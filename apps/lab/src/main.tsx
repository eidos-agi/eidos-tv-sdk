import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  HOME_CONTENT,
  APPS,
  currentFocusLabel,
  searchResults,
} from "@eidos-tv/core/tv";
import type { AuthorityMode, RemoteKey, TvState } from "@eidos-tv/protocol";
import { registerWebMCP } from "./webmcp";
import { download, snapshot, record } from "./capture";
import "./styles.css";
const fragment = new URLSearchParams(location.hash.slice(1));
const operatorToken = fragment.get("operator");
const agentToken = fragment.get("agent");
const token = operatorToken ?? agentToken;
const operator = !!operatorToken;
const uid = () => crypto.randomUUID();
async function api(path: string, data?: unknown, auth = token) {
  const response = await fetch(`/api${path}`, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${auth ?? ""}`,
      ...(data !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error ?? response.statusText);
  return result;
}
interface Scenario {
  id: string;
  name: string;
  goal: string;
}
interface View {
  id: string;
  revision?: number;
  config?: {
    scenarioId: string;
    authority: AuthorityMode;
    seed: number;
    faults: Record<string, boolean>;
    latencyMs: number;
    network: TvState["network"];
  };
  authority?: AuthorityMode;
  observation: { tv: TvState; focusLabel: string; timeMs: number };
  trace?: { seq: number; timeMs: number; type: string; summary: string }[];
  result?: {
    success: boolean;
    actions: number;
    remotePresses: number;
    pttInteractions: number;
    deniedActions: number;
    durationMs: number;
    finalStateHash: string;
  };
  scenario: Scenario;
  lease?: boolean;
  tools: string[];
}
function App() {
  const [view, setView] = useState<View>();
  const viewRef = useRef<View | undefined>(undefined);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState("Play episode three of Bluey");
  const [confidence, setConfidence] = useState(0.92);
  const [query, setQuery] = useState("Bluey");
  const [running, setRunning] = useState(false);
  const generation = useRef(0);
  const [progress, setProgress] = useState<string[]>([]);
  const [grant, setGrant] = useState<string>();
  const [webmcp, setWebmcp] = useState("Open an agent view to register WebMCP");
  const [saved, setSaved] = useState<{ id: string }[]>([]);
  const [traceFile, setTraceFile] = useState<any>();
  const [replayAt, setReplayAt] = useState(0);
  const [replayTv, setReplayTv] = useState<TvState>();
  const [png, setPng] = useState<string>();
  const [recording, setRecording] = useState(false);
  const stopRecording = useRef<(() => void) | undefined>(undefined);
  const screen = useRef<HTMLDivElement>(null);
  const ptt = useRef<string | undefined>(undefined);
  const pending = useRef(Promise.resolve());
  const runnerToken = useRef<string | undefined>(undefined);
  function show(v: View) {
    viewRef.current = v;
    setView(v);
  }
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : String(e));
  function queue(action: () => Promise<unknown>) {
    const gen = generation.current;
    pending.current = pending.current
      .then(() => (gen === generation.current ? action() : undefined))
      .then(() => {}, fail);
    return pending.current;
  }
  async function refresh() {
    const v = viewRef.current;
    const gen = generation.current;
    if (v) {
      const next = await api(`/sessions/${v.id}`);
      if (gen === generation.current && viewRef.current?.id === v.id)
        show(next);
    }
  }
  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!token) return;
      const me = await api("/me");
      const all = await api("/scenarios");
      if (!alive) return;
      setScenarios(all);
      const v = me.operator
        ? me.sessions.length
          ? await api(`/sessions/${me.sessions[0]}`)
          : await api("/sessions", {})
        : await api(`/sessions/${me.sessionId}`);
      if (alive) show(v);
    })().catch(fail);
    const timer = setInterval(() => {
      if (alive && viewRef.current) void refresh().catch(fail);
    }, 700);
    return () => {
      alive = false;
      clearInterval(timer);
      generation.current++;
      stopRecording.current?.();
    };
  }, []);
  async function call(
    name: string,
    input: Record<string, unknown> = {},
    auth = token,
    transport = "ui",
  ) {
    const v = viewRef.current;
    if (!v) throw Error("Session not connected");
    const result = await api(
      `/sessions/${v.id}/action`,
      {
        name,
        input,
        requestId: uid(),
        transport,
        ...(operator && auth === token ? { revision: v.revision } : {}),
      },
      auth,
    );
    if (result.session && result.session.revision === viewRef.current?.revision)
      show(result.session);
    else await refresh();
    return result.result;
  }
  useEffect(() => {
    if (!view || operator || !agentToken) return;
    let cleanup: undefined | (() => void);
    let disposed = false;
    void (async () => {
      const tools = await api(`/sessions/${view.id}/tools`);
      const stop = await registerWebMCP(
        tools,
        (name, input) => call(name, input, agentToken, "webmcp"),
        setWebmcp,
      );
      if (disposed) stop();
      else cleanup = stop;
    })().catch(fail);
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [view?.id]);
  function key(key: RemoteKey) {
    void queue(() => call("remote.press", { key }));
  }
  function startPtt() {
    if (ptt.current) return;
    const sessionId = uid();
    ptt.current = sessionId;
    void queue(() => call("remote.pttStart", { sessionId }));
  }
  function stopPtt(cancel = false) {
    const sessionId = ptt.current;
    if (!sessionId) return;
    ptt.current = undefined;
    void queue(async () => {
      if (cancel) {
        await call("remote.pttCancel", { sessionId });
        return;
      }
      await call("remote.pttSpeak", {
        sessionId,
        text: transcript,
        confidence,
        partials: [transcript.slice(0, Math.ceil(transcript.length / 2))],
      });
      const latency = viewRef.current?.config?.latencyMs ?? 0;
      if (latency) await call("session.wait", { ms: latency });
      await call("remote.pttStop", { sessionId });
    });
  }
  const inputRefs = useRef({ key, startPtt, stopPtt });
  inputRefs.current = { key, startPtt, stopPtt };
  useEffect(() => {
    const mapping: Record<string, RemoteKey> = {
      ArrowUp: "UP",
      ArrowDown: "DOWN",
      ArrowLeft: "LEFT",
      ArrowRight: "RIGHT",
      Enter: "SELECT",
      Home: "HOME",
      Escape: "BACK",
      " ": "PLAY_PAUSE",
    };
    function down(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLElement &&
        e.target.closest("input,textarea,select,button")
      )
        return;
      if (e.repeat) return;
      if (e.code === "KeyV") {
        e.preventDefault();
        inputRefs.current.startPtt();
      } else if (mapping[e.key]) {
        e.preventDefault();
        inputRefs.current.key(mapping[e.key]);
      }
    }
    function up(e: KeyboardEvent) {
      if (e.code === "KeyV") inputRefs.current.stopPtt();
    }
    const blur = () => inputRefs.current.stopPtt(true);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);
  async function reset(patch: Record<string, unknown> = {}) {
    const gen = ++generation.current;
    setRunning(false);
    setProgress([]);
    ptt.current = undefined;
    setGrant(undefined);
    runnerToken.current = undefined;
    setReplayTv(undefined);
    setError("");
    const v = viewRef.current!;
    const fresh = await api(`/sessions/${v.id}/reset`, {
      ...v.config,
      ...(patch.scenarioId
        ? {
            faults: Object.fromEntries(
              Object.keys(v.config!.faults).map((key) => [key, false]),
            ),
          }
        : {}),
      ...patch,
    });
    if (gen === generation.current) show(fresh);
  }
  async function makeGrant() {
    const gen = generation.current;
    const v = viewRef.current!;
    const g = await api(`/sessions/${v.id}/grant`, { revision: v.revision });
    if (gen !== generation.current) {
      await api(`/sessions/${v.id}/revoke`, { token: g.token });
      throw Error("RUN_CANCELLED");
    }
    setGrant(g.token);
    return g.token as string;
  }
  async function run() {
    if (running || !view?.config) return;
    const gen = ++generation.current;
    setRunning(true);
    setProgress([]);
    setError("");
    const id = view.id;
    let auth: string | undefined;
    try {
      const fresh = await api(`/sessions/${id}/reset`, view.config);
      if (gen !== generation.current) throw Error("RUN_CANCELLED");
      show(fresh);
      auth = await makeGrant();
      runnerToken.current = auth;
      const mode = view.config.authority;
      if (!["semantic", "remote-only"].includes(mode))
        throw Error("Use the rendered remote for this access mode");
      const step = async (
        name: string,
        input: Record<string, unknown> = {},
      ) => {
        if (gen !== generation.current) throw Error("RUN_CANCELLED");
        const result = await call(name, input, auth, "internal");
        if (gen !== generation.current) throw Error("RUN_CANCELLED");
        setProgress((p) => [
          ...p,
          `${name}${input.key ? " · " + input.key : ""}`,
        ]);
        return result;
      };
      await step("tv.observe");
      const scenario = view.config.scenarioId;
      if (["signed-out", "parental-pin", "purchase"].includes(scenario))
        await step("session.requestHelp", {
          reason: "Please provide sign-in or approval before playback.",
        });
      else if (scenario === "profile") {
        await step("remote.press", { key: "RIGHT" });
        await step("remote.press", { key: "SELECT" });
      } else if (scenario === "launch-app") {
        await step("remote.press", { key: "OPTIONS" });
        await step("remote.press", { key: "RIGHT" });
        await step("remote.press", { key: "SELECT" });
      } else if (scenario === "text-search")
        await step("remote.type", { text: "The Wild Robot" });
      else {
        await step("remote.press", { key: "HOME" });
        if (mode === "semantic") {
          await step("tv.launchApp", { appId: "video" });
          await step("tv.openContent", { contentId: "bluey", episode: 3 });
        } else {
          const sessionId = uid();
          await step("remote.pttStart", { sessionId });
          await step("remote.pttSpeak", {
            sessionId,
            text: scenario === "voice-search" ? "Find Bluey" : transcript,
            confidence,
            partials: ["Play episode three"],
          });
          if (view.config.latencyMs)
            await step("session.wait", { ms: view.config.latencyMs });
          await step("remote.pttStop", { sessionId });
        }
        let observed = (await step("tv.observe")) as View["observation"];
        if (observed.tv.modal)
          await step("session.requestHelp", {
            reason: "The TV requires human approval.",
          });
        else if (
          scenario !== "voice-search" &&
          (observed.tv.playback.state !== "playing" ||
            observed.tv.playback.episode !== "Episode 3")
        ) {
          // Recovery uses only the public observation and the rendered remote controls.
          if (observed.tv.playback.state === "buffering")
            await step("session.wait", { ms: 2000 });
          else {
            await step("remote.shortcut", { appId: "video" });
            await step("remote.press", { key: "HOME" });
            for (let attempts = 0; attempts < 3; attempts++) {
              observed = (await step("tv.observe")) as View["observation"];
              if (observed.tv.route === "details") break;
              await step("remote.press", { key: "SELECT" });
            }
            observed = (await step("tv.observe")) as View["observation"];
            for (
              let attempts = 0;
              attempts < 15 && observed.tv.playback.episode !== "Episode 3";
              attempts++
            ) {
              await step("remote.press", {
                key: observed.tv.focusIndex < 2 ? "RIGHT" : "LEFT",
              });
              observed = (await step("tv.observe")) as View["observation"];
            }
            await step("remote.press", { key: "SELECT" });
            await step("session.wait", { ms: 2000 });
          }
        }
      }
      await step("tv.observe");
    } catch (e) {
      if ((e as Error).message !== "RUN_CANCELLED") fail(e);
    } finally {
      if (gen === generation.current) {
        await api(`/sessions/${id}/takeover`, {}).catch(fail);
        setGrant(undefined);
        setRunning(false);
        await refresh();
      }
    }
  }
  async function exportTrace() {
    const data = await api(`/sessions/${view!.id}/trace`);
    setTraceFile(data);
    setReplayAt(data.actions.length);
    download(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      `eidos-tv-${view!.id}.json`,
    );
    setSaved(await api("/runs"));
  }
  async function scrub(through: number, file = traceFile) {
    setReplayAt(through);
    const result = await api("/replay", { trace: file, through });
    setReplayTv(result.observation.tv);
  }
  if (!token)
    return (
      <main className="welcome">
        <h1>Eidos TV Device Lab</h1>
        <p>
          Open the operator launch URL printed by <code>npm start</code>, or a
          session link issued by the operator.
        </p>
        <p>Every session has its own remote, TV, permissions and trace.</p>
      </main>
    );
  if (!view)
    return (
      <main className="welcome">
        <h1>Connecting to the lab…</h1>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  const tv = replayTv ?? view.observation.tv;
  const config = view.config;
  const authority = config?.authority ?? view.authority;
  const pttProps = {
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      startPtt();
    },
    onPointerUp: () => stopPtt(),
    onPointerCancel: () => stopPtt(true),
    onKeyDown: (e: React.KeyboardEvent) => {
      if ([" ", "Enter"].includes(e.key) && !e.repeat) {
        e.preventDefault();
        startPtt();
      }
    },
    onKeyUp: (e: React.KeyboardEvent) => {
      if ([" ", "Enter"].includes(e.key)) {
        e.preventDefault();
        stopPtt();
      }
    },
  };
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">▣</div>
          <div>
            <strong>Eidos TV SDK</strong>
            <span>Device Lab · v0.1</span>
          </div>
        </div>
        <div className="session-identity">
          {operator ? "Operator" : "Agent"} · {view.id.slice(0, 8)} ·{" "}
          {authority}
        </div>
        <div className="top-actions">
          <a
            href="https://github.com/eidos-agi/eidos-tv-sdk#readme"
            target="_blank"
            rel="noreferrer"
          >
            Docs ↗
          </a>
          <a
            href="https://github.com/eidos-agi/eidos-tv-sdk"
            target="_blank"
            rel="noreferrer"
          >
            GitHub ↗
          </a>
        </div>
      </header>
      {error && (
        <div className="error-message" role="alert">
          {error}
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
      <main className={`lab-grid ${operator ? "" : "agent-view"}`}>
        {operator && config && (
          <aside className="panel session-panel">
            <h2>Session configuration</h2>
            <p className="meta">Generic Streaming TV · Voice remote</p>
            <Field label="Scenario">
              <select
                value={config.scenarioId}
                onChange={(e) =>
                  void reset({ scenarioId: e.target.value }).catch(fail)
                }
              >
                {scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Agent access">
              <select
                value={authority}
                onChange={(e) =>
                  void reset({ authority: e.target.value }).catch(fail)
                }
              >
                <option value="semantic">Direct TV tools</option>
                <option value="remote-only">Remote tools only</option>
                <option value="visual-only">Rendered remote only</option>
                <option value="human">Human / manual</option>
              </select>
            </Field>
            <Field label="Network">
              <select
                value={config.network}
                onChange={(e) =>
                  void reset({ network: e.target.value }).catch(fail)
                }
              >
                {["normal", "slow", "intermittent", "offline"].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </Field>
            <Field label="Voice delay (logical ms)">
              <input
                type="number"
                min="0"
                max="30000"
                value={config.latencyMs}
                onChange={(e) =>
                  void reset({ latencyMs: Number(e.target.value) }).catch(fail)
                }
              />
            </Field>
            <h3>Fault injection</h3>
            {Object.entries(config.faults).map(([name, checked]) => (
              <label className="option" key={name}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    void reset({
                      faults: { ...config.faults, [name]: !checked },
                    }).catch(fail)
                  }
                />
                {
                  (
                    {
                      stt: "Low-confidence STT",
                      drop: "Drop next key",
                      duplicate: "Duplicate next key",
                      disconnect: "Remote disconnected",
                      crash: "Crash once",
                      purchase: "Purchase gate",
                      pin: "Parental PIN",
                      timeout: "STT timeout",
                      packetLoss: "Audio packet loss",
                    } as Record<string, string>
                  )[name]
                }
              </label>
            ))}
            <button
              className="primary full"
              disabled={
                running || !["semantic", "remote-only"].includes(authority!)
              }
              onClick={() => void run()}
            >
              {running ? "Running…" : "Start test run"}
            </button>
            <button
              className="secondary full"
              onClick={() => void reset().catch(fail)}
            >
              Reset session
            </button>
            <button
              className="secondary full"
              onClick={() =>
                void api(`/sessions/${view.id}/takeover`, {})
                  .then(() => {
                    generation.current++;
                    setRunning(false);
                    setGrant(undefined);
                    return refresh();
                  })
                  .catch(fail)
              }
            >
              Take control / revoke agent
            </button>
            <p className="meta">
              Configuration changes start a fresh run and revoke existing
              grants.
            </p>
          </aside>
        )}
        <section className="center-stage">
          <div className="tv-frame">
            <div className="tv-screen" ref={screen}>
              <TvView
                state={tv}
                selected={HOME_CONTENT[tv.focusIndex] ?? HOME_CONTENT[0]}
              />
            </div>
            <div className="tv-stand" />
          </div>
          <div className="tv-status" aria-live="polite">
            {tv.power === "off"
              ? "TV off"
              : `${tv.route} · ${currentFocusLabel(tv)}`}{" "}
            · Volume {tv.muted ? "muted" : tv.volume}
            {tv.voice?.active ? " · Listening…" : ""}
            {replayTv ? " · REPLAY" : ""}
          </div>
          <div className="bottom-grid">
            <section className="panel voice-panel">
              <h2>Voice / PTT</h2>
              <button
                aria-label="Hold to talk"
                className={`ptt-button ${tv.voice?.active ? "active" : ""}`}
                {...pttProps}
              >
                🎙
              </button>
              <p className="ptt-help">
                Hold the mic or V. Release to send the fixture.
              </p>
              <Field label="Fixture transcript">
                <input
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                />
              </Field>
              <Field label={`Confidence · ${confidence.toFixed(2)}`}>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={confidence}
                  onChange={(e) => setConfidence(Number(e.target.value))}
                />
              </Field>
              <Field label="Remote text">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </Field>
              <button
                className="secondary"
                onClick={() =>
                  void queue(() => call("remote.type", { text: query }))
                }
              >
                Send text
              </button>
              <button
                className="secondary"
                onClick={() =>
                  void queue(() => call("session.wait", { ms: 2000 }))
                }
              >
                Advance 2 seconds
              </button>
            </section>
            {operator && (
              <>
                <section className="panel capture-panel">
                  <h2>Screen capture</h2>
                  <div className="mini-screen">
                    {png ? (
                      <img src={png} alt="Captured TV frame" />
                    ) : (
                      <p className="meta">No snapshot yet</p>
                    )}
                  </div>
                  <div className="button-row">
                    <button
                      className="secondary"
                      onClick={() =>
                        void snapshot(screen.current!).then(setPng).catch(fail)
                      }
                    >
                      Take snapshot
                    </button>
                    <button
                      className={recording ? "danger" : "secondary"}
                      onClick={() => {
                        if (recording) {
                          stopRecording.current?.();
                          setRecording(false);
                        } else
                          void record(screen.current!, setError)
                            .then((stop) => {
                              stopRecording.current = stop;
                              setRecording(true);
                            })
                            .catch(fail);
                      }}
                    >
                      {recording ? "Stop recording" : "Record video"}
                    </button>
                  </div>
                  <p className="meta">
                    PNG frames and WebM video download from the rendered TV.
                  </p>
                </section>
                <section className="panel trace-panel">
                  <h2>Canonical trace</h2>
                  <div className="trace-list">
                    {view.trace?.slice(-30).map((e) => (
                      <div className="trace-row" key={e.seq}>
                        <time>{e.timeMs}ms</time>
                        <strong title={e.type}>{e.type}</strong>
                        <span title={e.summary}>{e.summary}</span>
                      </div>
                    ))}
                  </div>
                  <button
                    className="secondary"
                    onClick={() => void exportTrace().catch(fail)}
                  >
                    Export trace
                  </button>
                </section>
              </>
            )}
          </div>
          {operator && (
            <section className="panel replay-panel">
              <h2>Replay & saved runs</h2>
              <div className="button-row">
                <label className="secondary file-input">
                  Import trace
                  <input
                    aria-label="Import trace"
                    type="file"
                    accept="application/json,.json"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file)
                        void file
                          .text()
                          .then(async (text) => {
                            const data = JSON.parse(text);
                            await scrub(data.actions.length, data);
                            setTraceFile(data);
                          })
                          .catch(fail);
                    }}
                  />
                </label>
                <button
                  className="secondary"
                  onClick={() => void api("/runs").then(setSaved).catch(fail)}
                >
                  Load saved runs
                </button>
                {replayTv && (
                  <button
                    className="secondary"
                    onClick={() => setReplayTv(undefined)}
                  >
                    Return to live TV
                  </button>
                )}
              </div>
              {traceFile && (
                <Field
                  label={`Replay action ${replayAt} / ${traceFile.actions.length}`}
                >
                  <input
                    aria-label="Replay timeline"
                    type="range"
                    min="0"
                    max={traceFile.actions.length}
                    value={replayAt}
                    onChange={(e) =>
                      void scrub(Number(e.target.value)).catch(fail)
                    }
                  />
                </Field>
              )}
              <div className="saved-runs">
                {saved.map((r) => (
                  <button
                    className="link-button"
                    key={r.id}
                    onClick={() =>
                      void api(`/sessions/${r.id}/restore`, {})
                        .then(show)
                        .catch(fail)
                    }
                  >
                    {r.id.slice(0, 8)} · restore
                  </button>
                ))}
              </div>
            </section>
          )}
        </section>
        <section className="right-rail">
          <VirtualRemote
            onKey={key}
            pttProps={pttProps}
            active={!!tv.voice?.active}
            shortcut={(appId) =>
              void queue(() => call("remote.shortcut", { appId }))
            }
          />
          <section className="panel agent-panel">
            <h2>{operator ? "Agent control" : "Your task"}</h2>
            <div className="task-box">
              <p>{view.scenario.goal}</p>
            </div>
            {operator ? (
              <>
                <p className="meta">
                  Scripted fixture runner. No AI model is connected
                  automatically.
                </p>
                <button
                  className="secondary full"
                  disabled={running}
                  onClick={() => void makeGrant().catch(fail)}
                >
                  Issue agent grant
                </button>
                {grant && (
                  <div className="grant">
                    <button
                      className="secondary full"
                      onClick={() =>
                        window.open(
                          `/agent#agent=${grant}`,
                          "_blank",
                          "noopener",
                        )
                      }
                    >
                      Open agent view
                    </button>
                    <button
                      className="secondary full"
                      onClick={() =>
                        void navigator.clipboard.writeText(grant).catch(fail)
                      }
                    >
                      Copy session token
                    </button>
                    <code>POST /mcp</code>
                    <p className="meta">
                      Exclusive lease · expires in 1 hour. The token never
                      grants evaluator or configuration access.
                    </p>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="meta">{webmcp}</p>
                <button
                  className="secondary"
                  onClick={() =>
                    void queue(() =>
                      call("session.requestHelp", {
                        reason: "A person must resolve the TV prompt.",
                      }),
                    )
                  }
                >
                  Request human help
                </button>
              </>
            )}
          </section>
          {operator && (
            <>
              <section className="panel progress-panel">
                <h2>Runner progress</h2>
                <div className="progress-list">
                  {progress.length ? (
                    progress.slice(-12).map((p, i) => <div key={i}>✓ {p}</div>)
                  ) : (
                    <p className="meta">Ready for a test run.</p>
                  )}
                </div>
              </section>
              <section className="panel eval-panel">
                <h2>Evaluator · operator only</h2>
                <b className={view.result?.success ? "pass" : "pending"}>
                  {view.result?.success ? "PASS" : "GOAL NOT MET"}
                </b>
                {view.result &&
                  Object.entries(view.result)
                    .filter(([k]) => k !== "success")
                    .map(([k, v]) => (
                      <div className="metric" key={k}>
                        <span>{k}</span>
                        <strong>{String(v)}</strong>
                      </div>
                    ))}
              </section>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
function TvView({
  state,
  selected,
}: {
  state: TvState;
  selected: (typeof HOME_CONTENT)[number];
}) {
  if (state.power === "off")
    return <div className="tv-off">EIDOS TV · OFF</div>;
  const overlay = state.modal ? (
    <Modal type={state.modal} focus={state.focusIndex} />
  ) : !state.signedIn ? (
    <div className="modal-overlay">
      <div className="modal-card">
        <strong>Sign in required</strong>
        <p>Ask a person to sign in to Eidos Video.</p>
      </div>
    </div>
  ) : null;
  if (state.route === "playback")
    return (
      <div className="playback-view">
        <div className="playback-gradient" />
        <div className="playback-copy">
          <span className="eyebrow">{state.playback.state.toUpperCase()}</span>
          <h1>{state.playback.title}</h1>
          <p>
            {state.playback.episode} · {state.playback.position ?? 0}s
          </p>
          {state.playback.state === "buffering" && (
            <div className="error-banner">
              Network {state.network} · buffering
            </div>
          )}
        </div>
        {overlay}
      </div>
    );
  if (state.route === "details")
    return (
      <div className="details-view">
        <span className="eyebrow">EIDOS VIDEO</span>
        <h1>{state.playback.title}</h1>
        <p>{state.playback.episode} · Family · 22 min</p>
        <span className="watch-pill">← Choose episode → · OK to play</span>
        <div className="details-art">
          <div />
          <div />
          <div />
        </div>
        {overlay}
      </div>
    );
  if (state.route === "settings")
    return (
      <div className="search-view">
        <h1>TV settings</h1>
        <p>
          Volume {state.volume} · {state.muted ? "Muted" : "Sound on"}
        </p>
        <p>
          Network {state.network} · Profile {state.profile}
        </p>
        <p>Back to return home.</p>
        {overlay}
      </div>
    );
  const cards =
    state.route === "apps"
      ? APPS
      : state.route === "search"
        ? searchResults(state)
        : HOME_CONTENT;
  return (
    <div className="home-view">
      <div className="tv-topline">
        <strong>EIDOS TV</strong>
        <span>
          {state.activeAppId
            ? APPS.find((a) => a.id === state.activeAppId)?.title
            : "Home"}
        </span>
        <span>{state.profile}</span>
      </div>
      <div className="tv-layout">
        <aside className="tv-nav">
          <div className={state.route === "home" ? "selected" : ""}>Home</div>
          <div className={state.route === "apps" ? "selected" : ""}>
            Apps · ✱
          </div>
          <div>Search · type or talk</div>
          <div>Settings · ✱ twice</div>
        </aside>
        <div className="tv-content">
          {state.route === "home" ? (
            <div className="hero">
              <div className="hero-copy">
                <h1>Bluey</h1>
                <p>13 episodes · Eidos Video</p>
                <span className="watch-pill">Press OK to explore</span>
              </div>
              <div className="hero-orbs">
                <i />
                <i />
                <i />
                <i />
              </div>
            </div>
          ) : (
            <h1>
              {state.route === "apps"
                ? "Your apps"
                : `Search: ${state.query ?? ""}`}
            </h1>
          )}
          <h3>
            {state.route === "home"
              ? "Recommended for you"
              : `${cards.length} results`}
          </h3>
          <div className="content-row">
            {cards.map((item, index) => (
              <div
                key={item.id}
                className={`content-card ${state.focusIndex === index ? "focused" : ""}`}
                style={{ "--accent": item.accent } as React.CSSProperties}
              >
                <div className="card-art">{item.title.slice(0, 1)}</div>
                <strong>{item.title}</strong>
                <small>{item.subtitle}</small>
              </div>
            ))}
          </div>
          <p className="meta">
            D-pad to navigate · OK to select · Back to return
          </p>
        </div>
      </div>
      {state.network !== "normal" && (
        <div className="network-pill">Network: {state.network}</div>
      )}
      <div className="screen-focus">
        Focus ·{" "}
        {state.route === "home" ? selected.title : currentFocusLabel(state)}
      </div>
      {overlay}
    </div>
  );
}
function Modal({
  type,
  focus,
}: {
  type: NonNullable<TvState["modal"]>;
  focus: number;
}) {
  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <strong>
          {type === "purchase"
            ? "Confirm purchase"
            : type === "parental-pin"
              ? "Parental PIN required"
              : "Choose profile"}
        </strong>
        <p>
          {type === "profile"
            ? `${focus === 0 ? "▶ " : ""}Daniel    ${focus === 1 ? "▶ " : ""}Kids`
            : "Human approval required. Playback remains blocked."}
        </p>
        <p>Use Back to cancel.</p>
      </div>
    </div>
  );
}
function VirtualRemote({
  onKey,
  pttProps,
  active,
  shortcut,
}: {
  onKey: (key: RemoteKey) => void;
  pttProps: React.ButtonHTMLAttributes<HTMLButtonElement>;
  active: boolean;
  shortcut: (id: string) => void;
}) {
  const button = (label: string, key: RemoteKey, text: string) => (
    <button
      className="remote-button"
      aria-label={label}
      onClick={() => onKey(key)}
    >
      {text}
    </button>
  );
  return (
    <section className="panel remote-panel">
      <h2>Virtual remote</h2>
      <div className="remote-top">
        {button("Power", "POWER", "⏻")}
        {button("Home", "HOME", "⌂")}
      </div>
      <div className="dpad">
        {(["UP", "LEFT", "SELECT", "RIGHT", "DOWN"] as const).map((key, i) => (
          <button
            className={key.toLowerCase()}
            key={key}
            aria-label={
              key === "SELECT" ? "Select" : key[0] + key.slice(1).toLowerCase()
            }
            onClick={() => onKey(key)}
          >
            {["⌃", "‹", "OK", "›", "⌄"][i]}
          </button>
        ))}
      </div>
      <div className="remote-row">
        {button("Back", "BACK", "↶")}
        <button
          aria-label="Remote push to talk"
          className={`remote-button mic ${active ? "active" : ""}`}
          {...pttProps}
        >
          🎙
        </button>
        {button("Options", "OPTIONS", "✱")}
      </div>
      <div className="remote-row">
        {button("Rewind", "REWIND", "◀◀")}
        {button("Play or pause", "PLAY_PAUSE", "▶Ⅱ")}
        {button("Fast forward", "FAST_FORWARD", "▶▶")}
      </div>
      <div className="remote-row">
        {button("Volume down", "VOLUME_DOWN", "−")}
        {button("Mute", "MUTE", "◌")}
        {button("Volume up", "VOLUME_UP", "+")}
      </div>
      <div className="app-shortcuts">
        {APPS.filter((a) => a.id !== "netflix").map((a) => (
          <button key={a.id} onClick={() => shortcut(a.id)}>
            {a.title}
          </button>
        ))}
      </div>
    </section>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {React.cloneElement(children as React.ReactElement<{ id?: string }>, {
        id,
      })}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
