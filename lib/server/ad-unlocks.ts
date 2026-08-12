import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError } from "@/lib/server/api";
import type { ChapterAccessDecision } from "@/lib/server/chapter-access";
import type { Actor } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";

const CALLBACK_TOLERANCE_SECONDS = 5 * 60;
const MAX_CALLBACK_BYTES = 64 * 1024;
const MAX_CHALLENGES_PER_TEN_MINUTES = 10;

const callbackPayloadSchema = z.object({
  challengeId: z
    .string()
    .trim()
    .min(8)
    .max(160)
    .regex(/^[A-Za-z0-9._:-]+$/),
  providerReference: z
    .string()
    .trim()
    .min(3)
    .max(200)
    .regex(/^[A-Za-z0-9._:/-]+$/),
  status: z.literal("VERIFIED"),
});

export type AdUnlockChallengeStatus =
  | "PENDING"
  | "VERIFIED"
  | "CLAIMED"
  | "EXPIRED";

type AdUnlockEnvironment = {
  AD_REWARD_PROVIDER_URL?: string;
  AD_REWARD_WEBHOOK_SECRET?: string;
  AD_UNLOCK_HOURS?: string;
};

type ChallengeRow = {
  id: string;
  userId: string;
  chapterId: string;
  status: AdUnlockChallengeStatus;
  providerReference: string | null;
  expiresAt: string;
  verifiedAt: string | null;
  claimedAt: string | null;
  revision: number;
  seriesSlug: string;
  chapterSlug: string;
  seriesTitle: string;
  chapterLabel: string;
  accessType: "FREE" | "PAID";
  premiumAccess: number;
};

export type AdUnlockReadiness = {
  ready: boolean;
  reason: string | null;
  providerOrigin: string | null;
  unlockHours: number | null;
};

type AdUnlockConfiguration = AdUnlockReadiness & {
  providerUrl: URL;
  webhookSecret: string;
  unlockHours: number;
};

function configuredEnvironment() {
  return env as unknown as AdUnlockEnvironment;
}

function sqliteTimestamp(value: Date) {
  return value.toISOString().slice(0, 19).replace("T", " ");
}

function parsedProviderUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

/**
 * Public, secret-free readiness used by the feature-flag dependency graph.
 * Configuration remains fail-closed until all three values are valid.
 */
export function getAdUnlockReadiness(): AdUnlockReadiness {
  const configured = configuredEnvironment();
  const providerUrl = parsedProviderUrl(configured.AD_REWARD_PROVIDER_URL?.trim());
  if (!providerUrl) {
    return {
      ready: false,
      reason: "AD_REWARD_PROVIDER_URL_INVALID",
      providerOrigin: null,
      unlockHours: null,
    };
  }
  const webhookSecret = configured.AD_REWARD_WEBHOOK_SECRET ?? "";
  if (webhookSecret.length < 32) {
    return {
      ready: false,
      reason: "AD_REWARD_WEBHOOK_SECRET_INVALID",
      providerOrigin: providerUrl.origin,
      unlockHours: null,
    };
  }
  const unlockHours = Number(configured.AD_UNLOCK_HOURS);
  if (
    !Number.isInteger(unlockHours) ||
    unlockHours < 1 ||
    unlockHours > 168
  ) {
    return {
      ready: false,
      reason: "AD_UNLOCK_HOURS_INVALID",
      providerOrigin: providerUrl.origin,
      unlockHours: null,
    };
  }
  return {
    ready: true,
    reason: null,
    providerOrigin: providerUrl.origin,
    unlockHours,
  };
}

function requireAdUnlockConfiguration(): AdUnlockConfiguration {
  const readiness = getAdUnlockReadiness();
  if (!readiness.ready || readiness.unlockHours === null) {
    throw new ApiError(
      503,
      "AD_REWARD_PROVIDER_UNAVAILABLE",
      "Ad-supported chapter access is temporarily unavailable.",
      undefined,
      { reason: readiness.reason },
    );
  }
  const configured = configuredEnvironment();
  const providerUrl = parsedProviderUrl(configured.AD_REWARD_PROVIDER_URL?.trim());
  const webhookSecret = configured.AD_REWARD_WEBHOOK_SECRET ?? "";
  if (!providerUrl || webhookSecret.length < 32) {
    throw new ApiError(
      503,
      "AD_REWARD_PROVIDER_UNAVAILABLE",
      "Ad-supported chapter access is temporarily unavailable.",
    );
  }
  return {
    ...readiness,
    providerUrl,
    webhookSecret,
    unlockHours: readiness.unlockHours,
  };
}

