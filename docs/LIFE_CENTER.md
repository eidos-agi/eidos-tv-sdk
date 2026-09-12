# Example application — Life Center

Life Center is one workload for the TV testing lab. Open the normal operator link, choose **Application under test → Life Center (example)**, then choose one of four scenarios: request, voice instruction, cancellation, or offline worker.

Use the existing virtual remote: arrows select prompts or jobs, OK submits/opens, Back/Home returns, and Options cancels the selected pending job. Remote text creates a draft; press OK to submit it. The PTT fixture sends a transcript through the shared voice lifecycle. Microphone audio/STT integration is not included in this lab milestone.

Advance the lab clock to progress jobs, or use the scripted test runner. Jobs are part of the canonical TV snapshot and saved trace. Restore or replay a run to reconstruct them. Time while the server is closed does not advance a test. Results are explicitly simulated: no personal accounts, bookings, calendar writes, or cloud workers are connected.

## Agent connection

Create an agent grant using the lab, then connect through the existing `/mcp` endpoint or the grant's browser view for WebMCP. Remote-only grants use `remote.type`, `remote.press`, and the PTT tools. Semantic grants additionally expose `tv.requestJob`. `tv.observe` returns the TV and application state; `session.wait` advances logical time. The same authority checks and reset/revocation rules apply to every application.

The former standalone `/life-mcp` and `/api/life` endpoints are retired. Old standalone data is left on disk; it does not define the state of a new lab test.

## Verification and boundaries

`npm run verify` covers authority, deterministic replay, saved restoration, MCP shared state, input deduplication, and supported faults. `npm run test:life` exercises application selection and switching, common remote controls, all four scenarios, semantic runner behavior, and responsive layout. `npm run test:browser` retains the original media lab regression suite.

See [the application contract](APPLICATIONS.md) for extending the lab. Real AI backends, arbitrary application loading, live microphone integration, and native Roku/Android TV compatibility remain future lab capabilities. This repository is not a standalone Life Center product.
