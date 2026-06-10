// Drift guard: the SDK's hand-written types in src/types.ts are a typed projection
// of the canonical @agentcompose/spec schemas. This test validates representative
// values of those types against the canonical schemas (and asserts malformed values
// are rejected), so the types cannot silently diverge from the contract. It also
// covers the wire-validation helper used at transport boundaries.
import { test } from "node:test";
import assert from "node:assert/strict";
import AjvDefault from "ajv/dist/2020.js";
import addFormatsDefault from "ajv-formats";
import { registerSchemas, SCHEMA_BASE } from "@agentcompose/spec";
import { validateWireParams } from "../src/wire.ts";
import type { Part, Task, Artifact, AgentDescriptor } from "../src/types.ts";

const Ajv = ((AjvDefault as any).default ?? AjvDefault) as any;
const addFormats = ((addFormatsDefault as any).default ?? addFormatsDefault) as any;
const ajv = addFormats(new Ajv({ allErrors: true, strict: false }));
registerSchemas(ajv);

const validator = (name: string) => {
  const v = ajv.getSchema(`${SCHEMA_BASE}${name}.json`);
  assert.ok(v, `schema ${name} should be registered`);
  return v as ((d: unknown) => boolean) & { errors?: unknown };
};
const partV = ajv.getSchema(`${SCHEMA_BASE}common.json#/$defs/Part`) as ((d: unknown) => boolean) & {
  errors?: unknown;
};

test("Part: each typed variant validates against common.json#/$defs/Part", () => {
  assert.ok(partV, "Part schema should resolve");
  const parts: Part[] = [
    { kind: "text", text: "hello" },
    { kind: "json", json: { a: 1 }, mediaType: "application/json" },
    { kind: "file", mediaType: "text/plain", name: "n.txt", uri: "https://x/y" },
  ];
  for (const p of parts) assert.ok(partV(p), `part ${p.kind} should validate: ${JSON.stringify(partV.errors)}`);
});

test("Part: a malformed value is rejected", () => {
  assert.equal(partV({ kind: "text" }), false); // missing text
  assert.equal(partV({ kind: "image", url: "x" }), false); // unknown kind
});

test("AgentDescriptor: a typed descriptor validates", () => {
  const d: AgentDescriptor = {
    agentcomposeVersion: "0.1.0",
    id: "dev.example.research",
    name: "Research Agent",
    version: "1.0.0",
    capabilities: [{ id: "research", description: "Summarize a topic." }],
  };
  const v = validator("agent-descriptor");
  assert.ok(v(d), `descriptor should validate: ${JSON.stringify(v.errors)}`);
});

test("Task + Artifact: a typed task validates against task.json", () => {
  const artifact: Artifact = {
    id: "a1",
    parts: [{ kind: "text", text: "out" }],
    name: "result.txt",
    createdAt: "2026-06-10T16:00:00.000Z",
  };
  const task: Task = {
    id: "t1",
    state: "completed",
    createdAt: "2026-06-10T16:00:00.000Z",
    updatedAt: "2026-06-10T16:00:01.000Z",
    artifacts: [artifact],
    result: { parts: [{ kind: "text", text: "done" }] },
  };
  const v = validator("task");
  assert.ok(v(task), `task should validate: ${JSON.stringify(v.errors)}`);
});

test("wire params: valid submit / configure / provideInput pass", () => {
  assert.equal(validateWireParams("task-submit", { goal: [{ kind: "text", text: "go" }] }), null);
  assert.equal(validateWireParams("agent-configure", { config: { depth: "deep" } }), null);
  assert.equal(
    validateWireParams("task-provide-input", { id: "t1", input: [{ kind: "text", text: "more" }] }),
    null,
  );
});

test("wire params: malformed are rejected with errors", () => {
  const empty = validateWireParams("task-submit", { goal: [] }); // minItems 1
  assert.ok(empty && Array.isArray(empty.errors));
  const badPart = validateWireParams("task-submit", { goal: [{ kind: "text" }] }); // missing text
  assert.ok(badPart, "submit with a malformed part should fail");
  const noConfig = validateWireParams("agent-configure", {}); // config required
  assert.ok(noConfig, "configure without config should fail");
  const noInput = validateWireParams("task-provide-input", { id: "t1" }); // input required
  assert.ok(noInput, "provideInput without input should fail");
});