async function resolveChapterAccess(
  actor: Actor,
  seriesSlug: string,
  chapterSlug: string,
) {
  // Kept dynamic so the feature dependency graph may safely import readiness
  // without creating a feature-flags -> chapter-access import cycle.
  const chapterAccess = await import("@/lib/server/chapter-access");
  return chapterAccess.resolveChapterAccess(actor, seriesSlug, chapterSlug);
}

function assertAdEligible(access: ChapterAccessDecision) {
  if (
    access.accessType !== "PAID" ||
    access.accessLevel === "PREMIUM" ||
    access.canRead ||
    access.reason !== "PURCHASE_REQUIRED"
  ) {
    throw new ApiError(
      409,
      "AD_UNLOCK_NOT_ELIGIBLE",
      "This chapter is not eligible for an ad-supported unlock.",
    );
  }
}

function challengeProviderUrl(
  base: URL,
  challengeId: string,
  requestUrl: string,
  seriesSlug: string,
  chapterSlug: string,
) {
  const requestOrigin = new URL(requestUrl).origin;
  const providerUrl = new URL(base.toString());
  providerUrl.searchParams.set("challenge_id", challengeId);
  providerUrl.searchParams.set(
    "callback_url",
    new URL("/api/v1/ad-unlocks/provider-callback", requestOrigin).toString(),
  );
  providerUrl.searchParams.set(
    "return_url",
    new URL(
      `/title/${encodeURIComponent(seriesSlug)}/chapter/${encodeURIComponent(chapterSlug)}`,
      requestOrigin,
    ).toString(),
  );
  return providerUrl.toString();
}

function challengePublicData(
  challenge: Pick<ChallengeRow, "id" | "status" | "expiresAt">,
  providerUrl: string,
) {
  return {
    challengeId: challenge.id,
    status: challenge.status,
    expiresAt: challenge.expiresAt,
    providerUrl,
  };
}

async function expireStaleChallenges(db: D1Database, actorId?: string) {
  const actorFilter = actorId ? " AND user_id = ?" : "";
  const statement = db.prepare(
    `UPDATE ad_unlock_challenges
        SET status = 'EXPIRED', revision = revision + 1,
            updated_at = CURRENT_TIMESTAMP
      WHERE status IN ('PENDING', 'VERIFIED')
        AND datetime(expires_at) <= CURRENT_TIMESTAMP${actorFilter}`,
  );
  await (actorId ? statement.bind(actorId) : statement).run();
}

export async function getAdUnlockAvailability(
  actor: Actor,
  seriesSlug: string,
  chapterSlug: string,
) {
  const access = await resolveChapterAccess(actor, seriesSlug, chapterSlug);
  return {
    available:
      access.accessType === "PAID" &&
      access.accessLevel !== "PREMIUM" &&
      !access.canRead &&
      access.reason === "PURCHASE_REQUIRED",
  };
}

export async function createAdUnlockChallenge(
  db: D1Database,
  actor: Actor,
  input: {
    seriesSlug: string;
    chapterSlug: string;
    requestUrl: string;
  },
) {
  const configuration = requireAdUnlockConfiguration();
  const access = await resolveChapterAccess(
    actor,
    input.seriesSlug,
    input.chapterSlug,
  );
  assertAdEligible(access);
  await expireStaleChallenges(db, actor.id);

  const existing = await db
    .prepare(
      `SELECT id, status, expires_at AS expiresAt
         FROM ad_unlock_challenges
        WHERE user_id = ? AND chapter_id = ?
          AND status IN ('PENDING', 'VERIFIED')
          AND datetime(expires_at) > CURRENT_TIMESTAMP
        ORDER BY datetime(created_at) DESC
        LIMIT 1`,
    )
    .bind(actor.id, access.chapterId)
    .first<Pick<ChallengeRow, "id" | "status" | "expiresAt">>();
  if (existing) {
    return challengePublicData(
      existing,
      challengeProviderUrl(
        configuration.providerUrl,
        existing.id,
        input.requestUrl,
        input.seriesSlug,
        input.chapterSlug,
      ),
    );
  }

  const recent = await db
    .prepare(
      `SELECT COUNT(*) AS total
         FROM ad_unlock_challenges
        WHERE user_id = ?
          AND datetime(created_at) >= datetime('now', '-10 minutes')`,
    )
    .bind(actor.id)
    .first<{ total: number }>();
  if (Number(recent?.total ?? 0) >= MAX_CHALLENGES_PER_TEN_MINUTES) {
    throw new ApiError(
      429,
      "AD_UNLOCK_RATE_LIMITED",
      "Too many ad unlock attempts. Wait a few minutes and try again.",
    );
  }

  const id = `adu_${randomId()}`;
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await db
    .prepare(
      `INSERT INTO ad_unlock_challenges
       (id, user_id, chapter_id, provider, status, expires_at)
       VALUES (?, ?, ?, ?, 'PENDING', ?)`,
    )
    .bind(
      id,
      actor.id,
      access.chapterId,
      configuration.providerOrigin,
      expiresAt,
    )
    .run();
  return challengePublicData(
    { id, status: "PENDING", expiresAt },
    challengeProviderUrl(
      configuration.providerUrl,
      id,
      input.requestUrl,
      input.seriesSlug,
      input.chapterSlug,
    ),
  );
}

