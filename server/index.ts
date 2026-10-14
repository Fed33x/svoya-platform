import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import { Server } from "socket.io";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync, existsSync, createWriteStream, unlinkSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  initial,
  command,
  buzz,
  bump,
  record,
  publicState,
  packSchema,
  type Game,
} from "./game.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = path.resolve(process.env.DATA_DIR || path.join(root, "data"));
mkdirSync(path.join(data, "media"), { recursive: true });
const adminPassword = process.env.ADMIN_PASSWORD;
if (!adminPassword || adminPassword.length < 8)
  throw new Error("Set ADMIN_PASSWORD (at least 8 characters)");
const tvKey = process.env.TV_KEY || randomBytes(12).toString("hex");
const equal = (a: unknown, b: string) =>
  typeof a === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const db = new DatabaseSync(path.join(data, "game.sqlite"));
db.exec(
  "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY, json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, expires INTEGER NOT NULL)",
);
const row = db.prepare("SELECT json FROM state WHERE id=1").get() as
  { json: string } | undefined;
let game: Game = row ? JSON.parse(row.json) : initial();
if (["open", "answering", "question"].includes(game.phase)) {
  game.phase = "paused";
  game.deadline = null;
  bump(game);
  record(game, "Сервер перезапущен. Игра на паузе.");
}
function save() {
  db.prepare(
    "INSERT INTO state(id,json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json",
  ).run(JSON.stringify(game));
}
save();
const app = Fastify({ logger: true, bodyLimit: 2 * 1024 * 1024 });
await app.register(cookie);
await app.register(rateLimit, { max: 180, timeWindow: "1 minute" });
await app.register(multipart, {
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
});
function isAdmin(req: any) {
  const t = req.cookies?.admin;
  return (
    typeof t === "string" &&
    !!db
      .prepare("SELECT token FROM sessions WHERE token=? AND expires>?")
      .get(t, Date.now())
  );
}
async function requireAdmin(req: any, reply: any) {
  if (!isAdmin(req))
    return reply.code(401).send({ error: "Войдите как ведущий" });
}
app.addHook("onRequest", async (req, reply) => {
  if (["POST", "PUT", "DELETE"].includes(req.method)) {
    const origin = req.headers.origin;
    if (origin) {
      let host = "";
      try {
        host = new URL(origin).host;
      } catch {}
      if (host !== req.headers.host)
        return reply.code(403).send({ error: "Origin mismatch" });
    }
  }
});
app.addHook("onSend", async (_req, reply) => {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Referrer-Policy", "same-origin");
  reply.header("X-Frame-Options", "DENY");
});
app.setErrorHandler((e, req, reply) => {
  const err = e as Error & { statusCode?: number };
  req.log.warn(e);
  reply
    .code(err.statusCode || 400)
    .send({ error: err.message || "Ошибка запроса" });
});
app.get("/api/health", async () => ({ ok: true, version: "1.0.0" }));
app.post(
  "/api/login",
  { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
  async (req, reply) => {
    if (!equal((req.body as any)?.password, adminPassword))
      return reply.code(401).send({ error: "Неверный пароль" });
    const token = randomBytes(32).toString("hex");
    db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
    db.prepare("INSERT INTO sessions VALUES(?,?)").run(
      token,
      Date.now() + 86400000,
    );
    reply.setCookie("admin", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.COOKIE_SECURE === "true",
      path: "/",
      maxAge: 86400,
    });
    return { ok: true };
  },
);
app.post("/api/logout", { preHandler: requireAdmin }, async (req, reply) => {
  db.prepare("DELETE FROM sessions WHERE token=?").run(req.cookies.admin!);
  reply.clearCookie("admin", { path: "/" });
  for (const s of io.sockets.sockets.values())
    if (s.data.session === req.cookies.admin) s.disconnect(true);
  return { ok: true };
});
app.get("/api/admin", { preHandler: requireAdmin }, async () => ({
  tvKey,
  publicUrl: process.env.PUBLIC_URL || "",
  state: publicState(game, "admin"),
}));
app.post(
  "/api/join",
  { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
  async (req, reply) => {
    const b = req.body as any;
    const existing = game.players.find((p) => equal(b?.token, p.token));
    if (existing)
      return { token: existing.token, id: existing.id, name: existing.name };
    if (game.locked)
      return reply.code(403).send({ error: "Ведущий закрыл вход" });
    const name =
      typeof b?.name === "string" ? b.name.trim().replace(/\s+/g, " ") : "";
    if (name.length < 1 || name.length > 24)
      return reply.code(400).send({ error: "Имя: от 1 до 24 символов" });
    if (
      game.players.some(
        (p) => p.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    )
      return reply
        .code(409)
        .send({ error: "Это имя уже занято. Добавьте фамилию или ник" });
    if (game.players.length >= 100)
      return reply.code(409).send({ error: "В комнате уже 100 игроков" });
    const p = {
      id: randomUUID(),
      token: randomBytes(32).toString("hex"),
      name,
      scores: { quiz: 0, melody: 0 },
    };
    game.players.push(p);
    bump(game);
    save();
    broadcast();
    return { token: p.token, id: p.id, name: p.name };
  },
);
app.post("/api/media", { preHandler: requireAdmin }, async (req, reply) => {
  const f = await req.file();
  if (!f) return reply.code(400).send({ error: "Выберите файл" });
  const ext = path.extname(f.filename).toLowerCase();
  if (
    ![".mp3", ".wav", ".m4a", ".ogg", ".jpg", ".png", ".webp", ".mp4"].includes(
      ext,
    )
  )
    return reply
      .code(400)
      .send({
        error: "Поддерживаются MP3, WAV, M4A, OGG, JPG, PNG, WebP, MP4",
      });
  const id = randomUUID() + ext;
  const target = path.join(data, "media", id);
  try {
    await pipeline(f.file, createWriteStream(target));
    if (f.file.truncated) throw new Error("Файл больше 100 МБ");
  } catch (e) {
    try {
      unlinkSync(target);
    } catch {}
    throw e;
  }
  return { id };
});
app.register(staticFiles, {
  root: path.join(data, "media"),
  prefix: "/media/",
  decorateReply: false,
  setHeaders: (r) => {
    r.header("Cache-Control", "private, max-age=86400");
  },
  allowedPath: (_p, _root, req: any) =>
    isAdmin(req) ||
    equal(req.headers["x-tv-key"], tvKey) ||
    equal(req.query?.key, tvKey),
});
app.get("/api/pack", { preHandler: requireAdmin }, async () => game.pack);
const io = new Server(app.server, {
  maxHttpBufferSize: 2 * 1024 * 1024,
  pingInterval: 3000,
  pingTimeout: 5000,
  allowRequest: (req, cb) => {
    const o = req.headers.origin;
    let ok = !o;
    try {
      ok = ok || new URL(o!).host === req.headers.host;
    } catch {}
    cb(null, ok);
  },
});
let tvSocket: string | null = null,
  readyItem: string | null = null;
const undo: Game[] = [];
const handled = new Map<string, unknown>();
function tvReady() {
  return !!tvSocket && readyItem === `${game.current}:${game.step}`;
}
function broadcast() {
  for (const s of io.sockets.sockets.values())
    s.emit("state", {
      ...publicState(game, s.data.role),
      serverTime: Date.now(),
      tv: { connected: !!tvSocket, ready: tvReady() },
      online: game.players
        .filter((p) =>
          [...io.sockets.sockets.values()].some((s) => s.data.player === p.id),
        )
        .map((p) => p.id),
    });
}
function changed() {
  save();
  broadcast();
}
function snapshot() {
  undo.push(structuredClone(game));
  if (undo.length > 50) undo.shift();
}
function adminValid(s: any) {
  return (
    s.data.role === "admin" &&
    !!db
      .prepare("SELECT token FROM sessions WHERE token=? AND expires>?")
      .get(s.data.session, Date.now())
  );
}
io.use((s, next) => {
  const a = s.handshake.auth;
  if (a.role === "admin") {
    const cookies = app.parseCookie(s.handshake.headers.cookie || "");
    const token = cookies.admin;
    if (
      token &&
      db
        .prepare("SELECT token FROM sessions WHERE token=? AND expires>?")
        .get(token, Date.now())
    ) {
      s.data.role = "admin";
      s.data.session = token;
      return next();
    }
  } else if (a.role === "tv" && equal(a.key, tvKey)) {
    if (tvSocket) return next(new Error("Другой экран уже подключён"));
    s.data.role = "tv";
    return next();
  } else if (a.role === "player") {
    const p = game.players.find((p) => equal(a.token, p.token));
    if (p) {
      s.data.role = "player";
      s.data.player = p.id;
      return next();
    }
  }
  next(new Error("Нет доступа. Войдите заново."));
});
io.on("connection", (s) => {
  if (s.data.role === "tv") {
    if (tvSocket) {
      s.disconnect(true);
      return;
    }
    tvSocket = s.id;
    readyItem = null;
  }
  broadcast();
  s.on("tv:ready", (p, ack = () => {}) => {
    if (typeof ack !== "function") ack = () => {};
    if (s.data.role !== "tv" || s.id !== tvSocket) return;
    readyItem =
      p?.id === game.current && p?.step === game.step
        ? `${p.id}:${p.step}`
        : null;
    broadcast();
    ack({ ok: true });
  });
  s.on("tv:error", (p) => {
    if (s.data.role !== "tv") return;
    readyItem = null;
    if (["open", "question", "answering"].includes(game.phase)) {
      command(game, "pause");
      record(
        game,
        "Ошибка ТВ: " + String(p?.message || "воспроизведение").slice(0, 150),
      );
      changed();
    }
  });
  s.on("buzz", (p, ack = () => {}) => {
    if (typeof ack !== "function") ack = () => {};
    try {
      if (s.data.role !== "player")
        throw new Error("Только игрок может нажать кнопку");
      if (typeof p?.epoch !== "string") throw new Error("Некорректное нажатие");
      buzz(game, s.data.player, p.epoch);
      changed();
      ack({ ok: true });
    } catch (e) {
      if (
        game.current &&
        game.attempts.length < 100 &&
        s.data.role === "player"
      ) {
        game.attempts.push({
          id: s.data.player,
          at: Date.now(),
          accepted: false,
        });
        save();
        broadcast();
      }
      ack({ ok: false, error: (e as Error).message });
    }
  });
  s.on("command", (p, ack = () => {}) => {
    if (typeof ack !== "function") ack = () => {};
    try {
      if (!adminValid(s)) throw new Error("Сессия ведущего истекла");
      if (typeof p?.id !== "string" || p.id.length > 100)
        throw new Error("Нет ID команды");
      if (handled.has(p.id)) return ack(handled.get(p.id));
      if (p.revision !== game.revision)
        throw new Error("Состояние изменилось. Повторите действие");
      const before = structuredClone(game);
      if (p.type === "undo") {
        const prev = undo.pop();
        if (!prev) throw new Error("Нет действий для отмены");
        const revision = game.revision;
        const players = game.players;
        game = prev;
        for (const player of players)
          if (!game.players.some((x) => x.id === player.id))
            game.players.push(player);
        game.revision = revision;
        if (["open", "answering"].includes(game.phase)) {
          game.phase = "paused";
          game.deadline = null;
        }
        bump(game);
        record(game, "Ведущий отменил последнее действие");
      } else {
        if (p.type === "pack") {
          const pack = packSchema.parse(p.payload);
          for (const x of [...pack.questions, ...pack.tracks])
            if (x.media && !existsSync(path.join(data, "media", x.media)))
              throw new Error("Медиафайл не найден: " + x.media);
        }
        command(game, p.type, p.payload, tvReady());
        undo.push(before);
        if (undo.length > 50) undo.shift();
      }
      if (before.current !== game.current || before.step !== game.step)
        readyItem = null;
      const result = { ok: true };
      handled.set(p.id, result);
      if (handled.size > 1000) handled.delete(handled.keys().next().value!);
      changed();
      ack(result);
    } catch (e) {
      ack({ ok: false, error: (e as Error).message });
    }
  });
  s.on("disconnect", () => {
    if (s.id === tvSocket) {
      tvSocket = null;
      readyItem = null;
      if (["open", "question", "answering"].includes(game.phase)) {
        command(game, "pause");
        record(game, "Экран отключился. Игра на паузе.");
        save();
      }
    }
    broadcast();
  });
});
const timer = setInterval(() => {
  if (game.deadline && Date.now() >= game.deadline) {
    if (game.phase === "answering") {
      snapshot();
      command(game, "wrong");
      record(game, "Время ответа истекло");
      changed();
    } else if (game.phase === "open") {
      game.phase = "question";
      game.deadline = null;
      bump(game);
      record(game, "Время на нажатие истекло");
      changed();
    }
  }
}, 200);
await app.register(staticFiles, { root: path.join(root, "dist"), prefix: "/" });
app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith("/api/") || req.url.startsWith("/media/"))
    return reply.code(404).send({ error: "Не найдено" });
  return reply.sendFile("index.html");
});
await app.listen({
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || "0.0.0.0",
});
async function shutdown() {
  clearInterval(timer);
  save();
  io.close();
  await app.close();
  db.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
