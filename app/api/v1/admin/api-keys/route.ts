import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  API_KEY_SCOPES,
  BOT_API_KEY_SCOPES,
  createApiKeyMaterial,
  createBotApiKeyMaterial,
} from "@/lib/server/api-keys";
import { assertSameOrigin, auditStatement, requestIdFor } from "@/lib/server/admin-utils";
import { requireActor, requireOwner } from "@/lib/server/policy";

export const dynamic = "force-dynamic";

const ALL_API_KEY_SCOPES = [...API_KEY_SCOPES, ...BOT_API_KEY_SCOPES] as const;
const scopesSchema = z.array(z.enum(ALL_API_KEY_SCOPES)).min(1).max(ALL_API_KEY_SCOPES.length);
const createSchema = z.object({
  clientType: z.enum(["EXTERNAL_API", "DISCORD_BOT"]).default("EXTERNAL_API"),
  appName: z.string().trim().min(2).max(100),
  scopes: scopesSchema,
  allowedTeamId: z.string().trim().min(3).max(160).nullable().default(null),
  expiresAt: z.string().datetime().nullable().default(null),
}).superRefine((value, context) => {
  const allowed = value.clientType === "DISCORD_BOT"
    ? new Set<string>(BOT_API_KEY_SCOPES)
    : new Set<string>(API_KEY_SCOPES);
  value.scopes.forEach((scope, index) => {
    if (!allowed.has(scope)) {
      context.addIssue({
        code: "custom",
        path: ["scopes", index],
        message: `This scope is not valid for ${value.clientType.toLowerCase()}.`,
      });
    }
  });
});

function database() {
  if (!env.DB) throw new ApiError(503, "DATABASE_UNAVAILABLE", "API key storage is unavailable.");
  return env.DB;
}

async function validateTeam(teamId: string | null) {
  if (!teamId) return;
  const exists = await database().prepare(
    "SELECT id FROM teams WHERE id = ? AND is_archived = 0 AND verification_status = 'VERIFIED' LIMIT 1",
  ).bind(teamId).first();
  if (!exists) throw new ApiError(422, "TEAM_NOT_AVAILABLE", "Select an active verified team.");
}

