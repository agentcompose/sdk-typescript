// Spawns the research agent as a subprocess, configures it, submits a goal,
// and streams the result back. The "delegate to a subprocess" model, for real.
//   node examples/orchestrator.ts "your topic here"
import { spawnStdio } from "../src/index.ts";
import type { Part } from "../src/index.ts";

const agentPath = new URL("./research-agent.ts", import.meta.url).pathname;
const topic = process.argv.slice(2).join(" ") || "AI agent interoperability standards";

const client = spawnStdio("node", { args: [agentPath] });

const desc = await client.describe();
console.error(`▶ connected: ${desc.name} (${desc.id})`);

const effective = await client.configure({ depth: "deep" });
console.error(`▶ configured: ${JSON.stringify(effective)}`);

const task = await client.submit([{ kind: "text", text: topic }]);
console.error(`▶ task ${task.id} submitted\n`);

for await (const ev of client.events(task.id)) {
  if (ev.type === "message" && ev.delta.kind === "text") process.stdout.write(ev.delta.text);
  else if (ev.type === "progress") console.error(`  [progress] ${ev.percent ?? ""}% ${ev.message ?? ""}`);
  else if (ev.type === "status") console.error(`  [status] ${ev.state}`);
}

const final = await client.get(task.id);
console.error(`\n▶ final state: ${final.state}`);
await client.close();
