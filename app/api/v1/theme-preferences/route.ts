import { env } from "cloudflare:workers";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { assertSameOrigin, requestIdFor } from "@/lib/server/admin-utils";
import { requireActor } from "@/lib/server/policy";
import {
  activeThemeIdSchema,
  customThemeReference,
  defaultThemePreference,
  isCustomThemeReference,
  MAX_SAVED_CUSTOM_THEMES,
  MAX_SHORTLISTED_THEMES,
  presetThemeIds,
  savedCustomThemeSchema,
  themeDocumentSchema,
  themePreferenceMutationSchema,
  themePreferenceSchema,
  themeShortlistSchema,
  THEME_PREFERENCE_SCHEMA_VERSION,
  type ActiveThemeId,
  type SavedCustomTheme,
  type ThemePreference,
} from "@/lib/theme-system";

export const dynamic = "force-dynamic";

type PreferenceRow = {
  theme: string;
  customThemeJson: string | null;
  themeShortlistJson: string | null;
  preferenceRevision: number;
  updatedAt: string;
};

type CustomThemeRow = {
  id: string;
  themeJson: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

type NormalizedPreference = {
  preference: ThemePreference;
  recoveredFromInvalid: boolean;
  hasExplicitThemePreference: boolean;
  preferenceRevision: number;
  updatedAt: string | null;
};

function database() {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Theme preferences are temporarily unavailable.",
    );
  }
  return env.DB;
}

function parseStoredTheme(value: string) {
  try {
    const parsed = themeDocumentSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function normalizedTimestamp(value: string) {
  const hasZone = /(?:Z|[+-]\d{2}:\d{2})$/iu.test(value);
  const candidate = hasZone ? value : `${value.replace(" ", "T")}Z`;
  return new Date(candidate).toISOString();
}

function normalizeCustomThemes(rows: CustomThemeRow[]) {
  const customThemes: SavedCustomTheme[] = [];
  let recoveredFromInvalid = false;
  for (const row of rows) {
    let parsed: ReturnType<typeof savedCustomThemeSchema.safeParse> | null = null;
    try {
      const theme = parseStoredTheme(row.themeJson);
      parsed = theme
        ? savedCustomThemeSchema.safeParse({
            id: row.id,
            theme,
            revision: row.revision,
            createdAt: normalizedTimestamp(row.createdAt),
            updatedAt: normalizedTimestamp(row.updatedAt),
          })
        : null;
    } catch {
      parsed = null;
    }
    if (!parsed?.success) {
      recoveredFromInvalid = true;
      continue;
    }
    customThemes.push(parsed.data);
  }
  return { customThemes, recoveredFromInvalid };
}

function storedShortlist(
  value: string | null,
  customThemes: SavedCustomTheme[],
) {
  if (!value) {
    return {
      shortlist: [...presetThemeIds] as ActiveThemeId[],
      recoveredFromInvalid: false,
    };
  }
  try {
    const parsed = themeShortlistSchema.safeParse(JSON.parse(value));
    if (!parsed.success) throw parsed.error;
    const owned = new Set(
      customThemes.map((saved) => customThemeReference(saved.id)),
    );
    if (
      parsed.data.some(
        (reference) =>
          isCustomThemeReference(reference) && !owned.has(reference),
      )
    ) {
      throw new Error("The shortlist references a missing custom theme.");
    }
    return { shortlist: parsed.data, recoveredFromInvalid: false };
  } catch {
    return {
      shortlist: [...presetThemeIds] as ActiveThemeId[],
      recoveredFromInvalid: true,
    };
  }
}

function storedActiveTheme(
  value: string,
  customThemes: SavedCustomTheme[],
  shortlist: ActiveThemeId[],
) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "system" || normalized === "dark") return "nya-midnight";
  if (normalized === "light") return "paper-daylight";
  const parsed = activeThemeIdSchema.safeParse(normalized);
  if (parsed.success) {
    if (!isCustomThemeReference(parsed.data)) return parsed.data;
    const owned = customThemes.some(
      (saved) => customThemeReference(saved.id) === parsed.data,
    );
    if (owned) return parsed.data;
  }
  return shortlist[0] ?? "nya-midnight";
}

