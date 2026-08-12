import { env } from "cloudflare:workers";
import { z } from "zod";
import {
  decryptGiftCode,
  encryptGiftCode,
  formatGiftCode,
  generateGiftCode,
  hashGiftCode,
  isGiftCodeShape,
} from "@/lib/gift-codes";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  assertSameOrigin,
  requestIdFor,
} from "@/lib/server/admin-utils";
import {
  economySnapshot,
  ensureWalletAccount,
  platformAccountId,
  walletSnapshot,
} from "@/lib/server/economy";
import { requireActor } from "@/lib/server/policy";
import {
  getCommercialSettingsDocument,
  requirePaidEconomyPublic,
} from "@/lib/server/commercial-settings";
import { randomId } from "@/lib/server/random-id";
import { getFeatureStates } from "@/lib/server/feature-flags";

export const dynamic = "force-dynamic";

const giftActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("CREATE_GIFT"),
    amount: z.number().int().min(1).max(1_000_000),
    recipientMode: z.enum(["FOLLOWED", "EMAIL"]),
    recipientUserId: z.string().trim().max(120).default(""),
    recipientEmail: z
      .string()
      .trim()
      .max(254)
      .regex(
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        "Enter a valid recipient email address.",
      )
      .or(z.literal(""))
      .default(""),
    message: z.string().trim().max(320).default(""),
    idempotencyKey: z.string().trim().min(12).max(160),
  }),
  z.object({
    action: z.literal("REDEEM_GIFT"),
    code: z.string().trim().min(18).max(32),
  }),
  z.object({
    action: z.literal("SUPPORT_TEAM"),
    teamId: z.string().trim().min(3).max(120),
    seriesIds: z
      .array(z.string().trim().min(3).max(120))
      .max(20)
      .default([])
      .transform((values) => [...new Set(values)].sort()),
    amount: z.number().int().min(1).max(1_000_000),
    message: z.string().trim().max(320).default(""),
    idempotencyKey: z.string().trim().min(12).max(160),
  }),
]);

type GiftCardRow = {
  id: string;
  codeCiphertext: string;
  codeNonce: string;
  codeSuffix: string;
  coinAmount: number;
  recipientUserId: string | null;
  recipientLabel: string;
  message: string;
  status: "ACTIVE" | "REDEEMED" | "EXPIRED";
  expiresAt: string | null;
  redeemedAt: string | null;
  createdAt: string;
};

type FollowedReader = {
  id: string;
  displayName: string;
  username: string | null;
};

const privateHeaders = {
  "cache-control": "private, no-store",
  vary: "Cookie",
};

function database() {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Gift storage is temporarily unavailable.",
    );
  }
  return env.DB;
}

