import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { Channel } from "../channel.ts";
import { AgentError, isTerminal } from "../types.ts";
import type { AgentClient } from "../client.ts";
import type { AgentConfig, AgentDescriptor, Part, Task, TaskEvent } from "../types.ts";

export interface SpawnStdioOptions {
  args?: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
}

/**
 * stdio binding (host side): spawn an agent as a child process and drive it
 * over NDJSON. Implements the same AgentClient interface as in-process.
 */
export function spawnStdio(command: string, opts: SpawnStdioOptions = {}): AgentClient {
  const child: ReturnType<typeof spawn> = spawn(command, opts.args ?? [], {
    stdio: ["pipe", "pipe", "inherit"], // agent stderr → our stderr
    env: { ...process.env, ...opts.env },
    cwd: opts.cwd,
  });
  const stdout = child.stdout!;
  const stdin = child.stdin!;

  const pending = new Map<number, Pending>();
  const taskChannels = new Map<string, Channel<TaskEvent>>();
  let nextId = 0;

  const channelFor = (taskId: string): Channel<TaskEvent> => {
    let ch = taskChannels.get(taskId);
    if (!ch) {
      ch = new Channel<TaskEvent>();
      taskChannels.set(taskId, ch);
    }
    return ch;
  };

  const rl = createInterface({ input: stdout, crlfDelay: Infinity });
  rl.on("line", (line) => {
    const text = line.trim();
    if (text.length === 0) return;
    let msg: any;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.method === "task/event" && msg.params) {
      const ev = msg.params as TaskEvent;
      const ch = channelFor(ev.taskId);
      ch.push(ev);
      if (ev.type === "status" && isTerminal(ev.state)) ch.close();
      return;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const p = pending.get(msg.id)!;
      pending.delete(msg.id);
      if (msg.error) p.reject(new AgentError(msg.error.code, msg.error.message, msg.error.data));
      else p.resolve(msg.result);
    }
  });

  const rpc = <T>(method: string, params?: unknown): Promise<T> => {
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  };

  child.on("exit", () => {
    for (const p of pending.values()) p.reject(new Error("agent process exited"));
    pending.clear();
    for (const ch of taskChannels.values()) ch.close();
  });

  return {
    describe: () => rpc<AgentDescriptor>("agent/describe"),
    configure: (config: AgentConfig) => rpc<AgentConfig>("agent/configure", { config }),
    submit: (goal: Part[], o) => rpc<Task>("tasks/submit", { goal, ...o }),
    get: (id: string) => rpc<Task>("tasks/get", { id }),
    cancel: (id: string) => rpc<Task>("tasks/cancel", { id }),
    provideInput: (id: string, input: Part[]) => rpc<Task>("tasks/provideInput", { id, input }),
    events: (id: string) => channelFor(id),
    close: async () => {
      stdin.end();
      child.kill();
    },
  } satisfies AgentClient;
}
