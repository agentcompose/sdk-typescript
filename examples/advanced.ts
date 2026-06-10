// Demonstrates the operational surface beyond the happy path:
//   1. structured configuration errors (sync)
//   2. task-level errors (async, via the error event + failed state)
//   3. cancellation mid-flight
//   4. idempotent submit (retries dedupe)
//   node examples/advanced.ts
import { spawnStdio, ErrorCodes } from "../src/index.ts";
import type { AgentClient } from "../src/index.ts";

const agentPath = new URL("./research-agent.ts", import.meta.url).pathname;
const log = (s: string) => console.error(s);
const drain = async (client: AgentClient, id: string) => {
  for await (const _ of client.events(id)) { /* consume to completion */ }
  return client.get(id);
};

const client = spawnStdio("node", { args: [agentPath] });

// 1. Invalid configuration → rejected synchronously with a reserved code.
log("1. Invalid configuration");
try {
  await client.configure({ depth: "ultra" });
} catch (e: any) {
  log(`   rejected: [${e.code}] ${e.message}  (InvalidConfiguration=${ErrorCodes.InvalidConfiguration})\n`);
}

// 2. Task-level error → surfaces as an `error` event and a `failed` task.
log("2. Task error ('boom')");
await client.configure({});
const bad = await client.submit([{ kind: "text", text: "boom" }]);
const badFinal = await drain(client, bad.id);
log(`   final state: ${badFinal.state}, error: [${badFinal.error?.code}] ${badFinal.error?.message}\n`);

// 3. Cancellation mid-flight.
log("3. Cancellation");
await client.configure({ depth: "deep", delayMs: 150 });
const slow = await client.submit([{ kind: "text", text: "a slow topic" }]);
setTimeout(() => void client.cancel(slow.id), 200); // cancel shortly after it starts
const slowFinal = await drain(client, slow.id);
log(`   final state: ${slowFinal.state}\n`);

// 4. Idempotent submit — same key returns the same task, no double work.
log("4. Idempotency");
await client.configure({});
const key = "demo-key-123";
const first = await client.submit([{ kind: "text", text: "idempotent topic" }], { idempotencyKey: key });
const second = await client.submit([{ kind: "text", text: "idempotent topic" }], { idempotencyKey: key });
log(`   same task id returned twice: ${first.id === second.id} (${first.id})`);
await drain(client, first.id);

await client.close();
log("\nDone.");
