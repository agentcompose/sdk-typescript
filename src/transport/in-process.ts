import { AgentRuntime } from "../agent.ts";
import type { AgentDefinition } from "../agent.ts";
import type { AgentClient } from "../client.ts";
import type { AgentConfig, Part } from "../types.ts";

/**
 * In-process adapter: drive an agent as a library, with zero serialization.
 * The agent's mental model — add it as a dependency and delegate to it directly.
 */
export function inProcess(def: AgentDefinition): AgentClient {
  const runtime = new AgentRuntime(def);
  return {
    describe: async () => runtime.describe(),
    configure: async (config: AgentConfig) => runtime.configure(config),
    submit: (goal: Part[], opts) => runtime.submit(goal, opts),
    get: async (id: string) => runtime.get(id),
    cancel: async (id: string) => runtime.cancel(id),
    provideInput: async (id: string, input: Part[]) => runtime.provideInput(id, input),
    events: (id: string) => runtime.subscribe(id),
    close: async () => {},
  } satisfies AgentClient;
}
