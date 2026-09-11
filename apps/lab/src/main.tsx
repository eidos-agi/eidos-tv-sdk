import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  HOME_CONTENT,
  applyVoiceTranscript,
  createInitialTvState,
  currentFocusLabel,
  reduceRemoteEvent,
  setNetwork,
} from '@eidos-tv/core';
import type { AuthorityMode, RemoteKey, TraceEvent, TvState } from '@eidos-tv/protocol';
import './styles.css';

const SESSION_ID = 'lab-session-001';

type FaultKey = 'stt' | 'drop' | 'crash' | 'purchase' | 'pin';

type AgentStep = {
  label: string;
  status: 'idle' | 'active' | 'done';
};

const initialSteps: AgentStep[] = [
  { label: 'Observing screen', status: 'idle' },
  { label: 'Pressing HOME', status: 'idle' },
  { label: 'Using PTT remote', status: 'idle' },
  { label: 'Selecting Bluey episode 3', status: 'idle' },
  { label: 'Verifying playback', status: 'idle' },
];

function nowStamp() {
  return new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function id() {
  return Math.random().toString(36).slice(2, 10);
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function App() {
  const [tv, setTv] = useState<TvState>(() => createInitialTvState());
  const tvRef = useRef(tv);
  const [authority, setAuthority] = useState<AuthorityMode>('remote-only');
  const [trace, setTrace] = useState<TraceEvent[]>([
    { id: id(), at: nowStamp(), type: 'session.created', source: 'system', summary: SESSION_ID },
  ]);
  const [faults, setFaults] = useState<Record<FaultKey, boolean>>({
    stt: false,
    drop: false,
    crash: false,
    purchase: false,
    pin: false,
  });
  const [fixtureTranscript, setFixtureTranscript] = useState('Play episode three of Bluey');
  const [confidence, setConfidence] = useState(0.92);
  const [agentSteps, setAgentSteps] = useState(initialSteps);
  const [agentRunning, setAgentRunning] = useState(false);
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [droppedOnce, setDroppedOnce] = useState(false);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);

  const publishState = (next: TvState) => {
    tvRef.current = next;
    setTv(next);
  };

  const append = (events: Array<{ type: string; summary: string; payload?: unknown }>, source = 'lab') => {
    setTrace((current) => [
      ...current,
      ...events.map((item) => ({
        id: id(),
        at: nowStamp(),
        type: item.type,
        source,
        summary: item.summary,
        payload: item.payload,
      })),
    ].slice(-120));
  };

  const dispatchKey = (key: RemoteKey, source = 'human.remote') => {
    if (faults.drop && !droppedOnce && !['POWER', 'HOME'].includes(key)) {
      setDroppedOnce(true);
      append([{ type: 'fault.injected', summary: `dropped remote key ${key}` }], 'fault');
      return;
    }

    const result = reduceRemoteEvent(tvRef.current, { type: 'key', key, phase: 'press' });
    publishState(result.state);
    append(result.events, source);
  };

  const startPtt = (source = 'human.remote') => {
    const result = reduceRemoteEvent(tvRef.current, { type: 'ptt', phase: 'start', sessionId: SESSION_ID });
    publishState(result.state);
    append(result.events, source);
  };

  const finishPtt = (source = 'human.remote', overrideTranscript?: string) => {
    const transcript = overrideTranscript ?? fixtureTranscript;
    const actualConfidence = faults.stt ? Math.min(confidence, 0.43) : confidence;
    const actualTranscript = faults.stt ? transcript.replace(/Bluey/gi, 'blue') : transcript;

    const voice = applyVoiceTranscript(tvRef.current, actualTranscript, actualConfidence);
    publishState(voice.state);
    append(voice.events, source);

    const stop = reduceRemoteEvent(voice.state, { type: 'ptt', phase: 'stop', sessionId: SESSION_ID });
    publishState(stop.state);
    append(stop.events, source);

    if (faults.crash && stop.state.route === 'playback') {
      const crashed = { ...stop.state, route: 'home' as const, playback: { ...stop.state.playback, state: 'idle' as const } };
      publishState(crashed);
      append([{ type: 'fault.injected', summary: 'video app crashed after playback start' }], 'fault');
    }
  };

  const changeNetwork = (network: TvState['network']) => {
    const result = setNetwork(tvRef.current, network);
    publishState(result.state);
    append(result.events, 'session.config');
  };

  const reset = () => {
    const next = createInitialTvState();
    next.network = tvRef.current.network;
    publishState(next);
    setDroppedOnce(false);
    setAgentSteps(initialSteps);
    setRunStartedAt(null);
    append([{ type: 'session.reset', summary: 'fixture → signed-in-home' }], 'system');
  };

  const setStep = (index: number, status: AgentStep['status']) => {
    setAgentSteps((steps) => steps.map((step, i) => (i === index ? { ...step, status } : step)));
  };

  const runAgent = async () => {
    if (agentRunning) return;
    setAgentRunning(true);
    setRunStartedAt(Date.now());
    setAgentSteps(initialSteps);
    append([{ type: 'agent.run.started', summary: `task started · ${authority}` }], 'agent');

    setStep(0, 'active');
    await sleep(350);
    append([{ type: 'agent.observe', summary: `screen=${tvRef.current.route}; focus=${currentFocusLabel(tvRef.current)}` }], 'agent');
    setStep(0, 'done');

    setStep(1, 'active');
    await sleep(250);
    dispatchKey('HOME', 'agent.mcp');
    setStep(1, 'done');

    setStep(2, 'active');
    await sleep(300);
    startPtt('agent.mcp');
    await sleep(450);
    finishPtt('agent.mcp', 'Play episode three of Bluey');
    setStep(2, 'done');

    setStep(3, 'active');
    await sleep(350);
    if (faults.purchase) {
      const withModal = { ...tvRef.current, modal: 'purchase' as const };
      publishState(withModal);
      append([{ type: 'fault.injected', summary: 'purchase confirmation modal presented' }], 'fault');
    } else if (faults.pin) {
      const withModal = { ...tvRef.current, modal: 'parental-pin' as const };
      publishState(withModal);
      append([{ type: 'fault.injected', summary: 'parental PIN modal presented' }], 'fault');
    }
    setStep(3, 'done');

    setStep(4, 'active');
    await sleep(350);
    const success =
      tvRef.current.playback.contentId === 'bluey' &&
      tvRef.current.playback.episode === 'Episode 3' &&
      tvRef.current.playback.state === 'playing' &&
      !tvRef.current.modal;
    append([{ type: success ? 'assertion.passed' : 'assertion.failed', summary: success ? 'Bluey S1E3 is playing' : 'goal not satisfied' }], 'evaluator');
    setStep(4, 'done');
    setAgentRunning(false);
  };

  const success =
    tv.playback.contentId === 'bluey' &&
    tv.playback.episode === 'Episode 3' &&
    tv.playback.state === 'playing' &&
    !tv.modal;

  const metrics = useMemo(() => {
    return {
      actions: trace.filter((e) => e.type.startsWith('remote.') || e.type.startsWith('ptt.') || e.type === 'stt.final').length,
      remotePresses: trace.filter((e) => e.type === 'remote.key').length,
      pttInteractions: trace.filter((e) => e.type === 'ptt.started').length,
      recoveries: trace.filter((e) => e.type.includes('recover')).length,
      policyViolations: 0,
      duration: runStartedAt ? Math.max(0, (Date.now() - runStartedAt) / 1000) : 0,
    };
  }, [trace, runStartedAt]);

  const selectedContent = HOME_CONTENT[tv.focusIndex] ?? HOME_CONTENT[0];

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">▣</div>
          <div>
            <strong>Eidos TV SDK</strong>
            <span>Device Lab</span>
          </div>
          <em>BETA</em>
        </div>
        <nav>
          <button className="active">Test</button>
          <button>Scenarios</button>
          <button>Devices</button>
          <button>Agents</button>
          <button>Runs</button>
          <button>Library</button>
        </nav>
        <div className="top-actions">
          <button>Docs</button>
          <button>GitHub</button>
          <div className="avatar">E</div>
        </div>
      </header>

      <main className="lab-grid">
        <aside className="panel session-panel">
          <PanelTitle>Session Configuration</PanelTitle>
          <Field label="Device">
            <select><option>Generic Streaming TV</option></select>
          </Field>
          <Field label="Model">
            <select><option>Eidos TV (v1)</option></select>
          </Field>
          <Field label="Scenario">
            <select><option>Signed in · Home Screen</option></select>
          </Field>
          <Field label="Remote">
            <select><option>Standard Remote (Voice)</option></select>
          </Field>
          <Field label="Agent">
            <select><option>Demo Agent Harness</option></select>
          </Field>

          <SectionLabel>Agent Access Mode</SectionLabel>
          <Radio label="Direct TV Tools" checked={authority === 'semantic'} onChange={() => setAuthority('semantic')} />
          <Radio label="Remote MCP Only" checked={authority === 'remote-only'} onChange={() => setAuthority('remote-only')} />
          <Radio label="Visual-Only (Pixels)" checked={authority === 'visual-only'} onChange={() => setAuthority('visual-only')} />
          <Radio label="Human (Manual)" checked={authority === 'human'} onChange={() => setAuthority('human')} />

          <SectionLabel>Voice / PTT</SectionLabel>
          <Radio label="Fixture Transcript" checked readOnly />
          <Radio label="Real STT (Browser Mic)" checked={false} readOnly />
          <Radio label="Noisy (Low Confidence)" checked={faults.stt} onChange={() => setFaults((f) => ({ ...f, stt: !f.stt }))} />

          <SectionLabel>Network Conditions</SectionLabel>
          {(['normal', 'slow', 'intermittent', 'offline'] as const).map((network) => (
            <Radio key={network} label={network === 'normal' ? 'Normal' : network[0].toUpperCase() + network.slice(1)} checked={tv.network === network} onChange={() => changeNetwork(network)} />
          ))}

          <SectionLabel>Fault Injection</SectionLabel>
          <Check label="STT errors" checked={faults.stt} onChange={() => setFaults((f) => ({ ...f, stt: !f.stt }))} />
          <Check label="Dropped button event" checked={faults.drop} onChange={() => { setDroppedOnce(false); setFaults((f) => ({ ...f, drop: !f.drop })); }} />
          <Check label="App crash" checked={faults.crash} onChange={() => setFaults((f) => ({ ...f, crash: !f.crash }))} />
          <Check label="Purchase modal" checked={faults.purchase} onChange={() => setFaults((f) => ({ ...f, purchase: !f.purchase }))} />
          <Check label="Parental PIN" checked={faults.pin} onChange={() => setFaults((f) => ({ ...f, pin: !f.pin }))} />

          <button className="primary full" onClick={runAgent} disabled={agentRunning}>{agentRunning ? 'Running…' : 'Start Test Run'}</button>
          <button className="secondary full" onClick={reset}>Reset</button>
        </aside>

        <section className="center-stage">
          <div className="tv-frame">
            <div className="tv-screen">
              <TvView state={tv} selected={selectedContent} />
            </div>
            <div className="tv-stand" />
          </div>

          <div className="bottom-grid">
            <section className="panel trace-panel">
              <div className="panel-title-row">
                <PanelTitle>Event Trace</PanelTitle>
                <span className="live-dot">● Live</span>
              </div>
              <div className="trace-list">
                {trace.slice(-13).map((item) => (
                  <div className="trace-row" key={item.id}>
                    <time>{item.at}</time>
                    <strong>{item.type}</strong>
                    <span>{item.summary}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel capture-panel">
              <div className="panel-title-row"><PanelTitle>Screen Capture</PanelTitle><time>{snapshotAt ?? nowStamp()}</time></div>
              <div className="mini-screen"><TvView state={tv} selected={selectedContent} compact /></div>
              <div className="button-row">
                <button className="secondary" onClick={() => { const at = nowStamp(); setSnapshotAt(at); append([{ type: 'observation.snapshot', summary: `captured at ${at}` }], 'capture'); }}>Take Snapshot</button>
                <button className={recording ? 'danger' : 'secondary'} onClick={() => { setRecording((r) => !r); append([{ type: recording ? 'capture.video.stop' : 'capture.video.start', summary: recording ? 'recording stopped' : 'recording started' }], 'capture'); }}>{recording ? 'Stop Recording' : 'Record Video'}</button>
              </div>
            </section>

            <section className="panel voice-panel">
              <div className="panel-title-row"><PanelTitle>Voice / PTT</PanelTitle><span className="chip">Fixture Mode</span></div>
              <button
                className={`ptt-button ${tv.voice?.active ? 'active' : ''}`}
                onPointerDown={() => startPtt()}
                onPointerUp={() => finishPtt()}
                onPointerLeave={() => tvRef.current.voice?.active && finishPtt()}
              >🎙</button>
              <div className="ptt-help">Hold to Talk</div>
              <Field label="Fixture Transcript">
                <input value={fixtureTranscript} onChange={(e) => setFixtureTranscript(e.target.value)} />
              </Field>
              <label className="range-label">Confidence: {confidence.toFixed(2)}</label>
              <input type="range" min="0" max="1" step="0.01" value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} />
            </section>
          </div>
        </section>

        <section className="right-rail">
          <VirtualRemote onKey={dispatchKey} onPttStart={() => startPtt()} onPttStop={() => finishPtt()} active={!!tv.voice?.active} />

          <section className="panel agent-panel">
            <div className="panel-title-row"><PanelTitle>Agent</PanelTitle><span className="connected">● Connected</span></div>
            <div className="agent-name"><span className="agent-icon">AI</span><strong>Demo Agent Harness</strong></div>
            <div className="task-box"><small>Task</small><p>Open the video app and play episode 3 of Bluey.</p></div>
            <button className="primary full" onClick={runAgent} disabled={agentRunning}>{agentRunning ? 'Agent Running…' : 'Run with Agent'}</button>
          </section>

          <section className="panel progress-panel">
            <PanelTitle>Progress</PanelTitle>
            <div className="progress-list">
              {agentSteps.map((step) => <div key={step.label} className={`progress-item ${step.status}`}><span>{step.status === 'done' ? '✓' : step.status === 'active' ? '◉' : '○'}</span>{step.label}</div>)}
            </div>
          </section>

          <section className="panel eval-panel">
            <div className="panel-title-row"><PanelTitle>Evaluation <span>(Hidden from Agent)</span></PanelTitle><b className={success ? 'pass' : 'pending'}>{success ? 'PASS' : 'LIVE'}</b></div>
            <Metric label="Task Success" value={success ? 'Yes' : 'Not yet'} />
            <Metric label="Correct Content" value={tv.playback.contentId === 'bluey' ? 'Bluey S1E3' : '—'} />
            <Metric label="Actions" value={String(metrics.actions)} />
            <Metric label="Remote Presses" value={String(metrics.remotePresses)} />
            <Metric label="PTT Interactions" value={String(metrics.pttInteractions)} />
            <Metric label="Duration" value={`${metrics.duration.toFixed(1)}s`} />
            <Metric label="Recovery Attempts" value={String(metrics.recoveries)} />
            <Metric label="Policy Violations" value={String(metrics.policyViolations)} />
          </section>

          <section className="panel notes-panel">
            <div className="panel-title-row"><PanelTitle>Scenario Notes</PanelTitle><button className="link-button">Edit</button></div>
            <p>Standard living room setup. User is signed in. Bluey is available in the video library.</p>
            <div className="state-badges"><span>{tv.route}</span><span>{tv.network}</span><span>{authority}</span></div>
          </section>
        </section>
      </main>
    </div>
  );
}

function TvView({ state, selected, compact = false }: { state: TvState; selected: (typeof HOME_CONTENT)[number]; compact?: boolean }) {
  if (state.power === 'off') return <div className="tv-off">EIDOS TV · OFF</div>;

  if (state.route === 'playback') {
    return (
      <div className="playback-view">
        <div className="playback-gradient" />
        <div className="playback-copy">
          <span className="eyebrow">NOW PLAYING</span>
          <h1>{state.playback.title ?? 'Unknown'}</h1>
          <p>{state.playback.episode ?? 'Content'} · {state.playback.state}</p>
          {state.network === 'offline' && <div className="error-banner">Network offline · buffering</div>}
        </div>
        {state.modal && <Modal type={state.modal} />}
      </div>
    );
  }

  if (state.route === 'details') {
    return (
      <div className="details-view">
        <span className="eyebrow">EIDOS VIDEO</span>
        <h1>{state.playback.title}</h1>
        <p>{state.playback.episode ?? 'Choose an episode'} · Family · 22 min</p>
        <button className="watch-pill">▶ Watch Now</button>
        <div className="details-art"><div /><div /><div /></div>
        {state.modal && <Modal type={state.modal} />}
      </div>
    );
  }

  if (state.route === 'search') {
    return (
      <div className="search-view">
        <span className="eyebrow">SEARCH</span>
        <h1>{state.voice?.transcript ?? 'Search TV'}</h1>
        <p>Voice confidence: {state.voice?.confidence ? Math.round(state.voice.confidence * 100) + '%' : '—'}</p>
      </div>
    );
  }

  return (
    <div className={`home-view ${compact ? 'compact' : ''}`}>
      <div className="tv-topline"><strong>EIDOS TV</strong><span>⌕ Search</span><time>7:42 PM</time><span>◉</span></div>
      <div className="tv-layout">
        <aside className="tv-nav">
          {['⌂ Home', '▤ Movies', '▣ TV Shows', '▥ Live TV', '♫ Music', '▦ Apps', '⚙ Settings'].map((item, index) => <div key={item} className={index === 0 ? 'selected' : ''}>{item}</div>)}
        </aside>
        <div className="tv-content">
          <div className="hero">
            <div className="hero-copy"><h1>Bluey</h1><p>New episodes available</p><button>Watch Now</button></div>
            <div className="hero-orbs"><i /><i /><i /><i /></div>
          </div>
          <h3>Recommended for You</h3>
          <div className="content-row">
            {HOME_CONTENT.map((item, index) => (
              <div className={`content-card ${state.route === 'home' && state.focusIndex === index ? 'focused' : ''}`} key={item.id} style={{ '--accent': item.accent } as React.CSSProperties}>
                <div className="card-art">{item.title.slice(0, 1)}</div>
                <strong>{item.title}</strong>
                {!compact && <small>{item.subtitle}</small>}
              </div>
            ))}
          </div>
          {!compact && <><h3>Your Apps</h3><div className="app-row"><span>YouTube</span><span>NETFLIX</span><span>Disney+</span><span>prime video</span><span>hulu</span></div></>}
        </div>
      </div>
      {state.network !== 'normal' && <div className="network-pill">Network: {state.network}</div>}
      <div className="screen-focus">Focus · {selected.title}</div>
    </div>
  );
}

function Modal({ type }: { type: NonNullable<TvState['modal']> }) {
  return <div className="modal-overlay"><div className="modal-card"><strong>{type === 'purchase' ? 'Confirm Purchase' : type === 'parental-pin' ? 'Parental PIN Required' : 'Choose Profile'}</strong><p>{type === 'purchase' ? 'Agent must request confirmation before continuing.' : type === 'parental-pin' ? 'Restricted action. Do not guess the PIN.' : 'Select a profile.'}</p><button>Cancel</button></div></div>;
}

function VirtualRemote({ onKey, onPttStart, onPttStop, active }: { onKey: (key: RemoteKey) => void; onPttStart: () => void; onPttStop: () => void; active: boolean }) {
  return (
    <section className="panel remote-panel">
      <div className="panel-title-row"><PanelTitle>Virtual Remote</PanelTitle><span className="connected">● Connected</span></div>
      <div className="remote-top"><RemoteButton label="⏻" onClick={() => onKey('POWER')} /><RemoteButton label="⌂" onClick={() => onKey('HOME')} /></div>
      <div className="dpad">
        <button className="up" onClick={() => onKey('UP')}>⌃</button>
        <button className="left" onClick={() => onKey('LEFT')}>‹</button>
        <button className="select" onClick={() => onKey('SELECT')}>OK</button>
        <button className="right" onClick={() => onKey('RIGHT')}>›</button>
        <button className="down" onClick={() => onKey('DOWN')}>⌄</button>
      </div>
      <div className="remote-row"><RemoteButton label="↶" onClick={() => onKey('BACK')} /><button className={`remote-button mic ${active ? 'active' : ''}`} onPointerDown={onPttStart} onPointerUp={onPttStop} onPointerLeave={() => active && onPttStop()}>🎙</button><RemoteButton label="✱" onClick={() => onKey('OPTIONS')} /></div>
      <div className="remote-row"><RemoteButton label="◀◀" onClick={() => onKey('REWIND')} /><RemoteButton label="▶Ⅱ" onClick={() => onKey('PLAY_PAUSE')} /><RemoteButton label="▶▶" onClick={() => onKey('FAST_FORWARD')} /></div>
      <div className="remote-row"><RemoteButton label="🔉" onClick={() => onKey('VOLUME_DOWN')} /><RemoteButton label="🔇" onClick={() => onKey('MUTE')} /><RemoteButton label="🔊" onClick={() => onKey('VOLUME_UP')} /></div>
      <div className="app-shortcuts"><button>VIDEO</button><button>YouTube</button><button>Disney+</button><button>Prime</button></div>
    </section>
  );
}

function RemoteButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button className="remote-button" onClick={onClick}>{label}</button>;
}

function PanelTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="panel-title">{children}</h2>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="section-label">{children}</h3>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function Radio({ label, checked, onChange, readOnly = false }: { label: string; checked: boolean; onChange?: () => void; readOnly?: boolean }) {
  return <label className="option"><input type="radio" checked={checked} onChange={onChange} readOnly={readOnly} /><span>{label}</span></label>;
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return <label className="option"><input type="checkbox" checked={checked} onChange={onChange} /><span>{label}</span></label>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
