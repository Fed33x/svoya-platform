import { randomUUID } from "node:crypto";
import { z } from "zod";
export const questionSchema = z.object({
  id: z.string().min(1).max(64),
  category: z.string().min(1).max(60),
  value: z.number().int().min(1).max(100000),
  text: z.string().min(1).max(4000),
  answer: z.string().min(1).max(2000),
  notes: z.string().max(4000).default(""),
  media: z
    .string()
    .regex(/^[a-f0-9-]+\.(jpg|png|webp|mp4)$/)
    .optional(),
});
export const trackSchema = z.object({
  id: z.string().min(1).max(64),
  answer: z.string().min(1).max(2000),
  notes: z.string().max(4000).default(""),
  media: z.string().regex(/^[a-f0-9-]+\.(mp3|wav|m4a|ogg)$/),
  start: z.number().min(0).max(7200),
  steps: z
    .array(
      z.object({
        seconds: z.number().min(0.5).max(120),
        points: z.number().int().min(1).max(100000),
      }),
    )
    .min(1)
    .max(10),
});
export const packSchema = z
  .object({
    title: z.string().min(1).max(100),
    questions: z.array(questionSchema).max(200),
    tracks: z.array(trackSchema).max(100),
  })
  .superRefine((p, c) => {
    const ids = [...p.questions, ...p.tracks].map((q) => q.id);
    if (new Set(ids).size !== ids.length)
      c.addIssue({
        code: "custom",
        message: "ID вопросов и треков должны быть уникальны",
      });
    const cells = p.questions.map((q) => q.category + ":" + q.value);
    if (new Set(cells).size !== cells.length)
      c.addIssue({
        code: "custom",
        message: "В категории не может быть двух вопросов одной стоимости",
      });
    for (const t of p.tracks)
      for (let i = 1; i < t.steps.length; i++)
        if (
          t.steps[i].seconds <= t.steps[i - 1].seconds ||
          t.steps[i].points > t.steps[i - 1].points
        )
          c.addIssue({
            code: "custom",
            message: "Фрагменты должны удлиняться, а баллы — не расти",
          });
  });
export type Pack = z.infer<typeof packSchema>;
export type Mode = "quiz" | "melody";
export type Phase =
  | "lobby"
  | "board"
  | "question"
  | "open"
  | "answering"
  | "revealed"
  | "paused"
  | "finished";
