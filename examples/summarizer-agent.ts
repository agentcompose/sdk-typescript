// A deterministic summarizer agent — no model, no network. It exists to be
// composed: it turns prose into a short bulleted summary.
//   node examples/summarizer-agent.ts   (serve over stdio)
import { defineAgent, serveStdio } from "../src/index.ts";
import type { Part } from "../src/index.ts";

const textOf = (parts: Part[]) => parts.map((p) => (p.kind === "text" ? p.text : "")).join(" ").trim();

export const summarizerAgent = defineAgent({
  descriptor: {
    id: "dev.agentcompose.examples.summarizer",
    name: "Summarizer",
    version: "1.0.0",
    description: "Condenses text into a few bullet points.",
    capabilities: [
      { id: "summarize", description: "Summarize text into bullets.", inputModes: ["text/plain"], outputModes: ["text/markdown"] },
    ],
    configSchema: {
      type: "object",
      additionalProperties: false,
      properties: { maxBullets: { type: "integer", minimum: 1, maximum: 10, default: 3 } },
    },
  },
  async handle(goal, ctx) {
    const text = textOf(goal);
    const maxBullets = (ctx.config.maxBullets as number) ?? 3;

    ctx.progress(20, "splitting");
    const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    const bullets = (sentences.length ? sentences : [text]).slice(0, maxBullets).map((s) => `• ${s}`);

    let out = "Summary:\n";
    for (const b of bullets) {
      out += b + "\n";
      ctx.message({ kind: "text", text: b + "\n" });
    }
    ctx.progress(100, "done");
    return [{ kind: "text", text: out.trimEnd() }];
  },
});

if (import.meta.url === `file://${process.argv[1]}`) {
  serveStdio(summarizerAgent);
  process.stderr.write("summarizer-agent: serving over stdio\n");
}
