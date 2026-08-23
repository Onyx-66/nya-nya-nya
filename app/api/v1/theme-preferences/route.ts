import { env } from "cloudflare:workers";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { assertSameOrigin, requestIdFor } from "@/lib/server/admin-utils";
import { requireActor } from "@/lib/server/policy";
import {
  activeThemeIdSchema,
  defaultThemePreference,
  themeDocumentSchema,
  themePreferenceMutationSchema,
  themePreferenceSchema,
  type ThemeDocument,
  type ThemePreference,
} from "@/lib/theme-system";

export const dynamic = "force-dynamic";

type PreferenceRow = {
  theme: string;
  customThemeJson: string | null;
  settingsJson: string;
  updatedAt: string;
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

function parseStoredTheme(value: string | null | undefined) {
  if (!value) return null;
  try {
    const parsed = themeDocumentSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function storedCustomTheme(row: PreferenceRow) {
  const dedicated = parseStoredTheme(row.customThemeJson);
  if (dedicated) return dedicated;
  try {
    const settings = JSON.parse(row.settingsJson) as {
      themeBuilder?: { customTheme?: unknown };
    };
    const parsed = themeDocumentSchema.safeParse(
      settings.themeBuilder?.customTheme,
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function storedActiveTheme(value: string, customTheme: ThemeDocument | null) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "system" || normalized === "dark") return "nya-midnight";
  if (normalized === "light") return "paper-daylight";
  const parsed = activeThemeIdSchema.safeParse(normalized);
  if (!parsed.success) return "nya-midnight";
  if (parsed.data === "custom" && !customTheme) return "nya-midnight";
  return parsed.data;
}

function normalizeRow(row: PreferenceRow | null): {
  preference: ThemePreference;
  recoveredFromInvalid: boolean;
  hasExplicitThemePreference: boolean;
  updatedAt: string | null;
} {
  if (!row) {
    return {
      preference: defaultThemePreference,
      recoveredFromInvalid: false,
      hasExplicitThemePreference: false,
      updatedAt: null,
    };
  }
  const normalizedRawTheme = row.theme.trim().toLowerCase();
  const customTheme = storedCustomTheme(row);
  const activeThemeId = storedActiveTheme(row.theme, customTheme);
  const recoveredFromInvalid =
    normalizedRawTheme === "custom" && !customTheme;
  const hasExplicitThemePreference =
    activeThemeIdSchema.safeParse(normalizedRawTheme).success ||
    normalizedRawTheme === "dark" ||
    normalizedRawTheme === "light" ||
    Boolean(customTheme);
  return {
    preference: themePreferenceSchema.parse({
      schemaVersion: 1,
      activeThemeId,
      customTheme,
    }),
    recoveredFromInvalid,
    hasExplicitThemePreference,
    updatedAt: row.updatedAt,
  };
}

async function rowForUser(db: D1Database, userId: string) {
  return db
    .prepare(
      `SELECT theme,
              custom_theme_json AS customThemeJson,
              settings_json AS settingsJson,
              updated_at AS updatedAt
         FROM user_preferences
        WHERE user_id = ?
        LIMIT 1`,
    )
    .bind(userId)
    .first<PreferenceRow>();
}

const privateHeaders = {
  "cache-control": "private, no-store",
  vary: "cookie",
};

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    const normalized = normalizeRow(await rowForUser(database(), actor.id));
    return json(
      requestId,
      {
        data: {
          ...normalized.preference,
          exists: normalized.updatedAt !== null,
          hasExplicitThemePreference:
            normalized.hasExplicitThemePreference,
          recoveredFromInvalid: normalized.recoveredFromInvalid,
          updatedAt: normalized.updatedAt,
        },
      },
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
    if (mutation.action === "select") {
      if (mutation.activeThemeId === "custom") {
        const current = await rowForUser(db, actor.id);
        if (!current || !storedCustomTheme(current)) {
          throw new ApiError(
            409,
            "CUSTOM_THEME_MISSING",
            "Build or import a complete custom theme before selecting Custom.",
          );
        }
      }
      await db
        .prepare(
          `INSERT INTO user_preferences
           (user_id, theme, content_language, reader_mode, mature_content,
            settings_json, custom_theme_json, updated_at)
           VALUES (?, ?, 'en', 'VERTICAL', 0, '{}', NULL, CURRENT_TIMESTAMP)
           ON CONFLICT(user_id) DO UPDATE SET
             theme = excluded.theme,
             updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(actor.id, mutation.activeThemeId)
        .run();
    } else if (mutation.action === "save-custom") {
      await db
        .prepare(
          `INSERT INTO user_preferences
           (user_id, theme, content_language, reader_mode, mature_content,
            settings_json, custom_theme_json, updated_at)
           VALUES (?, ?, 'en', 'VERTICAL', 0, '{}', ?, CURRENT_TIMESTAMP)
           ON CONFLICT(user_id) DO UPDATE SET
             custom_theme_json = excluded.custom_theme_json,
             theme = CASE
               WHEN ? = 1 THEN 'custom'
               ELSE user_preferences.theme
             END,
             updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(
          actor.id,
          mutation.activate ? "custom" : "SYSTEM",
          JSON.stringify(mutation.customTheme),
          mutation.activate ? 1 : 0,
        )
        .run();
    } else {
      await db
        .prepare(
          `INSERT INTO user_preferences
           (user_id, theme, content_language, reader_mode, mature_content,
            settings_json, custom_theme_json, updated_at)
           VALUES (?, ?, 'en', 'VERTICAL', 0, '{}', ?, CURRENT_TIMESTAMP)
           ON CONFLICT(user_id) DO UPDATE SET
             theme = excluded.theme,
             custom_theme_json = excluded.custom_theme_json,
             updated_at = CURRENT_TIMESTAMP
           WHERE LOWER(TRIM(user_preferences.theme)) NOT IN (
             'nya-midnight', 'paper-daylight', 'slate-rain',
             'dracula-bloom', 'jade-night', 'custom', 'dark', 'light'
           )
             AND user_preferences.custom_theme_json IS NULL`,
        )
        .bind(
          actor.id,
          mutation.activeThemeId,
          mutation.customTheme ? JSON.stringify(mutation.customTheme) : null,
        )
        .run();
    }
    const normalized = normalizeRow(await rowForUser(db, actor.id));
    return json(
      requestId,
      {
        data: {
          ...normalized.preference,
          saved: true,
          recoveredFromInvalid: false,
          hasExplicitThemePreference: true,
          updatedAt: normalized.updatedAt,
        },
      },
      { headers: privateHeaders },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
