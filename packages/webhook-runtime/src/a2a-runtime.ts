import {
  A2aAgentCardSchema,
  A2aMessageSchema,
  JsonRpcRequestSchema,
  type A2aAgentCard,
  type A2aJsonRpcRequest,
  type A2aMessage,
  type A2aSkill,
  type A2aTask,
  type A2aTaskState,
} from "@relaycast/a2a";
import type { Context, Hono } from "hono";

type JsonRecord = Record<string, unknown>;

type HonoEnv<Env extends JsonRecord> = {
  Bindings: Env;
};

export type AgentAssistantA2aSkill = A2aSkill & {
  id: string;
};

export type A2aSkillDispatchInput<Env extends JsonRecord = JsonRecord> = {
  skillId: string;
  body: JsonRecord;
  request: A2aJsonRpcRequest;
  message: A2aMessage;
  context: Context<HonoEnv<Env>>;
};

export type A2aSkillDispatchResult = {
  state?: A2aTaskState;
  text?: string;
  data?: JsonRecord;
  metadata?: JsonRecord;
};

export type A2aSkillDispatcher<Env extends JsonRecord = JsonRecord> = (
  input: A2aSkillDispatchInput<Env>,
) => Promise<A2aSkillDispatchResult> | A2aSkillDispatchResult;

export interface BuildAgentAssistantA2aCardOptions {
  name: string;
  url: string;
  version: string;
  description?: string;
  skills: readonly AgentAssistantA2aSkill[];
  provider?: JsonRecord;
  capabilities?: JsonRecord;
  defaultInputModes?: readonly string[];
  defaultOutputModes?: readonly string[];
  documentationUrl?: string;
}

export interface RegisterA2aRoutesOptions<Env extends JsonRecord = JsonRecord>
  extends BuildAgentAssistantA2aCardOptions {
  agentCardPath?: string;
  legacyAgentCardPath?: string;
  rpcPath?: string;
  cacheControl?: string;
  authToken?: string | ((context: Context<HonoEnv<Env>>) => string | undefined);
  allowUnauthenticatedRpc?: boolean;
  dispatchSkill?: A2aSkillDispatcher<Env>;
}

type RpcEnvelope =
  | { jsonrpc: "2.0"; id?: A2aJsonRpcRequest["id"]; result: JsonRecord }
  | {
      jsonrpc: "2.0";
      id?: A2aJsonRpcRequest["id"];
      error: { code: number; message: string; data?: unknown };
    };

const DEFAULT_AGENT_CARD_PATH = "/.well-known/agent-card.json";
const DEFAULT_LEGACY_AGENT_CARD_PATH = "/.well-known/agent.json";
const DEFAULT_RPC_PATH = "/a2a/rpc";

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function timingSafeEqualString(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}

