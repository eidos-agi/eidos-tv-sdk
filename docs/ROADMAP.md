# Roadmap

The product is the TV testing lab: realistic TV/remote interaction, multiple applications and scenarios, and agents connecting through the remote or directly to the TV system. Life Center is one example workload, not the product. See [North Star](NORTH_STAR.md) and [example boundaries](LIFE_CENTER.md).

## Next priority: applications under test

- [x] Common application selector and documented built-in application contract.
- [x] Life Center selectable alongside existing media scenarios.
- [x] Shared input, authority, observation, supported faults, trace, capture, and replay facilities for both built-in applications.
- [ ] General application import/plugin loading beyond the two built-in adapters.
- [ ] Real agent backends per scenario, with explicit labels and test outcomes. Current runners and workers are simulated/scripted.
- [ ] Continue improving realistic remote/voice interaction while keeping fast local testing as an acceptance requirement.

## Current delivery — 2026-09-12

The generic lab now has a shared session server, schema-validated action dispatcher, real authority checks, HTTP and stdio MCP adapters, browser WebMCP registration, 13 fixtures, evaluator isolation from agent APIs, persistent traces, deterministic replay, PNG snapshots and WebM recording. See [implementation status](IMPLEMENTATION-STATUS.md) for evidence and limits.

The original M0–M11 below remains the complete roadmap. This delivery does **not** close every M0–M7 item: screenshot anchors in trace files, stale/delayed-render faults, model/token/cost metrics, a general scenario-authoring/import schema and an isolated pixels-only harness still remain. M8–M11 are not implemented.

## Definition of "working"

The first shippable proof is complete when a browser user and an external agent can both enter the same virtual room, operate the same virtual remote, hold/release PTT, drive a virtual TV through canonical events, reset the world, replay the run, and receive an objective pass/fail result without access to hidden oracle state.

---

## M0 — Repository + contracts

**Goal:** freeze the core boundaries before implementation spreads.

- [x] Product boundary documented.
- [x] TV and remote defined as independent devices.
- [x] Canonical action envelope defined.
- [x] Observation/oracle separation defined.
- [x] WebMCP and MCP defined as adapters over shared functions.
- [x] PTT lifecycle defined.
- [x] Authority profiles defined.
- [x] Create TypeScript workspace.
- [x] Add runtime validation for tool inputs, session config and replay imports.
- [ ] General device-pack and user-authored scenario contract validation.
- [x] Add CI for typecheck, formatting, core/API tests, build and browser acceptance.

**Gate:** contracts can be imported by every package with no browser dependency.

---

## M1 — Generic TV state engine

**Goal:** deterministic, headless TV world before UI polish.

Implement `pack-generic-tv` with approximately 30–50 canonical transitions.

Core states:

- home;
- app grid;
- search;
- results;
- title details;
- playback;
- profile picker;
- signed-out;
- settings;
- parental PIN;
- purchase confirmation;
- buffering;
- network error;
- app crash/recovery.

Core actions:

- power;
- Home;
- Back;
- Up/Down/Left/Right;
- Select;
- Play/Pause;
- Rewind/Fast-forward;
- text input;
- volume/mute;
- launch/open-content semantic actions;
- reset.

Tests:

- reducer determinism;
- legal focus transitions;
- reset idempotence;
- same action sequence => same final state hash;
- forbidden state mutation outside dispatcher.

**Gate:** headless scenario runner can complete a known task and produce a deterministic trace.

---

## M2 — Browser TV + virtual remote

**Goal:** BRS-like immediate usability: open a page and operate a TV.

Build `apps/lab`:

- TV viewport;
- virtual remote beside/below TV;
- keyboard mappings;
- touch/click support;
- remote button down/up semantics;
- basic responsive layout;
- current scenario selector;
- reset button;
- event trace drawer.

Remote controls:

- D-pad + Select;
- Home;
- Back;
- Options;
- Play/Pause;
- Rewind/Fast-forward;
- volume/mute;
- text/keyboard entry;
- PTT hold button.

**Gate:** human UI actions only call the canonical dispatcher; no component may mutate TV state directly.

---

## M3 — PTT fixture runtime

**Goal:** make PTT useful before real audio exists.

Implement fixture mode:

```text
ptt.start
-> fixture transcript
-> optional partials
-> confidence
-> configurable latency
-> TV/app voice handler
-> rendered response
-> ptt.stop
```

Required fixture controls:

- transcript;
- confidence;
- partial transcript sequence;
- latency;
- timeout;
- no-speech;
- wrong transcript;
- release-too-early.

Tests:

- PTT requires valid lifecycle;
- deterministic seeded latency/failure behavior;
- trace captures all PTT stages;
- abort/cancel does not leak pending events into next run.

**Gate:** a human can hold the rendered mic button and drive a TV scenario using a deterministic voice fixture.

---

## M4 — WebMCP control

**Goal:** make the browser-native agent interface first-class.

Expose page-scoped tools backed by the same core functions.

Remote tools:

- `remote.observe`
- `remote.press`
- `remote.keyDown`
- `remote.keyUp`
- `remote.type`
- `remote.pttStart`
- `remote.pttSpeak`
- `remote.pttStop`

TV tools:

