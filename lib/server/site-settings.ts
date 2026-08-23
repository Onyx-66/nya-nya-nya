import { env } from "cloudflare:workers";
import {
  defaultSiteTheme,
  parseSiteTheme,
  type SiteTheme,
} from "@/lib/site-theme";
import { ApiError } from "@/lib/server/api";
import { randomId } from "@/lib/server/random-id";

export type SiteThemeDocument = {
  settings: SiteTheme;
  revision: number;
  updatedAt: string | null;
  recoveredFromInvalid?: boolean;
};

const legacyDefaultDark = {
  background: "#07111f",
  backgroundSoft: "#0a1728",
  surface: "#0d1d31",
  surfaceRaised: "#12263f",
  surfaceStrong: "#18314f",
  text: "#f4f9fd",
  textSoft: "#bfd1df",
  muted: "#829db1",
  line: "#244563",
  lineStrong: "#376789",
} as const;

function migrateLegacyDefaultTheme(theme: SiteTheme): SiteTheme {
  const isLegacyDark = Object.entries(legacyDefaultDark).every(
    ([key, value]) => theme.dark[key as keyof typeof legacyDefaultDark] === value,
  );
  return isLegacyDark ? { ...theme, dark: { ...defaultSiteTheme.dark } } : theme;
}

export async function getSiteThemeDocument(): Promise<SiteThemeDocument> {
  if (!env.DB) {
    return { settings: defaultSiteTheme, revision: 0, updatedAt: null };
  }
  let row:
    | {
        settings_json: string;
        revision: number;
        updated_at: string;
      }
    | null;
  try {
    row = await env.DB.prepare(
      `SELECT settings_json, revision, updated_at
       FROM site_theme_settings WHERE id = 'active' LIMIT 1`,
    ).first<{
      settings_json: string;
      revision: number;
      updated_at: string;
    }>();
  } catch {
    throw new ApiError(
      503,
      "APPEARANCE_SETTINGS_UNAVAILABLE",
      "Saved appearance settings could not be loaded safely.",
    );
  }
  if (!row) {
    return { settings: defaultSiteTheme, revision: 0, updatedAt: null };
  }
  try {
    return {
      settings: migrateLegacyDefaultTheme(parseSiteTheme(JSON.parse(row.settings_json))),
      revision: Number(row.revision),
      updatedAt: row.updated_at,
    };
  } catch {
    return {
      settings: defaultSiteTheme,
      revision: Number(row.revision),
      updatedAt: row.updated_at,
      recoveredFromInvalid: true,
    };
  }
}

export async function getSiteTheme(): Promise<SiteTheme> {
  try {
    return (await getSiteThemeDocument()).settings;
  } catch {
    // Appearance storage must never take the public reader offline. The
    // protected administrator document endpoint still surfaces the database
    // failure, while public rendering safely falls back to the validated
    // built-in theme.
    return defaultSiteTheme;
  }
}

export async function saveSiteTheme(
  settings: SiteTheme,
  actorUserId: string,
  requestId: string,
  expectedRevision: number,
): Promise<SiteThemeDocument> {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Appearance settings storage is unavailable.",
    );
  }
  const current = await getSiteThemeDocument();
  if (Number(expectedRevision) !== current.revision) {
    throw new ApiError(
      409,
      "STALE_VERSION",
      "Another administrator changed the appearance settings. Reload before publishing.",
    );
  }
  const nextRevision = expectedRevision + 1;
  const normalized = parseSiteTheme(settings);
  const mutation =
    expectedRevision === 0
      ? env.DB.prepare(
          `INSERT INTO site_theme_settings
           (id, schema_version, settings_json, revision, updated_by_user_id)
           VALUES ('active', 1, ?, 1, ?)
           ON CONFLICT(id) DO NOTHING`,
        )
          .bind(JSON.stringify(normalized), actorUserId)
      : env.DB.prepare(
          `UPDATE site_theme_settings
              SET settings_json = ?,
                  revision = revision + 1,
                  updated_by_user_id = ?,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = 'active' AND revision = ?`,
        )
          .bind(JSON.stringify(normalized), actorUserId, expectedRevision);
  const results = await env.DB.batch([
    mutation,
    env.DB.prepare(
      `INSERT INTO audit_logs
       (id, actor_user_id, actor_role, action, category, source_area,
        target_type, target_id, target_label, request_id,
        old_value_json, new_value_json)
       SELECT ?, ?, (SELECT primary_role FROM users WHERE id = ?),
              'site.theme.update', 'APPEARANCE_SETTINGS', 'APPEARANCE',
              'SITE_SETTINGS', 'active', 'Site theme', ?, ?, ?
       WHERE changes() = 1`,
    ).bind(
      randomId(),
      actorUserId,
      actorUserId,
      requestId,
      JSON.stringify(current.settings),
      JSON.stringify(normalized),
    ),
  ]);
  if (!results[0]?.meta.changes) {
    throw new ApiError(
      409,
      "STALE_VERSION",
      "Another administrator changed the appearance settings. Reload before publishing.",
    );
  }
  return {
    settings: normalized,
    revision: nextRevision,
    updatedAt: new Date().toISOString(),
  };
}
