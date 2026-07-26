import { env } from "cloudflare:workers";
import { z } from "zod";
import type { RouletteReward } from "@/lib/reward-settings";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  assertSameOrigin,
  requestIdFor,
} from "@/lib/server/admin-utils";
import {
  economySnapshot,
  ensureWalletAccount,
  platformAccountId,
} from "@/lib/server/economy";
import { requireActor } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";
import { getRewardSettingsDocument } from "@/lib/server/reward-settings";

export const dynamic = "force-dynamic";

const spinSchema = z.object({
  idempotencyKey: z.string().trim().min(12).max(160),
});

type SpinRow = {
  id: string;
  rewardKey: string;
  rewardType: "SHARDS" | "ONYX" | "STORE_ITEM";
  rewardAmount: number;
  storeItemId: string | null;
  nextEligibleAt: string;
  spunAt: string;
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
      "Roulette is temporarily unavailable.",
    );
  }
  return env.DB;
}

function secureRoll(maxExclusive: number) {
  if (maxExclusive <= 1) return 0;
  const ceiling = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive;
  const value = new Uint32Array(1);
  do {
    crypto.getRandomValues(value);
  } while (value[0] >= ceiling);
  return value[0] % maxExclusive;
}

function selectReward(rewards: RouletteReward[]) {
  const total = rewards.reduce((sum, reward) => sum + reward.weight, 0);
  let roll = secureRoll(total);
  for (const reward of rewards) {
    if (roll < reward.weight) return reward;
    roll -= reward.weight;
  }
  return rewards[rewards.length - 1];
}

function mapSpin(row: SpinRow, label: string | null = null) {
  return {
    id: row.id,
    rewardKey: row.rewardKey,
    rewardType: row.rewardType,
    rewardAmount: Number(row.rewardAmount),
    storeItemId: row.storeItemId,
    label,
    nextEligibleAt: row.nextEligibleAt,
    spunAt: row.spunAt,
  };
}

