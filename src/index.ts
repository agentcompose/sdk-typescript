export * from "./types.ts";
export { defineAgent, AgentRuntime } from "./agent.ts";
export type { AgentDefinition, AgentHandler, HandlerContext, EmitApi } from "./agent.ts";
export type { AgentClient } from "./client.ts";
export { inProcess } from "./transport/in-process.ts";
export { serveStdio } from "./transport/stdio-server.ts";
export type { ServeStdioOptions } from "./transport/stdio-server.ts";
export { spawnStdio } from "./transport/stdio-client.ts";
export type { SpawnStdioOptions } from "./transport/stdio-client.ts";
// EXPERIMENTAL composition engine (Scope-B spike) — API may change.
export { Coordinator } from "./coordinator.ts";
export type { Member, EventSink, CallOptions } from "./coordinator.ts";
