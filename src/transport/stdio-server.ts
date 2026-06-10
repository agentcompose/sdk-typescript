import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { AgentRuntime } from "../agent.ts";
import type { AgentDefinition } from "../agent.ts";
import { JsonRpcCodes, toRpcError } from "../types.ts";
import type { Part, TaskEvent } from "../types.ts";

export interface ServeStdioOptions {
  input?: Readable;
  output?: Writable;
}

/**
 * stdio binding (server side): serve an agent over NDJSON on stdin/stdout.
 * stdout carries protocol JSON only; everything else MUST go to stderr.
 * Task events are pushed as `task/event` notifications.
 */
export function serveStdio(def: AgentDefinition, opts: ServeStdioOptions = {}): AgentRuntime {
  const runtime = new AgentRuntime(def);
  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stdout;

  const write = (msg: unknown): void => {
    output.write(JSON.stringify(msg) + "\n");
  };
  const reply = (id: unknown, result: unknown): void => write({ jsonrpc: "2.0", id, result });
  const fail = (id: unknown, error: { code: number; message: string; data?: unknown }): void =>
    write({ jsonrpc: "2.0", id, error });
  const notify = (method: string, params: unknown): void =>
    write({ jsonrpc: "2.0", method, params });

  const forwarded = new Set<string>();
  const forward = (taskId: string): void => {
    // Forward each task's events exactly once. An idempotent re-submit returns an
    // existing task; without this guard a second subscribe would re-emit its
    // `task/event` notifications, duplicating them for the client.
    if (forwarded.has(taskId)) return;
    forwarded.add(taskId);
    void (async () => {
      for await (const ev of runtime.subscribe(taskId)) {
        notify("task/event", ev as TaskEvent);
      }
    })();
  };

  const rl = createInterface({ input, crlfDelay: Infinity });
  rl.on("line", (line) => {
    const text = line.trim();
    if (text.length === 0) return;
    let msg: { id?: unknown; method?: string; params?: Record<string, unknown> };
    try {
      msg = JSON.parse(text);
    } catch {
      return; // ignore unparseable input
    }
    if (typeof msg.method !== "string" || msg.id === undefined) return; // notifications: nothing to do
    void handle(msg.id, msg.method, msg.params ?? {});
  });

  async function handle(id: unknown, method: string, params: Record<string, unknown>): Promise<void> {
    try {
      switch (method) {
        case "agent/describe":
          return reply(id, runtime.describe());
        case "agent/configure":
          return reply(id, runtime.configure((params.config ?? {}) as Record<string, unknown>));
        case "tasks/submit": {
          const task = await runtime.submit(
            (params.goal ?? []) as Part[],
            params.idempotencyKey ? { idempotencyKey: String(params.idempotencyKey) } : undefined,
          );
          reply(id, task);
          forward(task.id);
          return;
        }
        case "tasks/get":
          return reply(id, runtime.get(String(params.id)));
        case "tasks/cancel":
          return reply(id, runtime.cancel(String(params.id)));
        case "tasks/provideInput":
          return reply(id, runtime.provideInput(String(params.id), (params.input ?? []) as Part[]));
        default:
          return fail(id, { code: JsonRpcCodes.MethodNotFound, message: `Unknown method: ${method}` });
      }
    } catch (err) {
      fail(id, toRpcError(err));
    }
  }

  return runtime;
}