async function mapGiftCard(row: GiftCardRow) {
  const expired =
    Boolean(row.expiresAt) && Date.parse(row.expiresAt ?? "") <= Date.now();
  return {
    id: row.id,
    code: formatGiftCode(
      await decryptGiftCode({
        codeCiphertext: row.codeCiphertext,
        codeNonce: row.codeNonce,
      }),
    ),
    codeSuffix: row.codeSuffix,
    amount: Number(row.coinAmount),
    currency: "ONYX" as const,
    recipientLabel: row.recipientLabel,
    message: row.message,
    status:
      row.status === "ACTIVE" && expired
        ? ("EXPIRED" as const)
        : row.status,
    valid: row.status === "ACTIVE" && !expired,
    redeemedAt: row.redeemedAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

async function responseData(userId: string) {
  const [commercial, featureStates] = await Promise.all([
    getCommercialSettingsDocument(),
    getFeatureStates(database()),
  ]);
  const premiumEconomyPublic = Boolean(
    commercial.settings.economy.premiumEconomyPublic &&
      featureStates.premium_unlocks.effective,
  );
  const [cards, teams, teamSeries, followedReaders, balances] =
    await Promise.all([
      database()
        .prepare(
          `SELECT id, code_ciphertext AS codeCiphertext,
                  code_nonce AS codeNonce, code_suffix AS codeSuffix,
                  coin_amount AS coinAmount,
                  recipient_user_id AS recipientUserId,
                  recipient_label AS recipientLabel, message, status,
                  expires_at AS expiresAt, redeemed_at AS redeemedAt,
                  created_at AS createdAt
             FROM gift_cards
            WHERE purchaser_user_id = ?
            ORDER BY created_at DESC
            LIMIT 100`,
        )
        .bind(userId)
        .all<GiftCardRow>(),
      database()
        .prepare(
          `SELECT id, slug, name, description
             FROM teams
            WHERE verification_status = 'VERIFIED'
              AND is_archived = 0
            ORDER BY name COLLATE NOCASE`,
        )
        .all<{
          id: string;
          slug: string;
          name: string;
          description: string;
        }>(),
      database()
        .prepare(
          `SELECT DISTINCT c.team_id AS teamId, s.id, s.slug, s.title
             FROM chapters c
             JOIN series s ON s.id = c.series_id
             JOIN teams t ON t.id = c.team_id
            WHERE c.team_id IS NOT NULL
              AND c.state = 'PUBLISHED'
              AND c.visibility = 'PUBLIC'
              AND c.published_at IS NOT NULL
              AND datetime(c.published_at) <= datetime('now')
              AND t.verification_status = 'VERIFIED'
              AND t.is_archived = 0
              AND s.is_published = 1
              AND s.archived_at IS NULL
              AND s.status NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
              AND s.rights_status IN
                ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
            ORDER BY c.team_id, s.title COLLATE NOCASE, s.id`,
        )
        .all<{
          teamId: string;
          id: string;
          slug: string;
          title: string;
        }>(),
      database()
        .prepare(
          `SELECT u.id, u.display_name AS displayName, up.username
             FROM user_follows uf
             JOIN users u ON u.id = uf.followed_user_id
             LEFT JOIN user_profiles up ON up.user_id = u.id
            WHERE uf.follower_user_id = ?
              AND u.status = 'ACTIVE'
              AND NOT EXISTS (
                SELECT 1
                  FROM user_blocks ub
                 WHERE (ub.blocker_user_id = ? AND ub.blocked_user_id = u.id)
                    OR (ub.blocker_user_id = u.id AND ub.blocked_user_id = ?)
              )
            ORDER BY u.display_name COLLATE NOCASE, u.id
            LIMIT 150`,
        )
        .bind(userId, userId, userId)
        .all<FollowedReader>(),
      economySnapshot(database(), userId),
    ]);
  const seriesByTeam = new Map<
    string,
    Array<{ id: string; slug: string; title: string }>
  >();
  for (const entry of teamSeries.results) {
    seriesByTeam.set(entry.teamId, [
      ...(seriesByTeam.get(entry.teamId) ?? []),
      { id: entry.id, slug: entry.slug, title: entry.title },
    ]);
  }
  return {
    cards: premiumEconomyPublic
      ? await Promise.all(cards.results.map(mapGiftCard))
      : [],
    teams: premiumEconomyPublic
      ? teams.results.map((team) => ({
          ...team,
          series: seriesByTeam.get(team.id) ?? [],
        }))
      : [],
    followedReaders: premiumEconomyPublic ? followedReaders.results : [],
    balances: premiumEconomyPublic
      ? balances
      : { shards: balances.shards },
    premiumEconomyPublic,
  };
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    return json(requestId, await responseData(actor.id), {
      headers: privateHeaders,
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

async function resolveGiftRecipient(
  actorId: string,
  payload: Extract<
    z.infer<typeof giftActionSchema>,
    { action: "CREATE_GIFT" }
  >,
) {
  if (payload.recipientMode === "EMAIL") {
    const email = payload.recipientEmail.trim().toLocaleLowerCase("en-US");
    if (!email) {
      throw new ApiError(
        422,
        "RECIPIENT_REQUIRED",
        "Enter the email address of the reader receiving this Gift Card.",
      );
    }
    const reader = await database()
      .prepare(
        `SELECT u.id
           FROM users u
          WHERE lower(u.email) = ?
            AND u.status = 'ACTIVE'
            AND u.id <> ?
            AND NOT EXISTS (
              SELECT 1
                FROM user_blocks ub
               WHERE (ub.blocker_user_id = ? AND ub.blocked_user_id = u.id)
                  OR (ub.blocker_user_id = u.id AND ub.blocked_user_id = ?)
            )
          LIMIT 1`,
      )
      .bind(email, actorId, actorId, actorId)
      .first<{ id: string }>();
    if (!reader) {
      throw new ApiError(
        422,
        "RECIPIENT_UNAVAILABLE",
        "This recipient is unavailable. Check the email or choose someone you follow.",
      );
    }
    return { userId: reader.id, label: email };
  }
  if (!payload.recipientUserId) {
    throw new ApiError(
      422,
      "RECIPIENT_REQUIRED",
      "Choose someone from the people you follow.",
    );
  }
  const reader = await database()
    .prepare(
      `SELECT u.id, u.display_name AS displayName, up.username
         FROM user_follows uf
         JOIN users u ON u.id = uf.followed_user_id
         LEFT JOIN user_profiles up ON up.user_id = u.id
        WHERE uf.follower_user_id = ?
          AND uf.followed_user_id = ?
          AND u.status = 'ACTIVE'
          AND NOT EXISTS (
            SELECT 1
              FROM user_blocks ub
             WHERE (ub.blocker_user_id = ? AND ub.blocked_user_id = u.id)
                OR (ub.blocker_user_id = u.id AND ub.blocked_user_id = ?)
          )
        LIMIT 1`,
    )
    .bind(actorId, payload.recipientUserId, actorId, actorId)
    .first<{ id: string; displayName: string; username: string | null }>();
  if (!reader) {
    throw new ApiError(
      422,
      "RECIPIENT_UNAVAILABLE",
      "This followed reader is no longer available. Choose another recipient.",
    );
  }
  return {
    userId: reader.id,
    label: reader.username
      ? `${reader.displayName} (@${reader.username})`
      : reader.displayName,
  };
}

async function createGift(
  actorId: string,
  coinPlural: string,
  payload: Extract<
    z.infer<typeof giftActionSchema>,
    { action: "CREATE_GIFT" }
  >,
) {
  const db = database();
  const recipient = await resolveGiftRecipient(actorId, payload);
  const existing = await db
    .prepare(
      `SELECT id, code_ciphertext AS codeCiphertext,
              code_nonce AS codeNonce, code_suffix AS codeSuffix,
              coin_amount AS coinAmount,
              recipient_user_id AS recipientUserId,
              recipient_label AS recipientLabel, message, status,
              expires_at AS expiresAt, redeemed_at AS redeemedAt,
              created_at AS createdAt
         FROM gift_cards
        WHERE purchaser_user_id = ? AND purchase_idempotency_key = ?
        LIMIT 1`,
    )
    .bind(actorId, payload.idempotencyKey)
    .first<GiftCardRow>();
  if (existing) {
    if (
      Number(existing.coinAmount) !== payload.amount ||
      existing.recipientUserId !== recipient.userId ||
      existing.recipientLabel !== recipient.label ||
      existing.message !== payload.message
    ) {
      throw new ApiError(
        409,
        "IDEMPOTENCY_KEY_REUSED",
        "Use a new request identifier for this gift.",
      );
    }
    return { card: await mapGiftCard(existing), created: false };
  }
  const wallet = await walletSnapshot(db, actorId, "ONYX");
  if (wallet.balance < payload.amount) {
    throw new ApiError(
      409,
      "INSUFFICIENT_ONYX",
      `Your ${coinPlural} balance is too low for this gift.`,
    );
  }
  const securedCode = await encryptGiftCode(generateGiftCode());
  const giftId = randomId();
  const transactionId = randomId();
  const escrowId = platformAccountId("gift_escrow", "ONYX");
  const result = await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO ledger_accounts
         (id, owner_type, owner_id, currency, account_type)
         VALUES (?, 'PLATFORM', 'NYASCANS_GIFT_ESCROW', 'ONYX', 'ESCROW')`,
      )
      .bind(escrowId),
    db
      .prepare(
        `INSERT INTO ledger_transactions
         (id, kind, reference_type, reference_id, idempotency_key, memo)
         VALUES (?, 'GIFT_CARD_ISSUE', 'GIFT_CARD', ?, ?, ?)`,
      )
      .bind(
        transactionId,
        giftId,
        `gift:issue:${actorId}:${payload.idempotencyKey}`,
        `Gift card · ${payload.amount} ${coinPlural}`,
      ),
    db
      .prepare(
        `INSERT INTO ledger_entries
         (id, transaction_id, account_id, amount)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(randomId(), transactionId, wallet.accountId, -payload.amount),
    db
      .prepare(
        `INSERT INTO ledger_entries
         (id, transaction_id, account_id, amount)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(randomId(), transactionId, escrowId, payload.amount),
    db
      .prepare(
        `INSERT INTO gift_cards
         (id, code_hash, code_ciphertext, code_nonce, code_suffix,
          purchaser_user_id, purchase_idempotency_key, coin_amount,
          recipient_user_id, recipient_label, message, purchase_transaction_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        giftId,
        securedCode.codeHash,
        securedCode.codeCiphertext,
        securedCode.codeNonce,
        securedCode.codeSuffix,
        actorId,
        payload.idempotencyKey,
        payload.amount,
        recipient.userId,
        recipient.label,
        payload.message,
        transactionId,
      ),
  ]);
  if (!result[4]?.meta.changes) {
    throw new ApiError(
      409,
      "GIFT_NOT_CREATED",
      "This gift could not be created. Try again.",
    );
  }
  const card = await db
    .prepare(
      `SELECT id, code_ciphertext AS codeCiphertext,
              code_nonce AS codeNonce, code_suffix AS codeSuffix,
              coin_amount AS coinAmount,
              recipient_user_id AS recipientUserId,
              recipient_label AS recipientLabel, message, status,
              expires_at AS expiresAt, redeemed_at AS redeemedAt,
              created_at AS createdAt
         FROM gift_cards WHERE id = ? LIMIT 1`,
    )
    .bind(giftId)
    .first<GiftCardRow>();
  if (!card) {
    throw new ApiError(409, "GIFT_NOT_CREATED", "This gift was not created.");
  }
  return { card: await mapGiftCard(card), created: true };
}

async function redeemGift(
  actorId: string,
  rawCode: string,
  requestId: string,
  coinPlural: string,
) {
  const recentAttempts = await database()
    .prepare(
      `SELECT COUNT(*) AS count
         FROM audit_logs
        WHERE actor_user_id = ?
          AND action = 'gift.redeem.attempt'
          AND created_at > datetime('now', '-10 minutes')`,
    )
    .bind(actorId)
    .first<{ count: number }>();
  if (Number(recentAttempts?.count ?? 0) >= 8) {
    throw new ApiError(
      429,
      "GIFT_REDEMPTION_RATE_LIMITED",
      "Wait a few minutes before trying another Gift Code.",
    );
  }
  await database()
    .prepare(
      `INSERT INTO audit_logs
       (id, actor_user_id, action, category, source_area,
        target_type, target_id, target_label, request_id, new_value_json)
       VALUES (?, ?, 'gift.redeem.attempt', 'COMMERCE_STORE', 'GIFT_CARDS',
               'GIFT_CARD', 'REDACTED', 'Gift Code redemption', ?, '{}')`,
    )
    .bind(randomId(), actorId, requestId)
    .run();
  if (!isGiftCodeShape(rawCode)) {
    throw new ApiError(
      404,
      "GIFT_CODE_INVALID",
      "This gift code is invalid or no longer available.",
    );
  }
  const db = database();
  const codeHash = await hashGiftCode(rawCode);
  const card = await db
    .prepare(
      `SELECT id, purchaser_user_id AS purchaserUserId,
              recipient_user_id AS recipientUserId,
              coin_amount AS coinAmount, status, expires_at AS expiresAt
         FROM gift_cards
        WHERE code_hash = ?
        LIMIT 1`,
    )
    .bind(codeHash)
    .first<{
      id: string;
      purchaserUserId: string;
      recipientUserId: string | null;
      coinAmount: number;
      status: string;
      expiresAt: string | null;
    }>();
  const usable =
    card &&
    card.status === "ACTIVE" &&
    card.purchaserUserId !== actorId &&
    (!card.recipientUserId || card.recipientUserId === actorId) &&
    (!card.expiresAt || Date.parse(card.expiresAt) > Date.now());
  if (!usable || !card) {
    throw new ApiError(
      404,
      "GIFT_CODE_INVALID",
      "This gift code is invalid or no longer available.",
    );
  }
  const walletId = await ensureWalletAccount(db, actorId, "ONYX");
  const escrowId = platformAccountId("gift_escrow", "ONYX");
  const transactionId = randomId();
  const results = await db.batch([
    db
      .prepare(
        `UPDATE gift_cards
            SET status = 'REDEEMED',
                redeemed_by_user_id = ?,
                redeemed_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND status = 'ACTIVE'
            AND purchaser_user_id <> ?
            AND (recipient_user_id IS NULL OR recipient_user_id = ?)
            AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
            AND redeemed_transaction_id IS NULL`,
      )
      .bind(actorId, card.id, actorId, actorId),
    db
      .prepare(
        `INSERT INTO ledger_transactions
         (id, kind, reference_type, reference_id, idempotency_key, memo)
         SELECT ?, 'GIFT_CARD_REDEEM', 'GIFT_CARD', id, ?, ?
           FROM gift_cards
          WHERE id = ?
            AND redeemed_by_user_id = ?
            AND redeemed_transaction_id IS NULL`,
      )
      .bind(
        transactionId,
        `gift:redeem:${card.id}`,
        `Redeemed gift card · ${card.coinAmount} ${coinPlural}`,
        card.id,
        actorId,
      ),
    db
      .prepare(
        `INSERT INTO ledger_entries
         (id, transaction_id, account_id, amount)
         SELECT ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM ledger_transactions WHERE id = ?)`,
      )
      .bind(
        randomId(),
        transactionId,
        escrowId,
        -Number(card.coinAmount),
        transactionId,
      ),
    db
      .prepare(
        `INSERT INTO ledger_entries
         (id, transaction_id, account_id, amount)
         SELECT ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM ledger_transactions WHERE id = ?)`,
      )
      .bind(
        randomId(),
        transactionId,
        walletId,
        Number(card.coinAmount),
        transactionId,
      ),
    db
      .prepare(
        `UPDATE gift_cards
            SET redeemed_transaction_id = ?
          WHERE id = ?
            AND redeemed_by_user_id = ?
            AND redeemed_transaction_id IS NULL
            AND EXISTS (SELECT 1 FROM ledger_transactions WHERE id = ?)`,
      )
      .bind(transactionId, card.id, actorId, transactionId),
  ]);
  if (!results[0]?.meta.changes || !results[4]?.meta.changes) {
    throw new ApiError(
      404,
      "GIFT_CODE_INVALID",
      "This gift code is invalid or no longer available.",
    );
  }
  return {
    redeemed: true,
    amount: Number(card.coinAmount),
    wallet: await walletSnapshot(db, actorId, "ONYX"),
  };
}

async function supportTeam(
  actorId: string,
  actorDisplayName: string,
  coinPlural: string,
  payload: Extract<
    z.infer<typeof giftActionSchema>,
    { action: "SUPPORT_TEAM" }
  >,
) {
  const db = database();
  const existing = await db
    .prepare(
      `SELECT id, team_id AS teamId, coin_amount AS coinAmount, message
         FROM team_support_receipts
        WHERE supporter_user_id = ? AND idempotency_key = ?
        LIMIT 1`,
    )
    .bind(actorId, payload.idempotencyKey)
    .first<{
      id: string;
      teamId: string;
      coinAmount: number;
      message: string;
    }>();
  if (existing) {
    const existingSeries = await db
      .prepare(
        `SELECT series_id AS seriesId
           FROM team_support_receipt_series
          WHERE receipt_id = ?
          ORDER BY series_id`,
      )
      .bind(existing.id)
      .all<{ seriesId: string }>();
    if (
      existing.teamId !== payload.teamId ||
      Number(existing.coinAmount) !== payload.amount ||
      existing.message !== payload.message ||
      existingSeries.results.map((entry) => entry.seriesId).join("|") !==
        payload.seriesIds.join("|")
    ) {
      throw new ApiError(
        409,
        "IDEMPOTENCY_KEY_REUSED",
        "Use a new request identifier for this support purchase.",
      );
    }
    return { receiptId: existing.id, created: false };
  }
  const team = await db
    .prepare(
      `SELECT id, slug, name
         FROM teams
        WHERE id = ?
          AND verification_status = 'VERIFIED'
          AND is_archived = 0
        LIMIT 1`,
    )
    .bind(payload.teamId)
    .first<{ id: string; slug: string; name: string }>();
  if (!team) {
    throw new ApiError(
      404,
      "TEAM_NOT_AVAILABLE",
      "This Translation Team is not available for support.",
    );
  }
  const targetedSeries =
    payload.seriesIds.length > 0
      ? await db
          .prepare(
            `SELECT s.id, s.slug, s.title
               FROM chapters c
               JOIN series s ON s.id = c.series_id
              WHERE c.team_id = ?
                AND s.id IN (${payload.seriesIds.map(() => "?").join(",")})
                AND c.state = 'PUBLISHED'
                AND c.visibility = 'PUBLIC'
                AND c.published_at IS NOT NULL
                AND datetime(c.published_at) <= datetime('now')
                AND s.is_published = 1
                AND s.archived_at IS NULL
                AND s.status NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
                AND s.rights_status IN
                  ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
              GROUP BY s.id, s.slug, s.title
              ORDER BY s.id`,
          )
          .bind(team.id, ...payload.seriesIds)
          .all<{ id: string; slug: string; title: string }>()
      : { results: [] as Array<{ id: string; slug: string; title: string }> };
  if (targetedSeries.results.length !== payload.seriesIds.length) {
    throw new ApiError(
      422,
      "TEAM_SERIES_UNAVAILABLE",
      "One or more selected series are not published by this Translation Team.",
    );
  }
  const recipients = await db
    .prepare(
      `SELECT tm.user_id AS userId
         FROM team_memberships tm
         JOIN users u ON u.id = tm.user_id
        WHERE tm.team_id = ?
          AND tm.status = 'ACTIVE'
          AND u.status = 'ACTIVE'
          AND tm.user_id <> ?
        ORDER BY tm.user_id
        LIMIT 100`,
    )
    .bind(team.id, actorId)
    .all<{ userId: string }>();
  const wallet = await walletSnapshot(db, actorId, "ONYX");
  if (wallet.balance < payload.amount) {
    throw new ApiError(
      409,
      "INSUFFICIENT_ONYX",
      `Your ${coinPlural} balance is too low for this support purchase.`,
    );
  }
  const teamAccountId = `la_team_${team.id}_support_onyx`;
  const receiptId = randomId();
  const transactionId = randomId();
  const supportTarget =
    targetedSeries.results.length > 0
      ? targetedSeries.results.map((entry) => entry.title).join(", ")
      : team.name;
  const metadata = JSON.stringify({
    receiptId,
    teamId: team.id,
    seriesIds: payload.seriesIds,
    amount: payload.amount,
    currency: "ONYX",
    supporterUserId: actorId,
    message: payload.message,
  });
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT OR IGNORE INTO ledger_accounts
         (id, owner_type, owner_id, currency, account_type)
         VALUES (?, 'TEAM', ?, 'ONYX', 'SUPPORT')`,
      )
      .bind(teamAccountId, team.id),
    db
      .prepare(
        `INSERT OR IGNORE INTO ledger_transactions
         (id, kind, reference_type, reference_id, idempotency_key, memo)
         SELECT ?, 'TEAM_SUPPORT', 'TEAM', ?, ?, ?
          WHERE (
            SELECT COALESCE(SUM(amount), 0)
              FROM ledger_entries
             WHERE account_id = ?
          ) >= ?`,
      )
      .bind(
        transactionId,
        team.id,
        `team-support:${actorId}:${payload.idempotencyKey}`,
        `Supported ${team.name} · ${payload.amount} ${coinPlural}`,
        wallet.accountId,
        payload.amount,
      ),
    db
      .prepare(
        `INSERT INTO ledger_entries
         (id, transaction_id, account_id, amount)
         SELECT ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM ledger_transactions WHERE id = ?
          )`,
      )
      .bind(
        randomId(),
        transactionId,
        wallet.accountId,
        -payload.amount,
        transactionId,
      ),
    db
      .prepare(
        `INSERT INTO ledger_entries
         (id, transaction_id, account_id, amount)
         SELECT ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM ledger_transactions WHERE id = ?
          )`,
      )
      .bind(
        randomId(),
        transactionId,
        teamAccountId,
        payload.amount,
        transactionId,
      ),
    db
      .prepare(
        `INSERT INTO team_support_receipts
         (id, supporter_user_id, team_id, idempotency_key,
          coin_amount, message, transaction_id)
         SELECT ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM ledger_transactions WHERE id = ?
          )`,
      )
      .bind(
        receiptId,
        actorId,
        team.id,
        payload.idempotencyKey,
        payload.amount,
        payload.message,
        transactionId,
        transactionId,
      ),
    ...targetedSeries.results.map((entry) =>
      db
        .prepare(
          `INSERT INTO team_support_receipt_series
           (receipt_id, series_id)
           SELECT ?, ?
            WHERE EXISTS (
              SELECT 1 FROM team_support_receipts WHERE id = ?
            )`,
        )
        .bind(receiptId, entry.id, receiptId),
    ),
    ...recipients.results.map((recipient) =>
      db
        .prepare(
          `INSERT INTO notifications
           (id, user_id, kind, title, body, dedupe_key, action_url,
            metadata_json)
           SELECT ?, ?, 'TEAM_SUPPORT', 'New Translation Team support',
                  ?, ?, ?, ?
            WHERE EXISTS (
              SELECT 1 FROM team_support_receipts WHERE id = ?
            )`,
        )
        .bind(
          randomId(),
          recipient.userId,
          `${actorDisplayName} supported ${supportTarget} with ${payload.amount.toLocaleString("en-US")} ${coinPlural}.`,
          `team-support:${receiptId}:${recipient.userId}`,
          `/team/${team.slug}`,
          metadata,
          receiptId,
        ),
    ),
  ];
  const results = await db.batch(statements);
  if (!results[4]?.meta.changes) {
    const concurrentReceipt = await db
      .prepare(
        `SELECT id, team_id AS teamId, coin_amount AS coinAmount, message
           FROM team_support_receipts
          WHERE supporter_user_id = ? AND idempotency_key = ?
          LIMIT 1`,
      )
      .bind(actorId, payload.idempotencyKey)
      .first<{
        id: string;
        teamId: string;
        coinAmount: number;
        message: string;
      }>();
    if (concurrentReceipt) {
      const concurrentSeries = await db
        .prepare(
          `SELECT series_id AS seriesId
             FROM team_support_receipt_series
            WHERE receipt_id = ?
            ORDER BY series_id`,
        )
        .bind(concurrentReceipt.id)
        .all<{ seriesId: string }>();
      if (
        concurrentReceipt.teamId !== payload.teamId ||
        Number(concurrentReceipt.coinAmount) !== payload.amount ||
        concurrentReceipt.message !== payload.message ||
        concurrentSeries.results
          .map((entry) => entry.seriesId)
          .join("|") !== payload.seriesIds.join("|")
      ) {
        throw new ApiError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "Use a new request identifier for this support purchase.",
        );
      }
      return {
        receiptId: concurrentReceipt.id,
        team: { id: concurrentReceipt.teamId, name: team.name },
        series: targetedSeries.results,
        amount: Number(concurrentReceipt.coinAmount),
        created: false,
        wallet: await walletSnapshot(db, actorId, "ONYX"),
      };
    }
    throw new ApiError(
      409,
      "SUPPORT_NOT_CREATED",
      "This support purchase could not be completed.",
    );
  }
  return {
    receiptId,
    team: { id: team.id, name: team.name },
    series: targetedSeries.results,
    amount: payload.amount,
    created: true,
    wallet: await walletSnapshot(db, actorId, "ONYX"),
  };
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    const commercial = await requirePaidEconomyPublic();
    const coinPlural = commercial.economy.coinPlural;
    const payload = giftActionSchema.parse(await request.json());
    const result =
      payload.action === "CREATE_GIFT"
        ? await createGift(actor.id, coinPlural, payload)
        : payload.action === "REDEEM_GIFT"
          ? await redeemGift(actor.id, payload.code, requestId, coinPlural)
          : await supportTeam(
              actor.id,
              actor.displayName,
              coinPlural,
              payload,
            );
    return json(
      requestId,
      {
        ...result,
        balances: await economySnapshot(database(), actor.id),
      },
      { headers: privateHeaders },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
