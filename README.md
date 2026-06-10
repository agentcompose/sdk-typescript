# @agentcompose/sdk

[![npm](https://img.shields.io/npm/v/@agentcompose/sdk.svg)](https://www.npmjs.com/package/@agentcompose/sdk)
[![provenance](https://img.shields.io/badge/npm-provenance-blue.svg)](https://www.npmjs.com/package/@agentcompose/sdk)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

> TypeScript SDK for [AgentCompose](https://github.com/agentcompose/spec) — define
> **configurable agent components** once, and run them in-process, as a local
> subprocess, or (soon) over HTTP.

**Version:** `0.1.0` · **License:** Apache-2.0 · **Requires:** Node ≥ 18.19

This SDK is the first runnable implementation of the AgentCompose contract. It
covers the **single-agent core**: configuration, the task lifecycle, and the
in-process + stdio transports. Composition (typed capability I/O, sessions) is
deferred to a later release, in step with the spec.

> 📋 **What works today.** See [STATUS.md](./STATUS.md) for the exact feature
> matrix, the known gaps (HTTP transport, auth enforcement, typed capability I/O),
> and readiness by use case before you build on it.
>
> 💡 **Writing an agent?** Read the spec's
> [Authoring Agents — Design Guidance](https://github.com/agentcompose/spec/blob/main/guides/authoring-agents.md)
> first — agents are best built as thin adapters over existing tools, at the right
> level of abstraction.

## Install

```bash
npm install @agentcompose/sdk
```

The published package ships compiled JavaScript + type declarations (`dist/`), so it
runs on Node ≥ 18.19 with no build step on your side. (This repo is *authored* in
strip-mode TypeScript; `npm run build` emits the `dist/` that gets published.)

## Define an agent (a reusable, configurable component)

```ts
import { defineAgent } from "@agentcompose/sdk";

export const research = defineAgent({
  descriptor: {
    agentcomposeVersion: "0.1.0",
    id: "dev.example.research",
    name: "Research Agent",
    version: "1.0.0",
    capabilities: [{ id: "research", description: "Summarize a topic." }],
    // Declared, typed configuration surface — run on defaults or override.
    configSchema: {
      type: "object",
      additionalProperties: false,
      properties: { depth: { type: "string", enum: ["shallow", "deep"], default: "shallow" } },
    },
  },
  async handle(goal, ctx) {
    ctx.progress(10, "working");
    ctx.message({ kind: "text", text: "…" });        // stream tokens
    return [{ kind: "text", text: `(${ctx.config.depth}) done` }];
  },
});
```

## Run it three ways — same client interface

```ts
import { inProcess, serveStdio, spawnStdio } from "@agentcompose/sdk";

// 1. In-process (zero wire) — add the agent as a dependency.
const client = inProcess(research);

// 2. Host it as a stdio process:  node my-agent.ts
serveStdio(research);

// 3. Drive a subprocess agent from an orchestrator:
const client2 = spawnStdio("node", { args: ["./my-agent.ts"] });

await client.configure({ depth: "deep" });
const task = await client.submit([{ kind: "text", text: "agent standards" }]);
for await (const ev of client.events(task.id)) {
  if (ev.type === "message" && ev.delta.kind === "text") process.stdout.write(ev.delta.text);
}
```

## Try the demos

```bash
npm run demo "AI agent interoperability"   # full driver: progress, streaming, artifact
npm run demo "?"                            # vague topic → input-required clarification loop
npm run demo:advanced                        # errors, cancellation, idempotency
```

The orchestrator spawns the reference agent as a subprocess, configures it, submits
a goal, and reacts to **every** event type over stdio.

## Lifecycle, events & errors

An agent is a task protocol, not a single request/response. Each task moves
through a state machine and emits a typed event stream.

**Task states:** `submitted → working → (input-required ⇄ working) → completed | failed | canceled`

**Event stream** (`for await (const ev of client.events(taskId))`):

| `ev.type` | Meaning | Builder emits via |
|-----------|---------|-------------------|
| `status` | state changed | automatic / `ctx.status()` |
| `progress` | percent + message | `ctx.progress(50, "writing")` |
| `message` | streamed output delta | `ctx.message({ kind, text })` |
| `artifact` | produced file/data | `ctx.artifact(parts, name)` |
| `result` | final payload | `return [...]` |
| `error` | structured failure | `throw new AgentError(code, msg)` |

**Errors** carry a reserved code (`ErrorCodes`): `TaskNotFound` (-32000),
`CapabilityNotSupported` (-32001), `InvalidGoal` (-32002), `AuthRequired` (-32003),
`RateLimited` (-32004), `InvalidState` (-32005), `UnsupportedVersion` (-32006),
`InvalidConfiguration` (-32007). Synchronous calls (e.g. `configure`) reject with
an `AgentError`; task failures surface as an `error` event and a `failed` state.

**Operational verbs:** `client.cancel(id)` (aborts `ctx.signal`), `requestInput()` ⇄
`provideInput()` (pause/resume), and `submit(goal, { idempotencyKey })` (dedupe retries).

## API surface

| Export | Purpose |
|--------|---------|
| `defineAgent(def)` | Declare an agent component (descriptor + handler). |
| `inProcess(def)` | Client backed by a direct, in-process runtime. |
| `serveStdio(def)` | Serve an agent over the stdio binding (NDJSON). |
| `spawnStdio(cmd, opts)` | Host-side client that spawns + drives a subprocess agent. |
| `AgentRuntime` | The transport-neutral core (advanced use). |

`AgentClient` (uniform across transports): `describe`, `configure`, `submit`,
`get`, `cancel`, `provideInput`, `events`, `close`.

The handler `ctx` provides: `config` (effective, secrets resolved from env),
`status` / `message` / `progress` / `artifact` emitters, `requestInput()` for the
`input-required` flow, `signal` for cancellation, and `taskId`.

## Test

```bash
npm test        # in-process + end-to-end stdio
npm run typecheck
```

## License

[Apache-2.0](./LICENSE)
