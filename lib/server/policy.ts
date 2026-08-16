import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { getAuthenticatedUser } from "@/app/chatgpt-auth";
import { ApiError } from "@/lib/server/api";
import {
  canAny,
  highestRole,
  hasRoleAtLeast,
  ROLES,
} from "@/lib/permissions.mjs";
import { randomId } from "@/lib/server/random-id";
import { getAdminMfaState } from "@/lib/server/admin-mfa";
import { NON_DELEGABLE_CAPABILITIES } from "@/lib/admin-permissions";

export type Actor = {
  id: string;
  email: string;
  displayName: string;
  primaryRole: keyof typeof ROLES;
  roles: Array<keyof typeof ROLES>;
  avatarUrl: string | null;
  teamIds: string[];
  managedTeamIds: string[];
  requestTeamIds: string[];
  uploadTeamIds: string[];
  canUseUploadCenter: boolean;
  authMethod: "CHATGPT" | "PASSWORD";
  adminMfaRequired: boolean;
  adminMfaEnrolled: boolean;
  adminMfaVerified: boolean;
  adminMfaExpiresAt: string | null;
  permissionOverrides: Array<{ role: string; capability: string; allowed: boolean }>;
};

type MembershipRow = {
  team_id: string;
  membership_role: string;
  can_request_series: number;
  verification_status: string;
};

const validRoles = new Set(Object.values(ROLES));

function actorIdForEmail(email: string) {
  return `usr_${email.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 48)}`;
}

