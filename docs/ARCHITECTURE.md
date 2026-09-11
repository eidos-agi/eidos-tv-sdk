# Architecture

## 1. Product boundary

Eidos TV SDK is a behavioral emulator and test lab for remote-controlled consumer interfaces.

It deliberately does **not** attempt to reproduce proprietary firmware, DRM roots, app-store identity, certified hardware paths, or vendor cloud services. Those belong to real-device validation.

The SDK instead owns the interaction layer that agents need to learn and that tests need to grade:

- rendered display;
- focus/navigation state;
- remote inputs;
- text input;
- playback state;
- PTT / voice transport;
- app and modal flows;
- network/device faults;
- observations;
- reset and replay;
- deterministic hidden ground truth.

## 2. Architecture rule: devices are independent actors

A TV and its remote are not one object.

```text
Room / Session
|
+-- tv-1       Device(type=display.tv)
+-- remote-1   Device(type=input.remote)
+-- mic-1      Device(type=input.microphone)       [optional]
+-- agent-1    Actor
+-- evaluator  Hidden actor
```

Relationships are explicit edges:

```text
remote-1 --controls--> tv-1
remote-1 --voice-----> tv-1
mic-1    --audio-----> remote-1
agent-1  --controls--> remote-1
```

This matters because we want to test agents at different points in the chain.

## 3. Core data contracts

### Device

```ts
export interface DeviceDescriptor {
  id: string;
  kind: string;
  name: string;
  capabilities: string[];
  inputs: PortDescriptor[];
  outputs: PortDescriptor[];
}
```

### Device graph edge

```ts
export interface DeviceEdge {
  from: string;
  to: string;
  channel: "control" | "audio" | "video" | "state" | "telemetry";
  protocol: string;
}
```

### Canonical action envelope

Every action, regardless of source, enters the runtime through the same envelope.

```ts
export interface ActionEnvelope<T = unknown> {
  id: string;
  sessionId: string;
  source: {
    kind: "human" | "agent" | "fixture" | "replay" | "system";
    id: string;
    transport: "ui" | "webmcp" | "mcp" | "rest" | "replay" | "internal";
  };
  targetDeviceId: string;
  action: string;
  payload: T;
  timestamp: string;
}
```

Authorization happens before dispatch. The reducer/runtime should not care whether the caller was a human click or an MCP client.

### Remote events

```ts
export type RemoteEvent =
  | { type: "key"; key: string; phase: "press" | "down" | "up" }
  | { type: "text"; text: string }
  | { type: "ptt"; phase: "start" | "stop"; sessionId: string }
  | { type: "ptt.audio"; sessionId: string; audioRef: string }
  | { type: "ptt.transcript"; sessionId: string; text: string; confidence: number };
```

## 4. State model

State should be split into public observable state and hidden evaluator state.

```ts
export interface TvState {
  power: "on" | "off";
  route: string;
  focusId: string | null;
  activeAppId?: string;
  playback?: PlaybackState;
  modal?: string;
  network: NetworkState;
  voice?: VoiceState;
}

export interface OracleState {
  expectedGoal?: GoalSpec;
  semanticFocus?: string;
  permittedActions: string[];
  forbiddenActions: string[];
  correctContentId?: string;
  successPredicates: Predicate[];
  failurePredicates: Predicate[];
}
```

The operating agent receives only the observations allowed by the current authority profile. It must never receive `OracleState` unless the test explicitly evaluates oracle-assisted behavior.

## 5. Runtime pipeline

```text
UI / WebMCP / MCP / REST / Replay
              |
              v
        AuthZ / policy
              |
              v
       Action dispatcher
              |
              v
        Device runtime
              |
       +------+------+----------------+
       |             |                |
       v             v                v
  state reducer   event bus       fault injector
       |             |                |
       +-------------+----------------+
                     |
                     v
                 renderer
                     |
         +-----------+------------+
         |                        |
         v                        v
   observation stream          trace store
```

## 6. WebMCP and MCP

WebMCP and MCP are adapters over the same application functions.

Do not implement independent behavior for each transport.

```ts
async function pressRemoteKey(ctx: CallContext, input: { key: string }) {
  return ctx.dispatch({
    targetDeviceId: ctx.remoteId,
    action: "remote.press",
    payload: input,
  });
}
```

That function can be exposed as:

- a clickable button;
- a WebMCP tool registered by the remote page;
- an MCP server tool;
- a REST endpoint;
- a replay operation;
- a test helper.

### Suggested TV tools

```text
tv.observe
tv.getCapabilities
tv.getPlayback
tv.press
tv.type
tv.launchApp
tv.openContent
tv.reset
```

### Suggested remote tools

```text
remote.observe
remote.press
remote.keyDown
remote.keyUp
remote.type
remote.pttStart
remote.pttSpeak
remote.pttAudio
remote.pttStop
```

The active authority profile controls which tools are registered/exposed.

## 7. Authority profiles

A test declares how much abstraction the operating agent may use.

