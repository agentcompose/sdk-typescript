// EXPERIMENTAL composition engine. A Coordinator lets one agent drive others.
// It is transport-agnostic: members can be in-process or spawned subprocesses.
// This is a Scope-B learning spike, not a frozen API — expect it to change.
import { AgentError, JsonRpcCodes } from "./types.ts";
import type { AgentClient } from "./client.ts";
import type { AgentConfig, Part, Result } from "./types.ts";

/** A sink that receives a child's forwarded activity (e.g. an agent's ctx). */
export interface EventSink {
  message?(delta: Part): void;
  progress?(percent?: number, message?: string): void;
}

/** A sub-agent the coordinator can call, plus optional configuration. */
export interface Member {
  name: string;
  client: AgentClient;
  config?: AgentConfig;
}

export interface CallOptions {
  /** Forward the member's progress/status (tagged with its name) here. */
  sink?: EventSink;
  /** Cancel the member's task when this aborts. */
  signal?: AbortSignal;
  /** Also forward the member's streamed message deltas to the sink. */
  forwardMessages?: boolean;
}

/**
 * Coordinates a team of agents from inside another agent's handler.
 * Thin on purpose — it standardizes calling, forwarding, and failure
 * propagation, not control flow. The caller writes the orchestration logic.
 */
export class Coordinator {
  #members = new Map<string, Member>();
  #configured = false;

  constructor(members: Member[] = []) {
    for (const m of members) this.#members.set(m.name, m);
  }

  add(member: Member): this {
    this.#members.set(member.name, member);
    return this;
  }

  /** Apply each member's configuration once (idempotent). */
  async configure(): Promise<void> {
    if (this.#configured) return;
    for (const m of this.#members.values()) {
      if (m.config) await m.client.configure(m.config);
    }
    this.#configured = true;
  }

  /** Run one member to completion, forwarding activity and returning its result. */
  async call(name: string, goal: Part[], opts: CallOptions = {}): Promise<Result> {
    const m = this.#members.get(name);
    if (!m) throw new AgentError(JsonRpcCodes.InvalidParams, `Unknown team member: ${name}`);
    await this.configure();

    const task = await m.client.submit(goal);

    let onAbort: (() => void) | undefined;
    if (opts.signal) {
      onAbort = () => void m.client.cancel(task.id).catch(() => {});
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      for await (const ev of m.client.events(task.id)) {
        if (ev.type === "progress") opts.sink?.progress?.(ev.percent, `${name}: ${ev.message ?? ""}`);
        else if (ev.type === "status") opts.sink?.progress?.(undefined, `${name} → ${ev.state}`);
        else if (ev.type === "message" && opts.forwardMessages) opts.sink?.message?.(ev.delta);
      }
    } finally {
      if (opts.signal && onAbort) opts.signal.removeEventListener("abort", onAbort);
    }

    const final = await m.client.get(task.id);
    if (final.state !== "completed") {
      throw new AgentError(
        final.error?.code ?? JsonRpcCodes.InternalError,
        `Member "${name}" ended ${final.state}: ${final.error?.message ?? "no result"}`,
        final.error?.data,
      );
    }
    return final.result ?? { parts: [] };
  }

  /** Fan out: run several member calls in parallel; rejects if any fails. */
  async callMany(
    calls: { name: string; goal: Part[] }[],
    opts: CallOptions = {},
  ): Promise<Result[]> {
    return Promise.all(calls.map((c) => this.call(c.name, c.goal, opts)));
  }

  /** Close every member's client (terminates spawned subprocesses). */
  async close(): Promise<void> {
    await Promise.all([...this.#members.values()].map((m) => m.client.close()));
  }
}