async function challengeForUser(
  db: D1Database,
  actorId: string,
  challengeId: string,
) {
  return db
    .prepare(
      `SELECT challenge.id,
              challenge.user_id AS userId,
              challenge.chapter_id AS chapterId,
              challenge.status,
              challenge.provider_reference AS providerReference,
              challenge.expires_at AS expiresAt,
              challenge.verified_at AS verifiedAt,
              challenge.claimed_at AS claimedAt,
              challenge.revision,
              series.slug AS seriesSlug,
              chapter.slug AS chapterSlug,
              series.title AS seriesTitle,
              CASE
                WHEN chapter.title = '' THEN 'Chapter ' || chapter.chapter_number
                ELSE 'Chapter ' || chapter.chapter_number || ' · ' || chapter.title
              END AS chapterLabel,
              chapter.access_type AS accessType,
              CASE WHEN visibility.access_type = 'PREMIUM' THEN 1 ELSE 0 END AS premiumAccess
         FROM ad_unlock_challenges challenge
         JOIN chapters chapter ON chapter.id = challenge.chapter_id
         JOIN series series ON series.id = chapter.series_id
         LEFT JOIN content_visibility_overrides visibility
           ON visibility.chapter_id = chapter.id
        WHERE challenge.id = ? AND challenge.user_id = ?
        LIMIT 1`,
    )
    .bind(challengeId, actorId)
    .first<ChallengeRow>();
}

export async function getAdUnlockChallengeStatus(
  db: D1Database,
  actor: Actor,
  challengeId: string,
) {
  await expireStaleChallenges(db, actor.id);
  const challenge = await challengeForUser(db, actor.id, challengeId);
  if (!challenge) {
    throw new ApiError(
      404,
      "AD_UNLOCK_CHALLENGE_NOT_FOUND",
      "This ad unlock attempt could not be found.",
    );
  }
  return {
    challengeId: challenge.id,
    status: challenge.status,
    expiresAt: challenge.expiresAt,
  };
}