function rpcResult(id: A2aJsonRpcRequest["id"], result: JsonRecord): RpcEnvelope {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(
  id: A2aJsonRpcRequest["id"],
  code: number,
  message: string,
  data?: unknown,
): RpcEnvelope {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

function tokenFromHeader(authHeader: string | undefined): string | undefined {
  const match = authHeader?.match(/^Bearer\s+(.+)$/i);
  return trimOptional(match?.[1]);
}

function resolveAuthToken<Env extends JsonRecord>(
  context: Context<HonoEnv<Env>>,
  token: RegisterA2aRoutesOptions<Env>["authToken"],
): string | undefined {
  return typeof token === "function" ? trimOptional(token(context)) : trimOptional(token);
}

function validateRpcAuth<Env extends JsonRecord>(
  context: Context<HonoEnv<Env>>,
  options: RegisterA2aRoutesOptions<Env>,
): { ok: true } | { ok: false; status: 401 | 403 | 500; message: string } {
  const expected = resolveAuthToken(context, options.authToken);
  if (!expected && options.allowUnauthenticatedRpc) {
    return { ok: true };
  }
  if (!expected) {
    return {
      ok: false,
      status: 500,
      message: "A2A RPC endpoint is not configured with an auth token",
    };
  }

  const actual = tokenFromHeader(context.req.header("authorization"));
  if (!actual) {
    return { ok: false, status: 401, message: "Missing Bearer token" };
  }
  if (!timingSafeEqualString(actual, expected)) {
    return { ok: false, status: 403, message: "Invalid Bearer token" };
  }
  return { ok: true };
}

function decodeMessageBody(message: A2aMessage): JsonRecord {
  const dataPart = message.parts.find(
    (part): part is { kind: "data"; data: JsonRecord } =>
      part.kind === "data" && isRecord(part.data),
  );
  if (dataPart) {
    return dataPart.data;
  }

  const textPart = message.parts.find(
    (part): part is { kind: "text"; text: string } => part.kind === "text",
  );
  if (!textPart?.text.trim()) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(textPart.text);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readSkillId(body: JsonRecord): string | undefined {
  const skill = body.skill ?? body.skillId ?? body.capability;
  return typeof skill === "string" && skill.trim().length > 0 ? skill.trim() : undefined;
}

function resultToText(result: A2aSkillDispatchResult): string {
  if (result.text !== undefined) {
    return result.text;
  }
  if (result.data !== undefined) {
    return JSON.stringify(result.data);
  }
  return JSON.stringify({ status: result.state ?? "completed" });
}

function responseForSkill(
  skillId: string,
  message: A2aMessage,
  result: A2aSkillDispatchResult,
): { task: A2aTask; message: A2aMessage } {
  const responseText = resultToText(result);
  const responseMessage: A2aMessage = {
    message_id: `${message.message_id}-response`,
    role: "agent",
    ...(message.context_id ? { context_id: message.context_id } : {}),
    parts: [{ kind: "text", text: responseText }],
  };
  const state = result.state ?? "completed";

  return {
    message: responseMessage,
    task: {
      id: message.message_id,
      ...(message.context_id ? { context_id: message.context_id } : {}),
      status: { state },
      artifacts: [{ name: skillId, parts: responseMessage.parts }],
      history: [message, responseMessage],
      metadata: { skill: skillId, ...(result.metadata ?? {}) },
    },
  };
}

async function handleMessageSend<Env extends JsonRecord>(
  context: Context<HonoEnv<Env>>,
  request: A2aJsonRpcRequest,
  options: RegisterA2aRoutesOptions<Env>,
): Promise<{ task: A2aTask; message: A2aMessage }> {
  const message = A2aMessageSchema.parse(request.params?.message);
  const body = decodeMessageBody(message);
  const skillId = readSkillId(body);
  if (!skillId) {
    throw new RpcClientError("message/send body must include a skill id", "missing_skill");
  }
  if (!options.skills.some((skill) => skill.id === skillId)) {
    throw new RpcClientError(`Unknown A2A skill: ${skillId}`, "unknown_skill");
  }

  const result = options.dispatchSkill
    ? await options.dispatchSkill({ skillId, body, request, message, context })
    : {
        state: "input-required" as const,
        data: {
          status: "preview",
          skill: skillId,
          note: "Skill is advertised but no dispatcher is registered for this agent.",
        },
      };

  return responseForSkill(skillId, message, result);
}

async function handleRpc<Env extends JsonRecord>(
  context: Context<HonoEnv<Env>>,
  options: RegisterA2aRoutesOptions<Env>,
): Promise<Response> {
  let parsed: A2aJsonRpcRequest;
  let id: A2aJsonRpcRequest["id"];
  try {
    parsed = JsonRpcRequestSchema.parse(await context.req.json());
    id = parsed.id;
  } catch (error) {
    return context.json(
      rpcError(undefined, -32600, "Invalid Request", {
        message: error instanceof Error ? error.message : "Failed to parse JSON-RPC body",
      }),
      400,
    );
  }

  const auth = validateRpcAuth(context, options);
  if (!auth.ok) {
    return context.json(rpcError(id, -32001, auth.message), auth.status);
  }

  try {
    if (parsed.method === "message/send") {
      return context.json(rpcResult(id, await handleMessageSend(context, parsed, options)));
    }
    return context.json(rpcError(id, -32601, `Method not found: ${parsed.method}`), 404);
  } catch (error) {
    if (error instanceof RpcClientError) {
      return context.json(rpcError(id, -32602, error.message, { code: error.code }), 400);
    }
    return context.json(
      rpcError(id, -32603, error instanceof Error ? error.message : "A2A internal error"),
      500,
    );
  }
}

export function buildAgentAssistantA2aCard(
  options: BuildAgentAssistantA2aCardOptions,
): A2aAgentCard {
  const card: A2aAgentCard = {
    name: options.name,
    url: normalizeBaseUrl(options.url),
    version: options.version,
    skills: options.skills.map((skill) => ({ ...skill })),
    ...(options.description ? { description: options.description } : {}),
    ...(options.provider ? { provider: options.provider } : {}),
    ...(options.capabilities ? { capabilities: options.capabilities } : {}),
    default_input_modes: [...(options.defaultInputModes ?? ["text"])],
    default_output_modes: [...(options.defaultOutputModes ?? ["text"])],
    ...(options.documentationUrl ? { documentation_url: options.documentationUrl } : {}),
  };
  return A2aAgentCardSchema.parse(card);
}

export function registerA2aRoutes<Env extends JsonRecord>(
  app: Hono<HonoEnv<Env>>,
  options: RegisterA2aRoutesOptions<Env>,
): void {
  const agentCardPath = options.agentCardPath ?? DEFAULT_AGENT_CARD_PATH;
  const legacyAgentCardPath = options.legacyAgentCardPath ?? DEFAULT_LEGACY_AGENT_CARD_PATH;
  const rpcPath = options.rpcPath ?? DEFAULT_RPC_PATH;

  app.get(agentCardPath, (context) =>
    context.json(buildAgentAssistantA2aCard(options), 200, {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": options.cacheControl ?? "public, max-age=60",
    }),
  );

  app.options(agentCardPath, (context) =>
    context.body(null, 204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    }),
  );

  if (legacyAgentCardPath) {
    app.get(legacyAgentCardPath, (context) => context.redirect(agentCardPath, 308));
  }

  app.post(rpcPath, (context) => handleRpc(context, options));
}

class RpcClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}
