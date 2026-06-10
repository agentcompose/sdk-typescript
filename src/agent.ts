import { randomUUID } from "node:crypto";
import AjvDefault from "ajv/dist/2020.js";
import addFormatsDefault from "ajv-formats";
// Normalize CJS/ESM interop so types and runtime agree across resolvers.
const Ajv = ((AjvDefault as any).default ?? AjvDefault) as any;
const addFormats = ((addFormatsDefault as any).default ?? addFormatsDefault) as any;
import { Channel } from "./channel.ts";
import {
  AGENTCOMPOSE_VERSION,
  AgentError,
  ErrorCodes,
  assertCompatibleVersion,
  isTerminal,
  toRpcError,
} from "./types.ts";
import type {
  AgentConfig,
  AgentDescriptor,
  Artifact,
  Part,
  Result,
  Task,
  TaskEvent,
} from "./types.ts";

/** Emit methods available on the handler context. */
export interface EmitApi {
  status(state: "working" | "input-required", message?: Part[]): void;
  message(delta: Part): void;
  progress(percent?: number, message?: string): void;
  artifact(parts: Part[], name?: string): void;
}

export interface HandlerContext extends EmitApi {
  taskId: string;
  signal: AbortSignal;
  /** Effective configuration for this instance, with SecretRefs resolved from env. */
  config: AgentConfig;
  /** Pause in input-required until the caller supplies input. */
  requestInput(prompt?: Part[]): Promise<Part[]>;
}

export type AgentHandler = (
  goal: Part[],
  ctx: HandlerContext,
) => Promise<Part[] | Result | void>;

export interface AgentDefinition {
  descriptor: AgentDescriptor;
  handle: AgentHandler;
}

/** Validate-light a definition, default the protocol version, and return it. */
export function defineAgent(def: AgentDefinition): AgentDefinition {
  if (!def.descriptor?.id) throw new Error("defineAgent: descriptor.id is required");
  if (!Array.isArray(def.descriptor.capabilities) || def.descriptor.capabilities.length === 0) {
    throw new Error("defineAgent: at least one capability is required");
  }
  // Single source of truth: default to the SDK's protocol version, and reject a
  // descriptor that declares an incompatible one.
  if (def.descriptor.agentcomposeVersion === undefined) {
    def.descriptor.agentcomposeVersion = AGENTCOMPOSE_VERSION;
  } else {
    assertCompatibleVersion(def.descriptor.agentcomposeVersion);
  }
  return def;
}

interface TaskRun {
  task: Task;
  events: TaskEvent[];
  listeners: Set<(e: TaskEvent) => void>;
  controller: AbortController;
  done: boolean;
  pendingInput?: (input: Part[]) => void;
}

const SECRET_REF = "secretRef";

/** Replace { secretRef: "NAME" } leaves with process.env.NAME (deep). */
function resolveSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(resolveSecrets);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj[SECRET_REF] === "string") {
      return process.env[obj[SECRET_REF] as string] ?? null;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = resolveSecrets(v);
    return out;
  }
  return value;
}

/** Apply top-level `default`s declared in a configSchema. */
function applyDefaults(schema: Record<string, unknown> | undefined, config: AgentConfig): AgentConfig {
  const props = (schema?.properties ?? {}) as Record<string, { default?: unknown }>;
  const merged: AgentConfig = { ...config };
  for (const [key, prop] of Object.entries(props)) {
    if (merged[key] === undefined && prop && "default" in prop) merged[key] = prop.default;
  }
  return merged;
}

/**
 * The transport-neutral agent core. Drives the task lifecycle and configuration.
 * Wrapped by the in-process and stdio adapters.
 */
export class AgentRuntime {
  #def: AgentDefinition;
  #runs = new Map<string, TaskRun>();
  #idempotency = new Map<string, string>();
  #ajv = addFormats(new Ajv({ allErrors: true, strict: false }));
  #validateConfig?: ((data: unknown) => boolean) & { errors?: unknown };
  #effectiveConfig: AgentConfig = {};

  constructor(def: AgentDefinition) {
    this.#def = def;
    if (def.descriptor.configSchema) {
      this.#validateConfig = this.#ajv.compile(def.descriptor.configSchema);
    }
    // Seed defaults so the component runs with no configure() call.
    this.#effectiveConfig = applyDefaults(def.descriptor.configSchema, {});
  }

  describe(): AgentDescriptor {
    return this.#def.descriptor;
  }

