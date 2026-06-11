import { test } from "node:test";
import assert from "node:assert/strict";
import { defineAgent, inProcess } from "../src/index.ts";
import type { Span, SpanStart, TaskEvent } from "../src/index.ts";

const drain = async (events: AsyncIterable<TaskEvent>): Promise<TaskEvent[]> => {
  const out: TaskEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
};

/** Reconstruct materialized spans from a stream's span-start/span-end events. */
function spansOf(events: TaskEvent[]): Span[] {
  const byId = new Map<string, Span>();
  for (const e of events) {
    if (e.type === "span-start") {
      byId.set(e.span.spanId, { ...e.span, status: "unset" });
    } else if (e.type === "span-end") {
      const s = byId.get(e.spanId);
      if (s) {
        s.endTime = e.endTime;
        s.status = e.status;
        if (e.attributes) s.attributes = { ...s.attributes, ...e.attributes };
        if (e.events) s.events = e.events;
      }
    }
  }
  return [...byId.values()];
}

test("tracing: an un-instrumented agent still emits a single root agent span", async () => {
  const bare = defineAgent({
    descriptor: { id: "t.bare", name: "Bare", version: "2.1.0", capabilities: [{ id: "x", description: "x" }] },
    async handle() {
      return [{ kind: "text", text: "done" }];
    },
  });
  const client = inProcess(bare);
  const task = await client.submit([{ kind: "text", text: "hi" }]);
  const spans = spansOf(await drain(client.events(task.id)));

  assert.equal(spans.length, 1, "exactly one (root) span");
  const root = spans[0];
  assert.equal(root.kind, "agent");
  assert.equal(root.name, "Bare");
  assert.equal(root.parentSpanId, undefined, "root has no parent");
  assert.equal(root.status, "ok");
  assert.equal(root.attributes?.["agent.id"], "t.bare");
  assert.equal(root.attributes?.["agent.version"], "2.1.0");
  assert.ok(root.endTime && root.endTime >= root.startTime);
});

test("tracing: nested ctx.trace.span auto-parents and carries attributes + events", async () => {
  const worker = defineAgent({
    descriptor: { id: "t.work", name: "Work", version: "1.0.0", capabilities: [{ id: "x", description: "x" }] },
    async handle(_goal, ctx) {
      await ctx.trace.span({ name: "outer", kind: "step" }, async (outer) => {
        outer.attr("outer.flag", true);
        await ctx.trace.span({ name: "inner", kind: "llm", attributes: { model: "m" } }, async (inner) => {
          inner.event("token", { n: 1 });
          inner.attr("tokens.out", 7);
        });
      });
      return [{ kind: "text", text: "ok" }];
    },
  });
  const client = inProcess(worker);
  const task = await client.submit([{ kind: "text", text: "go" }]);
  const spans = spansOf(await drain(client.events(task.id)));

  const root = spans.find((s) => s.kind === "agent")!;
  const outer = spans.find((s) => s.name === "outer")!;
  const inner = spans.find((s) => s.name === "inner")!;

  assert.equal(spans.length, 3);
  assert.equal(outer.parentSpanId, root.spanId, "outer nests under root");
  assert.equal(inner.parentSpanId, outer.spanId, "inner nests under outer (implicit)");
  assert.equal(outer.attributes?.["outer.flag"], true);
  assert.equal(inner.attributes?.model, "m");
  assert.equal(inner.attributes?.["tokens.out"], 7);
  assert.equal(inner.events?.[0]?.name, "token");
  // One shared trace id across the whole tree.
  assert.equal(new Set(spans.map((s) => s.traceId)).size, 1);
});

test("tracing: a throwing span closes with status error and the root reflects failure", async () => {
  const boom = defineAgent({
    descriptor: { id: "t.boom", name: "Boom", version: "1.0.0", capabilities: [{ id: "x", description: "x" }] },
    async handle(_goal, ctx) {
      await ctx.trace.span({ name: "risky", kind: "tool" }, async () => {
        throw new Error("kaboom");
      });
      return [];
    },
  });
  const client = inProcess(boom);
  const task = await client.submit([{ kind: "text", text: "go" }]);
  const spans = spansOf(await drain(client.events(task.id)));

  const risky = spans.find((s) => s.name === "risky")!;
  const root = spans.find((s) => s.kind === "agent")!;
  assert.equal(risky.status, "error");
  assert.equal(root.status, "error", "an unhandled throw fails the root span too");
});

test("tracing: forwardSpan re-stamps an inner trace under the current span", async () => {
  // Simulate a composition boundary: an inner trace (its own ids, parentless root)
  // forwarded through a worker should adopt this trace and nest under the active span.
  const innerTraceId = "trace_inner";
  const innerRootId = "span_innerRoot";
  const innerChildId = "span_innerChild";

  const bridge = defineAgent({
    descriptor: { id: "t.bridge", name: "Bridge", version: "1.0.0", capabilities: [{ id: "x", description: "x" }] },
    async handle(_goal, ctx) {
      await ctx.trace.span({ name: "boundary", kind: "step" }, async () => {
        const innerRoot: SpanStart = { traceId: innerTraceId, spanId: innerRootId, name: "inner-agent", kind: "agent", startTime: Date.now() };
        const innerChild: SpanStart = { traceId: innerTraceId, spanId: innerChildId, parentSpanId: innerRootId, name: "inner-step", kind: "step", startTime: Date.now() };
        ctx.trace.forwardSpan({ type: "span-start", taskId: ctx.taskId, span: innerRoot });
        ctx.trace.forwardSpan({ type: "span-start", taskId: ctx.taskId, span: innerChild });
        ctx.trace.forwardSpan({ type: "span-end", taskId: ctx.taskId, traceId: innerTraceId, spanId: innerChildId, endTime: Date.now(), status: "ok" });
        ctx.trace.forwardSpan({ type: "span-end", taskId: ctx.taskId, traceId: innerTraceId, spanId: innerRootId, endTime: Date.now(), status: "ok" });
      });
      return [{ kind: "text", text: "ok" }];
    },
  });
  const client = inProcess(bridge);
  const task = await client.submit([{ kind: "text", text: "go" }]);
  const spans = spansOf(await drain(client.events(task.id)));

  const boundary = spans.find((s) => s.name === "boundary")!;
  const innerRoot = spans.find((s) => s.spanId === innerRootId)!;
  const innerChild = spans.find((s) => s.spanId === innerChildId)!;

  assert.equal(innerRoot.parentSpanId, boundary.spanId, "inner root re-parented under the boundary span");
  assert.equal(innerChild.parentSpanId, innerRootId, "inner non-root keeps its own parentage");
  // The whole forwarded subtree adopts this trace's id.
  assert.equal(innerRoot.traceId, boundary.traceId);
  assert.equal(innerChild.traceId, boundary.traceId);
});
