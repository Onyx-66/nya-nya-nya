import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { ApiError } from "@/lib/server/api";
import {
  assertAnyCapability,
  highestRole,
  hasRoleAtLeast,
  ROLES,
} from "@/lib/permissions.mjs";
import { randomId } from "@/lib/server/random-id";

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
  const identity = await getChatGPTUser();
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
  let row = await env.DB.prepare(
    `SELECT u.id, u.email, u.display_name, u.primary_role, u.status,
            p.avatar_key, p.revision AS profile_revision
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
      avatar_key: string | null;
      profile_revision: number | null;
    }>();

  if (!row) {
    const provisionRequestId = `auth-${randomId()}`;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO users
         (id, email, display_name, primary_role, status)
         VALUES (?, ?, ?, ?, 'ACTIVE')`,
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
              p.avatar_key, p.revision AS profile_revision
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
        avatar_key: string | null;
        profile_revision: number | null;
      }>();
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
                p.avatar_key, p.revision AS profile_revision
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
          avatar_key: string | null;
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

  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    primaryRole: row.primary_role,
    roles,
    avatarUrl: row.avatar_key
      ? `/api/v1/profile-media?slot=avatar&revision=${Number(row.profile_revision ?? 1)}`
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
  };
}

export async function requireActor(capability?: string): Promise<Actor> {
  const actor = await getActor();
  if (!actor) {
    throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Sign in to continue.");
  }
  if (capability === "upload.create" && actor.uploadTeamIds.length > 0) {
    return actor;
  }
  if (capability) assertAnyCapability(actor.roles, capability);
  return actor;
}

export function requireAdminConsole(actor: Actor) {
  if (
    !actor.roles.some((role) =>
      [ROLES.OWNER, ROLES.ADMINISTRATOR, ROLES.MANAGER].includes(role),
    )
  ) {
    throw new ApiError(403, "ADMIN_REQUIRED", "Staff authorization is required.");
  }
}

export function requireAdmin(actor: Actor) {
  if (
    !actor.roles.includes(ROLES.OWNER) &&
    !actor.roles.includes(ROLES.ADMINISTRATOR)
  ) {
    throw new ApiError(403, "ADMIN_REQUIRED", "Administrator authorization is required.");
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
}
