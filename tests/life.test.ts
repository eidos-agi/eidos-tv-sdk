import test from "node:test";
import assert from "node:assert/strict";
import { Session, NO_FAULTS, replay, toolNames } from "@eidos-tv/core";
import { evaluate } from "../apps/server/src/evaluator";
const agent = { id: "agent", kind: "agent", transport: "mcp" } as const;
test("example uses common authority, deduplication, logical time, and replay", () => {
  const s = new Session({ scenarioId: "life-request" });
  assert.throws(
    () => s.dispatch(agent, "tv.requestJob", { text: "Prepare my next trip" }),
    /AUTHORITY_DENIED/,
  );
  s.dispatch(agent, "remote.type", { text: "Prepare my next trip" });
  s.dispatch(agent, "remote.press", { key: "SELECT" }, "submit");
  s.dispatch(agent, "remote.press", { key: "SELECT" }, "submit");
  assert.equal(s.snapshot().life?.jobs.length, 1);
  s.dispatch(agent, "remote.press", { key: "POWER" });
  s.dispatch(agent, "session.wait", { ms: 5000 });
  assert.equal(s.snapshot().life?.jobs[0].status, "completed");
  assert.deepEqual(replay(s.export()).snapshot(), s.snapshot());
  assert.equal(
    toolNames("remote-only", "life-center").includes("tv.requestJob"),
    false,
  );
});
test("voice delay, low confidence, disconnect, and worker faults apply to the example", () => {
  for (const fault of ["stt", "timeout", "packetLoss"] as const) {
    const s = new Session({
      scenarioId: "life-voice",
      latencyMs: 500,
      faults: { ...NO_FAULTS, [fault]: true },
    });
    s.dispatch(agent, "remote.pttStart", { sessionId: "v" });
    s.dispatch(agent, "remote.pttSpeak", {
      sessionId: "v",
      text: "Prepare my next trip",
      confidence: 1,
    });
    s.dispatch(agent, "session.wait", { ms: 6000 });
    assert.equal(s.snapshot().life?.jobs.length, 0);
    assert.equal(evaluate(s).success, false);
    assert.deepEqual(replay(s.export()).snapshot(), s.snapshot());
  }
  const offline = new Session({
    scenarioId: "life-request",
    authority: "semantic",
    faults: { ...NO_FAULTS, crash: true },
  });
  offline.dispatch(agent, "tv.requestJob", { text: "Prepare my next trip" });
  offline.dispatch(agent, "session.wait", { ms: 30000 });
  assert.equal(offline.snapshot().life?.jobs[0].status, "blocked");
  assert.equal(evaluate(offline).success, false);
  const disconnected = new Session({
    scenarioId: "life-request",
    faults: { ...NO_FAULTS, disconnect: true },
  });
  assert.throws(
    () => disconnected.dispatch(agent, "remote.type", { text: "hello" }),
    /DISCONNECTED/,
  );
});
test("dropped and duplicated keys are visible in the example trace", () => {
  const s = new Session({
    scenarioId: "life-request",
    faults: { ...NO_FAULTS, drop: true, duplicate: true },
  });
  s.dispatch(agent, "remote.type", { text: "Prepare my next trip" });
  s.dispatch(agent, "remote.press", { key: "SELECT" });
  assert.equal(s.snapshot().life?.jobs.length, 0);
  s.dispatch(agent, "remote.press", { key: "SELECT" });
  assert.equal(s.snapshot().life?.jobs.length, 1);
  assert.equal(s.trace.filter((e) => e.type === "fault.injected").length, 2);
  assert.deepEqual(replay(s.export()).snapshot(), s.snapshot());
});
