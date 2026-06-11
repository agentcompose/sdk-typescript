# Changelog

All notable changes to `@agentcompose/sdk` are documented here. This project adheres
to [Semantic Versioning](https://semver.org/). Pre-1.0, minor versions may introduce
additive changes; breaking changes are avoided but possible while the contract settles.

## 0.1.2 — 2026-06-11

### Added
- **Tracing (`ctx.trace`).** Every handler is now wrapped in a **root span** automatically,
  so every agent is observable for free — its timing and final status (`ok` / `error` /
  `unset` on cancel) are recorded even if the handler never opens a span. Domain spans are
  pure opt-in:
  - `ctx.trace.span(opts, fn)` — scoped span that auto-closes (`ok` on return, `error` on
    throw) and **auto-nests** under the enclosing span via `AsyncLocalStorage`, so the trace
    tree mirrors the call stack with no hand-wired parentage.
  - `ctx.trace.startSpan(opts)` — a manually-ended `SpanHandle` for event-driven work (e.g.
    one span per tool execution), with `attr` / `event` / `end({ status, error })`.
  - `ctx.trace.forwardSpan(ev)` — re-stamps a child agent's span onto the current trace so a
    composition boundary propagates a sub-trace **losslessly** instead of flattening it.
- Spans surface as immutable `span-start` / `span-end` task events on the existing stream;
  `TaskEvent` gains those variants and the supporting `SpanStart` / `SpanEvent` /
  `SpanStatus` / `AttrMap` types (all exported for consumers like the engine).
- New exports: `createTracer`, and types `TraceApi`, `SpanHandle`, `SpanOptions`.

The tracer is transport- and runtime-neutral (needs only an event sink and a clock), and
the feature is fully additive — agents written against 0.1.1 are unaffected.

## 0.1.1 — 2026-06-10

### Added
- **Inbound wire validation against the canonical contract.** The SDK now depends on
  [`@agentcompose/spec`](https://www.npmjs.com/package/@agentcompose/spec) and validates
  inbound JSON-RPC params (`tasks/submit`, `agent/configure`, `tasks/provideInput`) at
  the stdio boundary against the published schemas, rejecting malformed messages with
  `InvalidParams` (-32602). Exposed as `validateWireParams` for other transports.
- **Type drift guard.** A test validates representative values of the SDK's types
  (`Part`, `Task`, `Artifact`, `AgentDescriptor`) against the canonical schemas, so the
  hand-written types can no longer silently diverge from the contract.

## 0.1.0 — 2026-06-10

First published release. The single-agent substrate of the AgentCompose contract.

### Added
- `defineAgent` / `AgentRuntime` — author a configurable agent component: descriptor
  (id, version, capabilities, `configSchema`), the task lifecycle, configuration with
  JSON-Schema validation and defaults, and secret references resolved from the env.
- Transports: `inProcess` (same-process client) and `serveStdio` / `spawnStdio`
  (NDJSON over stdio), behind one uniform `AgentClient` interface.
- Task lifecycle with streamed events (progress, message, artifact, status, result,
  error), cancellation, idempotent submit, and durable `input-required` HITL.
- Wire types aligned to the spec: `Part` as `text` / `file` / `json`; structured
  `prompt` on `input-required` status.
- Error model: `AgentError`, `JsonRpcCodes`, `ErrorCodes`, `toRpcError`.
- Distribution: published as compiled JS + type declarations (`dist/`); runs on
  Node ≥ 18.19 with no build step for consumers.

### Known limitations
See [STATUS.md](./STATUS.md): no HTTP transport yet, no auth enforcement, no typed
capability I/O / sessions, and in-process vs stdio subscription parity differs.
