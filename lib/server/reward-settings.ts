import { env } from "cloudflare:workers";
import {
  defaultRewardSettings,
  parseRewardSettings,
  type RewardSettings,
} from "@/lib/reward-settings";
import { ApiError } from "@/lib/server/api";
import { randomId } from "@/lib/server/random-id";

export type RewardSettingsDocument = {
  settings: RewardSettings;
  revision: number;
  updatedAt: string | null;
  recoveredFromInvalid?: boolean;
};

export async function getRewardSettingsDocument(): Promise<RewardSettingsDocument> {
  if (!env.DB) {
    return {
      settings: defaultRewardSettings,
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
         FROM reward_settings
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
      "REWARD_SETTINGS_UNAVAILABLE",
      "Reward settings could not be loaded safely.",
    );
  }
  if (!row) {
    return {
      settings: defaultRewardSettings,
      revision: 0,
      updatedAt: null,
    };
  }
  try {
    const parsed = rewardSettingsSchemaResult(JSON.parse(row.settingsJson));
    return {
      settings: parsed.settings,
      revision: Number(row.revision),
      updatedAt: row.updatedAt,
      recoveredFromInvalid: parsed.recovered,
    };
  } catch {
    return {
      settings: defaultRewardSettings,
      revision: Number(row.revision),
      updatedAt: row.updatedAt,
      recoveredFromInvalid: true,
    };
  }
}

function rewardSettingsSchemaResult(value: unknown) {
  const parsed = parseRewardSettings(value);
  return {
    settings: parsed,
    recovered: parsed === defaultRewardSettings && value !== defaultRewardSettings,
  };
}

export async function saveRewardSettings(
  settings: RewardSettings,
  actorUserId: string,
  requestId: string,
  expectedRevision: number,
): Promise<RewardSettingsDocument> {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Reward settings storage is unavailable.",
    );
  }
  const current = await getRewardSettingsDocument();
  if (current.revision !== expectedRevision) {
    throw new ApiError(
      409,
      "STALE_VERSION",
      "Another administrator changed the reward settings. Reload before saving.",
    );
  }
  const normalized = parseRewardSettings(settings);
  const mutation =
    expectedRevision === 0
      ? env.DB.prepare(
          `INSERT INTO reward_settings
           (id, schema_version, settings_json, revision, updated_by_user_id)
           VALUES ('active', 1, ?, 1, ?)
           ON CONFLICT(id) DO NOTHING`,
        ).bind(JSON.stringify(normalized), actorUserId)
      : env.DB.prepare(
          `UPDATE reward_settings
              SET settings_json = ?,
                  revision = revision + 1,
                  updated_by_user_id = ?,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = 'active' AND revision = ?`,
        ).bind(JSON.stringify(normalized), actorUserId, expectedRevision);
  const result = await env.DB.batch([
    mutation,
    env.DB.prepare(
      `INSERT INTO audit_logs
       (id, actor_user_id, actor_role, action, category, source_area,
        target_type, target_id, target_label, request_id,
        old_value_json, new_value_json)
       SELECT ?, ?, (SELECT primary_role FROM users WHERE id = ?),
              'community.rewards.update', 'COMMUNITY', 'DISCUSSIONS',
              'SITE_SETTINGS', 'rewards', 'Community rewards', ?, ?, ?
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
  if (!result[0]?.meta.changes) {
    throw new ApiError(
      409,
      "STALE_VERSION",
      "Another administrator changed the reward settings. Reload before saving.",
    );
  }
  return {
    settings: normalized,
    revision: expectedRevision + 1,
    updatedAt: new Date().toISOString(),
  };
}