function normalizeState(
  row: PreferenceRow | null,
  customRows: CustomThemeRow[],
): NormalizedPreference {
  if (!row && customRows.length === 0) {
    return {
      preference: defaultThemePreference,
      recoveredFromInvalid: false,
      hasExplicitThemePreference: false,
      preferenceRevision: 0,
      updatedAt: null,
    };
  }
  const normalizedLibrary = normalizeCustomThemes(customRows);
  if (normalizedLibrary.customThemes.length > MAX_SAVED_CUSTOM_THEMES) {
    throw new ApiError(
      500,
      "CUSTOM_THEME_LIBRARY_INVALID",
      "The saved theme library exceeds its server limit. No themes were changed.",
    );
  }
  const shortlistState = storedShortlist(
    row?.themeShortlistJson ?? null,
    normalizedLibrary.customThemes,
  );
  const rawTheme = row?.theme ?? "SYSTEM";
  const activeThemeId = storedActiveTheme(
    rawTheme,
    normalizedLibrary.customThemes,
    shortlistState.shortlist,
  );
  const shortlist = shortlistState.shortlist.includes(activeThemeId)
    ? shortlistState.shortlist
    : [activeThemeId, ...shortlistState.shortlist].slice(
        0,
        MAX_SHORTLISTED_THEMES,
      );
  const normalizedRawTheme = rawTheme.trim().toLowerCase();
  const parsedRawTheme = activeThemeIdSchema.safeParse(normalizedRawTheme);
  const recoveredActive =
    !["system", "dark", "light"].includes(normalizedRawTheme) &&
    (!parsedRawTheme.success || parsedRawTheme.data !== activeThemeId);
  const hasExplicitThemePreference = Boolean(
    row &&
      (
        parsedRawTheme.success ||
        normalizedRawTheme === "dark" ||
        normalizedRawTheme === "light" ||
        row.customThemeJson ||
        row.themeShortlistJson ||
        customRows.length
      ),
  );
  return {
    preference: themePreferenceSchema.parse({
      schemaVersion: THEME_PREFERENCE_SCHEMA_VERSION,
      activeThemeId,
      shortlist,
      customThemes: normalizedLibrary.customThemes,
    }),
    recoveredFromInvalid:
      normalizedLibrary.recoveredFromInvalid ||
      shortlistState.recoveredFromInvalid ||
      shortlist !== shortlistState.shortlist ||
      recoveredActive,
    hasExplicitThemePreference,
    preferenceRevision: row?.preferenceRevision ?? 0,
    updatedAt: row?.updatedAt ?? null,
  };
}

function rowStatement(db: D1Database, userId: string) {
  return db
    .prepare(
      `SELECT theme,
              custom_theme_json AS customThemeJson,
              theme_shortlist_json AS themeShortlistJson,
              theme_preference_revision AS preferenceRevision,
              updated_at AS updatedAt
         FROM user_preferences
        WHERE user_id = ?
        LIMIT 1`,
    )
    .bind(userId);
}

function customRowsStatement(db: D1Database, userId: string) {
  return db
    .prepare(
      `SELECT id,
              theme_json AS themeJson,
              revision,
              created_at AS createdAt,
              updated_at AS updatedAt
         FROM user_custom_themes
        WHERE user_id = ?
        ORDER BY updated_at DESC, created_at ASC, id ASC`,
    )
    .bind(userId);
}

async function stateForUser(db: D1Database, userId: string) {
  const [rowResult, customRowsResult] = await db.batch([
    rowStatement(db, userId),
    customRowsStatement(db, userId),
  ]);
  return normalizeState(
    (rowResult.results[0] as PreferenceRow | undefined) ?? null,
    customRowsResult.results as CustomThemeRow[],
  );
}

