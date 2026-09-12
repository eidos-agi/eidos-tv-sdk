# Run the shared Device Lab

Requires Node 22+ and npm. From the repository root:

```sh
npm ci
npm run build
npm start
```

Open the operator URL printed at startup. The token in its fragment is an operator credential: keep that page with the human/evaluator, and give operating agents a separate **Issue agent grant → Open agent view** link. The service binds only to `127.0.0.1:4317`; it is not a hosted ChatGPT connector. `PORT`, `EIDOS_TV_DATA`, and `EIDOS_TV_OPERATOR_TOKEN` are optional environment variables. Otherwise a fresh operator token is generated on restart. No cloud account is required.

## Operate and evaluate

The center display, visible remote, text input and held PTT button share the canonical dispatcher with MCP. Keyboard arrows, Enter, Home, Escape, Space and held V operate the remote when focus is outside a form control. Options opens Apps; Options again opens Settings. Select opens a title at episode 1; Left/Right selects its episode before playback.

Choose a scenario and authority, then start the scripted fixture runner. The runner is deterministic test code, not a connected language model. Agent views have no evaluator panel, trace export, configuration, reset or grant issuance. Purchase/PIN scenarios require asking for help; they do not accept guessed credentials or simulate a payment approval.

PTT supports start/speak/stop/cancel, partials, confidence, delay, no speech, timeout and packet-loss fixtures. Time is logical and advances only on actions or `session.wait`. The delay field is not a real speech-provider latency measurement. Browser fixture release submits the selected transcript, advances the configured delay, then stops. External clients can deliberately stop before the delay to test early-release behavior.

Network slow/intermittent conditions buffer then recover after logical time advances. Offline remains offline. Drop and duplicate faults consume one key event; crash consumes one playback attempt. Gates, disconnected remote and voice faults persist for the run.

## Connect an MCP client

Issue a session grant in the operator page. It expires after one hour and holds an exclusive input lease. Reset, a replacement grant, or **Take control / revoke agent** invalidates it and cancels pending remote input. Tokens stay in memory; restarts invalidate all grants.

Streamable HTTP endpoint: `http://127.0.0.1:4317/mcp`, with `Authorization: Bearer <session-token>`. This works with a client on the same machine. For stdio clients, configure the working directory as this repository and:

```json
{
  "command": "node",
  "args": ["--import", "tsx", "apps/mcp/src/main.ts"],
  "env": {
    "EIDOS_TV_SESSION_TOKEN": "<issued session token>",
    "EIDOS_TV_MCP_URL": "http://127.0.0.1:4317/mcp"
  }
}
```

The proxy attaches to the existing session; it does not create a second TV. Remote-only MCP cannot invoke semantic TV tools, even by guessing their names. Semantic grants additionally expose `tv.launchApp` and `tv.openContent`. The browser agent page registers the same definitions using `document.modelContext`, with a compatibility fallback to older `navigator.modelContext` implementations. If native WebMCP is unavailable, the page says so and MCP remains usable. Reference: [Chrome imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api).

The rendered-remote profile advertises no structured tools, but its browser renderer necessarily receives display state. It is not a hardened pixels-only benchmark against a client with DOM, JavaScript, network or operator-page access. A future isolated visual harness must restrict those capabilities. Do not report this profile as proof of a model's visual-only performance.

## Capture, replay and storage

**Take snapshot** exports the actual rendered TV as PNG. **Record video** produces a WebM from captured rendered frames; it is not the underlying streaming media and does not contain audio. **Export trace** downloads versioned actions, configuration and final-state hash. Import validates and replays the log; the slider reconstructs earlier states without mutating the live TV. Return to live TV to continue operating it.

Runs are saved atomically under `.eidos-tv/runs` by default, including archived runs on reset. Load saved runs to restore a run after restart. The state hash detects replay divergence; it is not a signature or authenticity guarantee. The developer with repository/filesystem access can inspect evaluator logic. Capture downloads are separate artifacts; screenshots are not yet embedded in the JSON trace.

## Verify

```sh
npm run verify
npx playwright install chromium
npm run test:browser
```

To use an installed Chrome for browser tests, set `EIDOS_TV_CHROME` to its executable path. Tests create their own temporary server and browser profile. They never attach to a person's existing Chrome session. Browser artifacts are written to ignored `qa-artifacts/`. CI runs both headless and browser checks and retains the artifacts.

The current runtime implements the generic device. BrightScript/BRS execution, recorded/live microphone input with STT, a hosted authenticated connector, and an isolated real-model visual benchmark remain unimplemented. The UI does not claim these integrations are connected.
