import {
  defaultThemeCatalogPolicy,
  effectiveThemeCatalogPolicy,
  publicThemeCatalogFromEntries,
  parseThemeCatalogPolicy,
  type AdminThemeCatalog,
  type PublicThemeCatalog,
  type ThemeCatalogEntry,
  type ThemeCatalogPolicy,
} from "@/lib/theme-catalog";
import {
  presetTheme,
  presetThemeIds,
  themeDocumentSchema,
  type ActiveThemeId,
} from "@/lib/theme-system";
import { env } from "cloudflare:workers";
import { ApiError } from "@/lib/server/api";
import { grantCurrencyReward } from "@/lib/server/economy";
import { randomId } from "@/lib/server/random-id";

type CatalogSettingsRow = {
  settingsJson: string;
  revision: number;
  updatedAt: string;
};

type UserThemeRow = {
  userId: string;
  id: string;
  themeJson: string;
  displayName: string;
  primaryRole: string;
};

function database() {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Theme catalog storage is unavailable.",
    );
  }
  return env.DB;
}

function fallbackEntries(): ThemeCatalogEntry[] {
  return presetThemeIds.map((id) => ({
    id,
    theme: presetTheme(id),
    source: "PRESET",
    creatorDisplayName: null,
    creatorUserId: undefined,
    creatorRole: undefined,
    creatorIsAdministrator: false,
  }));
}

function parseUserTheme(row: UserThemeRow): ThemeCatalogEntry | null {
  let parsed: ReturnType<typeof themeDocumentSchema.safeParse>;
  try {
    parsed = themeDocumentSchema.safeParse(JSON.parse(row.themeJson));
  } catch {
    return null;
  }
  if (!parsed.success) return null;
  return {
    id: `custom:${row.id}` as ActiveThemeId,
    theme: parsed.data,
    source: "USER",
    creatorDisplayName: row.displayName,
    creatorUserId: row.userId,
    creatorRole: row.primaryRole,
    creatorIsAdministrator: ["OWNER", "ADMINISTRATOR"].includes(
      row.primaryRole.toUpperCase(),
    ),
  };
}

async function entriesFromDatabase() {
  const rows = await database()
    .prepare(
      `SELECT t.user_id AS userId,
              t.id,
              t.theme_json AS themeJson,
              u.display_name AS displayName,
              u.primary_role AS primaryRole
         FROM user_custom_themes t
         JOIN users u ON u.id = t.user_id
        ORDER BY datetime(t.updated_at) DESC, t.id ASC`,
    )
    .all<UserThemeRow>();
  const userEntries = rows.results
    .map((row): ThemeCatalogEntry | null => parseUserTheme(row))
    .filter((entry): entry is ThemeCatalogEntry => Boolean(entry));
  return [...fallbackEntries(), ...userEntries];
}

async function settingsRow() {
  return database()
    .prepare(
      `SELECT settings_json AS settingsJson,
              revision,
              updated_at AS updatedAt
         FROM theme_catalog_settings
        WHERE id = 'active'
        LIMIT 1`,
    )
    .first<CatalogSettingsRow>();
}

function catalogFrom(
  policyInput: unknown,
  entries: ThemeCatalogEntry[],
  revision: number,
  updatedAt: string | null,
): AdminThemeCatalog {
  const ids = new Set(entries.map((entry) => entry.id));
  const policy = effectiveThemeCatalogPolicy(
    parseThemeCatalogPolicy(policyInput),
    ids,
  );
  const publicCatalog = publicThemeCatalogFromEntries(
    policy,
    entries,
    revision,
    updatedAt,
  );
  return {
    ...publicCatalog,
    policy,
    themes: entries,
  };
}

export async function getThemeCatalogDocument(): Promise<AdminThemeCatalog> {
  const [row, entries] = await Promise.all([settingsRow(), entriesFromDatabase()]);
  let storedPolicy: unknown = defaultThemeCatalogPolicy;
  if (row?.settingsJson) {
    try {
      storedPolicy = JSON.parse(row.settingsJson) as unknown;
    } catch {
      storedPolicy = defaultThemeCatalogPolicy;
    }
  }
  return catalogFrom(
    storedPolicy,
    entries,
    Number(row?.revision ?? 0),
    row?.updatedAt ?? null,
  );
}

export async function getPublicThemeCatalog(): Promise<PublicThemeCatalog> {
  if (!env.DB) {
    return publicThemeCatalogFromEntries(
      defaultThemeCatalogPolicy,
      fallbackEntries(),
      0,
      null,
    );
  }
  try {
    const document = await getThemeCatalogDocument();
    return {
      policy: document.policy,
      suggestedThemes: document.suggestedThemes,
      revision: document.revision,
      updatedAt: document.updatedAt,
    };
  } catch {
    return publicThemeCatalogFromEntries(
      defaultThemeCatalogPolicy,
      fallbackEntries(),
      0,
      null,
    );
  }
}