function preferenceCasStatement(
  db: D1Database,
  userId: string,
  activeThemeId: ActiveThemeId,
  shortlist: ActiveThemeId[],
  expectedRevision: number,
  mutationMarker: string,
  customGuard?: { themeId: string; mutationMarker: string },
) {
  const guardSql = customGuard
    ? `AND EXISTS (
         SELECT 1 FROM user_custom_themes
         WHERE user_id = ? AND id = ? AND mutation_marker = ?
       )`
    : "";
  const bindings: unknown[] = [
    userId,
    activeThemeId,
    JSON.stringify(shortlist),
    mutationMarker,
    expectedRevision,
    userId,
    userId,
    expectedRevision,
  ];
  if (customGuard) {
    bindings.push(userId, customGuard.themeId, customGuard.mutationMarker);
  }
  bindings.push(expectedRevision);
  if (customGuard) {
    bindings.push(userId, customGuard.themeId, customGuard.mutationMarker);
  }
  return db
    .prepare(
      `INSERT INTO user_preferences
       (user_id, theme, content_language, reader_mode, mature_content,
        settings_json, custom_theme_json, theme_shortlist_json,
        theme_preference_revision, theme_mutation_marker, updated_at)
       SELECT ?, ?, 'en', 'VERTICAL', 0, '{}', NULL, ?, 1, ?, CURRENT_TIMESTAMP
       WHERE (
         (? = 0 AND NOT EXISTS (
           SELECT 1 FROM user_preferences WHERE user_id = ?
         ))
         OR EXISTS (
           SELECT 1 FROM user_preferences
           WHERE user_id = ? AND theme_preference_revision = ?
         )
       )
       ${guardSql}
       ON CONFLICT(user_id) DO UPDATE SET
         theme = excluded.theme,
         theme_shortlist_json = excluded.theme_shortlist_json,
         theme_preference_revision = user_preferences.theme_preference_revision + 1,
         theme_mutation_marker = excluded.theme_mutation_marker,
         updated_at = CURRENT_TIMESTAMP
         WHERE user_preferences.theme_preference_revision = ?
         ${guardSql}`,
    )
    .bind(...bindings);
}

async function assertOwnedCustomReference(
  db: D1Database,
  userId: string,
  reference: ActiveThemeId,
  excludingThemeId?: string,
) {
  if (!isCustomThemeReference(reference)) return;
  const themeId = reference.slice("custom:".length);
  if (themeId === excludingThemeId) {
    throw new ApiError(
      409,
      "CUSTOM_THEME_FALLBACK_INVALID",
      "Choose a different theme before deleting the active theme.",
    );
  }
  const row = await db
    .prepare(
      `SELECT 1 AS owned
         FROM user_custom_themes
        WHERE user_id = ? AND id = ?
        LIMIT 1`,
    )
    .bind(userId, themeId)
    .first<{ owned: number }>();
  if (!row) {
    throw new ApiError(
      404,
      "CUSTOM_THEME_MISSING",
      "That saved custom theme no longer exists.",
    );
  }
}

async function assertOwnedShortlist(
  db: D1Database,
  userId: string,
  shortlist: ActiveThemeId[],
) {
  for (const reference of shortlist) {
    await assertOwnedCustomReference(db, userId, reference);
  }
}

function responseData(normalized: NormalizedPreference) {
  return {
    ...normalized.preference,
    preferenceRevision: normalized.preferenceRevision,
    exists: normalized.updatedAt !== null,
    hasExplicitThemePreference: normalized.hasExplicitThemePreference,
    recoveredFromInvalid: normalized.recoveredFromInvalid,
    updatedAt: normalized.updatedAt,
  };
}

function isThemeLimitError(error: unknown) {
  return String(error).includes("CUSTOM_THEME_LIMIT_REACHED");
}

function preferenceConflict() {
  return new ApiError(
    409,
    "THEME_PREFERENCE_REVISION_CONFLICT",
    "Your theme settings changed on another device. Reload them before saving.",
  );
}

