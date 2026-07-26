import { env } from "cloudflare:workers";
import {
  defaultCommercialSettings,
  parseCommercialSettings,
  type CommercialSettings,
} from "@/lib/commercial-settings";
import { ApiError } from "@/lib/server/api";
import { randomId } from "@/lib/server/random-id";

export type CommercialSettingsDocument = {
  settings: CommercialSettings;
  revision: number;
  updatedAt: string | null;
  recoveredFromInvalid?: boolean;
};

export async function getCommercialSettingsDocument(): Promise<CommercialSettingsDocument> {
  if (!env.DB) {
    return {
      settings: defaultCommercialSettings,
      revision: 0,
      updatedAt: null,
    };
  }
  let row:
    | {
        settingsJson: string;
        revision: number;
        updatedAt: string;
      }
    | null;
  try {
    row = await env.DB.prepare(
      `SELECT settings_json AS settingsJson,
              revision,
              updated_at AS updatedAt
         FROM commercial_settings
        WHERE id = 'active'
        LIMIT 1`,
    ).first<{
      settingsJson: string;
      revision: number;
      updatedAt: string;
    }>();
  } catch {
    throw new ApiError(
      503,
      "COMMERCIAL_SETTINGS_UNAVAILABLE",
      "Saved commercial settings could not be loaded safely.",
    );
  }
  if (!row) {
    return {
      settings: defaultCommercialSettings,
      revision: 0,
      updatedAt: null,
    };
  }
  try {
    return {
      settings: parseCommercialSettings(JSON.parse(row.settingsJson)),
      revision: Number(row.revision),
      updatedAt: row.updatedAt,
    };
  } catch {
    return {
      settings: defaultCommercialSettings,
      revision: Number(row.revision),
      updatedAt: row.updatedAt,
      recoveredFromInvalid: true,
    };
  }
}

export async function requirePaidEconomyPublic() {
  const document = await getCommercialSettingsDocument();
  if (!document.settings.economy.premiumEconomyPublic) {
    throw new ApiError(
      403,
      "PAID_ECONOMY_HIDDEN",
      "The premium coin economy is currently private.",
    );
  }
  return document.settings;
}

export async function saveCommercialSettings(
  settings: CommercialSettings,
  actorUserId: string,
  requestId: string,
  expectedRevision: number,
): Promise<CommercialSettingsDocument> {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Commercial settings storage is unavailable.",
    );
  }
  const current = await getCommercialSettingsDocument();
  if (Number(expectedRevision) !== current.revision) {
    throw new ApiError(
      409,
      "STALE_VERSION",
      "Another administrator changed the commercial settings. Reload before saving.",
    );
  }
  const normalized = parseCommercialSettings(settings);
  const revision = expectedRevision + 1;
  const mutation =
    expectedRevision === 0
      ? env.DB.prepare(
          `INSERT INTO commercial_settings
           (id, schema_version, settings_json, revision, updated_by_user_id)
           VALUES ('active', 2, ?, 1, ?)
           ON CONFLICT(id) DO NOTHING`,
        )
          .bind(JSON.stringify(normalized), actorUserId)
      : env.DB.prepare(
          `UPDATE commercial_settings
              SET settings_json = ?,
                  schema_version = 2,
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
              'site.commercial.update', 'COMMERCE_STORE', 'COMMERCE',
              'SITE_SETTINGS', 'commercial', 'Commercial settings', ?, ?, ?
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
      "Another administrator changed the commercial settings. Reload before saving.",
    );
  }
  return {
    settings: normalized,
    revision,
    updatedAt: new Date().toISOString(),
  };
}
