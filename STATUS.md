# SDK Status & Limitations

> Honest, current-state assessment of `@agentcompose/sdk`. This is **substrate**
> (`0.0.x`): the single-agent core runs and is tested, but several capabilities
> needed for production and for sharing agents publicly are not built yet.

Last reviewed: 2026-06-10

## What works today

- **`defineAgent()`** — reusable, configurable agent components (`configSchema` + handler).
- **Configuration** — validation against `configSchema`, default application, secrets resolved from env (`{ secretRef }`).
- **Task lifecycle** — `submitted → working → (input-required) → completed/failed/canceled`.
- **Streaming** — `message` deltas, `progress`, `artifact` events.
- **Interaction** — `input-required` ↔ `provideInput`, cancel, idempotency keys.
- **Transports behind one `AgentClient`** — `inProcess`, `serveStdio` (NDJSON), `spawnStdio` (subprocess host).
- **Quality** — in-process + end-to-end stdio tests passing; clean `tsc`; zero build step (Node ≥ 22 runs the TS directly).

## Known gaps

| Gap | Impact | Tracking |
|-----|--------|----------|
| **Not published to npm** | Consumers install from git, not `npm i @agentcompose/sdk`. Version is `0.0.0`. | planned: tag + publish `0.1.0` |
| **No HTTP transport** | Agents can't be exposed as a network service; same-machine only (in-process / subprocess). | planned |
| **No auth enforcement** | The descriptor can *declare* auth, but the SDK does not verify bearer/apiKey/oauth on incoming calls. Fine for local, not for exposed agents. | planned (with HTTP) |
| **No typed capability I/O / sessions** | Agents can't be composed *programmatically* by input/output shape; no cross-task memory. | Spec Scope B |
| **Reference agent is a stub** | `examples/research-agent.ts` simulates work with `sleep`; no real model is wired. | planned: real `provider` binding |
| **Substrate maturity** | No retries/backpressure, no graceful shutdown drain, no logging/telemetry hooks, shallow input validation. | hardening backlog |

## Readiness by use case

| You want to… | Status |
|--------------|--------|
| Prototype an agent and drive it from your own code, locally | ✅ Ready |
| Publish an agent others install and run as a subprocess | ⚠️ Almost — needs npm publish + versioned tag |
| Expose an agent as a hosted HTTP service with auth | ❌ Not yet — needs HTTP transport + auth enforcement |
| Compose two agents by typed contracts | ❌ Not yet — Spec Scope B (typed I/O + sessions) |

## Relationship to the spec

This SDK implements the **single-agent core + configuration** layer of the
[AgentCompose spec](https://github.com/agentcompose/spec), which is stable. The
composition layer (typed capability I/O, sessions) is deferred in both the spec
(Scope B) and this SDK, and will land together.

## Near-term priorities

1. Wire one real model into the reference agent via the `provider` config (prove the configurable-component story end to end).
2. Publish `0.1.0` to npm.
3. HTTP transport + auth enforcement.
4. Spec Scope B: typed capability I/O + sessions.
