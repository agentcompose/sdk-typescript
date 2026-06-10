// Runtime validation of inbound wire messages against the canonical AgentCompose
// schemas published by @agentcompose/spec. This is where untrusted JSON crossing a
// transport boundary (e.g. stdio) is checked before it reaches the runtime, so the
// spec — not a hand-copied shape — is the authority on what a valid message is.
import AjvDefault from "ajv/dist/2020.js";
import addFormatsDefault from "ajv-formats";
import { registerSchemas, SCHEMA_BASE } from "@agentcompose/spec";

const Ajv = ((AjvDefault as unknown as { default?: unknown }).default ?? AjvDefault) as new (
  opts?: unknown,
) => AjvInstance;
const addFormats = ((addFormatsDefault as unknown as { default?: unknown }).default ??
  addFormatsDefault) as (ajv: AjvInstance) => AjvInstance;

interface ValidateFn {
  (data: unknown): boolean;
  errors?: unknown;
}
interface AjvInstance {
  addSchema(schema: object): unknown;
  getSchema(id: string): ValidateFn | undefined;
}

const ajv = addFormats(new Ajv({ allErrors: true, strict: false }));
registerSchemas(ajv);

/** Wire message params that carry a canonical schema and arrive from untrusted callers. */
export type WireParams = "task-submit" | "agent-configure" | "task-provide-input";

export interface WireValidationFailure {
  message: string;
  errors: unknown;
}

/**
 * Validate JSON-RPC params against the named canonical schema. Returns `null` when
 * the params are valid, or a failure (with Ajv errors) to surface as
 * `InvalidParams`. The schema is always present (registered at module load), so a
 * missing validator is treated as a programming error rather than passing silently.
 */
export function validateWireParams(name: WireParams, params: unknown): WireValidationFailure | null {
  const validate = ajv.getSchema(`${SCHEMA_BASE}${name}.json`);
  if (!validate) throw new Error(`No canonical schema registered for ${name}`);
  if (validate(params)) return null;
  return { message: `Invalid params for ${name}`, errors: validate.errors ?? null };
}