- `tv.observe`
- `tv.getCapabilities`
- `tv.getPlayback`
- `tv.press`
- `tv.type`
- `tv.launchApp`
- `tv.openContent`
- `tv.reset`

Authority profile must determine registration/availability.

Tests:

- WebMCP and human UI yield identical canonical events;
- remote-only profile cannot invoke semantic TV actions;
- visual-only profile exposes no action tools;
- denied tool calls are traced.

**Gate:** browser agent can discover and operate the virtual remote without special test-only hooks.

---

## M5 — Remote MCP server

**Goal:** let ChatGPT, Claude, coding agents, and external harnesses operate sessions without browser-specific WebMCP access.

Implement an MCP adapter over the exact same application functions used by WebMCP.

Required capabilities:

- discover sessions;
- inspect allowed device capabilities;
- observe current screen/state according to authority;
- operate remote;
- operate TV only when profile allows it;
- reset scenario;
- fetch trace/result.

Security:

- session-scoped tokens;
- explicit authority profile;
- exclusive or declared shared leases;
- no oracle tools on operating-agent server;
- all mutations audited.

**Gate:** external MCP client completes the same scenario as the browser agent and produces the same canonical trace shape.

---

## M6 — Scenario + evaluator system

**Goal:** turn the emulator into a benchmark/test instrument.

Implement declarative scenario files with:

- starting fixture;
- user goal;
- authority profile;
- observation profile;
- faults;
- limits;
- success predicates;
- failure predicates.

Evaluator metrics:

- success/failure;
- action count;
- duration;
- recoveries;
- denied actions;
- policy violations;
- PTT interactions;
- final-state hash;
- optional token/model/cost metadata supplied by harness.

**Gate:** same task can be run under semantic, remote-only, and visual-only profiles and compared.

---

## M7 — Replay + fault injection

**Goal:** every failure becomes a reproducible regression case.

Replay:

- deterministic logical-event replay;
- timeline scrubber in lab;
- state snapshots/checkpoints;
- trace export/import;
- screenshot anchors.

Fault injection:

- dropped remote key;
- duplicate remote key;
- remote disconnect;
- delayed render;
- network slow/offline/intermittent;
- app crash;
- stale observation;
- PTT packet loss;
- STT delay/error/low confidence;
- duplicate voice action.

**Gate:** failed run can be converted into a fixture and reproduced in CI.

---

## M8 — BRS runtime adapter / Roku-like pack

**Goal:** add actual BrightScript/SceneGraph app execution without making BRS the core architecture.

- integrate BRS Engine as optional runtime;
- translate canonical remote events to BRS input;
- capture/render BRS output inside TV viewport;
- map supported ECP-like semantics where useful;
- build Roku-like remote layout and interaction pack;
- preserve Eidos session, authority, PTT, trace, and evaluator layers around it.

**Gate:** one open/demo BrightScript app can be operated by human UI, WebMCP remote, and MCP remote through the same Eidos action path.

---

## M9 — Real audio

**Goal:** add audio realism only after deterministic voice tests are stable.

Modes:

1. prerecorded audio fixture;
2. live browser microphone;
3. pluggable STT provider.

Requirements:

- audio artifact references in traces;
- VAD/release behavior;
- configurable provider latency/failure;
- transcript confidence and partials;
- privacy-conscious retention defaults.

**Gate:** identical scenario can run with deterministic transcript, recorded audio, or live mic.

---

## M10 — Multi-device lab

**Goal:** generalize from one TV + one remote to a room/device graph.

Examples:

```text
phone-remote --> tv
remote --> tv
remote --voice--> tv
console --> tv-input
agent --> remote
agent --> phone-remote
```

Add:

- multiple remotes;
- pairing/unpairing;
- device discovery;
- shared/exclusive control;
- per-device WebMCP surfaces;
- multi-device trace visualization.

**Gate:** agent can be inserted at different edges of the graph without changing device implementations.

---

## M11 — Additional device packs

Only after the generic engine is healthy:

- Android-TV-like;
- Fire-TV-like;
- Apple-TV-like;
- cable-box-like;
- kiosk/control-panel pack.

Each new pack must prove it can be added without modifying core contracts for ordinary interactions.

---

# First benchmark suite

Create at least these scenarios before pursuing visual fidelity:

1. Launch an app from Home.
2. Search for a title using remote text entry.
3. Search via PTT with perfect transcript.
4. Search via PTT with low confidence.
5. Recover from wrong app launch.
6. Select the correct profile.
7. Handle signed-out state.
8. Handle parental PIN without guessing/bypassing.
9. Refuse/seek confirmation on a purchase.
10. Recover from buffering/network error.
11. Recover from a dropped remote key.
12. Resume playback after app crash.

Every scenario should be runnable under multiple authority profiles.

# Do not do yet

Until M0–M7 are solid, do not spend meaningful time on:

- pixel-perfect vendor cloning;
- DRM;
- commercial streaming services;
- vendor firmware;
- hardware certificates;
- a giant app catalog;
- many device families;
- production speech providers;
- real hardware farms.

The product is the **control/evaluation architecture**, not the skins.
# Updated product priority — September 12, 2026

The TV testing lab is the primary product. Life Center supplies one family of personal-AI test cases; media and other applications supply others. Generalize the lab rather than building a standalone personal-AI product in this repository.
