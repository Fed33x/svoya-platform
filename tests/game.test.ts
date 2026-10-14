import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initial,
  command,
  buzz,
  publicState,
  packSchema,
} from "../server/game.js";
function setup() {
  const g = initial();
  g.players = [
    {
      id: "a",
      token: "SECRET-A",
      name: "Антон",
      scores: { quiz: 0, melody: 0 },
    },
    {
      id: "b",
      token: "SECRET-B",
      name: "Катя",
      scores: { quiz: 0, melody: 0 },
    },
  ];
  command(g, "start");
  command(g, "select", { id: "q0-0" });
  return g;
}
test("server accepts exactly one winner and rejects stale buzz", () => {
  const g = setup();
  command(g, "open", {}, true);
  const epoch = g.epoch;
  buzz(g, "a", epoch);
  assert.throws(() => buzz(g, "b", epoch));
  assert.equal(g.winner, "a");
  command(g, "wrong");
  assert.equal(g.players[0].scores.quiz, -100);
  command(g, "open", {}, true);
  assert.throws(() => buzz(g, "a", g.epoch));
  assert.throws(() => buzz(g, "b", epoch));
  buzz(g, "b", g.epoch);
  command(g, "correct");
  assert.equal(g.players[1].scores.quiz, 100);
  assert.equal(g.phase, "revealed");
  assert.equal(g.chooser, "b");
  assert.throws(() => command(g, "correct"));
});
test("answers, notes, tokens and media do not leak to players", () => {
  const g = setup();
  g.pack.questions[0].media = "1234-abcd.jpg";
  const p = JSON.stringify(publicState(g, "player"));
  assert.ok(!p.includes("SECRET"));
  assert.ok(!p.includes("1234-abcd"));
  assert.ok(!p.includes("Демонстрационный"));
  assert.equal((publicState(g, "player") as any).current.answer, undefined);
  assert.equal((publicState(g, "tv") as any).current.answer, undefined);
  assert.equal((publicState(g, "admin") as any).current.answer, "12");
  command(g, "reveal");
  assert.equal((publicState(g, "player") as any).current.answer, "12");
});
test("TV must be ready, expired buzz rejected, pause closes buzzer", () => {
  const g = setup();
  assert.throws(() => command(g, "open"));
  command(g, "open", {}, true);
  g.deadline = Date.now() - 10;
  assert.throws(() => buzz(g, "a", g.epoch));
  command(g, "pause");
  assert.equal(g.deadline, null);
  assert.throws(() => buzz(g, "a", g.epoch));
  command(g, "resume");
  assert.equal(g.phase, "question");
});
test("melody fragments lower price, unblock players and scores remain separate", () => {
  const g = setup();
  command(g, "reveal");
  command(g, "board");
  g.pack.tracks = [
    {
      id: "song",
      answer: "Песня",
      notes: "",
      media: "abcd.mp3",
      start: 10,
      steps: [
        { seconds: 1, points: 500 },
        { seconds: 3, points: 400 },
      ],
    },
  ];
  command(g, "mode", { mode: "melody" });
  command(g, "select", { id: "song" });
  command(g, "open", {}, true);
  buzz(g, "a", g.epoch);
  command(g, "wrong");
  assert.equal(g.players[0].scores.melody, 0);
  assert.ok(g.blocked.includes("a"));
  command(g, "nextStep");
  assert.deepEqual(g.blocked, []);
  command(g, "open", {}, true);
  buzz(g, "a", g.epoch);
  command(g, "correct");
  assert.equal(g.players[0].scores.melody, 400);
  assert.equal(g.players[0].scores.quiz, 0);
});
test("pack validation rejects duplicate ids, cells and invalid fragment ladders", () => {
  const g = setup();
  assert.throws(() =>
    packSchema.parse({
      ...g.pack,
      questions: [g.pack.questions[0], g.pack.questions[0]],
    }),
  );
  assert.throws(() =>
    packSchema.parse({
      ...g.pack,
      tracks: [
        {
          id: "song",
          answer: "x",
          notes: "",
          media: "abcd.mp3",
          start: 0,
          steps: [
            { seconds: 3, points: 100 },
            { seconds: 1, points: 500 },
          ],
        },
      ],
    }),
  );
});
test("new evening clears scores but preserves players, settings and questions", () => {
  const g = setup();
  g.players[0].scores.quiz = 500;
  g.settings.answerSeconds = 30;
  command(g, "reset");
  assert.equal(g.phase, "lobby");
  assert.equal(g.players.length, 2);
  assert.equal(g.players[0].scores.quiz, 0);
  assert.equal(g.settings.answerSeconds, 30);
  assert.equal(g.pack.questions.length, 20);
});
