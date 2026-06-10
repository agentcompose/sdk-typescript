import { test } from "node:test";
import assert from "node:assert/strict";
import { defineAgent, inProcess, ErrorCodes } from "../src/index.ts";
import type { TaskEvent } from "../src/index.ts";

const echo = defineAgent({
  descriptor: {
    agentcomposeVersion: "0.1.0",
    id: "test.echo",
    name: "Echo",
    version: "1.0.0",
    capabilities: [{ id: "echo", description: "Echo the goal." }],
    configSchema: {
      type: "object",
      additionalProperties: false,
      properties: { prefix: { type: "string", default: "echo: " } },
    },
  },
  async handle(goal, ctx) {
    const text = goal.map((p) => (p.kind === "text" ? p.text : "")).join("");
    return [{ kind: "text", text: (ctx.config.prefix as string) + text }];
  },
});

const drain = async (events: AsyncIterable<TaskEvent>): Promise<TaskEvent[]> => {
  const out: TaskEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
};

test("submit → completed with result, default config applied", async () => {
  const client = inProcess(echo);
  const task = await client.submit([{ kind: "text", text: "hi" }]);
  const events = await drain(client.events(task.id));
  const final = await client.get(task.id);

  assert.equal(final.state, "completed");
  assert.equal(final.result?.parts[0] && "text" in final.result.parts[0] ? final.result.parts[0].text : "", "echo: hi");
  assert.ok(events.some((e) => e.type === "result"));
  assert.equal(events.at(-1)?.type, "status");
});

test("configure overrides default", async () => {
  const client = inProcess(echo);
  const eff = await client.configure({ prefix: ">> " });
  assert.equal(eff.prefix, ">> ");
  const task = await client.submit([{ kind: "text", text: "yo" }]);
  await drain(client.events(task.id));
  const final = await client.get(task.id);
  const p = final.result?.parts[0];
  assert.equal(p && "text" in p ? p.text : "", ">> yo");
});

test("invalid configuration is rejected with -32007", async () => {
  const client = inProcess(echo);
  await assert.rejects(
    () => client.configure({ unknown: true }),
    (err: any) => err.code === ErrorCodes.InvalidConfiguration,
  );
});

test("empty goal is rejected with InvalidGoal", async () => {
  const client = inProcess(echo);
  await assert.rejects(
    () => client.submit([]),
    (err: any) => err.code === ErrorCodes.InvalidGoal,
  );
});

test("input-required → provideInput resumes and completes", async () => {
  const asker = defineAgent({
    descriptor: {
      agentcomposeVersion: "0.1.0",
      id: "test.asker",
      name: "Asker",
      version: "1.0.0",
      capabilities: [{ id: "ask", description: "Ask then answer." }],
    },
    async handle(_goal, ctx) {
      const input = await ctx.requestInput([{ kind: "text", text: "What is your name?" }]);
      const name = input.map((p) => (p.kind === "text" ? p.text : "")).join("");
      return [{ kind: "text", text: `Hello, ${name}` }];
    },
  });
  const client = inProcess(asker);
  const task = await client.submit([{ kind: "text", text: "go" }]);

  // Consume events in the background; provide input when asked.
  const seen: TaskEvent[] = [];
  const pump = (async () => {
    for await (const e of client.events(task.id)) {
      seen.push(e);
      if (e.type === "status" && e.state === "input-required") {
        await client.provideInput(task.id, [{ kind: "text", text: "Ada" }]);
      }
    }
  })();
  await pump;

  const final = await client.get(task.id);
  assert.equal(final.state, "completed");
  const p = final.result?.parts[0];
  assert.equal(p && "text" in p ? p.text : "", "Hello, Ada");
  assert.ok(seen.some((e) => e.type === "status" && e.state === "input-required"));
});