```yaml
profiles:
  semantic:
    allow:
      - tv.observe
      - tv.launchApp
      - tv.openContent
      - tv.getPlayback

  remote-only:
    allow:
      - tv.observe
      - remote.press
      - remote.keyDown
      - remote.keyUp
      - remote.type
      - remote.pttStart
      - remote.pttSpeak
      - remote.pttStop

  visual-remote:
    allow: []
    browserInput: true
    renderedRemote: true

  human:
    browserInput: true
    renderedRemote: true
```

The benchmark can therefore run the same task under multiple capability levels.

## 8. PTT runtime

PTT is a lifecycle with observable and injectable stages.

```text
ptt.start
  -> source.open
  -> audio.frame*
  -> endpoint / release
  -> stt.partial*
  -> stt.final
  -> intent / app handling
  -> visual/audio response
  -> ptt.stop
```

Supported input modes:

1. **fixture** — deterministic transcript and confidence;
2. **audio** — prerecorded WAV/Opus clip through the voice pipeline;
3. **live** — browser microphone.

Fault points should include:

- remote disconnect;
- delayed PTT down/up;
- premature release;
- audio dropout;
- duplicated audio packet;
- STT latency;
- partial-only STT;
- low confidence;
- wrong transcript;
- backend timeout;
- duplicated semantic action;
- late UI response.

## 9. Observation model

An agent may receive one or more observation channels depending on the test:

- screenshot/frame;
- video stream;
- audio output;
- accessibility/UI tree;
- limited semantic state;
- event acknowledgements.

The evaluator receives all of the above plus hidden state.

Observation APIs must identify their fidelity so a benchmark result can say exactly what the agent was allowed to perceive.

## 10. Scenario model

Scenarios should be declarative and versioned.

```yaml
id: play-latest-kids-episode
pack: generic-streaming-tv
fixture: signed-in-home

goal:
  text: Play the newest episode of Bluey

world:
  network: normal
  stt:
    mode: fixture
    confidence: 0.82

agent:
  profile: remote-only

oracle:
  success:
    - playback.contentId == "bluey.latest"
    - playback.state == "playing"
  failure:
    - purchase.confirmed == true

limits:
  maxActions: 50
  timeoutMs: 60000
```

## 11. Device packs

A device pack is a plugin that contributes:

```text
manifest
capabilities
state schema
reducers
renderer
remote layouts
scenarios
fixtures
faults
optional protocol adapters
```

Suggested first packs:

1. `generic-streaming-tv` — reference implementation and benchmark substrate.
2. `roku-like` — focus/navigation semantics and optional BRS runtime integration.
3. Later: Android-TV-like, Fire-TV-like, Apple-TV-like.

Avoid trademarked visual assets or proprietary binaries. Device packs should emulate interaction semantics, not impersonate certified hardware.

## 12. BRS integration

Treat BRS Engine as an optional application/runtime provider.

```text
Eidos session/runtime
       |
       +-- native simulated TV renderer
       |
       +-- BRS adapter
              |
              +-- BrightScript / SceneGraph execution
```

The BRS adapter must translate canonical remote events into BRS input and surface BRS output as the TV observation stream.

Eidos remains responsible for:

- sessions;
- device graph;
- virtual remotes;
- PTT;
- authority;
- WebMCP/MCP;
- trace/replay;
- fault injection;
- evaluation.

## 13. Trace format

Every run produces a replayable trace.

Minimum event classes:

```text
session.created
authority.granted
observation.frame
action.requested
action.allowed
action.denied
remote.key
ptt.started
ptt.audio
stt.partial
stt.final
tv.transition
fault.injected
assertion.passed
assertion.failed
session.completed
```

A trace must be sufficient to reconstruct the logical state transitions even if screenshots/video are not retained forever.

## 14. Evaluation

A run result should contain at least:

```ts
interface RunResult {
  success: boolean;
  score: number;
  actions: number;
  durationMs: number;
  recoveries: number;
  policyViolations: number;
  deniedActions: number;
  pttInteractions: number;
  finalStateHash: string;
  traceId: string;
}
```

Later benchmark dimensions can include token use, model cost, visual-only vs semantic delta, voice robustness, and safety behavior.

## 15. Initial repository layout

```text
apps/
  lab/                  # browser TV + remote + test console

packages/
  core/                 # device graph, dispatcher, state runtime
  protocol/             # shared schemas/types
  webmcp/               # WebMCP adapter
  mcp/                  # MCP server adapter
  ptt/                  # voice/PTT runtime and fixtures
  evaluator/            # oracle/assertions/scoring
  trace/                # event log/replay
  pack-generic-tv/      # first working device pack
  pack-roku-like/       # compatibility/device pack
  runtime-brs/          # optional BRS Engine adapter

docs/
  ARCHITECTURE.md
  ROADMAP.md
```

## 16. Non-negotiable invariants

1. No transport-specific business logic.
2. No direct UI mutation outside the canonical dispatcher.
3. Remote-only tests cannot secretly invoke semantic TV actions.
4. Oracle data is structurally separated from agent observations.
5. Every state-changing operation is traceable.
6. Every deterministic scenario is resettable to a stable fixture.
7. Device packs cannot require changes to core for ordinary new controls/states.
8. Fault injection is deterministic when seeded.
9. Test results record the exact authority and observation profile used.
10. Real-device adapters, when added, use the same normalized device contract.
