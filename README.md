# Eidos TV SDK

An agent-native SDK and browser lab for emulating televisions, remotes, push-to-talk voice interactions, and other remote-controlled consumer interfaces.

## Run it

```sh
npm ci
npm run build
npm start
```

Open the operator URL printed at startup. This runs a shared local TV session with a browser remote, HTTP/stdio MCP adapters, WebMCP registration, 13 scenarios, fault injection, capture and deterministic replay. See [running and connecting agents](docs/RUNNING.md) and [verified implementation status](docs/IMPLEMENTATION-STATUS.md).

## What this is

Eidos TV SDK is not a firmware clone or a DRM/device-certification emulator. It models the observable behavior and interaction surface of TVs and their peripherals so humans and AI agents can operate them, test against them, and be objectively evaluated.

The core idea is simple:

- A **TV** is a device with state, capabilities, inputs, outputs, and a renderer.
- A **remote** is a separate device that emits canonical remote events.
- **PTT** is a first-class interaction channel with button-down, audio/transcript, confidence, latency, failure, and button-up semantics.
- Humans, browser agents, MCP clients, replay fixtures, and test runners all use the same underlying action path.
- The operating agent sees observations; the evaluator keeps hidden ground truth.

```text
Agent / Human / Test Runner
          |
   WebMCP / MCP / UI
          |
          v
   Virtual Remote -----------+
   | D-pad / keys / PTT      |
   +-------------------------+
          |
     RemoteEvent bus
          |
          v
      Virtual TV
   state + renderer
          |
          +----> screenshots / UI observations
          +----> traces / replay
          +----> hidden evaluator oracle
```

## Control modes

A single scenario can be run with different authority profiles:

1. **Semantic TV control** — the agent may call high-level TV tools.
2. **Remote control** — the agent may only operate the virtual remote through MCP/WebMCP.
3. **Visual remote control** — the agent sees the rendered TV and remote and clicks like a person.
4. **Human mode** — a person operates the exact same virtual remote.

This creates an agent capability ladder without changing the underlying world.

## Canonical event model

Everything funnels through one action/event model. A human click and an MCP call should be indistinguishable after authorization.

```ts
export type RemoteEvent =
  | { type: "key"; key: string; phase: "press" | "down" | "up" }
  | { type: "text"; text: string }
  | { type: "ptt"; phase: "start" | "stop"; sessionId: string }
  | { type: "ptt.audio"; sessionId: string; audioRef: string };
```

## PTT / voice

PTT is modeled as a transport and test boundary, not just a microphone icon.

```text
PTT down
  -> audio source (fixture | prerecorded | live)
  -> STT / deterministic transcript
  -> confidence / partials / latency
  -> intent or app behavior
  -> visual response
  -> PTT up
```

The lab must be able to inject failures at every stage: premature release, packet loss, low-confidence recognition, wrong transcript, timeout, duplicated commands, disconnected remote, and delayed rendering.

## Device packs

The engine is generic. Device families are packs.

```text
packages/
  core/
  webmcp/
  mcp/
  lab-ui/
  packs/
    generic-streaming-tv/
    roku-like/
    android-tv-like/
    fire-tv-like/
    apple-tv-like/
```

A pack defines its renderer, remote layout, state graph, capabilities, scenarios, voice behavior, and fault model.

## BRS Engine

For Roku/BrightScript compatibility, prefer integrating BRS Engine as an optional runtime adapter rather than rebuilding BrightScript execution. Eidos TV SDK owns the device graph, remote/PTT model, sessions, WebMCP/MCP control, traces, fault injection, replay, and evaluation.

## Principles

- **Remote and TV are separate devices.**
- **One canonical action path.** Human UI, WebMCP, MCP, replay, and tests dispatch the same events.
- **Observation is separate from oracle.** Evaluator truth is never exposed to the operating agent by default.
- **Authority is explicit.** Tests decide whether an agent receives semantic TV tools, remote-only tools, or visual-only access.
- **Replay everything.** Actions, observations, screenshots, PTT lifecycle, transcripts, faults, timestamps, and policy decisions become trace artifacts.
- **Deterministic fixtures first.** Real audio/network integrations come after reproducible scenarios work.
- **No proprietary-platform promises.** This is behavioral device emulation, not a certified Roku/Apple TV/Fire TV replacement.

## Initial milestone

The first useful build should contain:

- browser-rendered generic streaming TV;
- virtual remote with D-pad, Home, Back, playback, volume, and PTT;
- deterministic TV state machine;
- transcript-fixture PTT mode;
- canonical event log;
- resettable scenarios;
- WebMCP tools for TV and remote;
- remote MCP adapter using the same functions;
- authority profiles for semantic, remote-only, and visual-only operation;
- hidden evaluator/oracle;
- replay and basic grading.

See `docs/ARCHITECTURE.md` and `docs/ROADMAP.md` for the build contract.
# Example application: Life Center

The product is the TV testing lab. Choose **Application under test** to switch between Streaming TV (13 scenarios) and Life Center (4 example scenarios). Both use the same lab controls, session grants, MCP/WebMCP actions, logical clock, evaluator, saved traces, and replay. See [example setup and boundaries](docs/LIFE_CENTER.md) and [application contract](docs/APPLICATIONS.md).