async function listKeys() {
  const db = database();
  const [keys, teams] = await Promise.all([
    db.prepare(
      `SELECT ak.id, ak.client_type AS clientType, ak.app_name AS appName,
              ak.key_prefix AS keyPrefix, ak.scopes_json AS scopesJson,
              ak.allowed_team_id AS allowedTeamId,
              t.name AS allowedTeamName, ak.status, ak.expires_at AS expiresAt,
              ak.last_used_at AS lastUsedAt, ak.request_count AS requestCount,
              ak.revision, ak.created_at AS createdAt, ak.updated_at AS updatedAt,
              ak.replaced_by_key_id AS replacedByKeyId
         FROM api_keys ak
         LEFT JOIN teams t ON t.id = ak.allowed_team_id
        ORDER BY datetime(ak.created_at) DESC, ak.id DESC`,
    ).all<Record<string, unknown>>(),
    db.prepare(
      "SELECT id, name, slug FROM teams WHERE is_archived = 0 AND verification_status = 'VERIFIED' ORDER BY name COLLATE NOCASE",
    ).all(),
  ]);
  return {
    keys: keys.results.map((row) => ({
      ...row,
      maskedKey: `${row.clientType === "DISCORD_BOT" ? "nya_bot" : "nya_live"}_${String(row.keyPrefix)}_••••••••`,
      scopes: (() => { try { return JSON.parse(String(row.scopesJson)); } catch { return []; } })(),
      scopesJson: undefined,
    })),
    teams: teams.results,
    availableScopes: ALL_API_KEY_SCOPES,
  };
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    requireOwner(actor);
    return json(requestId, await listKeys(), { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

async function insertKey(payload: z.infer<typeof createSchema>, actorUserId: string) {
  const db = database();
  await validateTeam(payload.allowedTeamId);
  const material = payload.clientType === "DISCORD_BOT"
    ? await createBotApiKeyMaterial()
    : await createApiKeyMaterial();
  await db.prepare(
    `INSERT INTO api_keys
     (id, client_type, app_name, key_prefix, secret_hash, scopes_json, allowed_team_id,
      status, created_by_user_id, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
  ).bind(material.id, payload.clientType, payload.appName, material.prefix, material.secretHash, JSON.stringify([...new Set(payload.scopes)]), payload.allowedTeamId, actorUserId, payload.expiresAt).run();
  return material;
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireOwner(actor);
    const payload = createSchema.parse(await request.json());
    const material = await insertKey(payload, actor.id);
    await auditStatement(database(), actor, requestId, {
      action: "api.key.create",
      category: "AUTHENTICATION_SECURITY",
      sourceArea: "API_CONTROL",
      targetType: "API_KEY",
      targetId: material.id,
      targetLabel: payload.appName,
      metadata: { scopes: payload.scopes, allowedTeamId: payload.allowedTeamId },
    }).run();
    return json(requestId, { ...(await listKeys()), created: { id: material.id, secret: material.secret } }, { status: 201 });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function PATCH(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireOwner(actor);
    const db = database();
    const raw = await request.json() as Record<string, unknown>;
    const action = z.enum(["RESET", "REVOKE"]).parse(raw.action);
    const id = z.string().trim().min(3).max(160).parse(raw.id);
    const revision = z.coerce.number().int().min(1).parse(raw.revision);
    const current = await db.prepare(
      `SELECT id, client_type AS clientType, app_name AS appName,
              scopes_json AS scopesJson, allowed_team_id AS allowedTeamId,
              expires_at AS expiresAt,
              status, revision FROM api_keys WHERE id = ? LIMIT 1`,
    ).bind(id).first<{ id: string; clientType: "EXTERNAL_API" | "DISCORD_BOT"; appName: string; scopesJson: string; allowedTeamId: string | null; expiresAt: string | null; status: string; revision: number }>();
    if (!current || Number(current.revision) !== revision) throw new ApiError(409, "STALE_VERSION", "This API key changed. Reload and try again.");
    if (current.status !== "ACTIVE") throw new ApiError(409, "API_KEY_INACTIVE", "Only an active key can be reset or revoked.");
    if (action === "REVOKE") {
      const result = await db.prepare(
        "UPDATE api_keys SET status = 'REVOKED', revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND revision = ? AND status = 'ACTIVE'",
      ).bind(id, revision).run();
      if (!result.meta.changes) throw new ApiError(409, "STALE_VERSION", "This API key changed. Reload and try again.");
      await auditStatement(db, actor, requestId, { action: "api.key.revoke", category: "AUTHENTICATION_SECURITY", sourceArea: "API_CONTROL", targetType: "API_KEY", targetId: id, targetLabel: current.appName }).run();
      return json(requestId, await listKeys());
    }
    const scopes = scopesSchema.parse(JSON.parse(current.scopesJson));
    const material = current.clientType === "DISCORD_BOT"
      ? await createBotApiKeyMaterial()
      : await createApiKeyMaterial();
    const results = await db.batch([
      db.prepare(
        `INSERT INTO api_keys
         (id, client_type, app_name, key_prefix, secret_hash, scopes_json, allowed_team_id,
          status, created_by_user_id, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
      ).bind(material.id, current.clientType, current.appName, material.prefix, material.secretHash, JSON.stringify(scopes), current.allowedTeamId, actor.id, current.expiresAt),
      db.prepare(
        `UPDATE api_keys SET status = 'ROTATED', replaced_by_key_id = ?,
                revision = revision + 1, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND revision = ? AND status = 'ACTIVE'`,
      ).bind(material.id, id, revision),
      auditStatement(db, actor, requestId, { action: "api.key.reset", category: "AUTHENTICATION_SECURITY", sourceArea: "API_CONTROL", targetType: "API_KEY", targetId: id, targetLabel: current.appName, metadata: { replacementId: material.id } }, "changes() = 1"),
    ]);
    if (!results[1]?.meta.changes) {
      await db.prepare("DELETE FROM api_keys WHERE id = ?").bind(material.id).run();
      throw new ApiError(409, "STALE_VERSION", "This API key changed. Reload and try again.");
    }
    return json(requestId, { ...(await listKeys()), created: { id: material.id, secret: material.secret } });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