function configuredAdministrators() {
  const configured =
    (
      env as unknown as {
        NYASCANS_ADMIN_EMAILS?: string;
      }
    ).NYASCANS_ADMIN_EMAILS ?? "";
  return new Set(
    configured
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

function configuredOwners() {
  const configured =
    (
      env as unknown as {
        NYASCANS_OWNER_EMAILS?: string;
      }
    ).NYASCANS_OWNER_EMAILS ?? "";
  return new Set(
    configured
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function getActor(): Promise<Actor | null> {
  const identity = await getAuthenticatedUser();
  if (!identity) return null;
  if (!env.DB) {
    throw new ApiError(503, "DATABASE_UNAVAILABLE", "Identity storage is unavailable.");
  }

  const id = actorIdForEmail(identity.email);
  const email = identity.email.toLowerCase();
  const trustedOwners = configuredOwners();
  const trustedAdministrators = configuredAdministrators();
  const provisionedRole = trustedOwners.has(email)
    ? ROLES.OWNER
    : trustedAdministrators.has(email)
      ? ROLES.ADMINISTRATOR
      : ROLES.USER;
  const identityLookup = identity.userId ? "u.id = ?" : "u.email = ?";
  const identityLookupValue = identity.userId ?? email;
  let row = await env.DB.prepare(
    `SELECT u.id, u.email, u.display_name, u.primary_role, u.status,
            u.email_verified_at, p.avatar_key, p.username AS profile_username,
            p.revision AS profile_revision
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE ${identityLookup}
      LIMIT 1`,
  )
    .bind(identityLookupValue)
    .first<{
      id: string;
      email: string;
      display_name: string;
      primary_role: keyof typeof ROLES;
      status: string;
      email_verified_at: string | null;
      avatar_key: string | null;
      profile_username: string | null;
      profile_revision: number | null;
    }>();

  if (!row && identity.authMethod === "PASSWORD") {
    throw new ApiError(
      401,
      "ACCOUNT_NOT_FOUND",
      "This account could not be resolved.",
    );
  }

  if (!row) {
    const provisionRequestId = `auth-${randomId()}`;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO users
         (id, email, display_name, primary_role, status, email_verified_at)
         VALUES (?, ?, ?, ?, 'ACTIVE', CURRENT_TIMESTAMP)`,
      ).bind(id, email, identity.displayName, provisionedRole),
      env.DB.prepare(
        `INSERT OR IGNORE INTO user_roles
         (user_id, role, assigned_by_user_id)
         VALUES (?, ?, NULL)`,
      ).bind(id, provisionedRole),
      env.DB.prepare(
        `INSERT INTO audit_logs
         (id, actor_user_id, action, category, source_area, result, actor_role,
          target_type, target_id, target_label, reason, request_id,
          old_value_json, new_value_json)
         SELECT ?, ?, 'authorization.role.provision', 'USERS_ROLES',
                'AUTHORIZATION', 'SUCCESS', ?, 'USER', ?, ?,
                'Privileged role provisioned from trusted deployment configuration.',
                ?, NULL, ?
          WHERE changes() = 1
            AND ? IN ('OWNER', 'ADMINISTRATOR')`,
      ).bind(
        randomId(),
        id,
        provisionedRole,
        id,
        identity.displayName,
        provisionRequestId,
        JSON.stringify({ primaryRole: provisionedRole, status: "ACTIVE" }),
        provisionedRole,
      ),
    ]);
    row = await env.DB.prepare(
      `SELECT u.id, u.email, u.display_name, u.primary_role, u.status,
              u.email_verified_at, p.avatar_key, p.username AS profile_username,
              p.revision AS profile_revision
         FROM users u
         LEFT JOIN user_profiles p ON p.user_id = u.id
        WHERE u.email = ?
        LIMIT 1`,
    )
      .bind(email)
      .first<{
        id: string;
        email: string;
        display_name: string;
        primary_role: keyof typeof ROLES;
        status: string;
        email_verified_at: string | null;
        avatar_key: string | null;
        profile_username: string | null;
        profile_revision: number | null;
      }>();
  }

  if (
    row &&
    identity.authMethod === "CHATGPT" &&
    !row.email_verified_at
  ) {
    await env.DB.prepare(
      `UPDATE users
          SET email_verified_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND email_verified_at IS NULL`,
    )
      .bind(row.id)
      .run();
    row.email_verified_at = new Date().toISOString();
  }

  if (!row || row.status !== "ACTIVE") {
    throw new ApiError(403, "ACCOUNT_SUSPENDED", "This account cannot access NyaScans.");
  }
  if (!validRoles.has(row.primary_role)) {
    throw new ApiError(
      403,
      "ROLE_INVALID",
      "This account has an unsupported authorization role.",
    );
  }

  if (
    hasRoleAtLeast(provisionedRole, row.primary_role) &&
    provisionedRole !== row.primary_role
  ) {
    const previousRole = row.primary_role;
    const promotionRequestId = `auth-${randomId()}`;
    const promotionResults = await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO user_roles
         (user_id, role, assigned_by_user_id)
         VALUES (?, ?, NULL)`,
      ).bind(row.id, provisionedRole),
      env.DB.prepare(
        `UPDATE users
            SET primary_role = ?,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND primary_role = ?
            AND status = 'ACTIVE'`,
      ).bind(provisionedRole, row.id, previousRole),
      env.DB.prepare(
        `INSERT INTO audit_logs
         (id, actor_user_id, action, category, source_area, result, actor_role,
          target_type, target_id, target_label, reason, request_id,
          old_value_json, new_value_json)
         SELECT ?, ?, 'authorization.role.promote', 'USERS_ROLES',
                'AUTHORIZATION', 'SUCCESS', ?, 'USER', ?, ?,
                'Role promoted from trusted deployment configuration.',
                ?, ?, ?
          WHERE changes() = 1`,
      ).bind(
        randomId(),
        row.id,
        provisionedRole,
        row.id,
        row.display_name,
        promotionRequestId,
        JSON.stringify({ primaryRole: previousRole }),
        JSON.stringify({ primaryRole: provisionedRole }),
      ),
    ]);
    if (promotionResults[1]?.meta.changes) {
      row.primary_role = provisionedRole;
    } else {
      const refreshed = await env.DB.prepare(
        `SELECT u.id, u.email, u.display_name, u.primary_role, u.status,
                u.email_verified_at, p.avatar_key, p.username AS profile_username,
                p.revision AS profile_revision
           FROM users u
           LEFT JOIN user_profiles p ON p.user_id = u.id
          WHERE u.id = ?
          LIMIT 1`,
      )
        .bind(row.id)
        .first<{
          id: string;
          email: string;
          display_name: string;
          primary_role: keyof typeof ROLES;
          status: string;
          email_verified_at: string | null;
          avatar_key: string | null;
          profile_username: string | null;
          profile_revision: number | null;
        }>();
      if (!refreshed) {
        throw new ApiError(
          401,
          "ACCOUNT_NOT_FOUND",
          "This account could not be resolved.",
        );
      }
      row = refreshed;
    }
  }

  if (row.status !== "ACTIVE") {
    throw new ApiError(
      403,
      "ACCOUNT_SUSPENDED",
      "This account cannot access NyaScans.",
    );
  }
  if (!validRoles.has(row.primary_role)) {
    throw new ApiError(
      403,
      "ROLE_INVALID",
      "This account has an unsupported authorization role.",
    );
  }

  await env.DB.prepare(
    `INSERT OR IGNORE INTO user_roles
     (user_id, role, assigned_by_user_id)
     VALUES (?, ?, NULL)`,
  )
    .bind(row.id, row.primary_role)
    .run();
  const roleRows = await env.DB.prepare(
    `SELECT role
       FROM user_roles
      WHERE user_id = ?
      ORDER BY CASE role
        WHEN 'OWNER' THEN 6
        WHEN 'ADMINISTRATOR' THEN 5
        WHEN 'MANAGER' THEN 4
        WHEN 'MODERATOR' THEN 3
        WHEN 'TEAM_LEADER' THEN 2
        WHEN 'UPLOADER' THEN 1
        ELSE 0
      END DESC`,
  )
    .bind(row.id)
    .all<{ role: keyof typeof ROLES }>();
  const roles = [
    ...new Set(
      (roleRows.results ?? [])
        .map((entry) => entry.role)
        .filter((role) => validRoles.has(role)),
    ),
  ] as Array<keyof typeof ROLES>;
  const permissionRows = await env.DB.prepare(
    "SELECT role, capability, allowed FROM role_permission_rules",
  ).all<{ role: string; capability: string; allowed: number }>();
  const permissionOverrides = (permissionRows.results ?? [])
    .filter((entry) => roles.includes(entry.role as keyof typeof ROLES))
    .map((entry) => ({ role: entry.role, capability: entry.capability, allowed: Boolean(entry.allowed) }));
  const resolvedPrimaryRole = highestRole(
    roles.length ? roles : [row.primary_role],
  ) as keyof typeof ROLES;
  if (resolvedPrimaryRole !== row.primary_role) {
    await env.DB.prepare(
      `UPDATE users
          SET primary_role = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
    )
      .bind(resolvedPrimaryRole, row.id)
      .run();
    row.primary_role = resolvedPrimaryRole;
  }

  const membershipRows = await env.DB.prepare(
    `SELECT tm.team_id,
            tm.membership_role,
            tm.can_request_series,
            t.verification_status
       FROM team_memberships tm
       JOIN teams t ON t.id = tm.team_id
      WHERE tm.user_id = ?
        AND tm.status = 'ACTIVE'
        AND t.verification_status <> 'SUSPENDED'
        AND t.is_archived = 0`,
  )
    .bind(row.id)
    .all<MembershipRow>();

  const memberships = membershipRows.results as MembershipRow[];
  const managedTeamIds = memberships
    .filter((membership) =>
      ["OWNER", "LEADER"].includes(
        membership.membership_role.toUpperCase(),
      ),
    )
    .map((membership) => membership.team_id);
  const requestTeamIds = memberships
    .filter(
      (membership) =>
        Boolean(membership.can_request_series) ||
        ["OWNER", "LEADER"].includes(
          membership.membership_role.toUpperCase(),
        ),
    )
    .map((membership) => membership.team_id);
  const administrator =
    roles.includes(ROLES.OWNER) ||
    roles.includes(ROLES.ADMINISTRATOR);
  const uploadTeamIds = memberships
    .filter(
      (membership) =>
        membership.verification_status === "VERIFIED" &&
        ["OWNER", "LEADER", "UPLOADER"].includes(
          membership.membership_role.toUpperCase(),
        ),
    )
    .map((membership) => membership.team_id);
  const adminRoleSet = new Set<keyof typeof ROLES>([
    ROLES.OWNER,
    ROLES.ADMINISTRATOR,
    ROLES.MANAGER,
  ]);
  const consoleOverrides = permissionOverrides.filter(
    (rule) => rule.capability === "admin.console.access",
  );
  const consoleAllowed = consoleOverrides.some((rule) => !rule.allowed)
    ? false
    : consoleOverrides.some((rule) => rule.allowed)
      ? true
      : canAny(roles, "admin.console.access");
  const adminMfaRequired = roles.some((role) => adminRoleSet.has(role)) || consoleAllowed;
  const adminMfa = adminMfaRequired
    ? await getAdminMfaState(row.id, new Headers(await headers()))
    : { enrolled: false, verified: false, expiresAt: null };

  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    primaryRole: row.primary_role,
    roles,
    avatarUrl: row.avatar_key && row.profile_username
      ? `/api/v1/profile-media?username=${encodeURIComponent(row.profile_username)}&slot=avatar&v=${Number(row.profile_revision ?? 1)}`
      : null,
    teamIds: memberships.map((membership) => membership.team_id),
    managedTeamIds,
    requestTeamIds,
    uploadTeamIds,
    canUseUploadCenter:
      administrator ||
      requestTeamIds.length > 0 ||
      uploadTeamIds.length > 0 ||
      managedTeamIds.length > 0,
    authMethod: identity.authMethod,
    adminMfaRequired,
    adminMfaEnrolled: adminMfa.enrolled,
    adminMfaVerified: adminMfa.verified,
    adminMfaExpiresAt: adminMfa.expiresAt,
    permissionOverrides,
  };
}

export function actorHasCapability(actor: Actor, capability: string) {
  if (actor.roles.includes(ROLES.OWNER)) return true;
  if (NON_DELEGABLE_CAPABILITIES.has(capability)) return false;
  const matching = actor.permissionOverrides.filter(
    (rule) => rule.capability === capability && actor.roles.includes(rule.role as keyof typeof ROLES),
  );
  if (matching.some((rule) => !rule.allowed)) return false;
  if (matching.some((rule) => rule.allowed)) return true;
  return canAny(actor.roles, capability);
}

export async function requireActor(capability?: string): Promise<Actor> {
  const actor = await getActor();
  if (!actor) {
    throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Sign in to continue.");
  }
  if (capability === "upload.create" && actor.uploadTeamIds.length > 0) {
    return actor;
  }
  if (capability && !actorHasCapability(actor, capability)) {
    throw new ApiError(403, "FORBIDDEN", "You do not have permission to perform this action.");
  }
  return actor;
}

export function requireAdminConsole(actor: Actor) {
  if (!actorHasCapability(actor, "admin.console.access")) {
    throw new ApiError(403, "ADMIN_PERMISSION_REQUIRED", "Administrator console permission is required.");
  }
  if (!actor.adminMfaEnrolled) {
    throw new ApiError(403, "ADMIN_MFA_SETUP_REQUIRED", "Set up administrator two-factor authentication before continuing.");
  }
}

export function requireAdminCapability(actor: Actor, capability: string) {
  requireAdminConsole(actor);
  if (!actorHasCapability(actor, capability)) {
    throw new ApiError(
      403,
      "ADMIN_PERMISSION_REQUIRED",
      "You do not have permission to perform this administrative action.",
    );
  }
}

export function requireAdmin(actor: Actor) {
  if (
    !actor.roles.includes(ROLES.OWNER) &&
    !actor.roles.includes(ROLES.ADMINISTRATOR)
  ) {
    throw new ApiError(403, "ADMIN_REQUIRED", "Administrator authorization is required.");
  }
  if (!actorHasCapability(actor, "admin.console.access")) {
    throw new ApiError(403, "ADMIN_PERMISSION_REQUIRED", "Administrator console permission is required.");
  }
  if (!actor.adminMfaEnrolled) {
    throw new ApiError(403, "ADMIN_MFA_SETUP_REQUIRED", "Set up administrator two-factor authentication before continuing.");
  }
}

export function requireOwner(actor: Actor) {
  if (!actor.roles.includes(ROLES.OWNER)) {
    throw new ApiError(
      403,
      "OWNER_REQUIRED",
      "Owner authorization is required.",
    );
  }
  if (!actor.adminMfaEnrolled) {
    throw new ApiError(403, "ADMIN_MFA_SETUP_REQUIRED", "Set up administrator two-factor authentication before continuing.");
  }
}
