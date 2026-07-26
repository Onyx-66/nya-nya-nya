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
import { randomId } from "@/lib/server/random-id";

export const dynamic = "force-dynamic";

const giftActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("CREATE_GIFT"),
    amount: z.number().int().min(1).max(1_000_000),
    recipientLabel: z.string().trim().max(80).default(""),
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
  recipientLabel: string;
  message: string;
  status: "ACTIVE" | "REDEEMED" | "EXPIRED";
  expiresAt: string | null;
  redeemedAt: string | null;
  createdAt: string;
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
  const [cards, teams, balances] = await Promise.all([
    database()
      .prepare(
        `SELECT id, code_ciphertext AS codeCiphertext,
                code_nonce AS codeNonce, code_suffix AS codeSuffix,
                coin_amount AS coinAmount,
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
    economySnapshot(database(), userId),
  ]);
  return {
    cards: await Promise.all(cards.results.map(mapGiftCard)),
    teams: teams.results,
    balances,
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

async function createGift(
  actorId: string,
  payload: Extract<
    z.infer<typeof giftActionSchema>,
    { action: "CREATE_GIFT" }
  >,
) {
  const db = database();
  const existing = await db
    .prepare(
      `SELECT id, code_ciphertext AS codeCiphertext,
              code_nonce AS codeNonce, code_suffix AS codeSuffix,
              coin_amount AS coinAmount,
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
      existing.recipientLabel !== payload.recipientLabel ||
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
      "Your Onyx balance is too low for this gift.",
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
        `Gift card · ${payload.amount} Onyx Coins`,
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
          recipient_label, message, purchase_transaction_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        payload.recipientLabel,
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
              coin_amount AS coinAmount, status, expires_at AS expiresAt
         FROM gift_cards
        WHERE code_hash = ?
        LIMIT 1`,
    )
    .bind(codeHash)
    .first<{
      id: string;
      purchaserUserId: string;
      coinAmount: number;
      status: string;
      expiresAt: string | null;
    }>();
  const usable =
    card &&
    card.status === "ACTIVE" &&
    card.purchaserUserId !== actorId &&
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
            AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
            AND redeemed_transaction_id IS NULL`,
      )
      .bind(actorId, card.id, actorId),
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
        `Redeemed gift card · ${card.coinAmount} Onyx Coins`,
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
  payload: Extract<
    z.infer<typeof giftActionSchema>,
    { action: "SUPPORT_TEAM" }
  >,
) {
  const db = database();
  const existing = await db
    .prepare(
      `SELECT id, team_id AS teamId, coin_amount AS coinAmount
         FROM team_support_receipts
        WHERE supporter_user_id = ? AND idempotency_key = ?
        LIMIT 1`,
    )
    .bind(actorId, payload.idempotencyKey)
    .first<{ id: string; teamId: string; coinAmount: number }>();
  if (existing) {
    if (
      existing.teamId !== payload.teamId ||
      Number(existing.coinAmount) !== payload.amount
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
      `SELECT id, name
         FROM teams
        WHERE id = ?
          AND verification_status = 'VERIFIED'
          AND is_archived = 0
        LIMIT 1`,
    )
    .bind(payload.teamId)
    .first<{ id: string; name: string }>();
  if (!team) {
    throw new ApiError(
      404,
      "TEAM_NOT_AVAILABLE",
      "This Translation Team is not available for support.",
    );
  }
  const wallet = await walletSnapshot(db, actorId, "ONYX");
  if (wallet.balance < payload.amount) {
    throw new ApiError(
      409,
      "INSUFFICIENT_ONYX",
      "Your Onyx balance is too low for this support purchase.",
    );
  }
  const teamAccountId = `la_team_${team.id}_support_onyx`;
  const receiptId = randomId();
  const transactionId = randomId();
  const results = await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO ledger_accounts
         (id, owner_type, owner_id, currency, account_type)
         VALUES (?, 'TEAM', ?, 'ONYX', 'SUPPORT')`,
      )
      .bind(teamAccountId, team.id),
    db
      .prepare(
        `INSERT INTO ledger_transactions
         (id, kind, reference_type, reference_id, idempotency_key, memo)
         VALUES (?, 'TEAM_SUPPORT', 'TEAM', ?, ?, ?)`,
      )
      .bind(
        transactionId,
        team.id,
        `team-support:${actorId}:${payload.idempotencyKey}`,
        `Supported ${team.name} · ${payload.amount} Onyx Coins`,
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
      .bind(randomId(), transactionId, teamAccountId, payload.amount),
    db
      .prepare(
        `INSERT INTO team_support_receipts
         (id, supporter_user_id, team_id, idempotency_key,
          coin_amount, message, transaction_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        receiptId,
        actorId,
        team.id,
        payload.idempotencyKey,
        payload.amount,
        payload.message,
        transactionId,
      ),
  ]);
  if (!results[4]?.meta.changes) {
    throw new ApiError(
      409,
      "SUPPORT_NOT_CREATED",
      "This support purchase could not be completed.",
    );
  }
  return {
    receiptId,
    team: { id: team.id, name: team.name },
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
    const payload = giftActionSchema.parse(await request.json());
    const result =
      payload.action === "CREATE_GIFT"
        ? await createGift(actor.id, payload)
        : payload.action === "REDEEM_GIFT"
          ? await redeemGift(actor.id, payload.code, requestId)
          : await supportTeam(actor.id, payload);
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
