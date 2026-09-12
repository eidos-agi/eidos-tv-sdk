# Implementation status

## Application workloads — current integration

The TV testing lab is the product. An application selector now offers Streaming TV and the Life Center example within the same lab. Four additional fixtures cover job requests, PTT instructions, cancellation, and offline workers, for 17 total scenarios.

Both built-in applications use the canonical session dispatcher, session grants, supported faults, operator-only evaluation, saved traces, capture, and deterministic replay. Example jobs advance only through the lab's logical clock. The standalone example UI and its operator-only API have been retired; old standalone data is preserved on disk but is not loaded as a lab run.

The built-in application contract is documented in [APPLICATIONS.md](APPLICATIONS.md). Arbitrary application loading, real AI workers, live microphone/STT integration, and native TV platform compatibility remain open. Earlier verification receipts below describe their original commits; current validation commands are `npm run verify`, `npm run test:browser`, and `npm run test:life`.

## 2026-09-12 — Shared Device Lab

The lab now runs against one local session service. Human UI, a second agent browser, WebMCP registration, HTTP MCP and the stdio MCP proxy all reach the same permission checks and dispatcher.

Implemented:

- schema-validated tools, session configuration and replay files;
- independent remote input state (held keys, PTT ownership and connection) and TV state;
- remote-only and semantic authority enforcement on the server;
- operator-only evaluator/configuration with a separate agent page;
- session tokens, exclusive input leases, revocation, revision checks and human takeover;
- deterministic navigation, real episode selection, app shortcuts, search, playback controls and modal gates;
- fixture PTT lifecycle, partials, confidence, logical delay, cancellation, early release, timeout and packet loss;
- 13 benchmark fixtures, including sign-in/help, PIN/purchase gates and recovery cases;
- dropped/duplicated keys, disconnected remote, crash and network faults;
- atomic run storage, reset archives, restore, validated replay and a timeline slider;
- actual PNG snapshots and WebM recordings of the rendered TV;
- responsive layout and accessible form/remote controls;
- reproducible core/API tests and a browser acceptance suite in CI.

### Verified evidence

At application commit `b411091`:

| Environment | Result |
| --- | --- |
| Local Linux | Typecheck, 48 core/API tests and production build passed |
| Daniel’s Mac mini via Fleet | Typecheck, 48 core/API tests and production build passed |
| Fresh Chrome profile on Mac mini | 21 browser checks passed; no uncaught errors or mobile horizontal overflow |

Fleet verification receipt: `780e998c4640c64a22a3b1d200c2403803cfe55f8844a3d6aa14120ce49a6b91`, terminal status `succeeded`, exit 0. Browser evidence is in `qa-artifacts/` on the verification checkout and uploaded by CI on every run.

The browser suite proves remote episode selection, pointer PTT, semantic and remote runners, eight recovery/help scenarios, cancellation during a reset, actual capture downloads, trace replay, a second browser operating the same TV, and denial after revocation. GitHub Linux CI exposed delayed-request teardown and a stale-reset race. The test now uses explicit request barriers; server reset operations reject stale revisions, and configuration changes disable Start until committed.

### Remaining boundaries

- BRS/BrightScript execution and additional vendor device packs are not implemented.
- Recorded/live microphone capture and speech-provider integration are not implemented.
- The scripted runner is not an AI model. Native WebMCP availability depends on the browser; adapter registration/dispatch/cleanup has a contract test. Native registration of 15 remote tools was verified on Mac Chrome 152.0.7977.83 with its WebMCP feature enabled (Fleet receipt `f25bb1cd9fdfb3e7b2681c96960dd5e2a7438c73dba1b4d50704a0795dc5fddb`).
- The rendered-remote profile has no advertised tools, but is not a hardened pixels-only model harness. Do not give an evaluated visual agent DOM/network/operator access and claim it is seeing only pixels.
- MCP is local HTTP/stdio. A hosted ChatGPT/Claude connector with OAuth and durable remote deployment remains separate work.
- Capture files are downloaded separately; screenshot anchors are not yet embedded in trace JSON.
- Stale-observation/delayed-render faults, configurable external scenario authoring, device-pack contracts and model/cost metrics remain on the full roadmap.
- Durations are logical emulator time, and hashes detect replay divergence rather than authenticate files.

Run and connection instructions: [RUNNING.md](RUNNING.md).
