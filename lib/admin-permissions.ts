export const ADMIN_PERMISSION_REGISTRY = [
  ["admin.console.access", "Administration", "Open the administration console"],
  ["admin.analytics.read", "Analytics", "Read platform analytics"],
  ["content.series.manage", "Publishing", "Manage series metadata and media"],
  ["content.chapters.manage", "Publishing", "Manage chapters and access decisions"],
  ["content.teams.manage", "Teams", "Manage verified team records and memberships"],
  ["content.team-requests.review", "Teams", "Review ownership and title requests"],
  ["content.sliders.manage", "Publishing", "Manage homepage sliders"],
  ["content.pinned.manage", "Publishing", "Manage pinned series"],
  ["content.taxonomy.manage", "Publishing", "Manage categories and genres"],
  ["content.editorial.manage", "Publishing", "Manage editorial selections"],
  ["uploads.review", "Publishing", "Review upload and replacement queues"],
  ["admin.series-requests.review", "Publishing", "Review new-series requests"],
  ["users.manage", "People", "Manage reader accounts and standard roles"],
  ["roles.manage", "People", "Manage protected roles and permission rules"],
  ["comments.moderate.global", "Moderation", "Moderate all comments"],
  ["reviews.moderate.global", "Moderation", "Moderate all reviews"],
  ["reports.manage", "Moderation", "Manage reader and series reports"],
  ["admin.support.manage", "Support", "Manage support tickets"],
  ["finance.balances.manage", "Finance", "Read and adjust durable balances"],
  ["finance.transactions.read", "Finance", "Read ledger transactions"],
  ["commerce.manage", "Commerce", "Manage paid-system and commerce settings"],
  ["discounts.manage", "Commerce", "Manage chapter and series discounts"],
  ["store.manage", "Commerce", "Manage store products and collections"],
  ["roulette.manage", "Commerce", "Manage roulette rewards and cadence"],
  ["admin.activity.read", "Operations", "Read human-readable user activity"],
  ["appearance.manage", "Platform", "Manage branding, footer, legal text, shortcuts, and theme"],
  ["announcements.manage", "Platform", "Manage announcements and event campaigns"],
  ["platform.operations.read", "Platform", "Read the operational registry for public systems"],
  ["platform.features.manage", "Platform", "Manage durable platform feature flags"],
  ["community.achievements.manage", "Community", "Manage achievement definitions and awards"],
  ["commerce.entitlements.read", "Commerce", "Inspect chapter entitlements and gift-card lifecycle"],
  ["notifications.manage", "Platform", "Inspect delivery and send targeted administrator notices"],
  ["security.read", "Security", "Read administrator security posture and login events"],
  ["security.sessions.manage", "Security", "Revoke administrator MFA sessions"],
  ["admin.audit.read", "Security", "Read immutable administrator audit events"],
  ["admin.audit.export", "Security", "Export immutable administrator audit events"],
  ["api.manage", "Security", "Manage external API credentials"],
  ["admin.identifiers.read", "Security", "Read immutable series, team, and chapter identifiers"],
  ["admin.bot-actions.read", "Security", "Read Discord Bot API actions and results"],
  ["team.manage.own", "Teams", "Manage assigned teams"],
  ["series.create", "Publishing", "Create series"],
  ["series.edit.assigned", "Publishing", "Edit assigned series"],
  ["chapter.draft.create", "Publishing", "Create chapter drafts"],
  ["chapter.submit.assigned", "Publishing", "Submit assigned chapters"],
  ["chapter.publish.assigned", "Publishing", "Publish assigned chapters"],
  ["upload.create", "Publishing", "Upload chapter files"],
  ["analytics.team.read", "Analytics", "Read team analytics"],
  ["analytics.chapter.read", "Analytics", "Read chapter analytics"],
  ["comments.moderate.own", "Teams", "Moderate own-team comments"],
] as const;

export type AdminCapability = (typeof ADMIN_PERMISSION_REGISTRY)[number][0];

export const NON_DELEGABLE_CAPABILITIES = new Set<string>([
  "admin.audit.read",
  "admin.audit.export",
  "roles.owner.manage",
  "roles.manage",
  "api.manage",
  "admin.identifiers.read",
  "admin.bot-actions.read",
  "security.sessions.manage",
]);

// Compatibility export: server guards and older callers consume this symbol,
// while the canonical slug/alias mapping now lives with the navigation model.
export { ADMIN_SECTION_CAPABILITIES } from "@/lib/admin-navigation";
export { ADMIN_SECTION_ALTERNATE_CAPABILITIES } from "@/lib/admin-navigation";

export function capabilityForAdminPath(path: string) {
  const suffix = path.replace(/^admin\//u, "");
  if (/^(summary|analytics)$/u.test(suffix)) return "admin.analytics.read";
  if (/^(series|series-cover)$/u.test(suffix)) return "content.series.manage";
  if (/^(chapter-detail|chapters)$/u.test(suffix)) return "content.chapters.manage";
  if (/^(teams|team-access|team-memberships|series-team-assignments)$/u.test(suffix)) return "content.teams.manage";
  if (/^users?$/u.test(suffix)) return "users.manage";
  if (/^(payouts)$/u.test(suffix)) return "finance.transactions.read";
  if (/^(store|store-items|store-collections|store-media)$/u.test(suffix)) return "store.manage";
  if (/^editor-picks$/u.test(suffix)) return "content.editorial.manage";
  if (/^(appearance|site-configuration|theme-catalog|site-media)$/u.test(suffix)) return "appearance.manage";
  if (/^commercial-settings$/u.test(suffix)) return "commerce.manage";
  if (/^discussion-settings$/u.test(suffix)) return "comments.moderate.global";
  if (/^reports$/u.test(suffix)) return "reports.manage";
  return "__unmapped_admin_capability__";
}