export async function claimAdUnlockChallenge(
  db: D1Database,
  actor: Actor,
  challengeId: string,
) {
  const configuration = requireAdUnlockConfiguration();
  await expireStaleChallenges(db, actor.id);
  const before = await challengeForUser(db, actor.id, challengeId);
  if (!before) {
    throw new ApiError(
      404,
      "AD_UNLOCK_CHALLENGE_NOT_FOUND",
      "This ad unlock attempt could not be found.",
    );
  }
  if (before.accessType !== "PAID" || Boolean(before.premiumAccess)) {
    throw new ApiError(
      409,
      "AD_UNLOCK_NOT_ELIGIBLE",
      "This chapter is not eligible for an ad-supported unlock.",
    );
  }
  if (before.status === "PENDING") {
    throw new ApiError(
      409,
      "AD_REWARD_NOT_VERIFIED",
      "Complete the ad before claiming chapter access.",
    );
  }
  if (before.status === "EXPIRED") {
    throw new ApiError(
      410,
      "AD_UNLOCK_CHALLENGE_EXPIRED",
      "This ad unlock attempt expired. Start a new one.",
    );
  }

  if (before.status === "VERIFIED") {
    const entitlementId = `ent_${randomId()}`;
    const notificationId = `ntf_${randomId()}`;
    const entitlementExpiresAt = sqliteTimestamp(
      new Date(Date.now() + configuration.unlockHours * 60 * 60 * 1000),
    );
    const results = await db.batch([
      db
        .prepare(
          `INSERT INTO entitlements
           (id, user_id, chapter_id, source_type, source_id, expires_at)
           SELECT ?, challenge.user_id, challenge.chapter_id,
                  'AD_REWARD', challenge.id, ?
             FROM ad_unlock_challenges challenge
            WHERE challenge.id = ? AND challenge.user_id = ?
              AND challenge.status = 'VERIFIED'
              AND datetime(challenge.expires_at) > CURRENT_TIMESTAMP
           ON CONFLICT(user_id, chapter_id) DO UPDATE SET
             source_type = excluded.source_type,
             source_id = excluded.source_id,
             starts_at = CURRENT_TIMESTAMP,
             expires_at = excluded.expires_at,
             revoked_at = NULL
           WHERE entitlements.revoked_at IS NOT NULL
              OR (entitlements.expires_at IS NOT NULL
                  AND datetime(entitlements.expires_at) <= CURRENT_TIMESTAMP)`,
        )
        .bind(
          entitlementId,
          entitlementExpiresAt,
          challengeId,
          actor.id,
        ),
      db
        .prepare(
          `INSERT INTO notifications
           (id, user_id, kind, title, body, dedupe_key, action_url, metadata_json)
           SELECT ?, challenge.user_id, 'AD_REWARD_UNLOCK', ?, ?, ?, ?, ?
             FROM ad_unlock_challenges challenge
            WHERE challenge.id = ? AND challenge.user_id = ?
              AND challenge.status = 'VERIFIED'
              AND datetime(challenge.expires_at) > CURRENT_TIMESTAMP
              AND NOT EXISTS (
                SELECT 1 FROM notifications existing
                 WHERE existing.user_id = challenge.user_id
                   AND existing.dedupe_key = ?
              )`,
        )
        .bind(
          notificationId,
          `Temporary access: ${before.seriesTitle}`,
          `${before.chapterLabel} is unlocked for ${configuration.unlockHours} hours after your verified ad reward.`,
          `ad-reward:${challengeId}`,
          `/title/${encodeURIComponent(before.seriesSlug)}/chapter/${encodeURIComponent(before.chapterSlug)}`,
          JSON.stringify({
            seriesSlug: before.seriesSlug,
            chapterSlug: before.chapterSlug,
            challengeId,
            expiresAt: entitlementExpiresAt,
          }),
          challengeId,
          actor.id,
          `ad-reward:${challengeId}`,
        ),
      db
        .prepare(
          `UPDATE ad_unlock_challenges
              SET status = 'CLAIMED', claimed_at = CURRENT_TIMESTAMP,
                  revision = revision + 1, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND user_id = ? AND status = 'VERIFIED'
              AND datetime(expires_at) > CURRENT_TIMESTAMP
              AND EXISTS (
                SELECT 1 FROM entitlements entitlement
                 WHERE entitlement.user_id = ad_unlock_challenges.user_id
                   AND entitlement.chapter_id = ad_unlock_challenges.chapter_id
                   AND entitlement.revoked_at IS NULL
                   AND datetime(entitlement.starts_at) <= CURRENT_TIMESTAMP
                   AND (entitlement.expires_at IS NULL
                     OR datetime(entitlement.expires_at) > CURRENT_TIMESTAMP)
              )`,
        )
        .bind(challengeId, actor.id),
    ]);
    if (Number(results[2]?.meta.changes ?? 0) === 0) {
      const current = await challengeForUser(db, actor.id, challengeId);
      if (current?.status !== "CLAIMED") {
        throw new ApiError(
          409,
          "AD_UNLOCK_CLAIM_CONFLICT",
          "Chapter access could not be claimed safely. Check the ad status and retry.",
        );
      }
    }
  }

  const access = await resolveChapterAccess(
    actor,
    before.seriesSlug,
    before.chapterSlug,
  );
  if (!access.canRead) {
    throw new ApiError(
      409,
      "AD_UNLOCK_ACCESS_NOT_GRANTED",
      "The verified reward did not grant chapter access. Try again.",
    );
  }
  return {
    challengeId,
    status: "CLAIMED" as const,
    access,
  };
}

