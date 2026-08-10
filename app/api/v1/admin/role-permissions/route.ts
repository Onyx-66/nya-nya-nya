import { env } from "cloudflare:workers";
import { z } from "zod";
import { can, ROLES } from "@/lib/permissions.mjs";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { assertSameOrigin, auditStatement, requestIdFor } from "@/lib/server/admin-utils";
import { requireActor, requireOwner } from "@/lib/server/policy";
import {
  ADMIN_PERMISSION_REGISTRY,
  NON_DELEGABLE_CAPABILITIES,
} from "@/lib/admin-permissions";

export const dynamic = "force-dynamic";

const editableRoles = [ROLES.ADMINISTRATOR, ROLES.MANAGER, ROLES.MODERATOR, ROLES.TEAM_LEADER, ROLES.UPLOADER, ROLES.USER] as const;

function database() {
  if (!env.DB) throw new ApiError(503, "DATABASE_UNAVAILABLE", "Permission settings are unavailable.");
  return env.DB;
}

async function snapshot() {
  const rules = await database().prepare("SELECT role, capability, allowed, revision, updated_at AS updatedAt FROM role_permission_rules ORDER BY role, capability").all<Record<string, unknown>>();
  return {
    roles: editableRoles,
    definitions: ADMIN_PERMISSION_REGISTRY.map(([id, group, label]) => ({ id, group, label })),
    rules: rules.results.map((rule) => ({ ...rule, allowed: Boolean(rule.allowed) })),
    defaults: Object.fromEntries(editableRoles.map((role) => [role, Object.fromEntries(ADMIN_PERMISSION_REGISTRY.map(([id]) => [id, can(role, id)]))])),
  };
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    requireOwner(actor);
    return json(requestId, { data: await snapshot() }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function PUT(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireOwner(actor);
    const payload = z.object({
      role: z.enum(editableRoles),
      capability: z.enum(ADMIN_PERMISSION_REGISTRY.map(([id]) => id) as [string, ...string[]]),
      allowed: z.boolean().nullable(),
      expectedRevision: z.number().int().min(0),
    }).parse(await request.json());
    if (NON_DELEGABLE_CAPABILITIES.has(payload.capability)) {
      throw new ApiError(403, "PERMISSION_NON_DELEGABLE", "This owner-only permission cannot be delegated.");
    }
    const db = database();
    let mutation;
    if (payload.allowed === null) {
      mutation = db.prepare("DELETE FROM role_permission_rules WHERE role = ? AND capability = ? AND revision = ?").bind(payload.role, payload.capability, payload.expectedRevision);
    } else if (payload.expectedRevision === 0) {
      mutation = db.prepare("INSERT OR IGNORE INTO role_permission_rules (role, capability, allowed, updated_by_user_id) VALUES (?, ?, ?, ?)").bind(payload.role, payload.capability, payload.allowed ? 1 : 0, actor.id);
    } else {
      mutation = db.prepare("UPDATE role_permission_rules SET allowed = ?, revision = revision + 1, updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE role = ? AND capability = ? AND revision = ?").bind(payload.allowed ? 1 : 0, actor.id, payload.role, payload.capability, payload.expectedRevision);
    }
    const results = await db.batch([
      mutation,
      auditStatement(db, actor, requestId, { action: "role.permission.update", category: "USERS_ROLES", sourceArea: "ROLE_PERMISSIONS", targetType: "ROLE", targetId: payload.role, targetLabel: payload.capability, reason: payload.allowed === null ? "Restored role default" : payload.allowed ? "Permission granted" : "Permission denied" }, "changes() = 1"),
    ]);
    if (!results[0]?.meta.changes) throw new ApiError(409, "STALE_VERSION", "This permission changed. Reload before trying again.");
    return json(requestId, { data: await snapshot() });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
