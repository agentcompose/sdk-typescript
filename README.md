# @agentcompose/sdk

> TypeScript SDK for [AgentCompose](https://github.com/agentcompose/spec) — define
> **configurable agent components** once, and run them in-process, as a local
> subprocess, or (soon) over HTTP.

**Status:** `0.0.x` early/substrate · **License:** Apache-2.0 · **Requires:** Node ≥ 22

This SDK is the first runnable implementation of the AgentCompose contract. It
covers the **single-agent core**: configuration, the task lifecycle, and the
in-process + stdio transports. Composition (typed capability I/O, sessions) is
deferred to a later release, in step with the spec.

## Install

```bash
npm install   # ajv + ajv-formats
```

No build step — Node runs the TypeScript directly.

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

## Try the demo

```bash
npm run demo "AI agent interoperability"
```

Spawns the reference agent as a subprocess, configures it, submits a goal, and
streams the result back over stdio.

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
