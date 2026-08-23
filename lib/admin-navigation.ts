import type { AdminCapability } from "@/lib/admin-permissions";

export type AdminNavigationChild = Readonly<{
  slug: string;
  label: string;
  capability?: AdminCapability;
  aliases: readonly string[];
  keywords: readonly string[];
}>;

export type AdminNavigationItem = Readonly<{
  slug: string;
  label: string;
  capability: AdminCapability;
  alternateCapabilities?: readonly AdminCapability[];
  aliases: readonly string[];
  keywords: readonly string[];
  children?: readonly AdminNavigationChild[];
}>;

export type AdminNavigationGroup = Readonly<{
  id: string;
  label: string;
  items: readonly AdminNavigationItem[];
}>;

const child = (
  slug: string,
  label: string,
  aliases: readonly string[] = [],
  keywords: readonly string[] = [],
  capability?: AdminCapability,
): AdminNavigationChild => ({
  slug,
  label,
  capability,
  aliases,
  keywords,
});

/**
 * The administration information architecture defined by admin_panel.md.
 * Historical slugs remain aliases so bookmarks and permission-guarded links
 * continue to work while every visible destination uses the rebuilt structure.
 */
export const ADMIN_NAVIGATION_GROUPS = [
  {
    id: "dashboard",
    label: "Dashboard",
    items: [
      {
        slug: "home",
        label: "Home",
        capability: "admin.analytics.read",
        aliases: ["dashboard", "analytics", "overview", "summary"],
        keywords: ["site overview", "quick actions", "system status", "metrics"],
      },
    ],
  },
  {
    id: "catalog",
    label: "Catalog",
    items: [
      {
        slug: "series",
        label: "Series",
        capability: "content.series.manage",
        aliases: ["catalogue"],
        keywords: ["titles", "metadata", "covers", "publishing", "add series", "import"],
      },
      {
        slug: "chapters",
        label: "Chapters",
        capability: "content.chapters.manage",
        alternateCapabilities: ["uploads.review"],
        aliases: ["chapter-access", "upload-center", "uploads"],
        keywords: ["pages", "release", "language", "price", "reader access"],
      },
      {
        slug: "genres-tags",
        label: "Genres & Tags",
        capability: "content.taxonomy.manage",
        aliases: ["categories-&-genres", "categories-genres", "taxonomy"],
        keywords: ["categories", "genres", "tags", "taxonomy"],
      },
    ],
  },
  {
    id: "homepage-marketing",
    label: "Homepage & Marketing",
    items: [
      {
        slug: "sliders",
        label: "Sliders",
        capability: "content.sliders.manage",
        aliases: ["carousel"],
        keywords: ["home", "hero", "featured"],
      },
      {
        slug: "pinned-series",
        label: "Pinned Series",
        capability: "content.pinned.manage",
        aliases: ["pinned"],
        keywords: ["featured", "home", "promoted titles"],
      },
      {
        slug: "editorial-picks",
        label: "Editorial Picks",
        capability: "content.editorial.manage",
        aliases: ["editorial", "editor-picks"],
        keywords: ["selections", "featured", "curation"],
      },
      {
        slug: "announcements-ads",
        label: "Announcements & Ads",
        capability: "announcements.manage",
        aliases: ["announcements-&-ads", "announcements", "campaigns"],
        keywords: ["floating image", "notice", "home campaign"],
      },
    ],
  },
  {
    id: "publishing-queue",
    label: "Publishing Queue",
    items: [
      {
        slug: "series-submissions",
        label: "Series Submissions",
        capability: "admin.series-requests.review",
        aliases: ["new-series-queue", "series-queue"],
        keywords: ["community requests", "new titles", "review", "duplicate"],
      },
      {
        slug: "chapter-review",
        label: "Chapter Review",
        capability: "uploads.review",
        aliases: ["review-queue", "uploads-review"],
        keywords: ["pending uploads", "source validation", "approve", "reject"],
      },
      {
        slug: "access-decisions",
        label: "Access Decisions",
        capability: "content.chapters.manage",
        aliases: ["chapter-decisions"],
        keywords: ["free schedule", "paywall", "entitlements"],
      },
    ],
  },
  {
    id: "teams",
    label: "Teams",
    items: [
      {
        slug: "team-directory",
        label: "Directory",
        capability: "content.teams.manage",
        aliases: ["teams", "groups"],
        keywords: ["members", "staff", "ownership", "identity"],
      },
      {
        slug: "team-requests",
        label: "Requests",
        capability: "content.team-requests.review",
        aliases: ["ownership-requests"],
        keywords: ["verification", "title change", "review"],
      },
    ],
  },
  {
    id: "community",
    label: "Community",
    items: [
      {
        slug: "users-roles",
        label: "Users & Roles",
        capability: "users.manage",
        aliases: ["users-&-roles", "users"],
        keywords: ["accounts", "roles", "status"],
      },
      {
        slug: "permissions",
        label: "Permissions",
        capability: "roles.manage",
        aliases: ["role-permissions"],
        keywords: ["capabilities", "access control", "roles"],
      },
      {
        slug: "reports",
        label: "Reports",
        capability: "reports.manage",
        aliases: ["series-reports"],
        keywords: ["moderation", "reader reports", "content"],
      },
      {
        slug: "discussions",
        label: "Discussions",
        capability: "comments.moderate.global",
        aliases: ["comments"],
        keywords: ["reactions", "moderation", "community"],
      },
      {
        slug: "support-tickets",
        label: "Support Tickets",
        capability: "admin.support.manage",
        aliases: ["support"],
        keywords: ["help", "open tickets", "requests"],
      },
    ],
  },
  {
    id: "monetization",
    label: "Monetization",
    items: [
      {
        slug: "wallet-balances",
        label: "Wallet & Balances",
        capability: "finance.balances.manage",
        aliases: ["balances", "wallets"],
        keywords: ["paw coins", "onyx", "shards", "private", "adjustments"],
      },
      {
        slug: "transactions",
        label: "Transactions",
        capability: "finance.transactions.read",
        aliases: ["purchases"],
        keywords: ["ledger", "chapter purchases", "payments"],
      },
      {
        slug: "payouts",
        label: "Payouts",
        capability: "finance.transactions.read",
        aliases: ["team-payouts"],
        keywords: ["teams", "settlements", "creators"],
      },
      {
        slug: "store",
        label: "Store",
        capability: "store.manage",
        alternateCapabilities: ["commerce.manage"],
        aliases: ["store-management", "commerce", "offers"],
        keywords: ["catalog", "pricing", "products", "checkout"],
        children: [
          child(
            "offers",
            "Offers & Pricing",
            ["commerce", "checkout"],
            [],
            "commerce.manage",
          ),
          child("coins", "Coins", [], [], "commerce.manage"),
          child(
            "memberships",
            "Memberships",
            ["subscriptions"],
            [],
            "commerce.manage",
          ),
          child("banners", "Banners", [], [], "store.manage"),
          child("cosmetics", "Cosmetics", [], [], "store.manage"),
          child(
            "logo-effects",
            "Logo Effects",
            ["effects"],
            [],
            "store.manage",
          ),
        ],
      },
      {
        slug: "discounts",
        label: "Discounts",
        capability: "discounts.manage",
        aliases: ["promotions"],
        keywords: ["sale", "chapter price", "series price"],
      },
      {
        slug: "roulette",
        label: "Roulette",
        capability: "roulette.manage",
        aliases: ["rewards"],
        keywords: ["wheel", "slots", "prizes"],
      },
      {
        slug: "content-access-control",
        label: "Content Access Control",
        capability: "content.chapters.manage",
        aliases: ["content-visibility", "visibility", "public-private"],
        keywords: ["free", "paid", "premium", "paywall", "exceptions"],
      },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    items: [
      {
        slug: "branding-appearance",
        label: "Branding & Appearance",
        capability: "appearance.manage",
        aliases: ["appearance", "branding", "theme"],
        keywords: ["logo", "colors", "typography", "templates", "palettes", "preview"],
      },
      {
        slug: "footer-legal",
        label: "Footer & Legal",
        capability: "appearance.manage",
        aliases: ["footer", "legal"],
        keywords: ["links", "social", "dmca", "terms", "privacy", "refund"],
      },
      {
        slug: "keyboard-shortcuts",
        label: "Keyboard Shortcuts",
        capability: "appearance.manage",
        aliases: ["shortcuts"],
        keywords: ["keys", "commands", "hotkeys"],
      },
      {
        slug: "feature-flags",
        label: "Feature Flags",
        capability: "platform.operations.read",
        aliases: ["site-coverage", "coverage"],
        keywords: ["payments", "memberships", "achievements", "moderation", "gift cards", "registry"],
        children: [
          child("registry", "Product Features", ["feature-flags"]),
          child("community", "Achievements"),
          child("moderation", "Moderation"),
          child("access", "Access & Gift Cards"),
          child("security", "Admin Security Registry"),
        ],
      },
      {
        slug: "security",
        label: "Security",
        capability: "security.read",
        aliases: ["admin-security"],
        keywords: ["two-factor", "sessions", "login alerts", "protections"],
      },
      {
        slug: "identifiers",
        label: "Identifiers",
        capability: "admin.identifiers.read",
        aliases: ["public-identifiers", "stable-ids"],
        keywords: ["public references", "series IDs", "team IDs", "chapter IDs"],
      },
      {
        slug: "bot-activity",
        label: "Bot Activity",
        capability: "admin.bot-actions.read",
        aliases: ["bot-actions", "discord-api"],
        keywords: ["discord", "bot", "api actions", "uploads"],
      },
      {
        slug: "integrations-api",
        label: "Integrations & API",
        capability: "api.manage",
        aliases: ["api-control", "api", "api-keys"],
        keywords: ["credentials", "bots", "scopes", "mangadex", "mangaupdates", "import"],
      },
    ],
  },
  {
    id: "activity",
    label: "",
    items: [
      {
        slug: "activity-log",
        label: "Activity Log",
        capability: "admin.activity.read",
        aliases: ["activity", "user-activity", "audit-log", "audit"],
        keywords: ["readable", "technical", "administrator actions", "security", "history"],
      },
    ],
  },
] as const satisfies readonly AdminNavigationGroup[];

export type AdminNavigationDestination = Readonly<{
  group: AdminNavigationGroup;
  item: AdminNavigationItem;
}>;

export function normalizeAdminNavigationKey(value: string | undefined) {
  return decodeURIComponent(value ?? "")
    .trim()
    .toLowerCase()
    .replaceAll("_", "-")
    .replace(/\s+/gu, "-");
}

export function validateAdminNavigation(
  groups: readonly AdminNavigationGroup[] = ADMIN_NAVIGATION_GROUPS,
) {
  const groupIds = new Set<string>();
  const groupLabels = new Set<string>();
  const destinations = new Map<string, string>();

  for (const group of groups) {
    const groupId = normalizeAdminNavigationKey(group.id);
    const groupLabel = group.label.trim().toLowerCase();
    if (groupIds.has(groupId)) throw new Error(`Duplicate admin navigation group id: ${group.id}`);
    if (groupLabel && groupLabels.has(groupLabel)) throw new Error(`Duplicate admin navigation group label: ${group.label}`);
    groupIds.add(groupId);
    if (groupLabel) groupLabels.add(groupLabel);

    for (const item of group.items) {
      const keys = [item.slug, item.label, ...item.aliases].map(normalizeAdminNavigationKey);
      for (const key of keys) {
        const existing = destinations.get(key);
        if (existing && existing !== item.slug) {
          throw new Error(`Duplicate admin navigation destination "${key}": ${existing} and ${item.slug}`);
        }
        destinations.set(key, item.slug);
      }
      const childKeys = new Map<string, string>();
      for (const nested of item.children ?? []) {
        for (const key of [nested.slug, nested.label, ...nested.aliases].map(normalizeAdminNavigationKey)) {
          const existing = childKeys.get(key);
          if (existing && existing !== nested.slug) {
            throw new Error(`Duplicate admin navigation child "${item.slug}/${key}"`);
          }
          childKeys.set(key, nested.slug);
        }
      }
    }
  }
  return true;
}

validateAdminNavigation();

const destinationByKey = new Map<string, AdminNavigationDestination>();
for (const group of ADMIN_NAVIGATION_GROUPS) {
  for (const item of group.items) {
    const destination = { group, item } satisfies AdminNavigationDestination;
    for (const key of [item.slug, item.label, ...item.aliases]) {
      destinationByKey.set(normalizeAdminNavigationKey(key), destination);
    }
  }
}

export function findAdminNavigationDestination(value: string | undefined) {
  return destinationByKey.get(normalizeAdminNavigationKey(value));
}

export function adminNavigationGroupsForCapabilities(
  capabilities: Iterable<string>,
): AdminNavigationGroup[] {
  const granted = new Set(capabilities);
  return ADMIN_NAVIGATION_GROUPS.map((group) => ({
    ...group,
    items: (group.items as readonly AdminNavigationItem[])
      .filter(
        (item) =>
          granted.has(item.capability) ||
          item.alternateCapabilities?.some((capability) =>
            granted.has(capability),
          ),
      )
      .map((item) => ({
        ...item,
        children: item.children?.filter(
          (nested) =>
            !nested.capability || granted.has(nested.capability),
        ),
      })),
  })).filter((group) => group.items.length > 0);
}

export const ADMIN_SECTION_CAPABILITIES: Readonly<Record<string, AdminCapability>> =
  Object.freeze(
    {
      ...Object.fromEntries(
        ADMIN_NAVIGATION_GROUPS.flatMap((group) =>
          group.items.flatMap((item) =>
            [item.slug, ...item.aliases].map((slug) => [slug, item.capability]),
          ),
        ),
      ),
      // Preserve the precise authorization contract of historical bookmarks.
      commerce: "commerce.manage",
      offers: "commerce.manage",
      "upload-center": "uploads.review",
      uploads: "uploads.review",
      "audit-log": "admin.audit.read",
      audit: "admin.audit.read",
    } as Record<string, AdminCapability>,
  );

/** Additional grants retained when historical tools share one canonical page. */
export const ADMIN_SECTION_ALTERNATE_CAPABILITIES: Readonly<
  Record<string, readonly AdminCapability[]>
> = Object.freeze({
  chapters: ["uploads.review"],
  store: ["commerce.manage"],
});

export type AdminCommonAction = Readonly<{
  id: string;
  label: string;
  description: string;
  capability: AdminCapability;
  sectionSlug: string;
  subsectionSlug?: string;
  keywords: readonly string[];
}>;

export const ADMIN_COMMON_ACTIONS = [
  {
    id: "create-series",
    label: "Add a series",
    description: "Create from scratch or import verified metadata.",
    capability: "content.series.manage",
    sectionSlug: "series",
    subsectionSlug: "new",
    keywords: ["new title", "mangadex", "mangaupdates", "catalog"],
  },
  {
    id: "review-series",
    label: "Review series submissions",
    description: "Cross-check and decide community title submissions.",
    capability: "admin.series-requests.review",
    sectionSlug: "series-submissions",
    keywords: ["queue", "duplicate", "request"],
  },
  {
    id: "review-chapters",
    label: "Review chapter uploads",
    description: "Validate queued chapter sources.",
    capability: "uploads.review",
    sectionSlug: "chapter-review",
    keywords: ["publish", "files", "manga"],
  },
  {
    id: "control-teams",
    label: "Manage teams",
    description: "Manage team identity, staff, and title relationships.",
    capability: "content.teams.manage",
    sectionSlug: "team-directory",
    keywords: ["members", "ownership", "staff"],
  },
  {
    id: "appearance-theme",
    label: "Edit public appearance",
    description: "Open branding, theme tokens, palettes, and preview.",
    capability: "appearance.manage",
    sectionSlug: "branding-appearance",
    keywords: ["colors", "branding", "layout"],
  },
  {
    id: "open-activity",
    label: "Open activity log",
    description: "Review readable activity or technical audit events.",
    capability: "admin.activity.read",
    sectionSlug: "activity-log",
    keywords: ["audit", "security", "history", "events"],
  },
] as const satisfies readonly AdminCommonAction[];
