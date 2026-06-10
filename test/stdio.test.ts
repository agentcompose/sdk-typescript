import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnStdio } from "../src/index.ts";
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
