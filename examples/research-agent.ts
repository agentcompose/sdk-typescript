// A configurable reference agent that exercises the full SDK surface.
// Run it directly to serve over stdio:  node examples/research-agent.ts
//
// As a component it is reusable: run on defaults, or configure depth / audience /
// pacing. It demonstrates progress, streaming, artifacts, input-required, and
// structured errors.
import { defineAgent, serveStdio, AgentError, ErrorCodes, AGENTCOMPOSE_VERSION } from "../src/index.ts";
import type { Part } from "../src/index.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const textOf = (parts: Part[]) => parts.map((p) => (p.kind === "text" ? p.text : "")).join(" ").trim();

export const researchAgent = defineAgent({
  descriptor: {
    agentcomposeVersion: AGENTCOMPOSE_VERSION,
    id: "dev.agentcompose.examples.research",
    name: "Research Agent",
    version: "1.0.0",
    description: "Researches a topic and returns a short summary with an outline artifact.",
    capabilities: [
      {
        id: "research",
        description: "Summarize a topic.",
        inputModes: ["text/plain"],
        outputModes: ["text/markdown"],
      },
    ],
    // Public, typed configuration surface. Run on defaults or override any knob.
    configSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        depth: { type: "string", enum: ["shallow", "deep"], default: "shallow" },
        audience: { type: "string", description: "Who the summary is written for." },
        delayMs: { type: "integer", minimum: 0, maximum: 5000, default: 20 },
      },
    },
  },

  async handle(goal, ctx) {
    const depth = (ctx.config.depth as string) ?? "shallow";
    const audience = ctx.config.audience as string | undefined;
    const delay = (ctx.config.delayMs as number) ?? 20;

    // 1. Validate input — if the topic is too vague, pause and ask the caller.
    let topic = textOf(goal);
    if (topic.replace(/[?\s]/g, "").length < 3) {
      const reply = await ctx.requestInput([
        { kind: "text", text: "That topic is too vague. What exactly should I research?" },
      ]);
      topic = textOf(reply);
    }
    if (ctx.signal.aborted) return; // canceled while waiting

    // 2. Demonstrate a structured, coded error for a known bad input.
    if (topic.toLowerCase() === "boom") {
      throw new AgentError(ErrorCodes.InvalidGoal, "Refusing to research 'boom'.", { topic });
    }

    // 3. Plan → work, reporting progress as we go.
    ctx.progress(10, `planning (${depth})`);
    await sleep(delay);

    const points =
      depth === "deep"
        ? [
            `A deep review of "${topic}": `,
            "the leading agent-interop standards are ",
            "MCP (tool access), A2A (agent-to-agent), and AgentCompose (composable components), ",
            "each operating at a different layer.",
          ]
        : [`A quick take on "${topic}": `, "MCP, A2A, and AgentCompose."];

    // 4. Stream the summary token-by-token.
    let summary = "";
    for (let i = 0; i < points.length; i++) {
      if (ctx.signal.aborted) return;
      await sleep(delay);
      summary += points[i];
      ctx.message({ kind: "text", text: points[i] });
      ctx.progress(10 + Math.round((80 * (i + 1)) / points.length), "writing");
    }

    if (audience) {
      const note = `\n\n_(written for: ${audience})_`;
      summary += note;
      ctx.message({ kind: "text", text: note });
    }

    // 5. Produce a structured artifact alongside the prose result.
    ctx.artifact(
      [{ kind: "json", json: { topic, depth, audience, sections: points.length }, mediaType: "application/json" }],
      "outline.json",
    );

    ctx.progress(100, "done");

    // 6. Return the final result.
    return [{ kind: "text", text: summary }];
  },
});

// Serve over stdio when run as a process (not when imported by a test).
if (import.meta.url === `file://${process.argv[1]}`) {
  serveStdio(researchAgent);
  process.stderr.write("research-agent: serving over stdio\n");
}
