import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { spawnStdio, defineAgent, serveStdio } from "../src/index.ts";
import type { TaskEvent } from "../src/index.ts";

const agentPath = new URL("../examples/research-agent.ts", import.meta.url).pathname;

test("stdio: describe → configure → submit → stream → completed", async () => {
  const client = spawnStdio("node", { args: [agentPath] });
  try {
    const desc = await client.describe();
    assert.equal(desc.id, "dev.agentcompose.examples.research");
    assert.ok(desc.configSchema, "descriptor advertises configSchema");

    const eff = await client.configure({ depth: "deep" });
    assert.equal(eff.depth, "deep");

    const task = await client.submit([{ kind: "text", text: "test topic" }]);
    assert.ok(task.id.startsWith("task_"));

    const events: TaskEvent[] = [];
    for await (const e of client.events(task.id)) events.push(e);

    const final = await client.get(task.id);
    assert.equal(final.state, "completed");

    const deltas = events
      .filter((e): e is Extract<TaskEvent, { type: "message" }> => e.type === "message")
      .map((e) => (e.delta.kind === "text" ? e.delta.text : ""))
      .join("");
    assert.match(deltas, /deep review/);
    assert.ok(events.some((e) => e.type === "result"));
  } finally {
    await client.close();
  }
});

test("stdio: invalid configuration returns -32007", async () => {
  const client = spawnStdio("node", { args: [agentPath] });
  try {
    await assert.rejects(
      () => client.configure({ depth: "nonsense" }),
      (err: any) => err.code === -32007,
    );
  } finally {
    await client.close();
  }
});

test("stdio boundary: malformed wire params are rejected with InvalidParams (-32602)", async () => {
  const def = defineAgent({
    descriptor: {
      agentcomposeVersion: "0.1.0",
      id: "dev.example.echo",
      name: "Echo",
      version: "1.0.0",
      capabilities: [{ id: "echo", description: "echo" }],
    },
    async handle() {
      return [{ kind: "text", text: "ok" } as const];
    },
  });
  const input = new PassThrough();
  const output = new PassThrough();
  serveStdio(def, { input, output });

  const responses: Array<{ id?: unknown; error?: { code: number } }> = [];
  output.on("data", (b: Buffer) => {
    for (const line of b.toString().split("\n").filter(Boolean)) responses.push(JSON.parse(line));
  });
  const send = (id: number, method: string, params: unknown) =>
    input.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");

  send(1, "tasks/submit", { goal: [] }); // empty goal violates minItems
  send(2, "tasks/submit", { goal: [{ kind: "text" }] }); // part missing text
  send(3, "agent/configure", {}); // config required
  send(4, "tasks/provideInput", { id: "t1" }); // input required
  await new Promise((r) => setTimeout(r, 80));

  for (const id of [1, 2, 3, 4]) {
    const resp = responses.find((m) => m.id === id);
    assert.ok(resp, `got a response for id ${id}`);
    assert.equal(resp.error?.code, -32602, `id ${id} should be InvalidParams`);
  }
});

test("stdio: idempotent re-submit does not duplicate forwarded events", async () => {
  const client = spawnStdio("node", { args: [agentPath] });
  try {
    const first = await client.submit([{ kind: "text", text: "topic" }], { idempotencyKey: "k1" });
    const again = await client.submit([{ kind: "text", text: "topic" }], { idempotencyKey: "k1" });
    assert.equal(again.id, first.id, "idempotent re-submit returns the same task");

    const events: TaskEvent[] = [];
    for await (const e of client.events(first.id)) events.push(e);

    const results = events.filter((e) => e.type === "result");
    assert.equal(results.length, 1, "result is forwarded exactly once, not duplicated");
  } finally {
    await client.close();
  }
});
