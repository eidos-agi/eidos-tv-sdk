# Product North Star — Device Lab

The first release should feel like an instrument panel for testing agents against a virtual television, not like a demo page.

The approved product shape is the Device Lab mockup: a TV in the center, a visible remote beside it, scenario and fault controls on the left, an agent runner and hidden evaluator on the right, and trace/capture/PTT tooling below the TV.

## Rule: no fake chrome

Every visible control must map to a real primitive. If a panel cannot affect the session, observe the session, or explain a test result, remove it until it can.

## Surface map

| Surface | Real primitive behind it |
| --- | --- |
| Device | device-pack manifest |
| Model | device variant/configuration |
| Scenario | resettable scenario fixture |
| Remote | input-device descriptor + layout |
| Agent | harness/client identity |
| Agent Access Mode | authority profile |
| Voice / PTT | PTT runtime mode + fixture/audio/live source |
| Network Conditions | deterministic network fault profile |
| Fault Injection | seeded fault injector |
| Start Test Run | scenario runner |
| Virtual TV | renderer over canonical TV state |
| Virtual Remote | separate device dispatching canonical RemoteEvents |
| Agent Task | goal specification |
| Progress | harness-reported steps + observed actions |
| Evaluation | hidden oracle + assertions |
| Event Trace | canonical event stream |
| Screen Capture | observation artifact producer |
| Voice / PTT panel | PTT lifecycle controller and trace |
| Scenario Notes | fixture metadata |
| Reset | deterministic restore to fixture |

## Non-negotiable interaction path

Human clicks, WebMCP calls, MCP calls, agent harness actions, replay events, and tests must converge before state mutation.

```text
Human UI ───────┐
WebMCP ─────────┤
MCP ────────────┤
Replay ─────────┤──> authority/policy ─> canonical dispatcher ─> device runtime
Test harness ───┘
```

For remote-only testing the chain is intentionally longer:

```text
Agent
  └─MCP/WebMCP─> Virtual Remote
                    └─RemoteEvent─> Virtual TV
```

The agent may observe the TV but may not bypass the remote and call semantic TV actions when the authority profile is `remote-only`.

## First working screen

The browser lab should expose these regions at once:

1. **Session Configuration** — device, model, scenario, remote, agent, authority, voice mode, network, faults.
2. **Virtual TV** — actual rendered state and focus, not a static screenshot.
3. **Virtual Remote** — D-pad, Home, Back, Options, playback, volume, shortcuts, and hold-to-talk PTT.
4. **Agent** — task plus run/connection state.
5. **Progress** — observable execution progress.
6. **Evaluation** — hidden-from-agent goal truth and metrics.
7. **Event Trace** — live canonical event stream.
8. **Screen Capture** — snapshot/video artifact controls.
9. **Voice / PTT** — fixture transcript, confidence, lifecycle and later real audio.
10. **Scenario Notes** — concise fixture/world explanation.

## Initial task

The reference task is:

> Open the video app and play episode 3 of Bluey.

It must eventually be runnable in four modes against the same world:

- semantic TV tools;
- remote MCP/WebMCP only;
- visual-only agent operating the rendered remote;
- human/manual.

Results should record success, action count, remote presses, PTT interactions, duration, recovery attempts, policy violations, trace ID, and exact authority/observation profiles.

## Faults that must become real

The initial UI exposes these intentionally because they exercise different layers of the system:

- STT error / low confidence;
- dropped remote button event;
- app crash;
- purchase confirmation;
- parental PIN;
- normal/slow/intermittent/offline network.

A checked fault must be represented in the session configuration and appear in the trace when triggered.

## Visual direction

- Dark, quiet, instrument-like UI.
- TV remains visually dominant.
- Remote looks tactile enough to understand immediately.
- Dense information is acceptable in the test lab, but hierarchy must remain strong.
- Avoid decorative dashboards that do not expose meaningful test state.
- Keep the BRS-style immediacy: open the page and immediately understand that the television is operable.

## Current implementation checkpoint

The approved layout now runs against a shared session service. Operator buttons, the scripted runner, an agent browser, WebMCP and external MCP converge at the same policy/dispatch boundary. Session grants cannot read evaluator output or change their authority. The operator can revoke control and reset; replay reconstructs saved runs separately from the live TV. PNG and WebM capture produce real downloaded artifacts.

The agent panel accurately identifies the scripted fixture runner. No AI provider is auto-connected. BRS, real audio/STT and a hardened visual-only model harness remain on the roadmap and do not appear as working controls. See `RUNNING.md` for the local service and connection contract.
