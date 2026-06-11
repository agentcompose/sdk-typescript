// The tracer: the engine-room behind ctx.trace. It turns ergonomic span calls into the
// immutable span-start/span-end events that travel the task stream, and it threads
// parentage automatically through AsyncLocalStorage so a handler never hand-wires the
// tree. Parenting is implicit by design — `ctx.trace.span(...)` nested inside another
// `span(...)` is a child, exactly as the call stack reads. This module is transport- and
// runtime-neutral: it only needs a sink for emitting events and a clock.
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { AttrMap, AttrValue, RpcError, SpanEvent, SpanStart, SpanStatus, TaskEvent } from "./types.ts";

/** A live span. Attributes and events set after open are flushed on end(), where the
 *  consumer overlays them onto what span-start delivered. end() is idempotent. */
export interface SpanHandle {
  readonly traceId: string;
  readonly spanId: string;
  attr(key: string, value: AttrValue): this;
  attrs(values: AttrMap): this;
  event(name: string, attributes?: AttrMap): this;
  end(opts?: { status?: SpanStatus; error?: RpcError }): void;
}

export interface SpanOptions {
  name: string;
  kind?: string;
  attributes?: AttrMap;
  /** Override the inferred parent. Absent ⇒ parent is the enclosing span (or none). */
  parentSpanId?: string;
}

/** The trace surface exposed on the handler context. */
export interface TraceApi {
  readonly traceId: string;
  /** The id of the currently-active span — what a forwarder re-parents under. */
  currentSpanId(): string | undefined;
  /** Open a span; the caller is responsible for end(). Auto-parents to the enclosing span. */
  startSpan(opts: SpanOptions): SpanHandle;
  /** Scoped span: opens, runs fn with the span active (so nested spans auto-parent),
   *  and closes — ok on return, error (with the thrown error captured) on throw. */
  span<T>(opts: SpanOptions, fn: (span: SpanHandle) => Promise<T>): Promise<T>;
  /** Forward a child/inner span event onto this trace, re-stamping it under the current
   *  trace and (for an inner root) the current span. This is how a composition boundary
   *  propagates a sub-trace losslessly instead of flattening it. */
  forwardSpan(ev: Extract<TaskEvent, { type: "span-start" | "span-end" }>): void;
}

type Emit = (ev: TaskEvent) => void;

const now = (): number => Date.now();

/**
 * Build a tracer bound to one task. `taskId` tags emitted events; `traceId` identifies
 * the whole trace (distinct from taskId so a composed run keeps one trace id across many
 * tasks). The returned `rootSpan` is the agent's top-level span — every other span nests
 * under it unless explicitly re-parented.
 */
export function createTracer(opts: {
  taskId: string;
  traceId: string;
  emit: Emit;
  root: SpanOptions;
}): { trace: TraceApi; rootSpan: SpanHandle; runWithRoot<T>(fn: () => Promise<T>): Promise<T> } {
  const { taskId, traceId, emit } = opts;
  // Tracks the active span for implicit parenting across awaits within one agent.
  const als = new AsyncLocalStorage<SpanHandle>();

  function makeSpan(spec: SpanOptions, parentSpanId: string | undefined): SpanHandle {
    const spanId = "span_" + randomUUID().slice(0, 12);
    const startTime = now();
    const attributes: AttrMap = { ...(spec.attributes ?? {}) };
    const events: SpanEvent[] = [];
    let ended = false;

    const start: SpanStart = {
      traceId,
      spanId,
      ...(parentSpanId ? { parentSpanId } : {}),
      name: spec.name,
      ...(spec.kind ? { kind: spec.kind } : {}),
      startTime,
      ...(Object.keys(attributes).length ? { attributes: { ...attributes } } : {}),
    };
    emit({ type: "span-start", taskId, span: start });

    const handle: SpanHandle = {
      traceId,
      spanId,
      attr(key, value) {
        attributes[key] = value;
        return handle;
      },
      attrs(values) {
        Object.assign(attributes, values);
        return handle;
      },
      event(name, attrs) {
        events.push({ time: now(), name, ...(attrs ? { attributes: attrs } : {}) });
        return handle;
      },
      end(endOpts) {
        if (ended) return; // idempotent: a scoped span + a manual end must not double-close
        ended = true;
        emit({
          type: "span-end",
          taskId,
          traceId,
          spanId,
          endTime: now(),
          status: endOpts?.status ?? (endOpts?.error ? "error" : "ok"),
          ...(Object.keys(attributes).length ? { attributes: { ...attributes } } : {}),
          ...(events.length ? { events: events.slice() } : {}),
          ...(endOpts?.error ? { error: endOpts.error } : {}),
        });
      },
    };
    return handle;
  }

  const rootSpan = makeSpan(opts.root, undefined);

  const trace: TraceApi = {
    traceId,
    currentSpanId() {
      return (als.getStore() ?? rootSpan).spanId;
    },
    startSpan(spec) {
      const parent = spec.parentSpanId ?? (als.getStore() ?? rootSpan).spanId;
      return makeSpan(spec, parent);
    },
    async span(spec, fn) {
      const span = trace.startSpan(spec);
      try {
        const out = await als.run(span, () => fn(span));
        span.end({ status: "ok" });
        return out;
      } catch (err) {
        span.end({ status: "error", error: toRpc(err) });
        throw err;
      }
    },
    forwardSpan(ev) {
      const parentForRoot = (als.getStore() ?? rootSpan).spanId;
      if (ev.type === "span-start") {
        // An inner root (no parent) nests under our current span; inner non-roots keep
        // their own parentage. traceId is always rewritten onto this trace so the whole
        // composed tree shares one id.
        const span: SpanStart = {
          ...ev.span,
          traceId,
          parentSpanId: ev.span.parentSpanId ?? parentForRoot,
        };
        emit({ type: "span-start", taskId, span });
      } else {
        emit({ ...ev, taskId, traceId });
      }
    },
  };

  return {
    trace,
    rootSpan,
    runWithRoot: (fn) => als.run(rootSpan, fn),
  };
}

function toRpc(err: unknown): RpcError {
  if (err && typeof err === "object" && "code" in err && "message" in err) {
    return { code: Number((err as RpcError).code), message: String((err as RpcError).message) };
  }
  return { code: -32603, message: err instanceof Error ? err.message : String(err) };
}
