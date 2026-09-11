# Implementation Status

## 2026-09-11 — North-Star shell

Implemented on `main`:

- npm/TypeScript workspace;
- shared canonical protocol types;
- deterministic generic-TV reducer;
- browser Device Lab shell matching the approved testing mockup;
- functional virtual remote;
- fixture PTT interaction;
- network profiles;
- STT, dropped-key, crash, purchase-modal, and parental-PIN fault controls;
- live canonical trace;
- snapshot/video-control trace hooks;
- deterministic demo-agent run;
- hidden evaluator metrics;
- CI workflow for typecheck/build.

Not yet claimed complete:

- native WebMCP registration;
- external MCP server;
- persisted scenario/trace store;
- deterministic replay timeline;
- BRS runtime adapter;
- real microphone/STT;
- visual-only external model harness.

The UI positions for these systems are intentionally present in the North Star so the backend can be filled in without redesigning the lab.
