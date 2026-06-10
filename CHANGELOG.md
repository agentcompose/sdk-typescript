# Changelog

All notable changes to `@agentcompose/sdk` are documented here. This project adheres
to [Semantic Versioning](https://semver.org/). Pre-1.0, minor versions may introduce
additive changes; breaking changes are avoided but possible while the contract settles.

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
