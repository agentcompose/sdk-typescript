// A configurable reference agent. Run it directly to serve over stdio:
//   node examples/research-agent.ts
// It is a reusable component: run on defaults, or configure `depth` / `systemPrompt`.
import { defineAgent, serveStdio } from "../src/index.ts";
import type { Part } from "../src/index.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const researchAgent = defineAgent({
  descriptor: {
    agentcomposeVersion: "0.1.0",
    id: "dev.agentcompose.examples.research",
    name: "Research Agent",
    version: "1.0.0",
    description: "Researches a topic and returns a short summary.",
    capabilities: [
      { id: "research", description: "Summarize a topic.", inputModes: ["text/plain"], outputModes: ["text/markdown"] },
    ],
    configSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        depth: { type: "string", enum: ["shallow", "deep"], default: "shallow" },
        systemPrompt: { type: "string" },
      },
    },
  },
  async handle(goal, ctx) {
    const topic = goal.map((p: Part) => (p.kind === "text" ? p.text : "")).join(" ").trim();
    const depth = (ctx.config.depth as string) ?? "shallow";

    ctx.progress(10, `researching (${depth})`);
    const chunks =
      depth === "deep"
        ? ["A deep review of ", `"${topic}"`, ": the leading agent-interop standards are ", "MCP, A2A, and AgentCompose, each at a different layer."]
        : ["A quick take on ", `"${topic}"`, ": MCP, A2A, and AgentCompose."];

    let text = "";
    for (const chunk of chunks) {
      await sleep(20);
      text += chunk;
      ctx.message({ kind: "text", text: chunk });
    }
    ctx.progress(100, "done");
    return [{ kind: "text", text }];
  },
});

// Serve over stdio when run as a process (not when imported by a test).
if (import.meta.url === `file://${process.argv[1]}`) {
  serveStdio(researchAgent);
  process.stderr.write("research-agent: serving over stdio\n");
}
