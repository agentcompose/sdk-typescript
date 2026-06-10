// A MASTER agent that coordinates a team — and is itself an AgentCompose agent.
// Its handle() delegates to a researcher, then a summarizer, forwarding their
// progress upward and returning the composed result.
//
// Recursive composition: the master plugs into any orchestrator exactly like a
// leaf agent (same tasks/submit face). Members here are in-process for a
// deterministic demo, but Coordinator works identically with spawnStdio members.
//
//   node examples/team-agent.ts   (serve the team over stdio)
import { defineAgent, inProcess, serveStdio, Coordinator } from "../src/index.ts";
import { researchAgent } from "./research-agent.ts";
import { summarizerAgent } from "./summarizer-agent.ts";

// Build the team once (per process), reused across tasks.
const team = new Coordinator([
  { name: "researcher", client: inProcess(researchAgent), config: { depth: "deep" } },
  { name: "summarizer", client: inProcess(summarizerAgent), config: { maxBullets: 3 } },
]);

export const teamAgent = defineAgent({
  descriptor: {
    id: "dev.agentcompose.examples.research-team",
    name: "Research Team",
    version: "1.0.0",
    description: "Researches a topic, then summarizes the findings.",
    capabilities: [
      { id: "research-and-summarize", description: "Research a topic and return a bulleted summary.", inputModes: ["text/plain"], outputModes: ["text/markdown"] },
    ],
  },
  async handle(goal, ctx) {
    // 1. Delegate to the researcher, forwarding its progress up to our caller.
    ctx.progress(5, "delegating to researcher");
    const research = await team.call("researcher", goal, { sink: ctx, signal: ctx.signal });
    if (ctx.signal.aborted) return;

    // 2. Feed the research into the summarizer (output → input wiring).
    ctx.progress(60, "delegating to summarizer");
    const summary = await team.call("summarizer", research.parts, {
      sink: ctx,
      signal: ctx.signal,
      forwardMessages: true, // stream the final summary through as our output
    });

    // 3. Leave a trace artifact of who did what.
    ctx.artifact(
      [{ kind: "data", data: { team: ["researcher", "summarizer"] }, mimeType: "application/json" }],
      "trace.json",
    );
    return summary.parts;
  },
});

if (import.meta.url === `file://${process.argv[1]}`) {
  serveStdio(teamAgent);
  process.stderr.write("team-agent: serving over stdio\n");
}