export interface Player {
  id: string;
  name: string;
  token: string;
  scores: Record<Mode, number>;
}
export interface Game {
  revision: number;
  epoch: string;
  playId: string;
  screenWelcome: boolean;
  mode: Mode;
  phase: Phase;
  current: string | null;
  step: number;
  melodyElapsed: number;
  playStartedAt: number | null;
  players: Player[];
  used: string[];
  blocked: string[];
  winner: string | null;
  chooser: string | null;
  deadline: number | null;
  locked: boolean;
  log: { at: number; text: string }[];
  attempts: { id: string; at: number; accepted: boolean }[];
  pack: Pack;
  settings: {
    answerSeconds: number;
    openSeconds: number;
    wrongPenalty: boolean;
  };
}
export function demoPack(): Pack {
  return {
    title: "28-й Канал",
    questions: [
      "Разминка",
      "Знакомые места",
      "Техника",
      "Музыкальная пауза",
    ].flatMap((category, c) =>
      [100, 200, 300, 400, 500].map((value, i) => ({
        id: `q${c}-${i}`,
        category,
        value,
        text: [
          [
            "Сколько месяцев в году содержат 28 дней?",
            "Какой город называют Северной столицей России?",
            "Как называется самый большой океан?",
            "Какое число идёт после 999?",
            "Сколько граней у куба?",
          ],
          [
            "В какой стране находится Рим?",
            "На какой реке стоит Санкт-Петербург?",
            "Как называется столица Финляндии?",
            "Какой город раньше назывался Ленинградом?",
            "В каком городе находится Эйфелева башня?",
          ],
          [
            "Как называется кнопка подтверждения на клавиатуре?",
            "Что означает сокращение USB?",
            "Как называется контейнерная платформа с китом на логотипе?",
            "Какое устройство раздаёт Wi-Fi дома?",
            "Как называется каталог пользователей Microsoft?",
          ],
          [
            "Сколько струн у обычной гитары?",
            "Сколько нот в принятом буквенно-слоговом ряду от до до си?",
            "Как называется человек, управляющий оркестром?",
            "Как называется повторяющаяся часть песни?",
            "Как называется ансамбль из трёх исполнителей?",
          ],
        ][c][i],
        answer: [
          ["12", "Санкт-Петербург", "Тихий", "1000", "6"],
          ["Италия", "Нева", "Хельсинки", "Санкт-Петербург", "Париж"],
          [
            "Enter",
            "Universal Serial Bus",
            "Docker",
            "Роутер",
            "Active Directory",
          ],
          ["6", "7", "Дирижёр", "Припев", "Трио"],
        ][c][i],
        notes: "Демонстрационный вопрос. Замените на вопрос о своей жизни.",
      })),
    ),
    tracks: [],
  };
}
export function initial(pack = demoPack()): Game {
  return {
    revision: 0,
    epoch: randomUUID(),
    playId: randomUUID(),
    screenWelcome: false,
    mode: "quiz",
    phase: "lobby",
    current: null,
    step: 0,
    melodyElapsed: 0,
    playStartedAt: null,
    players: [],
    used: [],
    blocked: [],
    winner: null,
    chooser: null,
    deadline: null,
    locked: false,
    log: [],
    attempts: [],
    pack,
    settings: { answerSeconds: 15, openSeconds: 20, wrongPenalty: true },
  };
}
export function item(g: Game) {
  return g.mode === "quiz"
    ? g.pack.questions.find((q) => q.id === g.current)
    : g.pack.tracks.find((t) => t.id === g.current);
}
export function price(g: Game) {
  const q = item(g);
  return q ? ("value" in q ? q.value : q.steps[g.step].points) : 0;
}
export function record(g: Game, text: string) {
  g.log.unshift({ at: Date.now(), text });
  g.log = g.log.slice(0, 150);
}
export function bump(g: Game) {
  g.revision++;
  g.epoch = randomUUID();
}
export function freezeMelody(g: Game, now = Date.now()) {
  if (
    g.mode !== "melody" ||
    g.phase !== "open" ||
    g.playStartedAt === null
  )
    return;
  const track = item(g);
  if (!track || !("steps" in track)) return;
  const target = track.steps[g.step].seconds;
  g.melodyElapsed = Math.min(
    target,
    Math.max(0, g.melodyElapsed + (now - g.playStartedAt) / 1000),
  );
  g.playStartedAt = null;
}
function requireThat(ok: unknown, msg: string): asserts ok {
  if (!ok) throw new Error(msg);
}
function startOpen(g: Game, tvReady: boolean) {
  requireThat(g.phase === "question", "Кнопки сейчас нельзя открыть");
  requireThat(!g.screenWelcome, "Сначала верните игровой экран");
  requireThat(tvReady, "Подключите экран и дождитесь готовности медиа");
  const startedAt = Date.now();
  const current = item(g);
  const melodyRemaining =
    g.mode === "melody" && current && "steps" in current
      ? Math.max(0, current.steps[g.step].seconds - g.melodyElapsed)
      : 0;
  g.phase = "open";
  g.playId = randomUUID();
  g.winner = null;
  g.playStartedAt = g.mode === "melody" ? startedAt : null;
  g.deadline =
    startedAt + g.settings.openSeconds * 1000 + melodyRemaining * 1000;
}
export function command(g: Game, type: string, p: any = {}, tvReady = false) {
  switch (type) {
    case "start":
      requireThat(
        g.phase === "lobby" || g.phase === "finished",
        "Сначала завершите текущую игру",
      );
      g.phase = "board";
      g.screenWelcome = false;
      break;
    case "screenWelcome":
      requireThat(typeof p.visible === "boolean", "Некорректный режим экрана");
      if (
        p.visible &&
        ["question", "open", "answering"].includes(g.phase)
      ) {
        freezeMelody(g);
        g.phase = "paused";
        g.deadline = null;
      }
      g.screenWelcome = p.visible;
      break;
    case "mode":
      requireThat(["quiz", "melody"].includes(p.mode), "Неизвестный режим");
      requireThat(
        ["lobby", "board", "finished", "revealed"].includes(g.phase),
        "Сначала завершите вопрос",
      );
      g.mode = p.mode;
      g.phase = "board";
      g.current = null;
      g.melodyElapsed = 0;
      g.playStartedAt = null;
      g.winner = null;
      g.deadline = null;
      break;
    case "select":
      requireThat(g.phase === "board", "Сначала вернитесь к полю");
      requireThat(!g.used.includes(p.id), "Вопрос уже сыгран");
      requireThat(
        (g.mode === "quiz" ? g.pack.questions : g.pack.tracks).some(
          (q) => q.id === p.id,
        ),
        "Вопрос не найден",
      );
      g.current = p.id;
      g.step = 0;
      g.melodyElapsed = 0;
      g.playStartedAt = null;
      g.blocked = [];
      g.winner = null;
      g.attempts = [];
      g.phase = "question";
      g.deadline = null;
      break;
    case "open":
      startOpen(g, tvReady);
      break;
    case "replayStep": {
      requireThat(
        g.mode === "melody" && ["question", "open"].includes(g.phase),
        "Сейчас нельзя повторить отрезок",
      );
      const track = item(g);
      requireThat(track && "steps" in track, "Мелодия не найдена");
      g.melodyElapsed = g.step ? track.steps[g.step - 1].seconds : 0;
      g.playStartedAt = null;
      g.deadline = null;
      g.phase = "question";
      startOpen(g, tvReady);
      record(g, `Повторён отрезок ${g.step + 1}`);
      break;
    }
    case "restartMelody": {
      requireThat(
        g.mode === "melody" && ["question", "open"].includes(g.phase),
        "Сейчас нельзя начать песню сначала",
      );
      g.step = 0;
      g.melodyElapsed = 0;
      g.playStartedAt = null;
      g.deadline = null;
      g.blocked = [];
      g.winner = null;
      g.phase = "question";
      startOpen(g, tvReady);
      record(g, "Мелодия запущена сначала");
      break;
    }
    case "nextStep": {
      requireThat(
        g.mode === "melody" && ["question", "open"].includes(g.phase),
        "Сейчас нельзя увеличить фрагмент",
      );
      const t = g.pack.tracks.find((t) => t.id === g.current)!;
      requireThat(g.step < t.steps.length - 1, "Это последний фрагмент");
      freezeMelody(g);
      g.step++;
      g.blocked = [];
      g.winner = null;
      g.phase = "question";
      g.deadline = null;
      break;
    }
    case "correct":
    case "wrong": {
      requireThat(
        g.phase === "answering" && g.winner,
        "Сейчас никто не отвечает",
      );
      const player = g.players.find((x) => x.id === g.winner)!;
      const delta =
        type === "correct"
          ? price(g)
          : g.mode === "quiz" && g.settings.wrongPenalty
            ? -price(g)
            : 0;
      player.scores[g.mode] += delta;
      record(
        g,
        `${player.name}: ${type === "correct" ? "верно" : "неверно"} (${delta > 0 ? "+" : ""}${delta})`,
      );
      g.deadline = null;
      if (type === "correct") {
        g.chooser = player.id;
        g.phase = "revealed";
        if (!g.used.includes(g.current!)) g.used.push(g.current!);
      } else {
        g.blocked.push(player.id);
        g.winner = null;
        g.phase = "question";
      }
      break;
    }
    case "reveal":
      requireThat(
        ["question", "open", "answering", "paused"].includes(g.phase) &&
          g.current,
        "Нет открытого вопроса",
      );
      freezeMelody(g);
      g.phase = "revealed";
      g.deadline = null;
      if (!g.used.includes(g.current)) g.used.push(g.current);
      break;
    case "board":
      requireThat(g.phase === "revealed", "Сначала раскройте ответ");
      g.phase = "board";
      g.current = null;
      g.melodyElapsed = 0;
      g.playStartedAt = null;
      g.winner = null;
      g.deadline = null;
      break;
    case "pause":
      requireThat(
        ["question", "open", "answering"].includes(g.phase),
        "Нечего ставить на паузу",
      );
      freezeMelody(g);
      g.phase = "paused";
      g.deadline = null;
      break;
    case "resume":
      requireThat(g.phase === "paused", "Игра не на паузе");
      g.phase = g.winner ? "answering" : "question";
      g.deadline = g.winner
        ? Date.now() + g.settings.answerSeconds * 1000
        : null;
      break;
    case "finish":
      freezeMelody(g);
      g.phase = "finished";
      g.deadline = null;
      g.current = null;
      g.melodyElapsed = 0;
      g.playStartedAt = null;
      g.winner = null;
      break;
    case "lock":
      g.locked = !!p.locked;
      break;
    case "removePlayer": {
      const player = g.players.find((x) => x.id === p.id);
      requireThat(player, "Команда не найдена");
      g.players = g.players.filter((x) => x.id !== player.id);
      g.blocked = g.blocked.filter((id) => id !== player.id);
      g.attempts = g.attempts.filter((attempt) => attempt.id !== player.id);
      if (g.chooser === player.id) g.chooser = null;
      if (g.winner === player.id) {
        g.winner = null;
        g.deadline = null;
        if (g.phase === "answering") g.phase = "question";
      }
      record(g, `Команда «${player.name}» удалена из комнаты`);
      break;
    }
    case "score": {
      const x = g.players.find((x) => x.id === p.id);
      requireThat(
        x && Number.isInteger(p.delta) && Math.abs(p.delta) <= 100000,
        "Некорректная корректировка",
      );
      x.scores[g.mode] += p.delta;
      record(g, `${x.name}: корректировка ${p.delta}`);
      break;
    }
    case "settings":
      g.settings = z
        .object({
          answerSeconds: z.number().int().min(3).max(120),
          openSeconds: z.number().int().min(3).max(120),
          wrongPenalty: z.boolean(),
        })
        .parse(p);
      break;
    case "pack":
      requireThat(
        ["lobby", "board", "finished"].includes(g.phase),
        "Завершите вопрос перед изменением пакета",
      );
      g.pack = packSchema.parse(p);
      g.used = [];
      g.current = null;
      g.melodyElapsed = 0;
      g.playStartedAt = null;
      g.phase = "board";
      g.winner = null;
      g.chooser = null;
      g.deadline = null;
      break;
    case "reset": {
      const old = g;
      const fresh = initial(g.pack);
      fresh.players = g.players.map((x) => ({
        ...x,
        scores: { quiz: 0, melody: 0 },
      }));
      fresh.settings = g.settings;
      fresh.revision = old.revision;
      Object.assign(g, fresh);
      break;
    }
    default:
      throw new Error("Неизвестная команда");
  }
  bump(g);
}
export function buzz(g: Game, id: string, epoch: string) {
  requireThat(g.phase === "open" && g.epoch === epoch, "Кнопка уже закрыта");
  requireThat(!g.deadline || Date.now() < g.deadline, "Время вышло");
  requireThat(
    g.players.some((p) => p.id === id),
    "Игрок не найден",
  );
  requireThat(!g.blocked.includes(id), "Вы уже отвечали на этом этапе");
  freezeMelody(g);
  g.winner = id;
  g.phase = "answering";
  g.deadline = Date.now() + g.settings.answerSeconds * 1000;
  g.attempts.push({ id, at: Date.now(), accepted: true });
  record(g, `Первым нажал: ${g.players.find((p) => p.id === id)!.name}`);
  bump(g);
}
export function publicState(g: Game, role: string) {
  const q = item(g);
  return {
    revision: g.revision,
    epoch: g.epoch,
    playId: g.playId,
    screenWelcome: g.screenWelcome,
    mode: g.mode,
    phase: g.phase,
    step: g.step,
    melodyElapsed: g.melodyElapsed,
    playStartedAt: g.playStartedAt,
    players: g.players.map(({ token, ...p }) => p),
    used: g.used,
    blocked: g.blocked,
    winner: g.winner,
    chooser: g.chooser,
    deadline: g.deadline,
    locked: g.locked,
    title: g.pack.title,
    settings: g.settings,
    board: g.pack.questions.map((q) => ({
      id: q.id,
      category: q.category,
      value: q.value,
    })),
    tracks: g.pack.tracks.map((t, i) => ({
      id: t.id,
      label: `Мелодия ${i + 1}`,
    })),
    current: q
      ? {
          id: q.id,
          text: "text" in q ? q.text : "Угадай мелодию",
          value: price(g),
          ...("steps" in q
            ? {
                seconds: q.steps[g.step].seconds,
                steps: q.steps.length,
                ladder: q.steps.map((step) => ({
                  seconds: step.seconds,
                  points: step.points,
                })),
                start: q.start,
              }
            : {}),
          ...(role === "admin" || role === "tv" ? { media: q.media } : {}),
          ...(role === "admin" || g.phase === "revealed"
            ? { answer: q.answer }
            : {}),
          ...(role === "admin" ? { notes: q.notes } : {}),
        }
      : null,
    ...(role === "admin"
      ? { pack: g.pack, log: g.log, attempts: g.attempts }
      : {}),
  };
}
