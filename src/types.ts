// Core AgentCompose types. These are the typed projection of the canonical schemas
// in @agentcompose/spec; a drift-guard test (test/wire.test.ts) validates
// representative values of these types against those schemas so the two cannot
// silently diverge. Inbound wire messages are validated against the schemas at the
// transport boundary (see wire.ts).
export const AGENTCOMPOSE_VERSION = "0.1.0";

export type Part =
  | { kind: "text"; text: string }
  | { kind: "file"; mediaType: string; name?: string; uri?: string; bytes?: string }
  | { kind: "json"; json: unknown; mediaType?: string };

export type TaskState =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "failed"
  | "canceled";

export const TERMINAL_STATES: readonly TaskState[] = ["completed", "failed", "canceled"];

export const isTerminal = (s: TaskState): boolean => TERMINAL_STATES.includes(s);

export interface Artifact {
  id: string;
  parts: Part[];
  name?: string;
  createdAt: string;
}

export interface Result {
  parts: Part[];
}

export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface Task {
  id: string;
  state: TaskState;
  createdAt: string;
  updatedAt: string;
  artifacts: Artifact[];
  result?: Result;
  error?: RpcError;
}

export interface Capability {
  id: string;
  description: string;
  inputModes?: string[];
  outputModes?: string[];
  tags?: string[];
}

export interface AgentDescriptor {
  agentcomposeVersion?: string;
  id: string;
  name: string;
  version: string;
  description?: string;
  capabilities: Capability[];
  endpoint?: string;
  taskRetention?: number;
  /** JSON Schema (draft 2020-12) describing accepted configuration. */
  configSchema?: Record<string, unknown>;
  auth?: Record<string, unknown>;
  [key: string]: unknown;
}

export type TaskEvent =
  | { type: "status"; taskId: string; state: TaskState; message?: string; prompt?: Part[] }
  | { type: "progress"; taskId: string; percent?: number; message?: string }
  | { type: "message"; taskId: string; delta: Part }
  | { type: "artifact"; taskId: string; artifact: Artifact }
  | { type: "result"; taskId: string; result: Result }
  | { type: "error"; taskId: string; error: RpcError };

export type AgentConfig = Record<string, unknown>;

/** Reserved AgentCompose error codes (-32000..-32099). */
export const ErrorCodes = {
  TaskNotFound: -32000,
  CapabilityNotSupported: -32001,
  InvalidGoal: -32002,
  AuthRequired: -32003,
  RateLimited: -32004,
  InvalidState: -32005,
  UnsupportedVersion: -32006,
  InvalidConfiguration: -32007,
} as const;

/** JSON-RPC standard codes used by the transport layer. */
export const JsonRpcCodes = {
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const;

export class AgentError extends Error {
  code: number;
  data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "AgentError";
    this.code = code;
    this.data = data;
  }
  toRpc(): RpcError {
    return { code: this.code, message: this.message, data: this.data };
  }
}

export const toRpcError = (err: unknown): RpcError => {
  if (err instanceof AgentError) return err.toRpc();
  const message = err instanceof Error ? err.message : String(err);
  return { code: JsonRpcCodes.InternalError, message };
};

/**
 * Compatibility key for a protocol version. Pre-1.0, minor bumps are breaking,
 * so 0.1 and 0.2 are incompatible; post-1.0, the major alone decides.
 */
export const compatKey = (version: string): string => {
  const [major = "0", minor = "0"] = version.split(".");
  return major === "0" ? `0.${minor}` : major;
};

/** Throw UnsupportedVersion if a peer's protocol version is incompatible with ours. */
export function assertCompatibleVersion(
  peer: string | undefined,
  local: string = AGENTCOMPOSE_VERSION,
): void {
  if (!peer) return;
  if (compatKey(peer) !== compatKey(local)) {
    throw new AgentError(
      ErrorCodes.UnsupportedVersion,
      `Incompatible AgentCompose protocol version: peer speaks ${peer}, this SDK speaks ${local}.`,
      { peer, local },
    );
  }
}
