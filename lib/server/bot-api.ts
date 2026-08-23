import { env } from "cloudflare:workers";
import { ApiError, json } from "@/lib/server/api";
import { auditStatement, requestIdFor, sha256Hex } from "@/lib/server/admin-utils";
import { assertApiTeam, requireBotApiKey, type BotApiKeyScope, type BotApiPrincipal } from "@/lib/server/api-keys";
import { actorHasCapability, type Actor } from "@/lib/server/policy";
import { resolvePublicReference, resolvePublicReferenceOrNull, type PublicEntityType } from "@/lib/server/public-identifiers";
import { randomId } from "@/lib/server/random-id";

export type BotContext = {
  requestId: string;
  principal: BotApiPrincipal;
  actor: Actor;
};

export function botRequestId(request: Request) {
  return requestIdFor(request);
}

export function botDatabase() {
  if (!env.DB) throw new ApiError(503, "DATABASE_UNAVAILABLE", "The Bot API is temporarily unavailable.");
  return env.DB;
}

export async function botContext(request: Request, scope: BotApiKeyScope) {
  const requestId = requestIdFor(request);
  const { principal, actor } = await requireBotApiKey(request, scope);
  return { requestId, principal, actor } satisfies BotContext;
}

export function requireBotCapability(actor: Actor, capability: string) {
  if (!actorHasCapability(actor, capability)) {
    throw new ApiError(403, "BOT_CAPABILITY_REQUIRED", `This actor does not have ${capability}.`);
  }
}

export async function botTeam(
  context: BotContext,
  publicRef: string,
  options: { capability?: string; requireMembership?: boolean } = {},
) {
  const db = botDatabase();
  const resolved = await resolvePublicReference(db, "TEAM", publicRef);
  assertApiTeam(context.principal, resolved.entityId);
  const team = await db.prepare(
    `SELECT id, public_ref AS publicRef, slug, name, verification_status AS verificationStatus,
            is_archived AS isArchived
       FROM teams WHERE id = ? LIMIT 1`,
  ).bind(resolved.entityId).first<{
    id: string;
    publicRef: string;
    slug: string;
    name: string;
    verificationStatus: string;
    isArchived: number;
  }>();
  if (!team || Number(team.isArchived) === 1 || team.verificationStatus !== "VERIFIED") {
    throw new ApiError(422, "TEAM_NOT_AVAILABLE", "The selected team is not active and verified.");
  }
  if (options.requireMembership !== false && !context.actor.teamIds.includes(team.id) && !context.actor.roles.some((role) => role === "OWNER" || role === "ADMINISTRATOR")) {
    throw new ApiError(403, "BOT_TEAM_SCOPE_REQUIRED", "The linked NyaScans actor is not an active member of this team.");
  }
  if (options.capability) requireBotCapability(context.actor, options.capability);
  return team;
}

export async function botEntity(
  type: PublicEntityType,
  publicRef: string,
) {
  return resolvePublicReference(botDatabase(), type, publicRef);
}

export async function botIdempotencyStart(
  context: BotContext,
  endpoint: string,
  key: string,
  body: unknown,
) {
  const db = botDatabase();
  const normalized = key.trim();
  if (normalized.length < 12 || normalized.length > 160) {
    throw new ApiError(422, "IDEMPOTENCY_KEY_REQUIRED", "Use an Idempotency-Key between 12 and 160 characters.");
  }
  const requestHash = await sha256Hex(new TextEncoder().encode(JSON.stringify(body)));
  const existing = await db.prepare(
    `SELECT request_hash AS requestHash, status, response_json AS responseJson
       FROM bot_idempotency_keys
      WHERE actor_user_id = ? AND endpoint = ? AND idempotency_key = ?
      LIMIT 1`,
  ).bind(context.actor.id, endpoint, normalized).first<{
    requestHash: string;
    status: string;
    responseJson: string | null;
  }>();
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was already used with a different request body.");
    }
    if (existing.status === "SUCCEEDED" && existing.responseJson) {
      return { key: normalized, replay: JSON.parse(existing.responseJson) as unknown };
    }
    if (existing.status === "PROCESSING") {
      throw new ApiError(409, "IDEMPOTENCY_IN_PROGRESS", "The same request is already being processed.");
    }
  }
  await db.prepare(
    `INSERT INTO bot_idempotency_keys
       (id, actor_user_id, endpoint, idempotency_key, request_hash, status, expires_at)
     VALUES (?, ?, ?, ?, ?, 'PROCESSING', datetime('now', '+2 days'))`,
  ).bind(randomId(), context.actor.id, endpoint, normalized, requestHash).run();
  return { key: normalized, replay: null as unknown };
}

