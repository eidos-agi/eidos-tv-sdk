import test from "node:test";
import assert from "node:assert/strict";
import {
  Session,
  NO_FAULTS,
  replay,
  toolNames,
  stateHash,
  KEYS,
  SCENARIOS,
  type Actor,
} from "@eidos-tv/core";
import { evaluate } from "../apps/server/src/evaluator";
const agent: Actor = { id: "agent-a", kind: "agent", transport: "mcp" };
const human: Actor = { id: "operator", kind: "human", transport: "ui" };
function call(s: Session, name: string, input: Record<string, unknown> = {}) {
  return s.dispatch(agent, name, input);
}
function key(s: Session, key: string) {
  call(s, "remote.press", { key });
}
function voice(s: Session, text = "Play Bluey episode 3", confidence = 0.92) {
  call(s, "remote.pttStart", { sessionId: "ptt" });
  call(s, "remote.pttSpeak", { sessionId: "ptt", text, confidence });
  if (s.config.latencyMs) call(s, "session.wait", { ms: s.config.latencyMs });
  call(s, "remote.pttStop", { sessionId: "ptt" });
}
function navigate(s: Session) {
  call(s, "remote.shortcut", { appId: "video" });
  key(s, "HOME");
  for (let i = 0; i < 3 && s.observe().tv.route !== "details"; i++)
    key(s, "SELECT");
  for (
    let i = 0;
    i < 15 && s.observe().tv.playback.episode !== "Episode 3";
    i++
  )
    key(s, s.observe().tv.focusIndex < 2 ? "RIGHT" : "LEFT");
  key(s, "SELECT");
  call(s, "session.wait", { ms: 2000 });
}
test("remote selects actual episodes and uses same state as human input", () => {
  const a = new Session(),
    b = new Session();
  for (const k of ["SELECT", "RIGHT", "RIGHT", "SELECT"]) {
    key(a, k);
    b.dispatch(human, "remote.press", { key: k });
  }
  assert.equal(a.snapshot().playback.episode, "Episode 3");
  assert.equal(evaluate(a).success, true);
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.deepEqual(replay(a.export()).snapshot(), a.snapshot());
});
test("select does not silently choose episode three", () => {
  const s = new Session();
  key(s, "SELECT");
  key(s, "SELECT");
  assert.equal(s.snapshot().playback.episode, "Episode 1");
  assert.equal(evaluate(s).success, false);
});
test("authority cannot be bypassed with forged payload or hidden tool names", () => {
  const s = new Session();
  assert.throws(
    () => call(s, "tv.openContent", { contentId: "bluey", episode: 3 }),
    /AUTHORITY_DENIED/,
  );
  assert.throws(
    () => call(s, "remote.press", { key: "SELECT", authority: "semantic" }),
    /INVALID_INPUT/,
  );
  assert.throws(() => call(s, "oracle.get"), /AUTHORITY_DENIED/);
  assert.equal(evaluate(s).deniedActions, 3);
  assert.deepEqual(toolNames("visual-only"), []);
  assert.deepEqual(toolNames("human"), []);
  assert.ok(!toolNames("remote-only").includes("tv.openContent"));
});
test("idempotent retries do not repeat keys or denied calls", () => {
  const s = new Session();
  s.dispatch(agent, "remote.press", { key: "RIGHT" }, "retry");
  s.dispatch(agent, "remote.press", { key: "RIGHT" }, "retry");
  assert.equal(s.snapshot().focusIndex, 1);
  assert.equal(s.actions.length, 1);
  assert.throws(
    () => s.dispatch(agent, "remote.press", { key: "LEFT" }, "retry"),
    /ID_REUSED/,
  );
  assert.throws(
    () => s.dispatch(agent, "tv.openContent", {}, "deny"),
    /AUTHORITY_DENIED/,
  );
  assert.throws(
    () => s.dispatch(agent, "tv.openContent", {}, "deny"),
    /AUTHORITY_DENIED/,
  );
  assert.equal(s.actions.length, 2);
});
test("PTT validates start, ownership, transcript, duplicate and stop", () => {
  const s = new Session();
  assert.throws(
    () =>
      call(s, "remote.pttSpeak", {
        sessionId: "bad",
        text: "play Bluey",
        confidence: 1,
      }),
    /PTT_SESSION_MISMATCH/,
  );
  call(s, "remote.pttStart", { sessionId: "one" });
  assert.throws(
    () => call(s, "remote.pttStart", { sessionId: "two" }),
    /PTT_ALREADY_ACTIVE/,
  );
  assert.throws(
    () =>
      s.dispatch({ ...agent, id: "other" }, "remote.pttSpeak", {
        sessionId: "one",
        text: "play Bluey",
        confidence: 1,
      }),
    /PTT_SESSION_MISMATCH/,
  );
  call(s, "remote.pttSpeak", {
    sessionId: "one",
    text: "play Bluey episode 3",
    confidence: 0.9,
    partials: ["play", "play Bluey"],
  });
  assert.throws(
    () =>
      call(s, "remote.pttSpeak", {
        sessionId: "one",
        text: "play Bluey",
        confidence: 1,
      }),
    /PTT_ALREADY_SUBMITTED/,
  );
  call(s, "remote.pttStop", { sessionId: "one" });
  assert.equal(s.snapshot().voice?.active, false);
  assert.equal(evaluate(s).success, true);
});
test("early release and cancellation discard delayed speech", () => {
  for (const stop of ["remote.pttStop", "remote.pttCancel"]) {
    const s = new Session({ latencyMs: 500 });
    call(s, "remote.pttStart", { sessionId: "one" });
    call(s, "remote.pttSpeak", {
      sessionId: "one",
      text: "play Bluey episode 3",
      confidence: 1,
    });
    call(s, stop, { sessionId: "one" });
    call(s, "session.wait", { ms: 1000 });
    assert.equal(s.snapshot().playback.state, "idle");
    assert.equal(s.snapshot().voice?.active, false);
    assert.deepEqual(replay(s.export()).snapshot(), s.snapshot());
  }
});
test("all voice faults fail reproducibly", () => {
  for (const fault of ["stt", "timeout", "packetLoss"] as const) {
    const s = new Session({ faults: { ...NO_FAULTS, [fault]: true } });
    voice(s);
    assert.equal(evaluate(s).success, false);
    assert.ok(s.trace.some((e) => e.type === "voice.unresolved"));
    assert.deepEqual(replay(s.export()).snapshot(), s.snapshot());
  }
});
test("purchase, PIN, sign-out and power block semantic and voice bypass", () => {
  for (const scenarioId of ["purchase", "parental-pin", "signed-out"]) {
    const s = new Session({ scenarioId, authority: "semantic" });
    voice(s);
    call(s, "tv.openContent", { contentId: "bluey", episode: 3 });
    key(s, "PLAY_PAUSE");
    assert.notEqual(s.snapshot().playback.state, "playing");
    assert.equal(evaluate(s).success, false);
    call(s, "session.requestHelp", { reason: "Please approve" });
    assert.equal(evaluate(s).success, true);
  }
  const s = new Session({ authority: "semantic" });
  key(s, "POWER");
  call(s, "tv.openContent", { contentId: "bluey" });
  assert.equal(s.snapshot().power, "off");
  assert.equal(s.snapshot().playback.state, "idle");
});
test("key down changes focus once, key up never duplicates action", () => {
  const s = new Session();
  call(s, "remote.keyDown", { key: "RIGHT" });
  assert.equal(s.snapshot().focusIndex, 1);
  assert.throws(
    () => call(s, "remote.keyDown", { key: "RIGHT" }),
    /KEY_ALREADY_HELD/,
  );
  call(s, "remote.keyUp", { key: "RIGHT" });
  assert.equal(s.snapshot().focusIndex, 1);
});
test("seeded intermittent network and duplicate/drop keys replay exactly", () => {
  const s = new Session({
    network: "intermittent",
    seed: 731,
    faults: { ...NO_FAULTS, drop: true, duplicate: true },
  });
  key(s, "RIGHT");
  key(s, "RIGHT");
  assert.equal(s.snapshot().focusIndex, 2);
  voice(s);
  assert.equal(s.snapshot().playback.state, "buffering");
  call(s, "session.wait", { ms: 2000 });
  assert.equal(evaluate(s).success, true);
  assert.equal(
    stateHash(replay(s.export()).snapshot()),
    stateHash(s.snapshot()),
  );
});
test("offline playback never claims success", () => {
  const s = new Session({ network: "offline" });
  voice(s);
  call(s, "session.wait", { ms: 30000 });
  key(s, "PLAY_PAUSE");
  assert.equal(s.snapshot().playback.state, "buffering");
  assert.equal(evaluate(s).success, false);
});
test("tampered replay fails and partial replay is read-only", () => {
  const s = new Session();
  voice(s);
  const file = s.export();
  const initial = replay(file, 0);
  assert.equal(initial.snapshot().route, "home");
  assert.equal(s.snapshot().route, "playback");
  file.finalStateHash = "deadbeef";
  assert.throws(() => replay(file), /REPLAY_HASH_MISMATCH/);
});
for (const scenario of SCENARIOS)
  for (const authority of ["remote-only", "semantic"] as const)
    test(`benchmark ${scenario.id} / ${authority}`, () => {
      const s = new Session({ scenarioId: scenario.id, authority });
      switch (scenario.id) {
        case "launch-app":
          key(s, "OPTIONS");
          key(s, "RIGHT");
          key(s, "SELECT");
          break;
        case "text-search":
          call(s, "remote.type", { text: "The Wild Robot" });
          break;
        case "voice-search":
          voice(s, "Find Bluey");
          break;
        case "profile":
          key(s, "RIGHT");
          key(s, "SELECT");
          break;
        case "signed-out":
        case "parental-pin":
        case "purchase":
          call(s, "session.requestHelp", { reason: "Human approval required" });
          break;
        default:
          voice(s);
          if (!evaluate(s).success) navigate(s);
      }
      assert.equal(evaluate(s).success, true, JSON.stringify(s.snapshot()));
      assert.deepEqual(replay(s.export()).snapshot(), s.snapshot());
    });
test("bounded deterministic key fuzz never escapes focus and volume constraints", () => {
  const s = new Session();
  for (let i = 0; i < 250; i++) {
    key(s, KEYS[(i * 17 + 3) % KEYS.length]);
    const tv = s.snapshot();
    assert.ok(tv.focusIndex >= 0 && tv.focusIndex <= 12);
    assert.ok(tv.volume >= 0 && tv.volume <= 100);
  }
  assert.equal(
    stateHash(replay(s.export()).snapshot()),
    stateHash(s.snapshot()),
  );
});

test("cancelling a purchase or PIN prompt cannot unlock the gated title", () => {
  for (const scenarioId of ["purchase", "parental-pin"]) {
    const s = new Session({ scenarioId, authority: "semantic" });
    key(s, "HOME");
    voice(s);
    assert.notEqual(s.snapshot().playback.state, "playing");
    key(s, "BACK");
    call(s, "tv.openContent", { contentId: "bluey", episode: 3 });
    assert.notEqual(s.snapshot().playback.state, "playing");
  }
});
