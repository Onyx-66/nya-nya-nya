import { env } from "cloudflare:workers";
import {
  defaultDiscussionSettings,
  parseDiscussionSettings,
  type DiscussionSettings,
} from "@/lib/discussion-settings";
import { ApiError } from "@/lib/server/api";
import { randomId } from "@/lib/server/random-id";

type StoredDiscussionSettings = {
  settingsJson: string;
  revision: number;
};

export async function getDiscussionSettingsDocument() {
  if (!env.DB) {
    return {
      settings: defaultDiscussionSettings,
      revision: 0,
    };
  }

  const row = await env.DB.prepare(
    `SELECT settings_json AS settingsJson, revision
     FROM discussion_settings
     WHERE id = 'global'
     LIMIT 1`,
  ).first<StoredDiscussionSettings>();

  if (!row) {
    return {
      settings: defaultDiscussionSettings,
      revision: 0,
    };
  }

  let value: unknown = null;
  try {
    value = JSON.parse(row.settingsJson);
  } catch {
    value = null;
  }

  return {
    settings: parseDiscussionSettings(value),
    revision: Number(row.revision),
  };
}

export async function saveDiscussionSettings(
  settings: DiscussionSettings,
  actorId: string,
  requestId: string,
  expectedRevision: number,
) {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Discussion settings storage is unavailable.",
    );
  }

  const current = await getDiscussionSettingsDocument();
  const revision = expectedRevision + 1;
  const mutation =
    expectedRevision === 0
      ? env.DB.prepare(
          `INSERT OR IGNORE INTO discussion_settings
           (id, schema_version, settings_json, revision, updated_by_user_id)
           VALUES ('global', 1, ?, 1, ?)`,
        ).bind(JSON.stringify(settings), actorId)
      : env.DB.prepare(
          `UPDATE discussion_settings
              SET schema_version = 1,
                  settings_json = ?,
                  revision = revision + 1,
                  updated_by_user_id = ?,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = 'global' AND revision = ?`,
        ).bind(JSON.stringify(settings), actorId, expectedRevision);
  const results = await env.DB.batch([
    mutation,
    env.DB.prepare(
      `INSERT INTO audit_logs
       (id, actor_user_id, action, target_type, target_id, request_id, old_value_json, new_value_json)
       SELECT ?, ?, 'discussion.settings.update', 'DISCUSSION_SETTINGS', 'global', ?, ?, ?
        WHERE changes() = 1`,
    ).bind(
      randomId(),
      actorId,
      requestId,
      JSON.stringify(current.settings),
      JSON.stringify(settings),
    ),
  ]);
  if (!results[0]?.meta.changes) {
    throw new ApiError(
      409,
      "STALE_VERSION",
      "Another administrator changed discussion settings. Reload before saving.",
    );
  }

  return { settings, revision };
}