function parseHex(value: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  const bytes = new Uint8Array(32);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

function signatureValue(header: string) {
  const candidate = header.trim();
  if (/^[0-9a-f]{64}$/i.test(candidate)) return candidate;
  const versioned = candidate
    .split(",")
    .map((part) => part.trim())
    .find((part) => part.startsWith("v1="));
  return versioned?.slice(3) ?? "";
}

export async function verifyAdRewardCallback(
  rawBody: string,
  timestampHeader: string,
  signatureHeader: string,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const configuration = requireAdUnlockConfiguration();
  const bodyBytes = new TextEncoder().encode(rawBody);
  if (!rawBody || bodyBytes.byteLength > MAX_CALLBACK_BYTES) {
    throw new ApiError(
      413,
      "AD_REWARD_CALLBACK_INVALID",
      "The ad reward callback payload is invalid.",
    );
  }
  if (!/^\d{10}$/.test(timestampHeader)) {
    throw new ApiError(
      400,
      "AD_REWARD_TIMESTAMP_INVALID",
      "The ad reward callback timestamp is invalid.",
    );
  }
  const timestamp = Number(timestampHeader);
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(nowSeconds - timestamp) > CALLBACK_TOLERANCE_SECONDS
  ) {
    throw new ApiError(
      400,
      "AD_REWARD_TIMESTAMP_EXPIRED",
      "The ad reward callback timestamp is outside the accepted window.",
    );
  }
  const supplied = parseHex(signatureValue(signatureHeader));
  if (!supplied) {
    throw new ApiError(
      401,
      "AD_REWARD_SIGNATURE_INVALID",
      "The ad reward callback signature is invalid.",
    );
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(configuration.webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${timestampHeader}.${rawBody}`),
    ),
  );
  if (!constantTimeEqual(expected, supplied)) {
    throw new ApiError(
      401,
      "AD_REWARD_SIGNATURE_INVALID",
      "The ad reward callback signature is invalid.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new ApiError(
      400,
      "AD_REWARD_CALLBACK_INVALID",
      "The ad reward callback payload is invalid.",
    );
  }
  return callbackPayloadSchema.parse(parsed);
}

export async function recordVerifiedAdReward(
  db: D1Database,
  payload: z.infer<typeof callbackPayloadSchema>,
) {
  await expireStaleChallenges(db);
  const challenge = await db
    .prepare(
      `SELECT id, status, provider_reference AS providerReference,
              expires_at AS expiresAt
         FROM ad_unlock_challenges
        WHERE id = ? LIMIT 1`,
    )
    .bind(payload.challengeId)
    .first<{
      id: string;
      status: AdUnlockChallengeStatus;
      providerReference: string | null;
      expiresAt: string;
    }>();
  if (!challenge) {
    throw new ApiError(
      404,
      "AD_UNLOCK_CHALLENGE_NOT_FOUND",
      "This ad unlock attempt could not be found.",
    );
  }
  const referenceOwner = await db
    .prepare(
      `SELECT id FROM ad_unlock_challenges
        WHERE provider_reference = ? AND id <> ? LIMIT 1`,
    )
    .bind(payload.providerReference, payload.challengeId)
    .first<{ id: string }>();
  if (referenceOwner) {
    throw new ApiError(
      409,
      "AD_REWARD_REFERENCE_CONFLICT",
      "This ad reward reference is already attached to another attempt.",
    );
  }
  if (
    ["VERIFIED", "CLAIMED"].includes(challenge.status) &&
    challenge.providerReference === payload.providerReference
  ) {
    return { received: true, duplicate: true, status: challenge.status };
  }
  if (challenge.status === "EXPIRED") {
    throw new ApiError(
      410,
      "AD_UNLOCK_CHALLENGE_EXPIRED",
      "This ad unlock attempt has expired.",
    );
  }
  if (
    challenge.status !== "PENDING" ||
    (challenge.providerReference &&
      challenge.providerReference !== payload.providerReference)
  ) {
    throw new ApiError(
      409,
      "AD_REWARD_CALLBACK_CONFLICT",
      "This ad reward callback conflicts with the current attempt.",
    );
  }
  const result = await db
    .prepare(
      `UPDATE ad_unlock_challenges
          SET status = 'VERIFIED', provider_reference = ?,
              verified_at = CURRENT_TIMESTAMP, revision = revision + 1,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'PENDING'
          AND datetime(expires_at) > CURRENT_TIMESTAMP
          AND provider_reference IS NULL`,
    )
    .bind(payload.providerReference, payload.challengeId)
    .run();
  if (Number(result.meta.changes ?? 0) === 0) {
    const current = await db
      .prepare(
        `SELECT status, provider_reference AS providerReference
           FROM ad_unlock_challenges WHERE id = ? LIMIT 1`,
      )
      .bind(payload.challengeId)
      .first<{
        status: AdUnlockChallengeStatus;
        providerReference: string | null;
      }>();
    if (
      current &&
      ["VERIFIED", "CLAIMED"].includes(current.status) &&
      current.providerReference === payload.providerReference
    ) {
      return { received: true, duplicate: true, status: current.status };
    }
    throw new ApiError(
      409,
      "AD_REWARD_CALLBACK_CONFLICT",
      "This ad reward callback conflicts with the current attempt.",
    );
  }
  return { received: true, duplicate: false, status: "VERIFIED" as const };
}