const privateHeaders = {
  "cache-control": "private, no-store",
  vary: "cookie",
};

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    return json(
      requestId,
      { data: responseData(await stateForUser(database(), actor.id)) },
      { headers: privateHeaders },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function PATCH(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "INVALID_JSON", "The theme request is not valid JSON.");
    }
    const mutation = themePreferenceMutationSchema.parse(body);
    const db = database();
    const current = await stateForUser(db, actor.id);
    if (
      mutation.action !== "reconcile" &&
      mutation.expectedPreferenceRevision !== current.preferenceRevision
    ) {
      throw preferenceConflict();
    }

    if (mutation.action === "select") {
      await assertOwnedCustomReference(db, actor.id, mutation.activeThemeId);
      await assertOwnedShortlist(db, actor.id, mutation.shortlist);
      if (!mutation.shortlist.includes(mutation.activeThemeId)) {
        throw new ApiError(
          400,
          "ACTIVE_THEME_NOT_SHORTLISTED",
          "The active theme must remain in the quick-switch shortlist.",
        );
      }
      const savedPreference = await preferenceCasStatement(
        db,
        actor.id,
        mutation.activeThemeId,
        mutation.shortlist,
        mutation.expectedPreferenceRevision,
        `theme-select:${requestId}`,
      ).run();
      if (!savedPreference.meta.changes) throw preferenceConflict();
    } else if (mutation.action === "create-custom") {
      if (current.preference.customThemes.length >= MAX_SAVED_CUSTOM_THEMES) {
        throw new ApiError(
          409,
          "CUSTOM_THEME_LIMIT_REACHED",
          "Delete a saved theme to create a new one.",
        );
      }
      const reference = customThemeReference(mutation.themeId);
      const nextActiveThemeId = mutation.activate
        ? reference
        : current.preference.activeThemeId;
      if (!mutation.shortlist.includes(nextActiveThemeId)) {
        throw new ApiError(
          400,
          "ACTIVE_THEME_NOT_SHORTLISTED",
          "The active theme must remain in the quick-switch shortlist.",
        );
      }
      await assertOwnedShortlist(
        db,
        actor.id,
        mutation.shortlist.filter((entry) => entry !== reference),
      );
      const mutationMarker = `theme-create:${requestId}`;
      const statements = [
        db
          .prepare(
            `INSERT INTO user_custom_themes
             (user_id, id, theme_json, revision, mutation_marker,
              created_at, updated_at)
             SELECT ?, ?, ?, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
             WHERE (
               (? = 0 AND NOT EXISTS (
                 SELECT 1 FROM user_preferences WHERE user_id = ?
               ))
               OR EXISTS (
                 SELECT 1 FROM user_preferences
                 WHERE user_id = ? AND theme_preference_revision = ?
               )
             )`,
          )
          .bind(
            actor.id,
            mutation.themeId,
            JSON.stringify(mutation.customTheme),
            mutationMarker,
            mutation.expectedPreferenceRevision,
            actor.id,
            actor.id,
            mutation.expectedPreferenceRevision,
          ),
        preferenceCasStatement(
          db,
          actor.id,
          nextActiveThemeId,
          mutation.shortlist,
          mutation.expectedPreferenceRevision,
          mutationMarker,
          { themeId: mutation.themeId, mutationMarker },
        ),
      ];
      try {
        const [created, savedPreference] = await db.batch(statements);
        if (!created.meta.changes || !savedPreference.meta.changes) {
          throw preferenceConflict();
        }
      } catch (error) {
        if (isThemeLimitError(error)) {
          throw new ApiError(
            409,
            "CUSTOM_THEME_LIMIT_REACHED",
            "Delete a saved theme to create a new one.",
          );
        }
        throw error;
      }
    } else if (mutation.action === "update-custom") {
      const reference = customThemeReference(mutation.themeId);
      const mutationMarker = `theme-update:${requestId}`;
      const nextActiveThemeId = mutation.activate
        ? reference
        : current.preference.activeThemeId;
      if (!mutation.shortlist.includes(nextActiveThemeId)) {
        throw new ApiError(
          400,
          "ACTIVE_THEME_NOT_SHORTLISTED",
          "The active theme must remain in the quick-switch shortlist.",
        );
      }
      await assertOwnedShortlist(db, actor.id, mutation.shortlist);
      const statements = [
        db
          .prepare(
            `UPDATE user_custom_themes
                SET theme_json = ?,
                    revision = revision + 1,
                    mutation_marker = ?,
                    updated_at = CURRENT_TIMESTAMP
              WHERE user_id = ? AND id = ? AND revision = ?
                AND (
                  (? = 0 AND NOT EXISTS (
                    SELECT 1 FROM user_preferences WHERE user_id = ?
                  ))
                  OR EXISTS (
                    SELECT 1 FROM user_preferences
                    WHERE user_id = ? AND theme_preference_revision = ?
                  )
                )`,
          )
          .bind(
            JSON.stringify(mutation.customTheme),
            mutationMarker,
            actor.id,
            mutation.themeId,
            mutation.expectedRevision,
            mutation.expectedPreferenceRevision,
            actor.id,
            actor.id,
            mutation.expectedPreferenceRevision,
          ),
        preferenceCasStatement(
          db,
          actor.id,
          nextActiveThemeId,
          mutation.shortlist,
          mutation.expectedPreferenceRevision,
          mutationMarker,
          { themeId: mutation.themeId, mutationMarker },
        ),
      ];
      const [updated, savedPreference] = await db.batch(statements);
      if (!updated.meta.changes || !savedPreference.meta.changes) {
        const exists = await db
          .prepare(
            `SELECT 1 AS owned FROM user_custom_themes
              WHERE user_id = ? AND id = ? LIMIT 1`,
          )
          .bind(actor.id, mutation.themeId)
          .first<{ owned: number }>();
        throw new ApiError(
          409,
          exists ? "CUSTOM_THEME_OR_PREFERENCE_REVISION_CONFLICT" : "CUSTOM_THEME_MISSING",
          exists
            ? "This theme changed on another device. Load it again before saving."
            : "That saved custom theme no longer exists.",
        );
      }
    } else if (mutation.action === "delete-custom") {
      await assertOwnedCustomReference(
        db,
        actor.id,
        mutation.fallbackThemeId,
        mutation.themeId,
      );
      const reference = customThemeReference(mutation.themeId);
      const shortlist = current.preference.shortlist.filter(
        (entry) => entry !== reference,
      );
      if (shortlist.length === 0) shortlist.push("nya-midnight");
      if (
        current.preference.activeThemeId === reference &&
        !shortlist.includes(mutation.fallbackThemeId)
      ) {
        throw new ApiError(
          400,
          "CUSTOM_THEME_FALLBACK_NOT_SHORTLISTED",
          "The replacement active theme must remain in the quick-switch shortlist.",
        );
      }
      const activeThemeId = current.preference.activeThemeId === reference
        ? mutation.fallbackThemeId
        : current.preference.activeThemeId;
      const mutationMarker = `theme-delete:${requestId}`;
      const [marked, savedPreference, deleted] = await db.batch([
        db
          .prepare(
            `UPDATE user_custom_themes
                SET mutation_marker = ?
              WHERE user_id = ? AND id = ? AND revision = ?
                AND (
                  (? = 0 AND NOT EXISTS (
                    SELECT 1 FROM user_preferences WHERE user_id = ?
                  ))
                  OR EXISTS (
                    SELECT 1 FROM user_preferences
                    WHERE user_id = ? AND theme_preference_revision = ?
                  )
                )`,
          )
          .bind(
            mutationMarker,
            actor.id,
            mutation.themeId,
            mutation.expectedRevision,
            mutation.expectedPreferenceRevision,
            actor.id,
            actor.id,
            mutation.expectedPreferenceRevision,
          ),
        preferenceCasStatement(
          db,
          actor.id,
          activeThemeId,
          shortlist,
          mutation.expectedPreferenceRevision,
          mutationMarker,
          { themeId: mutation.themeId, mutationMarker },
        ),
        db
          .prepare(
            `DELETE FROM user_custom_themes
              WHERE user_id = ? AND id = ? AND revision = ?
                AND mutation_marker = ?`,
          )
          .bind(
            actor.id,
            mutation.themeId,
            mutation.expectedRevision,
            mutationMarker,
          ),
      ]);
      if (
        !marked.meta.changes ||
        !savedPreference.meta.changes ||
        !deleted.meta.changes
      ) {
        throw new ApiError(
          409,
          "CUSTOM_THEME_REVISION_CONFLICT",
          "This theme changed on another device. Reload before deleting it.",
        );
      }
    } else if (mutation.action === "set-shortlist") {
      await assertOwnedShortlist(db, actor.id, mutation.shortlist);
      if (!mutation.shortlist.includes(current.preference.activeThemeId)) {
        throw new ApiError(
          400,
          "ACTIVE_THEME_NOT_SHORTLISTED",
          "The active theme must remain in the quick-switch shortlist.",
        );
      }
      const savedPreference = await preferenceCasStatement(
        db,
        actor.id,
        current.preference.activeThemeId,
        mutation.shortlist,
        mutation.expectedPreferenceRevision,
        `theme-shortlist:${requestId}`,
      ).run();
      if (!savedPreference.meta.changes) throw preferenceConflict();
    } else if (!current.hasExplicitThemePreference) {
      const marker = `reconcile:${requestId}`;
      const statements = [
        db
          .prepare(
            `INSERT INTO user_preferences
             (user_id, theme, content_language, reader_mode, mature_content,
              settings_json, custom_theme_json, theme_shortlist_json,
              theme_preference_revision, theme_mutation_marker, updated_at)
             VALUES (?, ?, 'en', 'VERTICAL', 0, '{}', NULL, NULL, 0, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(user_id) DO UPDATE SET
               theme = excluded.theme,
               theme_mutation_marker = excluded.theme_mutation_marker,
               updated_at = CURRENT_TIMESTAMP
             WHERE lower(trim(user_preferences.theme)) IN ('system', '')
               AND user_preferences.custom_theme_json IS NULL
               AND user_preferences.theme_shortlist_json IS NULL
               AND NOT EXISTS (
                 SELECT 1 FROM user_custom_themes
                 WHERE user_id = excluded.user_id
               )`,
          )
          .bind(actor.id, marker, marker),
      ];
      for (const saved of mutation.preference.customThemes) {
        statements.push(
          db
            .prepare(
              `INSERT INTO user_custom_themes
               (user_id, id, theme_json, revision, created_at, updated_at)
               SELECT ?, ?, ?, ?, ?, ?
               WHERE EXISTS (
                 SELECT 1 FROM user_preferences
                 WHERE user_id = ? AND theme = ?
               )`,
            )
            .bind(
              actor.id,
              saved.id,
              JSON.stringify(saved.theme),
              saved.revision,
              saved.createdAt,
              saved.updatedAt,
              actor.id,
              marker,
            ),
        );
      }
      statements.push(
        db
          .prepare(
            `UPDATE user_preferences
                SET theme = ?,
                    theme_shortlist_json = ?,
                    theme_preference_revision = theme_preference_revision + 1,
                    theme_mutation_marker = ?,
                    updated_at = CURRENT_TIMESTAMP
              WHERE user_id = ? AND theme = ? AND theme_mutation_marker = ?`,
          )
          .bind(
            mutation.preference.activeThemeId,
            JSON.stringify(mutation.preference.shortlist),
            marker,
            actor.id,
            marker,
            marker,
          ),
      );
      try {
        await db.batch(statements);
      } catch (error) {
        if (isThemeLimitError(error)) {
          throw new ApiError(
            409,
            "CUSTOM_THEME_LIMIT_REACHED",
            "Delete a saved theme to create a new one.",
          );
        }
        throw error;
      }
    }

    const normalized = await stateForUser(db, actor.id);
    return json(
      requestId,
      {
        data: {
          ...responseData(normalized),
          saved: true,
          recoveredFromInvalid: false,
          hasExplicitThemePreference: true,
        },
      },
      { headers: privateHeaders },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
