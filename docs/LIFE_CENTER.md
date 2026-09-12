# Personal AI Life Center

Open the operator URL printed by `npm start`, then choose **Open Life Center**. The `/home` route keeps the operator fragment. The original device lab is available from its header.

The local preview supports remote arrows, OK, Back, Home, and screen power; keyboard arrows/Enter/Escape when focus is outside a form; request submission; job cancellation; and result review. Browser speech recognition is optional and requires browser microphone permission. The transcript is reviewed before sending. Browser speech services may process audio remotely; this is not an offline STT implementation. No microphone capture is started automatically.

Jobs persist in `life-center.json` inside the configured EIDOS_TV_DATA directory. Simulated progression derives from elapsed wall time (queued, working, completed), including time while the screen or process is closed. No actual background worker runs. The three sample response families cover attention, travel preparation, and planning; arbitrary requests explicitly explain that real integration is required. No personal accounts, calendar writes, bookings, or cloud jobs are connected.

## Agent connection

An official SDK Streamable HTTP client can connect to `http://127.0.0.1:4317/life-mcp` using `Authorization: Bearer <operator token>`. This is an explicit local operator-level connection, not a session-scoped grant. Never distribute that token to an untrusted agent. The existing lab `/mcp` endpoint and its session grants remain separate and cannot access personal jobs.

Tools: `life.observe`, `life.request`, `life.open`, `life.cancel`, and `life.remote`. Native WebMCP registers the same tool definitions in a supported browser on `/home`, dispatching to the same authenticated `/api/life` handler. Both clients share the persisted Life Center state.

## Verification

`npm run verify` includes persistence, remote selection, cancellation, validation, and real MCP-to-HTTP shared-state tests. `npm run test:life` exercises the built page in Chromium, including remote operation, results, screen sleep, reload, a second browser client, cancellation, and mobile layout. Actual live microphone transcription requires a supported browser/service and is not claimed by these automated tests.

## Next integration milestones

- Replace simulated job progression with a durable worker adapter and explicit job events, retries, idempotency, and cancellation acknowledgement.
- Connect an actual agent with scoped personal-system permissions; prove a useful request and result end to end.
- Add identity and secure cross-device continuity. Current loopback deployment is not accessible from a traveling device.
- Test Roku and Android TV input, voice availability, rendering, and packaging on actual platform runtimes before promising support.
- Keep simulation labels visible until live capabilities are verified.