async function responseData(userId: string) {
  const [document, state, history, balances] = await Promise.all([
    getRewardSettingsDocument(),
    database()
      .prepare(
        `SELECT next_eligible_at AS nextEligibleAt,
                last_spin_id AS lastSpinId
           FROM roulette_state
          WHERE user_id = ?
          LIMIT 1`,
      )
      .bind(userId)
      .first<{ nextEligibleAt: string; lastSpinId: string | null }>(),
    database()
      .prepare(
        `SELECT id, reward_key AS rewardKey, reward_type AS rewardType,
                reward_amount AS rewardAmount, store_item_id AS storeItemId,
                next_eligible_at AS nextEligibleAt, spun_at AS spunAt
           FROM roulette_spins
          WHERE user_id = ?
          ORDER BY spun_at DESC
          LIMIT 12`,
      )
      .bind(userId)
      .all<SpinRow>(),
    economySnapshot(database(), userId),
  ]);
  const now = Date.now();
  const nextEligibleAt =
    state?.nextEligibleAt ?? "1970-01-01T00:00:00.000Z";
  const labelByKey = new Map(
    document.settings.rouletteRewards.map((reward) => [
      reward.id,
      reward.label,
    ]),
  );
  return {
    settings: document.settings,
    settingsRevision: document.revision,
    eligible: Date.parse(nextEligibleAt) <= now,
    nextEligibleAt,
    history: history.results.map((spin) =>
      mapSpin(spin, labelByKey.get(spin.rewardKey) ?? null),
    ),
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

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    const payload = spinSchema.parse(await request.json());
    const db = database();
    const existing = await db
      .prepare(
        `SELECT id, reward_key AS rewardKey, reward_type AS rewardType,
                reward_amount AS rewardAmount, store_item_id AS storeItemId,
                next_eligible_at AS nextEligibleAt, spun_at AS spunAt
           FROM roulette_spins
          WHERE user_id = ? AND idempotency_key = ?
          LIMIT 1`,
      )
      .bind(actor.id, payload.idempotencyKey)
      .first<SpinRow>();
    if (existing) {
      const document = await getRewardSettingsDocument();
      const label =
        document.settings.rouletteRewards.find(
          (reward) => reward.id === existing.rewardKey,
        )?.label ?? null;
      return json(
        requestId,
        {
          spin: mapSpin(existing, label),
          replayed: true,
          state: await responseData(actor.id),
        },
        { headers: privateHeaders },
      );
    }
    const document = await getRewardSettingsDocument();
    const owned = await db
      .prepare(
        "SELECT item_id AS itemId FROM user_store_items WHERE user_id = ?",
      )
      .bind(actor.id)
      .all<{ itemId: string }>();
    const ownedIds = new Set(owned.results.map((item) => item.itemId));
    const candidates = document.settings.rouletteRewards.filter(
      (reward) =>
        reward.enabled &&
        (reward.type !== "STORE_ITEM" ||
          Boolean(reward.itemId && !ownedIds.has(reward.itemId))),
    );
    if (candidates.length === 0) {
      throw new ApiError(
        409,
        "ROULETTE_REWARDS_UNAVAILABLE",
        "No Roulette rewards are currently available.",
      );
    }
    const reward = selectReward(candidates);
    const spinId = randomId();
    const transactionId = randomId();
    const nextEligibleAt = new Date(
      Date.now() + document.settings.rouletteCooldownHours * 3_600_000,
    ).toISOString();
    const statements: D1PreparedStatement[] = [
      db
        .prepare(
          `INSERT INTO roulette_state
           (user_id, next_eligible_at, last_spin_id, revision)
           VALUES (?, ?, ?, 1)
           ON CONFLICT(user_id) DO UPDATE SET
             next_eligible_at = excluded.next_eligible_at,
             last_spin_id = excluded.last_spin_id,
             revision = roulette_state.revision + 1,
             updated_at = CURRENT_TIMESTAMP
           WHERE datetime(roulette_state.next_eligible_at) <= datetime('now')`,
        )
        .bind(actor.id, nextEligibleAt, spinId),
      db
        .prepare(
          `INSERT INTO ledger_transactions
           (id, kind, reference_type, reference_id, idempotency_key, memo)
           SELECT ?, 'ROULETTE_REWARD', 'ROULETTE_SPIN', ?, ?, ?
            WHERE EXISTS (
              SELECT 1 FROM roulette_state
               WHERE user_id = ? AND last_spin_id = ?
            )`,
        )
        .bind(
          transactionId,
          spinId,
          `roulette:${actor.id}:${payload.idempotencyKey}`,
          `Roulette · ${reward.label}`,
          actor.id,
          spinId,
        ),
    ];
    if (reward.type === "STORE_ITEM") {
      if (!reward.itemId) {
        throw new ApiError(
          409,
          "ROULETTE_REWARD_INVALID",
          "The selected Roulette reward is not available.",
        );
      }
      statements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO user_store_items
             (user_id, item_id, transaction_id)
             SELECT ?, ?, ?
              WHERE EXISTS (SELECT 1 FROM ledger_transactions WHERE id = ?)`,
          )
          .bind(actor.id, reward.itemId, transactionId, transactionId),
      );
    } else {
      const currency = reward.type;
      const userAccountId = await ensureWalletAccount(
        db,
        actor.id,
        currency,
      );
      const sourceAccountId = platformAccountId("rewards", currency);
      await db
        .prepare(
          `INSERT OR IGNORE INTO ledger_accounts
           (id, owner_type, owner_id, currency, account_type)
           VALUES (?, 'PLATFORM', 'NYASCANS_REWARDS', ?, 'SOURCE')`,
        )
        .bind(sourceAccountId, currency)
        .run();
      statements.push(
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
            sourceAccountId,
            -reward.amount,
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
            userAccountId,
            reward.amount,
            transactionId,
          ),
      );
    }
    statements.push(
      db
        .prepare(
          `INSERT INTO roulette_spins
           (id, user_id, idempotency_key, reward_key, reward_type,
            reward_amount, store_item_id, transaction_id, next_eligible_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM ledger_transactions WHERE id = ?)`,
        )
        .bind(
          spinId,
          actor.id,
          payload.idempotencyKey,
          reward.id,
          reward.type,
          reward.amount,
          reward.itemId,
          transactionId,
          nextEligibleAt,
          transactionId,
        ),
    );
    const results = await db.batch(statements);
    if (!results[0]?.meta.changes) {
      const state = await responseData(actor.id);
      throw new ApiError(
        409,
        "ROULETTE_COOLDOWN",
        `Your next spin is available at ${state.nextEligibleAt}.`,
      );
    }
    const spin = await db
      .prepare(
        `SELECT id, reward_key AS rewardKey, reward_type AS rewardType,
                reward_amount AS rewardAmount, store_item_id AS storeItemId,
                next_eligible_at AS nextEligibleAt, spun_at AS spunAt
           FROM roulette_spins
          WHERE id = ?
          LIMIT 1`,
      )
      .bind(spinId)
      .first<SpinRow>();
    if (!spin) {
      throw new ApiError(
        409,
        "ROULETTE_SPIN_FAILED",
        "The Roulette spin could not be completed.",
      );
    }
    return json(
      requestId,
      {
        spin: mapSpin(spin, reward.label),
        replayed: false,
        state: await responseData(actor.id),
      },
      { headers: privateHeaders },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
