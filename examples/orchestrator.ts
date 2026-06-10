// A full orchestrator that drives the research agent over stdio and reacts to
// EVERY event type, including the input-required clarification loop.
//   node examples/orchestrator.ts "your topic"        (clear topic → straight through)
//   node examples/orchestrator.ts "?"                  (vague → agent asks, we answer)
import { spawnStdio } from "../src/index.ts";
import type { AgentClient, Part, TaskEvent } from "../src/index.ts";

const agentPath = new URL("./research-agent.ts", import.meta.url).pathname;
const topic = process.argv.slice(2).join(" ") || "AI agent interoperability standards";

const log = (s: string) => process.stderr.write(s + "\n");
const partText = (p: Part) => (p.kind === "text" ? p.text : JSON.stringify(p));

/** Drive a task to completion, reacting to each event type. */
async function drive(client: AgentClient, taskId: string): Promise<void> {
  for await (const ev of streamEvents(client, taskId)) {
    switch (ev.type) {
      case "status":
        log(`  • status  → ${ev.state}`);
        if (ev.state === "input-required") {
          const prompt = ev.message?.map(partText).join(" ") ?? "(input needed)";
          log(`    ↳ agent asks: ${prompt}`);
          await client.provideInput(taskId, [{ kind: "text", text: "AI agent interoperability standards" }]);
          log(`    ↳ we answered: "AI agent interoperability standards"`);
        }
        break;
      case "progress":
        log(`  • progress→ ${ev.percent ?? "?"}% ${ev.message ?? ""}`);
        break;
      case "message":
        process.stdout.write(ev.delta.kind === "text" ? ev.delta.text : "");
        break;
      case "artifact":
        log(`\n  • artifact→ ${ev.artifact.name} ${JSON.stringify(ev.artifact.parts[0])}`);
        break;
      case "result":
        log(`  • result  → ${ev.result.parts.map(partText).join("").length} chars`);
        break;
      case "error":
        log(`  • error   → [${ev.error.code}] ${ev.error.message}`);
        break;
    }
  }
}

// Wrap events() so the switch above is the only place that knows the protocol.
function streamEvents(client: AgentClient, taskId: string): AsyncIterable<TaskEvent> {
  return client.events(taskId);
}

const client = spawnStdio("node", { args: [agentPath] });

const desc = await client.describe();
log(`▶ ${desc.name} (${desc.id})`);
log(`  capabilities: ${desc.capabilities.map((c) => c.id).join(", ")}`);
log(`  config knobs: ${Object.keys((desc.configSchema as any)?.properties ?? {}).join(", ")}\n`);

const eff = await client.configure({ depth: "deep", audience: "engineers" });
log(`▶ configured: ${JSON.stringify(eff)}\n`);

const task = await client.submit([{ kind: "text", text: topic }]);
log(`▶ task ${task.id} submitted (goal: "${topic}")`);
await drive(client, task.id);

const final = await client.get(task.id);
log(`\n▶ final: ${final.state} · ${final.artifacts.length} artifact(s)`);
await client.close();