export async function botIdempotencyFinish(
  context: BotContext,
  endpoint: string,
  key: string,
  response: unknown,
  resourceRefs: string[] = [],
) {
  await botDatabase().prepare(
    `UPDATE bot_idempotency_keys
        SET status = 'SUCCEEDED', response_json = ?, resource_refs_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE actor_user_id = ? AND endpoint = ? AND idempotency_key = ?`,
  ).bind(JSON.stringify(response), JSON.stringify(resourceRefs), context.actor.id, endpoint, key).run();
}

export async function botIdempotencyFail(
  context: BotContext,
  endpoint: string,
  key: string,
  error: unknown,
) {
  const payload = error instanceof ApiError
    ? { code: error.code, message: error.message }
    : { code: "INTERNAL_ERROR", message: "The request could not be completed." };
  await botDatabase().prepare(
    `UPDATE bot_idempotency_keys
        SET status = 'FAILED', response_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE actor_user_id = ? AND endpoint = ? AND idempotency_key = ?`,
  ).bind(JSON.stringify({ error: payload }), context.actor.id, endpoint, key).run();
}

export function botAudit(
  context: BotContext,
  input: {
    action: string;
    targetType: string;
    targetId: string;
    targetLabel?: string;
    result?: "SUCCESS" | "DENIED" | "FAILURE";
    reason?: string;
    metadata?: Record<string, unknown>;
  },
) {
  return auditStatement(botDatabase(), context.actor, context.requestId, {
    action: input.action,
    category: "UPLOADS_IMPORTS",
    sourceArea: "BOT_API",
    result: input.result ?? "SUCCESS",
    targetType: input.targetType,
    targetId: input.targetId,
    targetLabel: input.targetLabel,
    reason: input.reason,
    metadata: {
      apiKeyId: context.principal.keyId,
      appName: context.principal.appName,
      discordUserId: context.principal.discordUserId,
      discordUsername: context.principal.discordUsername,
      discordCommand: context.principal.discordCommand,
      discordInteractionId: context.principal.discordInteractionId,
      ...input.metadata,
    },
  });
}

export function botJson(context: BotContext, data: unknown, init: ResponseInit = {}) {
  return json(context.requestId, data, init);
}

export async function botFailureAudit(context: BotContext, endpoint: string, error: unknown) {
  const failure = error instanceof ApiError
    ? { code: error.code, message: error.message }
    : { code: "INTERNAL_ERROR", message: "The request could not be completed." };
  await botAudit(context, {
    action: "bot.request.failure",
    result: "FAILURE",
    targetType: "BOT_ENDPOINT",
    targetId: endpoint,
    targetLabel: endpoint,
    reason: failure.message,
    metadata: { endpoint, errorCode: failure.code },
  }).run().catch(() => undefined);
}

function blockedHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/\.$/u, "");
  if (["localhost", "localhost.localdomain", "metadata.google.internal"].includes(host)) return true;
  if (host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return true;
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/u);
  if (!ipv4) return false;
  const [a, b] = ipv4.slice(1).map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function assertSafeExternalUrl(raw: string) {
  let url: URL;
  try { url = new URL(raw); } catch { throw new ApiError(422, "SOURCE_URL_INVALID", "Use a valid HTTPS source URL."); }
  if (url.protocol !== "https:" || blockedHostname(url.hostname)) {
    throw new ApiError(422, "SOURCE_URL_UNTRUSTED", "Only public HTTPS source URLs are accepted.");
  }
  url.username = "";
  url.password = "";
  return url;
}

export async function fetchExternalSource(raw: string) {
  const url = assertSafeExternalUrl(raw);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { redirect: "error", signal: controller.signal, headers: { accept: "image/jpeg,image/png,image/webp,application/json" } });
    if (!response.ok) throw new ApiError(422, "SOURCE_FETCH_FAILED", `The external source returned HTTP ${response.status}.`);
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > 250 * 1024 * 1024) throw new ApiError(413, "SOURCE_TOO_LARGE", "The external source exceeds the upload size limit.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 250 * 1024 * 1024) throw new ApiError(413, "SOURCE_TOO_LARGE", "The external source exceeds the upload size limit.");
    return { url: url.toString(), contentType: response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase() ?? "application/octet-stream", bytes };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(422, "SOURCE_FETCH_FAILED", "The external source could not be fetched safely.");
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveOptionalPublicReference(type: PublicEntityType, value: string | null | undefined) {
  if (!value) return null;
  return resolvePublicReferenceOrNull(botDatabase(), type, value);
}
