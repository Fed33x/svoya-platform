import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { io, type Socket } from "socket.io-client";
import { randomUUID } from "node:crypto";
const sleep = (n: number) => new Promise((r) => setTimeout(r, n));
test(
  "HTTP + realtime integration: roles, race, scoring, undo, TV loss, media and restart",
  { timeout: 40000 },
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "svoya-integration-"));
    const url = "http://127.0.0.1:3021";
    let processRef: ReturnType<typeof spawn>;
    let logs = "";
    const sockets: Socket[] = [];
    async function boot() {
      logs = "";
      processRef = spawn(
        process.execPath,
        ["--import", "tsx", "server/index.ts"],
        {
          env: {
            ...process.env,
            HOST: "127.0.0.1",
            PORT: "3021",
            ADMIN_PASSWORD: "testing-password",
            TV_KEY: "testing-tv",
            DATA_DIR: dir,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      processRef.stdout?.on("data", (c) => (logs += c));
      processRef.stderr?.on("data", (c) => (logs += c));
      for (let i = 0; i < 80; i++) {
        try {
          if (
            (
              await fetch(url + "/api/health", {
                signal: AbortSignal.timeout(500),
              })
            ).ok
          )
            return;
        } catch {}
        await sleep(100);
      }
      throw new Error(logs);
    }
    async function stop() {
      if (processRef.exitCode !== null) return;
      await new Promise<void>((r) => {
        processRef.once("exit", () => r());
        processRef.kill("SIGTERM");
        setTimeout(() => {
          processRef.kill("SIGKILL");
          r();
        }, 2000).unref();
      });
    }
    async function connect(auth: any, cookie?: string) {
      const s = io(url, {
        auth,
        extraHeaders: cookie ? { Cookie: cookie } : {},
        reconnection: false,
        forceNew: true,
      });
      sockets.push(s);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new Error("Socket connect timeout: " + JSON.stringify(auth)),
            ),
          5000,
        );
        s.once("connect", () => {
          clearTimeout(timer);
          resolve();
        });
        s.once("connect_error", (e) => {
          clearTimeout(timer);
          reject(e);
        });
      });
      return s;
    }
    async function post(endpoint: string, body: any, cookie = "") {
      return fetch(url + endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify(body),
      });
    }
    try {
      await boot();
      console.log("Integration: server ready");
      assert.equal((await fetch(url + "/api/admin")).status, 401);
      assert.equal(
        (await post("/api/login", { password: "wrong" })).status,
        401,
      );
      const login = await post("/api/login", { password: "testing-password" });
      assert.equal(login.status, 200);
      const cookie = login.headers.get("set-cookie")!.split(";")[0];
      assert.equal((await fetch(url + "/api/pack")).status, 401);
      const a = await (await post("/api/join", { name: "Антон" })).json();
      const b = await (await post("/api/join", { name: "Катя" })).json();
      assert.equal((await post("/api/join", { name: "Антон" })).status, 409);
      console.log("Integration: HTTP auth + join passed");
      const admin = await connect({ role: "admin" }, cookie);
      let state: any;
      admin.on("state", (v) => (state = v));
      const tv = await connect({ role: "tv", key: "testing-tv" });
      const pa = await connect({ role: "player", token: a.token });
      const pb = await connect({ role: "player", token: b.token });
      let publicView: any;
      pa.on("state", (s) => (publicView = s));
      await sleep(50);
      async function cmd(type: string, payload: any = {}, id = randomUUID()) {
        console.log("Command", type);
        await sleep(25);
        const r: any = await admin
          .timeout(3000)
          .emitWithAck("command", {
            id,
            revision: state.revision,
            type,
            payload,
          });
        assert.equal(r.ok, true, r.error);
        await sleep(25);
        return id;
      }
      console.log("Integration: sockets connected");
      await cmd("start");
      await cmd("select", { id: "q0-0" });
      assert.equal(publicView.current.answer, undefined);
      assert.equal(publicView.pack, undefined);
      assert.ok(!JSON.stringify(publicView).includes(a.token));
      await tv.emitWithAck("tv:ready", { id: "q0-0", step: 0 });
      await cmd("open");
      const epoch = state.epoch;
      const results: any[] = await Promise.all([
        pa.emitWithAck("buzz", { epoch }),
        pb.emitWithAck("buzz", { epoch }),
      ]);
      assert.equal(results.filter((x) => x.ok).length, 1);
      await sleep(30);
      const winner = state.winner;
      const duplicateId = await cmd("correct");
      assert.equal(
        state.players.find((p: any) => p.id === winner).scores.quiz,
        100,
      );
      await admin.emitWithAck("command", {
        id: duplicateId,
        revision: state.revision,
        type: "correct",
      });
      await sleep(20);
      assert.equal(
        state.players.find((p: any) => p.id === winner).scores.quiz,
        100,
      );
      await cmd("undo");
      assert.equal(state.phase, "paused");
      assert.equal(
        state.players.find((p: any) => p.id === winner).scores.quiz,
        0,
      );
      await cmd("resume");
      await cmd("correct");
      await cmd("board");
      await cmd("select", { id: "q0-1" });
      await tv.emitWithAck("tv:ready", { id: "q0-1", step: 0 });
      await cmd("open");
      tv.disconnect();
      await sleep(80);
      assert.equal(state.phase, "paused");
      const savedScore = state.players.find((p: any) => p.id === winner).scores
        .quiz;
      const fd = new FormData();
      fd.append(
        "file",
        new Blob([new Uint8Array([82, 73, 70, 70])], { type: "audio/wav" }),
        "test.wav",
      );
      const upload = await fetch(url + "/api/media", {
        method: "POST",
        headers: { Cookie: cookie },
        body: fd,
      });
      assert.equal(upload.status, 200);
      const { id: media } = await upload.json();
      assert.notEqual((await fetch(url + "/media/" + media)).status, 200);
      assert.equal(
        (
          await fetch(url + "/media/" + media, {
            headers: { "X-TV-Key": "testing-tv" },
          })
        ).status,
        200,
      );
      const fd2 = new FormData();
      fd2.append("file", new Blob(["<script>"]), "bad.html");
      assert.equal(
        (
          await fetch(url + "/api/media", {
            method: "POST",
            headers: { Cookie: cookie },
            body: fd2,
          })
        ).status,
        400,
      );
      await cmd("reveal");
      await cmd("board");
      await cmd("pack", {
        title: "Музыка",
        questions: [],
        tracks: [
          {
            id: "song",
            answer: "Тест",
            notes: "",
            media,
            start: 0,
            steps: [
              { seconds: 1, points: 500 },
              { seconds: 3, points: 400 },
            ],
          },
        ],
      });
      await cmd("mode", { mode: "melody" });
      await cmd("select", { id: "song" });
      const tv2 = await connect({ role: "tv", key: "testing-tv" });
      await tv2.emitWithAck("tv:ready", { id: "song", step: 0 });
      await cmd("open");
      await pa.emitWithAck("buzz", { epoch: state.epoch });
      await cmd("wrong");
      await cmd("nextStep");
      await tv2.emitWithAck("tv:ready", { id: "song", step: 1 });
      await cmd("open");
      await pa.emitWithAck("buzz", { epoch: state.epoch });
      await cmd("correct");
      assert.equal(
        state.players.find((p: any) => p.id === a.id).scores.melody,
        400,
      );
      for (const s of sockets) s.disconnect();
      await stop();
      await boot();
      const restored: any = await (
        await fetch(url + "/api/admin", { headers: { Cookie: cookie } })
      ).json();
      assert.equal(
        restored.state.players.find((p: any) => p.id === winner).scores.quiz,
        savedScore,
      );
      assert.equal(
        restored.state.players.find((p: any) => p.id === a.id).scores.melody,
        400,
      );
      const rejoin = await (await post("/api/join", { token: a.token })).json();
      assert.equal(rejoin.id, a.id);
    } catch (e) {
      console.error(logs);
      throw e;
    } finally {
      for (const s of sockets) s.disconnect();
      if (processRef! && !processRef.killed) await stop();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