function ensurePolicyReferences(
  policy: ThemeCatalogPolicy,
  entries: ThemeCatalogEntry[],
) {
  const available = new Set(entries.map((entry) => entry.id));
  const missing = [...policy.suggestedThemeIds, policy.defaultThemeId].filter(
    (id) => !available.has(id),
  );
  if (missing.length) {
    throw new ApiError(
      422,
      "THEME_CATALOG_REFERENCE_INVALID",
      "Choose only themes that are still available in the theme catalog.",
    );
  }
}

export async function saveThemeCatalog(
  input: ThemeCatalogPolicy,
  actorUserId: string,
  requestId: string,
  expectedRevision: number,
) {
  const current = await getThemeCatalogDocument();
  if (Number(expectedRevision) !== current.revision) {
    throw new ApiError(
      409,
      "STALE_VERSION",
      "Another administrator changed the theme catalog. Reload before publishing.",
    );
  }
  const normalized = parseThemeCatalogPolicy(input);
  ensurePolicyReferences(normalized, current.themes);
  if (!normalized.suggestedThemeIds.includes(normalized.defaultThemeId)) {
    throw new ApiError(
      422,
      "THEME_DEFAULT_NOT_SUGGESTED",
      "The default-new-user theme must be one of the five suggested themes.",
    );
  }

  const db = database();
  const mutation = expectedRevision === 0
    ? db
        .prepare(
          `INSERT INTO theme_catalog_settings
           (id, schema_version, settings_json, revision, updated_by_user_id)
           VALUES ('active', 1, ?, 1, ?)
           ON CONFLICT(id) DO NOTHING`,
        )
        .bind(JSON.stringify(normalized), actorUserId)
    : db
        .prepare(
          `UPDATE theme_catalog_settings
              SET settings_json = ?,
                  revision = revision + 1,
                  updated_by_user_id = ?,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = 'active' AND revision = ?`,
        )
        .bind(JSON.stringify(normalized), actorUserId, expectedRevision);
  const results = await db.batch([
    mutation,
    db
      .prepare(
        `INSERT INTO audit_logs
         (id, actor_user_id, actor_role, action, category, source_area,
          target_type, target_id, target_label, request_id,
          old_value_json, new_value_json)
         SELECT ?, ?, (SELECT primary_role FROM users WHERE id = ?),
                'theme.catalog.update', 'APPEARANCE_SETTINGS', 'APPEARANCE',
                'THEME_CATALOG', 'active', 'Theme catalog', ?, ?, ?
         WHERE changes() = 1`,
      )
      .bind(
        randomId(),
        actorUserId,
        actorUserId,
        requestId,
        JSON.stringify(current.policy),
        JSON.stringify(normalized),
      ),
  ]);
  if (!results[0]?.meta.changes) {
    throw new ApiError(
      409,
      "STALE_VERSION",
      "Another administrator changed the theme catalog. Reload before publishing.",
    );
  }

  const newlyPromotedUserThemes = normalized.suggestedThemeIds
    .filter((id) => !current.policy.suggestedThemeIds.includes(id))
    .map((id) => current.themes.find((entry) => entry.id === id))
    .filter(
      (entry): entry is ThemeCatalogEntry =>
        Boolean(entry?.source === "USER" && entry.creatorUserId && !entry.creatorIsAdministrator),
    );
  for (const entry of newlyPromotedUserThemes) {
    const isDefault = normalized.defaultThemeId === entry.id;
    const reward = await grantCurrencyReward(db, {
      userId: entry.creatorUserId!,
      currency: "ONYX",
      amount: 100,
      kind: "THEME_CATALOG_REWARD",
      referenceType: "THEME_CATALOG",
      referenceId: entry.id,
      idempotencyKey: `theme-catalog-reward:${entry.creatorUserId}:${entry.id}`,
      memo: `Theme catalog reward · ${entry.theme.name}`,
    });
    if (!reward.transactionId) continue;
    const claim = await db
      .prepare(
        `INSERT OR IGNORE INTO theme_catalog_reward_claims
         (creator_user_id, theme_reference, transaction_id, selected_by_user_id)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(entry.creatorUserId, entry.id, reward.transactionId, actorUserId)
      .run();
    if (!claim.meta.changes) continue;
    await db
      .prepare(
        `INSERT INTO notifications
         (id, user_id, kind, title, body, dedupe_key, action_url, metadata_json)
         VALUES (?, ?, 'THEME_CATALOG_REWARD', 'Your theme was selected', ?, ?, ?, ?)`,
      )
      .bind(
        randomId(),
        entry.creatorUserId,
        `“${entry.theme.name}” was selected by an administrator for NyaScans’ active five${isDefault ? " and as the default for new users" : ""}. You received 100 Paw Coins as a creator reward.`,
        `theme-catalog-reward:${entry.creatorUserId}:${entry.id}`,
        "/theme-builder#manage-themes",
        JSON.stringify({
          themeId: entry.id,
          themeName: entry.theme.name,
          amount: 100,
          currency: "ONYX",
          isDefault,
          rewardCreated: reward.created,
        }),
      )
      .run();
  }

  return getThemeCatalogDocument();
}
