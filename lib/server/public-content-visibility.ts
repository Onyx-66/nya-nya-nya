import type { D1Database } from "@cloudflare/workers-types";

/**
 * The public-reader paid-content gate. This deliberately has no actor or role
 * input: when paid content is private, public routes must behave as if it does
 * not exist for every account, including owners.
 */
export const PAID_CONTENT_PUBLIC_SQL = `EXISTS (
  SELECT 1
    FROM commercial_settings public_commercial
   WHERE public_commercial.id = 'active'
     AND public_commercial.revision >= 1
     AND json_valid(public_commercial.settings_json)
     AND json_type(
           CASE
             WHEN json_valid(public_commercial.settings_json)
               THEN public_commercial.settings_json
             ELSE '{}'
           END,
           '$.economy.premiumEconomyPublic'
         ) = 'true'
     AND EXISTS (
       SELECT 1
         FROM feature_flags public_premium_feature
        WHERE public_premium_feature.key = 'premium_unlocks'
          AND public_premium_feature.enabled = 1
     )
     AND EXISTS (
       SELECT 1
         FROM feature_flags public_paid_system_feature
        WHERE public_paid_system_feature.key = 'payments'
          AND public_paid_system_feature.enabled = 1
     )
)`;

export function effectiveChapterAccessSql(
  chapterAlias = "c",
  overrideAlias = "visibility_override",
) {
  return `CASE
    WHEN ${overrideAlias}.access_type IN ('FREE', 'PAID', 'PREMIUM')
    THEN ${overrideAlias}.access_type
    WHEN ${chapterAlias}.access_type = 'PAID'
     AND ${chapterAlias}.free_at IS NOT NULL
     AND datetime(${chapterAlias}.free_at) <= datetime('now')
     AND COALESCE(${overrideAlias}.auto_free_exempt, 0) = 0
    THEN 'FREE'
    ELSE ${chapterAlias}.access_type
  END`;
}

export function publicPaidSeriesPredicate(seriesAlias = "s") {
  void seriesAlias;
  // A private paid economy hides paid chapter releases, not their parent
  // series. Keeping the title public lets readers discover it and read any
  // currently-free chapters without exposing a locked release or purchase UI.
  return "1 = 1";
}

export function publicPaidChapterPredicate(
  chapterAlias = "c",
  overrideAlias = "visibility_override",
) {
  return `(${PAID_CONTENT_PUBLIC_SQL} OR (${effectiveChapterAccessSql(
    chapterAlias,
    overrideAlias,
  )}) = 'FREE')`;
}

export async function paidContentIsPublic(db: D1Database) {
  const row = await db
    .prepare(`SELECT CASE WHEN ${PAID_CONTENT_PUBLIC_SQL} THEN 1 ELSE 0 END AS enabled`)
    .first<{ enabled: number | boolean }>();
  return Boolean(row?.enabled);
}
