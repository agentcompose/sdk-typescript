import type { AgentConfig, AgentDescriptor, Part, Task, TaskEvent } from "./types.ts";

/** Uniform client interface — identical across in-process and stdio transports. */
export interface AgentClient {
  describe(): Promise<AgentDescriptor>;
  configure(config: AgentConfig): Promise<AgentConfig>;
  submit(goal: Part[], opts?: { idempotencyKey?: string }): Promise<Task>;
  get(id: string): Promise<Task>;
  cancel(id: string): Promise<Task>;
  provideInput(id: string, input: Part[]): Promise<Task>;
  events(id: string): AsyncIterable<TaskEvent>;
  close(): Promise<void>;
}
