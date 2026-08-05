import { env } from "cloudflare:workers";
import { ApiError } from "@/lib/server/api";
import { randomId } from "@/lib/server/random-id";

export const API_KEY_SCOPES = [
  "series:read",
  "series:create",
  "upload:chapter",
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

function base64url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

async function digest(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function createApiKeyMaterial() {
  const prefixBytes = crypto.getRandomValues(new Uint8Array(6));
  const secretBytes = crypto.getRandomValues(new Uint8Array(32));
  const prefix = base64url(prefixBytes);
  const secretPart = base64url(secretBytes);
  const secret = `nya_live_${prefix}_${secretPart}`;
  return { id: `api_key_${randomId()}`, prefix, secret, secretHash: await digest(secret) };
}

export type ApiPrincipal = {
  keyId: string;
  appName: string;
  actorUserId: string;
  scopes: ApiKeyScope[];
  allowedTeamId: string | null;
};

function safeScopes(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((scope): scope is ApiKeyScope => API_KEY_SCOPES.includes(scope as ApiKeyScope));
  } catch {
    return [];
  }
}

export async function requireApiKey(
  request: Request,
  requiredScope: ApiKeyScope,
): Promise<ApiPrincipal> {
  if (!env.DB) throw new ApiError(503, "DATABASE_UNAVAILABLE", "API authentication is unavailable.");
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(nya_live_([A-Za-z0-9_-]{8})_[A-Za-z0-9_-]{40,})$/i);
  if (!match) throw new ApiError(401, "API_KEY_REQUIRED", "Use a valid Bearer API key.");
  const secret = match[1]!;
  const prefix = match[2]!;
  const row = await env.DB.prepare(
    `SELECT id, app_name AS appName, secret_hash AS secretHash,
            scopes_json AS scopesJson, allowed_team_id AS allowedTeamId,
            created_by_user_id AS actorUserId, status, expires_at AS expiresAt
       FROM api_keys WHERE key_prefix = ? LIMIT 1`,
  ).bind(prefix).first<{
    id: string;
    appName: string;
    secretHash: string;
    scopesJson: string;
    allowedTeamId: string | null;
    actorUserId: string;
    status: string;
    expiresAt: string | null;
  }>();
  const incomingHash = await digest(secret);
  if (!row || !constantTimeEqual(row.secretHash, incomingHash)) {
    throw new ApiError(401, "API_KEY_INVALID", "This API key is invalid or inactive.");
  }
  if (row.status !== "ACTIVE" || (row.expiresAt && Date.parse(row.expiresAt) <= Date.now())) {
    throw new ApiError(401, "API_KEY_INACTIVE", "This API key is revoked, rotated, or expired.");
  }
  const scopes = safeScopes(row.scopesJson);
  if (!scopes.includes(requiredScope)) throw new ApiError(403, "API_SCOPE_REQUIRED", `This key does not include ${requiredScope}.`);
  const minuteWindow = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
  const dayWindow = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO api_key_rate_limits (api_key_id, window_start, request_count)
       VALUES (?, ?, 1)
       ON CONFLICT(api_key_id, window_start) DO UPDATE SET
         request_count = request_count + 1, updated_at = CURRENT_TIMESTAMP`,
    ).bind(row.id, minuteWindow),
    env.DB.prepare(
      `INSERT INTO api_key_rate_limits (api_key_id, window_start, request_count)
       VALUES (?, ?, 1)
       ON CONFLICT(api_key_id, window_start) DO UPDATE SET
         request_count = request_count + 1, updated_at = CURRENT_TIMESTAMP`,
    ).bind(row.id, dayWindow),
  ]);
  const [minute, day] = await Promise.all([
    env.DB.prepare("SELECT request_count AS count FROM api_key_rate_limits WHERE api_key_id = ? AND window_start = ?").bind(row.id, minuteWindow).first<{ count: number }>(),
    env.DB.prepare("SELECT request_count AS count FROM api_key_rate_limits WHERE api_key_id = ? AND window_start = ?").bind(row.id, dayWindow).first<{ count: number }>(),
  ]);
  if (Number(minute?.count ?? 0) > 60 || Number(day?.count ?? 0) > 10_000) {
    throw new ApiError(429, "API_RATE_LIMITED", "This API key has reached its request limit.");
  }
  await env.DB.prepare(
    "UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP, request_count = request_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'ACTIVE'",
  ).bind(row.id).run();
  return { keyId: row.id, appName: row.appName, actorUserId: row.actorUserId, scopes, allowedTeamId: row.allowedTeamId };
}

export function assertApiTeam(principal: ApiPrincipal, teamId: string) {
  if (principal.allowedTeamId && principal.allowedTeamId !== teamId) {
    throw new ApiError(403, "API_TEAM_SCOPE_REQUIRED", "This key is not authorized for the selected team.");
  }
}
