export const ROLES = Object.freeze({
  OWNER: "OWNER",
  ADMINISTRATOR: "ADMINISTRATOR",
  MANAGER: "MANAGER",
  MODERATOR: "MODERATOR",
  TEAM_LEADER: "TEAM_LEADER",
  UPLOADER: "UPLOADER",
  USER: "USER",
});

const readerCapabilities = [
  "catalog.read",
  "library.manage.own",
  "reader.progress.own",
  "wallet.read.own",
  "orders.read.own",
  "chapter.unlock.own",
  "comment.create",
  "review.create",
  "report.create",
];

const capabilities = Object.freeze({
  [ROLES.OWNER]: new Set(["*"]),
  [ROLES.ADMINISTRATOR]: new Set(["*"]),
  [ROLES.MANAGER]: new Set([
    ...readerCapabilities,
    "admin.series-requests.review",
    "admin.support.manage",
    "admin.console.access",
  ]),
  [ROLES.MODERATOR]: new Set([
    ...readerCapabilities,
    "comments.moderate.global",
    "reviews.moderate.global",
    "reports.manage",
  ]),
  [ROLES.TEAM_LEADER]: new Set([
    ...readerCapabilities,
    "team.manage.own",
    "series.create",
    "series.edit.assigned",
    "chapter.draft.create",
    "chapter.submit.assigned",
    "chapter.review.own",
    "chapter.publish.assigned",
    "chapter.preview.assigned",
    "upload.create",
    "analytics.team.read",
    "comments.moderate.own",
  ]),
  [ROLES.UPLOADER]: new Set([
    ...readerCapabilities,
    "series.read.assigned",
    "chapter.draft.create",
    "chapter.submit.assigned",
    "chapter.preview.assigned",
    "upload.create",
    "analytics.chapter.read",
  ]),
  [ROLES.USER]: new Set(readerCapabilities),
});

const ownerOnlyCapabilities = new Set([
  "admin.audit.read",
  "admin.audit.export",
  "roles.owner.manage",
]);

export function can(role, capability) {
  if (ownerOnlyCapabilities.has(capability) && role !== ROLES.OWNER) {
    return false;
  }
  const granted = capabilities[role] ?? new Set();
  return granted.has("*") || granted.has(capability);
}

export function assertCapability(role, capability) {
  if (!can(role, capability)) {
    const error = new Error("You do not have permission to perform this action.");
    error.code = "FORBIDDEN";
    error.status = 403;
    throw error;
  }
}

export function canAny(roles, capability) {
  return (Array.isArray(roles) ? roles : [roles]).some((role) =>
    can(role, capability),
  );
}

export function effectiveCapabilities(roles) {
  const selectedRoles = [
    ...new Set(Array.isArray(roles) ? roles : [roles]),
  ].filter((role) => role in capabilities);
  if (selectedRoles.includes(ROLES.OWNER)) return ["*"];
  if (selectedRoles.includes(ROLES.ADMINISTRATOR)) return ["admin.*"];

  return [
    ...new Set(
      selectedRoles.flatMap((role) => [
        ...(capabilities[role] ?? new Set()),
      ]),
    ),
  ].sort();
}

export function assertAnyCapability(roles, capability) {
  if (!canAny(roles, capability)) {
    const error = new Error("You do not have permission to perform this action.");
    error.code = "FORBIDDEN";
    error.status = 403;
    throw error;
  }
}

export function canAccessTeam(actor, teamId) {
  if (
    actor.roles?.includes(ROLES.OWNER) ||
    actor.roles?.includes(ROLES.ADMINISTRATOR) ||
    actor.primaryRole === ROLES.OWNER ||
    actor.primaryRole === ROLES.ADMINISTRATOR
  ) {
    return true;
  }
  return actor.teamIds?.includes(teamId) ?? false;
}

export const ROLE_RANK = Object.freeze({
  [ROLES.USER]: 0,
  [ROLES.UPLOADER]: 1,
  [ROLES.TEAM_LEADER]: 2,
  [ROLES.MODERATOR]: 3,
  [ROLES.MANAGER]: 4,
  [ROLES.ADMINISTRATOR]: 5,
  [ROLES.OWNER]: 6,
});

export function hasRoleAtLeast(role, minimumRole) {
  return (ROLE_RANK[role] ?? -1) >= (ROLE_RANK[minimumRole] ?? Number.MAX_SAFE_INTEGER);
}

export function highestRole(roles) {
  return [...new Set(Array.isArray(roles) ? roles : [roles])]
    .filter((role) => role in ROLE_RANK)
    .sort((left, right) => ROLE_RANK[right] - ROLE_RANK[left])[0] ?? ROLES.USER;
}

export function sumBalancedEntries(entries) {
  return entries.reduce((total, entry) => total + entry.amount, 0);
}