  /** Supply configuration; validate; return effective config (secrets NOT resolved). */
  configure(config: AgentConfig): AgentConfig {
    const merged = applyDefaults(this.#def.descriptor.configSchema, config ?? {});
    if (this.#validateConfig && !this.#validateConfig(merged)) {
      throw new AgentError(
        ErrorCodes.InvalidConfiguration,
        "Configuration failed validation against configSchema.",
        this.#validateConfig.errors,
      );
    }
    this.#effectiveConfig = merged;
    return merged;
  }

  async submit(goal: Part[], opts?: { idempotencyKey?: string }): Promise<Task> {
    if (!Array.isArray(goal) || goal.length === 0) {
      throw new AgentError(ErrorCodes.InvalidGoal, "Goal must be a non-empty array of parts.");
    }
    if (opts?.idempotencyKey) {
      const existing = this.#idempotency.get(opts.idempotencyKey);
      if (existing && this.#runs.has(existing)) return this.#snapshot(existing);
    }
    const id = "task_" + randomUUID().slice(0, 8);
    const now = new Date().toISOString();
    const task: Task = { id, state: "submitted", createdAt: now, updatedAt: now, artifacts: [] };
    const run: TaskRun = {
      task,
      events: [],
      listeners: new Set(),
      controller: new AbortController(),
      done: false,
    };
    this.#runs.set(id, run);
    if (opts?.idempotencyKey) this.#idempotency.set(opts.idempotencyKey, id);
    queueMicrotask(() => void this.#run(run, goal));
    return { ...task };
  }

  get(id: string): Task {
    return this.#snapshot(id);
  }

  cancel(id: string): Task {
    const run = this.#require(id);
    if (!run.done) {
      run.controller.abort();
      if (run.task.state === "input-required" && run.pendingInput) {
        // Unblock the handler so it can observe the abort.
        run.pendingInput([]);
      }
      this.#transition(run, "canceled");
      this.#finish(run);
    }
    return this.#snapshot(id);
  }

  provideInput(id: string, input: Part[]): Task {
    const run = this.#require(id);
    if (run.task.state !== "input-required" || !run.pendingInput) {
      throw new AgentError(ErrorCodes.InvalidState, "Task is not awaiting input.");
    }
    if (!Array.isArray(input) || input.length === 0) {
      throw new AgentError(ErrorCodes.InvalidGoal, "Input must be a non-empty array of parts.");
    }
    const resolve = run.pendingInput;
    run.pendingInput = undefined;
    this.#transition(run, "working");
    resolve(input);
    return this.#snapshot(id);
  }

  /** Replay buffered events, then stream new ones until the task is terminal. */
  subscribe(id: string): AsyncIterable<TaskEvent> {
    const run = this.#require(id);
    const ch = new Channel<TaskEvent>();
    for (const e of run.events) ch.push(e); // backlog (sync, no awaits before listener attaches)
    if (run.done) {
      ch.close();
    } else {
      const listener = (e: TaskEvent) => {
        ch.push(e);
        if (e.type === "status" && isTerminal(e.state)) {
          run.listeners.delete(listener);
          ch.close();
        }
      };
      run.listeners.add(listener);
    }
    return ch;
  }

  // --- internals ---

  #require(id: string): TaskRun {
    const run = this.#runs.get(id);
    if (!run) throw new AgentError(ErrorCodes.TaskNotFound, `Unknown task: ${id}`);
    return run;
  }

  #snapshot(id: string): Task {
    return structuredClone(this.#require(id).task);
  }

  #emit(run: TaskRun, ev: TaskEvent): void {
    run.events.push(ev);
    for (const l of [...run.listeners]) l(ev);
  }

  #transition(run: TaskRun, state: Task["state"], message?: Part[]): void {
    run.task.state = state;
    run.task.updatedAt = new Date().toISOString();
    this.#emit(run, { type: "status", taskId: run.task.id, state, message });
  }

  #finish(run: TaskRun): void {
    run.done = true;
    for (const l of [...run.listeners]) {
      run.listeners.delete(l);
    }
  }

  async #run(run: TaskRun, goal: Part[]): Promise<void> {
    const ctx: HandlerContext = {
      taskId: run.task.id,
      signal: run.controller.signal,
      config: resolveSecrets(this.#effectiveConfig) as AgentConfig,
      status: (state, message) => this.#transition(run, state, message),
      message: (delta) => this.#emit(run, { type: "message", taskId: run.task.id, delta }),
      progress: (percent, message) =>
        this.#emit(run, { type: "progress", taskId: run.task.id, percent, message }),
      artifact: (parts, name) => {
        const artifact: Artifact = {
          id: "art_" + randomUUID().slice(0, 8),
          parts,
          name,
          createdAt: new Date().toISOString(),
        };
        run.task.artifacts.push(artifact);
        this.#emit(run, { type: "artifact", taskId: run.task.id, artifact });
      },
      requestInput: (prompt) =>
        new Promise<Part[]>((resolve) => {
          run.pendingInput = resolve;
          this.#transition(run, "input-required", prompt);
        }),
    };

    if (run.done) return; // canceled before start
    this.#transition(run, "working");

    try {
      const out = await this.#def.handle(goal, ctx);
      if (run.done) return; // canceled during work
      const result: Result = Array.isArray(out)
        ? { parts: out }
        : out && typeof out === "object" && "parts" in out
          ? (out as Result)
          : { parts: [] };
      run.task.result = result;
      this.#emit(run, { type: "result", taskId: run.task.id, result });
      this.#transition(run, "completed");
    } catch (err) {
      if (run.done) return;
      const error = toRpcError(err);
      run.task.error = error;
      this.#emit(run, { type: "error", taskId: run.task.id, error });
      this.#transition(run, "failed");
    } finally {
      this.#finish(run);
    }
  }
}
