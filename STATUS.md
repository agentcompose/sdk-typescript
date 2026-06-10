# SDK Status & Limitations

> Honest, current-state assessment of `@agentcompose/sdk@0.1.0`. This is the
> **single-agent core** (`0.1.x`): it runs and is tested, but several capabilities
> needed for HTTP serving and for sharing agents publicly are not built yet.

Last reviewed: 2026-06-10

## What works today

- **`defineAgent()`** — reusable, configurable agent components (`configSchema` + handler).
- **Configuration** — validation against `configSchema`, default application, secrets resolved from env (`{ secretRef }`).
- **Wire validation** — inbound JSON-RPC params (`tasks/submit`, `agent/configure`, `tasks/provideInput`) are validated at the transport boundary against the **canonical `@agentcompose/spec` schemas**; malformed messages are rejected with `InvalidParams`. A drift-guard test ties the SDK types to those schemas.
- **Task lifecycle** — `submitted → working → (input-required) → completed/failed/canceled`.
- **Streaming** — `message` deltas, `progress`, `artifact` events.
- **Interaction** — `input-required` ↔ `provideInput`, cancel, idempotency keys.
- **Transports behind one `AgentClient`** — `inProcess`, `serveStdio` (NDJSON), `spawnStdio` (subprocess host).
- **Quality** — in-process + end-to-end stdio tests passing; clean `tsc`. Published as compiled JS + type declarations (runs on Node ≥ 18.19); authored in strip-mode TypeScript (Node ≥ 22.6 runs it directly in dev).

## Known gaps

| Gap | Impact | Tracking |
|-----|--------|----------|
| **No published agents yet** | An agent built *with* the SDK (a separate package) must itself be published before others can `npm i` / `npx` and run it as a subprocess. | derived from SDK publish |
| **No HTTP transport** | Agents can't be exposed as a network service; same-machine only (in-process / subprocess). | planned |
| **No auth enforcement** | The descriptor can *declare* auth, but the SDK does not verify bearer/apiKey/oauth on incoming calls. Fine for local, not for exposed agents. | planned (with HTTP) |
| **No typed capability I/O / sessions** | Agents can't be composed *programmatically* by input/output shape; no cross-task memory. | Spec Scope B |
| **Reference agent is a stub** | `examples/research-agent.ts` simulates work with `sleep`; no real model is wired. | planned: real `provider` binding |
| **Substrate maturity** | No retries/backpressure, no graceful shutdown drain, no logging/telemetry hooks. | hardening backlog |
| **Transport subscription parity** | In-process `subscribe()` supports multiple subscribers with synchronous backlog replay; the stdio client exposes a single shared, single-consumer event stream (no re-attach — `tasks/subscribe` is absent by the stdio binding). No data is lost, but tooling that assumes multi-subscriber parity across transports differs. | planned |

## Readiness by use case

| You want to… | Status |
|--------------|--------|
| Prototype an agent and drive it from your own code, locally | ✅ Ready |
| **Install the SDK from npm to build agents** | ⚠️ Almost — needs SDK published + versioned tag |
| Publish your own agent others install and run as a subprocess | ⚠️ Blocked on SDK publish, then publish your agent package |
| Expose an agent as a hosted HTTP service with auth | ❌ Not yet — needs HTTP transport + auth enforcement |
| Compose two agents by typed contracts | ❌ Not yet — Spec Scope B (typed I/O + sessions) |

## Relationship to the spec

This SDK implements the **single-agent core + configuration** layer of the
[AgentCompose spec](https://github.com/agentcompose/spec), which is stable. The
composition layer (typed capability I/O, sessions) is deferred in both the spec
(Scope B) and this SDK, and will land together.

## Near-term priorities

1. **Publish the SDK** (`@agentcompose/sdk` `0.1.0`) to npm — unblocks all builders.
2. Wire one real model into the reference agent via the `provider` config (prove the configurable-component story end to end).
3. HTTP transport + auth enforcement.
4. Spec Scope B: typed capability I/O + sessions.
