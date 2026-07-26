import type { D1Database } from "@cloudflare/workers-types";
import type { RewardCurrency } from "@/lib/reward-settings";
import { ApiError } from "@/lib/server/api";
import { randomId } from "@/lib/server/random-id";

export type WalletActivity = {
  id: string;
  kind: string;
  memo: string;
  createdAt: string;
  amount: number;
};

export type CurrencyWallet = {
  balance: number;
  currency: RewardCurrency;
  accountId: string;
  activity: WalletActivity[];
};

export function userWalletAccountId(
  userId: string,
  currency: RewardCurrency,
) {
  return currency === "ONYX"
    ? `la_user_${userId}`
    : `la_user_${userId}_shards`;
}

export function platformAccountId(
  purpose: string,
  currency: RewardCurrency,
) {
  return `la_platform_${purpose.toLowerCase()}_${currency.toLowerCase()}`;
}

export async function ensureWalletAccount(
  database: D1Database,
  userId: string,
  currency: RewardCurrency,
) {
  const accountId = userWalletAccountId(userId, currency);
  await database
    .prepare(
      `INSERT OR IGNORE INTO ledger_accounts
       (id, owner_type, owner_id, currency, account_type)
       VALUES (?, 'USER', ?, ?, 'AVAILABLE')`,
    )
    .bind(accountId, userId, currency)
    .run();
  return accountId;
}

export async function walletSnapshot(
  database: D1Database,
  userId: string,
  currency: RewardCurrency,
): Promise<CurrencyWallet> {
  const accountId = await ensureWalletAccount(database, userId, currency);
  const [balance, activity] = await Promise.all([
    database
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS balance
           FROM ledger_entries
          WHERE account_id = ?`,
      )
      .bind(accountId)
      .first<{ balance: number }>(),
    database
      .prepare(
        `SELECT t.id, t.kind, t.memo, t.created_at AS createdAt, e.amount
           FROM ledger_entries e
           JOIN ledger_transactions t ON t.id = e.transaction_id
          WHERE e.account_id = ?
          ORDER BY t.created_at DESC
          LIMIT 20`,
      )
      .bind(accountId)
      .all<WalletActivity>(),
  ]);
  return {
    balance: Number(balance?.balance ?? 0),
    currency,
    accountId,
    activity: activity.results.map((entry) => ({
      ...entry,
      amount: Number(entry.amount),
    })),
  };
}

export async function economySnapshot(database: D1Database, userId: string) {
  const [onyx, shards] = await Promise.all([
    walletSnapshot(database, userId, "ONYX"),
    walletSnapshot(database, userId, "SHARDS"),
  ]);
  return { onyx, shards };
}

export async function grantCurrencyReward(
  database: D1Database,
  input: {
    userId: string;
    currency: RewardCurrency;
    amount: number;
    kind: string;
    referenceType: string;
    referenceId: string;
    idempotencyKey: string;
    memo: string;
  },
) {
  if (!Number.isInteger(input.amount) || input.amount < 1) {
    return { created: false, transactionId: null, balance: null };
  }
  const userAccountId = await ensureWalletAccount(
    database,
    input.userId,
    input.currency,
  );
  const sourceAccountId = platformAccountId("rewards", input.currency);
  const transactionId = randomId();
  const results = await database.batch([
    database
      .prepare(
        `INSERT OR IGNORE INTO ledger_accounts
         (id, owner_type, owner_id, currency, account_type)
         VALUES (?, 'PLATFORM', 'NYASCANS_REWARDS', ?, 'SOURCE')`,
      )
      .bind(sourceAccountId, input.currency),
    database
      .prepare(
        `INSERT OR IGNORE INTO ledger_transactions
         (id, kind, reference_type, reference_id, idempotency_key, memo)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        transactionId,
        input.kind,
        input.referenceType,
        input.referenceId,
        input.idempotencyKey,
        input.memo,
      ),
    database
      .prepare(
        `INSERT INTO ledger_entries
         (id, transaction_id, account_id, amount)
         SELECT ?, id, ?, ?
           FROM ledger_transactions
          WHERE id = ?`,
      )
      .bind(randomId(), sourceAccountId, -input.amount, transactionId),
    database
      .prepare(
        `INSERT INTO ledger_entries
         (id, transaction_id, account_id, amount)
         SELECT ?, id, ?, ?
           FROM ledger_transactions
          WHERE id = ?`,
      )
      .bind(randomId(), userAccountId, input.amount, transactionId),
  ]);
  const created = Number(results[1]?.meta.changes ?? 0) === 1;
  const existing = created
    ? { id: transactionId, referenceId: input.referenceId }
    : await database
        .prepare(
          `SELECT id, reference_id AS referenceId
             FROM ledger_transactions
            WHERE idempotency_key = ?
            LIMIT 1`,
        )
        .bind(input.idempotencyKey)
        .first<{ id: string; referenceId: string }>();
  if (existing && existing.referenceId !== input.referenceId) {
    throw new ApiError(
      409,
      "IDEMPOTENCY_KEY_REUSED",
      "Use a new request identifier for this reward.",
    );
  }
  const wallet = await walletSnapshot(
    database,
    input.userId,
    input.currency,
  );
  return {
    created,
    transactionId: existing?.id ?? null,
    balance: wallet.balance,
  };
}
