import React, { useEffect, useRef, useState } from "react";
import "./life.css";
import { registerWebMCP, type PageTool } from "./webmcp";
type Job = {
  id: string;
  text: string;
  status: string;
  worker: string;
  steps: string[];
  result: string | null;
};
type View = {
  power: boolean;
  focus: number;
  selected: string | null;
  prompts: string[];
  jobs: Job[];
  tools: PageTool[];
};
export function LifeApp() {
  const token =
    new URLSearchParams(location.hash.slice(1)).get("operator") ?? "";
  const [view, setView] = useState<View>();
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const speech = useRef<any>(undefined);
  const actionPending = useRef(false);
  const generation = useRef(0);
  const [webmcp, setWebmcp] = useState("");
  const jobList = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (view && view.focus >= 3) {
      const item = jobList.current?.children[view.focus - 3] as
        HTMLElement | undefined;
      if (item && jobList.current)
        jobList.current.scrollTop =
          item.offsetTop -
          (jobList.current.children[0] as HTMLElement).offsetTop;
    }
  }, [view?.focus]);
  async function api(name?: string, input?: unknown) {
    const r = await fetch("/api/life", {
      method: name ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: name ? JSON.stringify({ name, input }) : undefined,
    });
    const v = await r.json();
    if (!r.ok) throw Error(v.error);
    return v as View;
  }
  async function act(name: string, input: unknown) {
    if (actionPending.current) return;
    generation.current++;
    actionPending.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await api(name, input);
      setView(next);
      return next;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      actionPending.current = false;
      setBusy(false);
    }
  }
  const ui = (name: string, input: unknown) => act(name, input).catch(() => {});
  const remote = (key: string) => act("life.remote", { key }).catch(() => {});
  useEffect(() => {
    let live = true;
    async function refresh() {
      const gen = generation.current;
      try {
        const v = await api();
        if (live && gen === generation.current && !actionPending.current)
          setView(v);
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    }
    void refresh();
    const timer = setInterval(refresh, 700);
    return () => {
      live = false;
      clearInterval(timer);
      speech.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!view) return;
    let closed = false;
    let cleanup = () => {};
    void registerWebMCP(
      view.tools,
      async (name, input) => {
        if (actionPending.current) throw Error("BUSY");
        return await act(name, input);
      },
      setWebmcp,
    ).then((fn) => {
      if (closed) fn();
      else cleanup = fn;
    });
    return () => {
      closed = true;
      cleanup();
    };
  }, [!!view]);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if ((e.target as HTMLElement).matches("input,textarea,button,a")) return;
      const k = (
        {
          ArrowLeft: "Left",
          ArrowRight: "Right",
          ArrowUp: "Up",
          ArrowDown: "Down",
          Enter: "Select",
          Escape: "Back",
          Home: "Home",
        } as Record<string, string>
      )[e.key];
      if (k) {
        e.preventDefault();
        void remote(k);
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  function talk() {
    if (listening) {
      speech.current?.stop();
      return;
    }
    const Recognition =
      (window as any).SpeechRecognition ??
      (window as any).webkitSpeechRecognition;
    if (!Recognition) {
      setError(
        "Speech recognition is unavailable in this browser. Type your instruction below.",
      );
      return;
    }
    const r = new Recognition();
    speech.current = r;
    r.lang = "en-US";
    r.interimResults = true;
    r.onresult = (e: any) =>
      setText(
        Array.from(e.results)
          .map((x: any) => x[0].transcript)
          .join(" "),
      );
    r.onerror = (e: any) => {
      setError(`Microphone: ${e.error}. You can type your instruction.`);
      setListening(false);
    };
    r.onend = () => setListening(false);
    try {
      r.start();
      setListening(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const selected = view?.jobs.find((j) => j.id === view.selected);
  return (
    <main className="life-shell">
      <header className="life-top">
        <strong>EIDOS / LIFE CENTER</strong>
        <span>Local preview · Simulated workers</span>
        <a href={`/${location.hash}`}>Device lab</a>
      </header>
      <div className="life-layout">
        <section
          className={`life-screen ${view?.power === false ? "life-off" : ""}`}
          aria-label="Life Center TV"
        >
          {!view ? (
            <h1>Connect your personal system</h1>
          ) : !view.power ? (
            <div className="life-sleep">
              <h1>Screen asleep</h1>
              <p>Your jobs remain available when you return.</p>
            </div>
          ) : (
            <>
              <div className="life-eyebrow">
                YOUR PERSONAL AI / AT HOME & AWAY
              </div>
              <h1>
                A little space for
                <br />
                everything on your mind.
              </h1>
              <p className="life-intro">
                Ask for help. Let work happen. Come back to what matters.
              </p>
              <div className="life-prompts">
                {view.prompts.map((p, i) => (
                  <button
                    disabled={busy}
                    className={view.focus === i ? "life-focused" : ""}
                    key={p}
                    onClick={() => ui("life.request", { text: p })}
                  >
                    <span>0{i + 1}</span>
                    {p}
                    <b>↗</b>
                  </button>
                ))}
              </div>
              <div className="life-jobs-title">
                <h2>Your work</h2>
                <span>
                  {
                    view.jobs.filter((j) =>
                      ["queued", "working"].includes(j.status),
                    ).length
                  }{" "}
                  in progress
                </span>
              </div>
              <div className="life-jobs" ref={jobList}>
                {!view.jobs.length && (
                  <p>Nothing waiting yet. Start with a request above.</p>
                )}
                {view.jobs.map((j, i) => (
                  <article
                    key={j.id}
                    className={view.focus === i + 3 ? "life-focused" : ""}
                  >
                    <button onClick={() => ui("life.open", { id: j.id })}>
                      <small>{j.worker} · simulated</small>
                      <strong>{j.text}</strong>
                      <span className={`life-status ${j.status}`}>
                        {j.status}
                      </span>
                    </button>
                    {["queued", "working"].includes(j.status) && (
                      <button
                        disabled={busy}
                        onClick={() => ui("life.cancel", { id: j.id })}
                      >
                        Cancel job
                      </button>
                    )}
                  </article>
                ))}
              </div>
              {selected && (
                <section className="life-result" aria-live="polite">
                  <div>
                    <small>{selected.worker} · simulated</small>
                    <button onClick={() => remote("Back")}>Close result</button>
                  </div>
                  <h2>{selected.text}</h2>
                  <p>
                    {selected.result ??
                      (selected.status === "cancelled"
                        ? "Job cancelled."
                        : "Working on a sample response…")}
                  </p>
                  <ol>
                    {selected.steps.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                </section>
              )}
            </>
          )}
        </section>
        <aside className="life-remote">
          <h2>Your remote</h2>
          <p>
            Point with arrows.
            <br />
            Ask with your voice.
          </p>
          <button onClick={() => remote("Power")}>Power</button>
          <div className="life-pad">
            {["Up", "Left", "Select", "Right", "Down"].map((k) => (
              <button
                disabled={busy}
                key={k}
                className={`key-${k}`}
                onClick={() => remote(k)}
                aria-label={k}
              >
                {
                  (
                    {
                      Up: "↑",
                      Left: "←",
                      Right: "→",
                      Down: "↓",
                      Select: "OK",
                    } as Record<string, string>
                  )[k]
                }
              </button>
            ))}
          </div>
          <div className="life-pair">
            <button onClick={() => remote("Back")}>Back</button>
            <button onClick={() => remote("Home")}>Home</button>
          </div>
          <button className="life-talk" onClick={talk}>
            {listening ? "Stop listening" : "Talk to your AI"}
          </button>
          <small>
            Browser transcription, when supported. Review before sending.
          </small>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) {
                void ui("life.request", { text });
              }
            }}
          >
            <label htmlFor="life-instruction">Your instruction</label>
            <textarea
              id="life-instruction"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Help me prepare for tomorrow…"
              maxLength={2000}
            />
            <button disabled={busy || !text.trim() || listening}>
              Send request
            </button>
          </form>
        </aside>
      </div>
      {error && (
        <p className="life-error" role="alert">
          {error === "UNAUTHORIZED"
            ? "Open the operator link from the local server, then choose Life Center."
            : error}
        </p>
      )}
      <footer>
        Same personal system. Any screen. · This preview uses sample responses
        and does not access your accounts.
        <br />
        {webmcp}
      </footer>
    </main>
  );
}
