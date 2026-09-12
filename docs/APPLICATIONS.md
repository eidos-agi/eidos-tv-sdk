# Applications under test

The lab is the product; applications are test workloads. The application selector filters scenarios. Selecting an application resets the current session into that application's starting scenario, clears scenario faults and pending input, and revokes the old agent grant through the existing broker.

The current built-in registry lives in `packages/core/src/applications.ts`. It defines application IDs, labels, supported faults, and the Life Center reducer/clock behavior. Media retains the existing TV reducer. The scenario selects the application; there is no second independently mutable application setting. This is a code extension point, not an arbitrary app upload system.

## Contract for another built-in application

1. Register its metadata and supported faults, and add scenario fixtures associated with its application ID.
2. Define serializable application state in the TV snapshot and deterministic initial state. No wall clock, random UUIDs, network calls, or private side store in the reducer.
3. Implement remote/text/transcript transitions and logical-time progression through the shared session dispatcher. Emit structured events. Keep device power, volume, PTT ownership, and authority checks in the shared path.
4. If needed, add schema-validated direct-TV tools restricted to semantic authority and that application. Remote-only grants must not gain semantic powers.
5. Render the snapshot within the lab TV surface, including replay snapshots. Add server-only evaluation rules and browser/core/API tests.

Saved traces include scenario config, actor, action IDs, payloads, and a final TV state hash including application jobs. Replay reconstructs the same state. All mock worker progress is explicit logical time; the lab never silently runs a second real-time worker.

## Current coverage

| Application | Scenarios | Additional behavior |
| --- | --- | --- |
| Streaming TV | 13 | Existing media navigation, playback, account gates and recovery |
| Life Center example | Request, PTT instruction, cancellation, offline worker | Draft text plus OK, direct `tv.requestJob` for semantic grants, simulated job results, Options to cancel |

Life Center supports dropped/duplicated keys, disconnect, low-confidence speech, speech delay/timeout/packet loss, and a worker-unavailable fault. Purchase and PIN faults are not supported by this example and are rejected in config. Offline blocks jobs; slow/intermittent profiles extend their logical completion time. This is a simulation, not proof of actual cloud network or agent behavior.

The former standalone `/api/life` and `/life-mcp` endpoints return a retirement error for authenticated callers. `/home` displays the lab. Prior standalone `life-center.json` data is left on disk but is not imported into test sessions. Existing media traces remain compatible; old standalone Life Center state was not a lab trace.
