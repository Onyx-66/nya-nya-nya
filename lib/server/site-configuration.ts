import { env } from "cloudflare:workers";
import {
  defaultSiteConfiguration,
  parseSiteConfiguration,
  siteConfigurationSchema,
  type SiteConfiguration,
} from "@/lib/site-configuration";
import { ApiError } from "@/lib/server/api";
import { randomId } from "@/lib/server/random-id";

export type SiteConfigurationDocument = {
  settings: SiteConfiguration;
  revision: number;
  updatedAt: string | null;
  recoveredFromInvalid?: boolean;
};

const MAX_CONFIGURATION_BYTES = 500_000;

function auditSnapshot(settings: SiteConfiguration) {
  return {
    siteName: settings.brand.siteName,
    homepage: {
      pinnedSeriesStyle: settings.homepage.pinnedSeriesStyle,
      recentReviewsStyle: settings.homepage.recentReviewsStyle,
    },
    footerGroups: settings.footer.groups.map((group) => group.id),
    socialLinks: settings.footer.socialLinks.map((link) => link.id),
    shortcuts: settings.keyboardShortcuts.map((shortcut) => shortcut.id),
    legalDocuments: settings.legalDocuments.map((document) => document.slug),
    media: {
      logo: settings.brand.logo.enabled,
      compactLogo: settings.brand.compactLogo.enabled,
      appIcon: settings.brand.appIcon.enabled,
      firstPage: settings.reader.firstPage.enabled,
      lastPage: settings.reader.lastPage.enabled,
    },
  };
}

export async function getSiteConfigurationDocument(): Promise<SiteConfigurationDocument> {
  if (!env.DB) {
    return {
      settings: defaultSiteConfiguration,
      revision: 0,
      updatedAt: null,
    };
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
         FROM site_configuration_settings
        WHERE id = 'active'
        LIMIT 1`,
    ).first<{
      settings_json: string;
      revision: number;
      updated_at: string;
    }>();
  } catch {
    throw new ApiError(
      503,
      "SITE_CONFIGURATION_UNAVAILABLE",
      "Saved site configuration could not be loaded safely.",
    );
  }
  if (!row) {
    return {
      settings: defaultSiteConfiguration,
      revision: 0,
      updatedAt: null,
    };
  }
  try {
    const raw = JSON.parse(row.settings_json) as unknown;
    const normalized = parseSiteConfiguration(raw);
    return {
      settings: normalized,
      revision: Number(row.revision),
      updatedAt: row.updated_at,
      recoveredFromInvalid:
        normalized === defaultSiteConfiguration ? true : undefined,
    };
  } catch {
    return {
      settings: defaultSiteConfiguration,
      revision: Number(row.revision),
      updatedAt: row.updated_at,
      recoveredFromInvalid: true,
    };
  }
}

export async function getSiteConfiguration(): Promise<SiteConfiguration> {
  return (await getSiteConfigurationDocument()).settings;
}

export async function saveSiteConfiguration(
  settings: SiteConfiguration,
  actorUserId: string,
  requestId: string,
  allowMediaUpdate = false,
  expectedRevision: number,
): Promise<SiteConfigurationDocument> {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Site configuration storage is unavailable.",
    );
  }
  const current = await getSiteConfigurationDocument();
  if (Number(expectedRevision) !== current.revision) {
    throw new ApiError(
      409,
      "STALE_VERSION",
      "Another administrator changed the site configuration. Reload before saving.",
    );
  }
  const requested = siteConfigurationSchema.parse(settings);
  const normalized = allowMediaUpdate
    ? requested
    : {
        ...requested,
        brand: {
          ...requested.brand,
          logo: {
            ...current.settings.brand.logo,
            enabled: requested.brand.logo.enabled,
          },
          compactLogo: {
            ...current.settings.brand.compactLogo,
            enabled: requested.brand.compactLogo.enabled,
          },
          appIcon: {
            ...current.settings.brand.appIcon,
            enabled: requested.brand.appIcon.enabled,
          },
        },
        reader: {
          firstPage: {
            ...current.settings.reader.firstPage,
            enabled: requested.reader.firstPage.enabled,
          },
          lastPage: {
            ...current.settings.reader.lastPage,
            enabled: requested.reader.lastPage.enabled,
          },
        },
      };
  const nextRevision = expectedRevision + 1;
  const serialized = JSON.stringify(normalized);
  if (new TextEncoder().encode(serialized).byteLength > MAX_CONFIGURATION_BYTES) {
    throw new ApiError(
      413,
      "SITE_CONFIGURATION_TOO_LARGE",
      "The complete site configuration must remain under 500 KB.",
    );
  }
  const mutation =
    expectedRevision === 0
      ? env.DB.prepare(
          `INSERT INTO site_configuration_settings
           (id, schema_version, settings_json, revision, updated_by_user_id)
           VALUES ('active', 1, ?, 1, ?)
           ON CONFLICT(id) DO NOTHING`,
        )
          .bind(serialized, actorUserId)
      : env.DB.prepare(
          `UPDATE site_configuration_settings
              SET settings_json = ?,
                  revision = revision + 1,
                  updated_by_user_id = ?,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = 'active' AND revision = ?`,
        )
          .bind(serialized, actorUserId, expectedRevision);
  const results = await env.DB.batch([
    mutation,
    env.DB.prepare(
      `INSERT INTO audit_logs
       (id, actor_user_id, actor_role, action, category, source_area,
        target_type, target_id, target_label, request_id,
        old_value_json, new_value_json)
       SELECT ?, ?, (SELECT primary_role FROM users WHERE id = ?),
              'site.configuration.update', 'APPEARANCE_SETTINGS',
              'APPEARANCE', 'SITE_SETTINGS', 'active',
              'Site configuration', ?, ?, ?
       WHERE changes() = 1`,
    ).bind(
      randomId(),
      actorUserId,
      actorUserId,
      requestId,
      JSON.stringify({ revision: current.revision, ...auditSnapshot(current.settings) }),
      JSON.stringify({ revision: nextRevision, ...auditSnapshot(normalized) }),
    ),
  ]);
  if (!results[0]?.meta.changes) {
    throw new ApiError(
      409,
      "STALE_VERSION",
      "Another administrator changed the site configuration. Reload before saving.",
    );
  }
  return {
    settings: normalized,
    revision: nextRevision,
    updatedAt: new Date().toISOString(),
  };
}
