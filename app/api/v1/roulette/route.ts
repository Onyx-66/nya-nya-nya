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
import { getCommercialSettingsDocument } from "@/lib/server/commercial-settings";

export const dynamic = "force-dynamic";

const spinSchema = z.object({
  idempotencyKey: z.string().trim().min(12).max(160),
  action: z.enum(["SPIN", "CLAIM_TASK"]).default("SPIN"),
  mode: z.enum(["DAILY", "PAID"]).or(z.literal("TASK")).default("DAILY"),
  currency: z.enum(["SHARDS", "ONYX"]).optional(),
  taskId: z.string().trim().min(2).max(80).optional(),
}).superRefine((payload, context) => {
  if (payload.action === "CLAIM_TASK" && !payload.taskId) {
    context.addIssue({
      code: "custom",
      path: ["taskId"],
      message: "Choose a weekly task to claim.",
    });
  }
});

type SpinRow = {
  id: string;
  rewardKey: string;
  rewardType: "SHARDS" | "ONYX" | "STORE_ITEM";
  rewardAmount: number;
  storeItemId: string | null;
  spinMode: "DAILY" | "TASK" | "PAID";
  costShards: number;
  costCurrency: "SHARDS" | "ONYX" | null;
  costAmount: number;
  nextEligibleAt: string;
  globalSpinNumber: number;
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

async function nextGlobalSpinNumber(poolKey: "FREE" | "PAID") {
  const db = database();
  await db
    .prepare(
      `INSERT OR IGNORE INTO roulette_pool_counters
       (pool_key, total_spins, revision)
       VALUES (?, 0, 1)`,
    )
    .bind(poolKey)
    .run();
  const row = await db
    .prepare(
      `SELECT total_spins AS totalSpins
         FROM roulette_pool_counters
        WHERE pool_key = ?
        LIMIT 1`,
    )
    .bind(poolKey)
    .first<{ totalSpins: number }>();
  if (!row) {
    throw new ApiError(
      503,
      "ROULETTE_COUNTER_UNAVAILABLE",
      "The global Roulette counter could not be loaded.",
    );
  }
  return Number(row.totalSpins) + 1;
}

type CadenceRow = {
  rewardKey: string;
  intervalSpins: number;
  nextDueSpin: number;
  lastAwardedSpin: number | null;
};

async function cadenceStateByReward(
  poolKey: "FREE" | "PAID",
  rewards: RouletteReward[],
  globalSpinNumber: number,
) {
  const intervalRewards = rewards.filter(
    (reward) =>
      reward.distributionMode === "GLOBAL_INTERVAL" &&
      Number(reward.globalIntervalSpins ?? 0) >= 2,
  );
  if (!intervalRewards.length) return new Map<string, CadenceRow>();
  const db = database();
  const statements: D1PreparedStatement[] = [];
  for (const reward of intervalRewards) {
    const interval = Number(reward.globalIntervalSpins);
    const nextDue = globalSpinNumber - 1 + interval;
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO roulette_reward_cadence
           (pool_key, reward_key, interval_spins, next_due_spin, revision)
           VALUES (?, ?, ?, ?, 1)`,
        )
        .bind(poolKey, reward.id, interval, nextDue),
      db
        .prepare(
          `UPDATE roulette_reward_cadence
              SET interval_spins = ?,
                  next_due_spin = ?,
                  revision = revision + 1,
                  updated_at = CURRENT_TIMESTAMP
            WHERE pool_key = ?
              AND reward_key = ?
              AND interval_spins <> ?`,
        )
        .bind(interval, nextDue, poolKey, reward.id, interval),
    );
  }
  await db.batch(statements);
  const rows = await db
    .prepare(
      `SELECT reward_key AS rewardKey,
              interval_spins AS intervalSpins,
              next_due_spin AS nextDueSpin,
              last_awarded_spin AS lastAwardedSpin
         FROM roulette_reward_cadence
        WHERE pool_key = ?
          AND reward_key IN (${intervalRewards.map(() => "?").join(", ")})`,
    )
    .bind(poolKey, ...intervalRewards.map((reward) => reward.id))
    .all<CadenceRow>();
  return new Map(rows.results.map((row) => [row.rewardKey, row]));
}

function selectRewardForGlobalSpin(
  rewards: RouletteReward[],
  globalSpinNumber: number,
  cadence: Map<string, CadenceRow>,
) {
  const due = rewards
    .filter(
      (reward) => {
        const state = cadence.get(reward.id);
        return (
          reward.distributionMode === "GLOBAL_INTERVAL" &&
          state &&
          Number(state.nextDueSpin) <= globalSpinNumber
        );
      },
    )
    .sort(
      (left, right) => {
        const leftState = cadence.get(left.id)!;
        const rightState = cadence.get(right.id)!;
        return (
          Number(leftState.nextDueSpin) - Number(rightState.nextDueSpin) ||
          Number(rightState.intervalSpins) - Number(leftState.intervalSpins) ||
          left.id.localeCompare(right.id)
        );
      },
    );
  if (due[0]) {
    return { reward: due[0], cadence: cadence.get(due[0].id) ?? null };
  }
  const weighted = rewards.filter(
    (reward) => reward.distributionMode !== "GLOBAL_INTERVAL",
  );
  if (!weighted.length) {
    throw new ApiError(
      409,
      "ROULETTE_WEIGHTED_REWARD_REQUIRED",
      "Keep at least one weighted reward enabled between global-cadence rewards.",
    );
  }
  return { reward: selectReward(weighted), cadence: null };
}

function mapSpin(row: SpinRow, label: string | null = null) {
  return {
    id: row.id,
    rewardKey: row.rewardKey,
    rewardType: row.rewardType,
    rewardAmount: Number(row.rewardAmount),
    storeItemId: row.storeItemId,
    spinMode: row.spinMode,
    costShards: Number(row.costShards),
    costCurrency: row.costCurrency,
    costAmount: Number(row.costAmount),
    label,
    nextEligibleAt: row.nextEligibleAt,
    globalSpinNumber: Number(row.globalSpinNumber ?? 0),
    spunAt: row.spunAt,
  };
}

function configuredRewardLabel(label: string, coinPlural: string) {
  return label.replace(/\b(?:Onyx|Paw) Coins?\b/giu, coinPlural);
}

function rewardWithMedia(reward: RouletteReward, coinPlural: string) {
  return {
    ...reward,
    label: configuredRewardLabel(reward.label, coinPlural),
    imageUrl: reward.imageKey
      ? `/api/v1/roulette-reward-media?key=${encodeURIComponent(reward.imageKey)}`
      : null,
  };
}

function currentWeekStart() {
  const now = new Date();
  const day = now.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset),
  );
  return {
    date: start.toISOString().slice(0, 10),
    instant: start.toISOString(),
  };
}

async function weeklyTaskProgress(userId: string) {
  const document = await getRewardSettingsDocument();
  const week = currentWeekStart();
  const [chapters, comments, upvotes, claims] = await Promise.all([
    database()
      .prepare(
        `SELECT COUNT(*) AS total
           FROM chapter_reward_claims
          WHERE user_id = ? AND datetime(claimed_at) >= datetime(?)`,
      )
      .bind(userId, week.instant)
      .first<{ total: number }>(),
    database()
      .prepare(
        `SELECT COUNT(*) AS total
           FROM discussion_comments
          WHERE user_id = ?
            AND moderation_status = 'VISIBLE'
            AND deleted_at IS NULL
            AND datetime(created_at) >= datetime(?)`,
      )
      .bind(userId, week.instant)
      .first<{ total: number }>(),
    database()
      .prepare(
        `SELECT COUNT(*) AS total
           FROM discussion_votes vote
           JOIN discussion_comments comment ON comment.id = vote.comment_id
          WHERE comment.user_id = ?
            AND vote.value = 1
            AND datetime(vote.created_at) >= datetime(?)`,
      )
      .bind(userId, week.instant)
      .first<{ total: number }>(),
    database()
      .prepare(
        `SELECT task_id AS taskId, awarded_spins AS awardedSpins,
                claimed_at AS claimedAt
           FROM roulette_task_claims
          WHERE user_id = ? AND week_start = ?`,
      )
      .bind(userId, week.date)
      .all<{ taskId: string; awardedSpins: number; claimedAt: string }>(),
  ]);
  const counts = {
    CHAPTERS_READ: Number(chapters?.total ?? 0),
    COMMENTS_POSTED: Number(comments?.total ?? 0),
    UPVOTES_RECEIVED: Number(upvotes?.total ?? 0),
  };
  const claimByTask = new Map(claims.results.map((claim) => [claim.taskId, claim]));
  return {
    weekStart: week.date,
    tasks: document.settings.rouletteTasks
      .filter((task) => task.enabled)
      .map((task) => {
        const progress = counts[task.metric];
        const claim = claimByTask.get(task.id);
        return {
          ...task,
          progress: Math.min(progress, task.target),
          complete: progress >= task.target,
          claimed: Boolean(claim),
          claimedAt: claim?.claimedAt ?? null,
        };
      }),
  };
}

async function availableRewards(
  userId: string,
  rewards: RouletteReward[],
) {
  const storeItemIds = [
    ...new Set(
      rewards
        .filter((reward) => reward.enabled && reward.type === "STORE_ITEM")
        .map((reward) => reward.itemId)
        .filter((itemId): itemId is string => Boolean(itemId)),
    ),
  ];
  const [owned, availableItems] = await Promise.all([
    database()
      .prepare(
        "SELECT item_id AS itemId FROM user_store_items WHERE user_id = ?",
      )
      .bind(userId)
      .all<{ itemId: string }>(),
    storeItemIds.length
      ? database()
          .prepare(
            `SELECT si.id
               FROM store_items si
               JOIN store_collections sc ON sc.id = si.collection_id
              WHERE si.id IN (${storeItemIds.map(() => "?").join(",")})
                AND si.is_published = 1
                AND si.is_hidden = 0
                AND si.archived_at IS NULL
                AND sc.enabled = 1
                AND (sc.starts_at IS NULL OR datetime(sc.starts_at) <= datetime('now'))
                AND (sc.ends_at IS NULL OR datetime(sc.ends_at) > datetime('now'))`,
          )
          .bind(...storeItemIds)
          .all<{ id: string }>()
      : Promise.resolve({ results: [] as Array<{ id: string }> }),
  ]);
  const ownedIds = new Set(owned.results.map((item) => item.itemId));
  const availableItemIds = new Set(
    availableItems.results.map((item) => item.id),
  );
  return rewards.filter(
    (reward) =>
      reward.enabled &&
      (reward.type !== "STORE_ITEM" ||
        Boolean(
          reward.itemId &&
            availableItemIds.has(reward.itemId) &&
            !ownedIds.has(reward.itemId),
        )),
  );
}

async function responseData(userId: string) {
  const [document, commercial, state, history, balances, weekly] = await Promise.all([
    getRewardSettingsDocument(),
    getCommercialSettingsDocument(),
    database()
      .prepare(
        `SELECT next_eligible_at AS nextEligibleAt,
                last_spin_id AS lastSpinId,
                free_spin_balance AS freeSpinBalance
           FROM roulette_state
          WHERE user_id = ?
          LIMIT 1`,
      )
      .bind(userId)
      .first<{
        nextEligibleAt: string;
        lastSpinId: string | null;
        freeSpinBalance: number;
      }>(),
    database()
      .prepare(
        `SELECT id, reward_key AS rewardKey, reward_type AS rewardType,
                reward_amount AS rewardAmount, store_item_id AS storeItemId,
                spin_mode AS spinMode, cost_shards AS costShards,
                cost_currency AS costCurrency, cost_amount AS costAmount,
                next_eligible_at AS nextEligibleAt,
                global_spin_number AS globalSpinNumber, spun_at AS spunAt
           FROM roulette_spins
          WHERE user_id = ?
          ORDER BY spun_at DESC
          LIMIT 12`,
      )
      .bind(userId)
      .all<SpinRow>(),
    economySnapshot(database(), userId),
    weeklyTaskProgress(userId),
  ]);
  const now = Date.now();
  const nextEligibleAt =
    state?.nextEligibleAt ?? "1970-01-01T00:00:00.000Z";
  const eligible = Date.parse(nextEligibleAt) <= now;
  const [candidates, paidCandidates] = await Promise.all([
    availableRewards(
      userId,
      document.settings.rouletteRewards.filter(
        (reward) =>
          commercial.settings.economy.premiumEconomyPublic ||
          reward.type !== "ONYX",
      ),
    ),
    availableRewards(
      userId,
      document.settings.roulettePaidRewards.filter(
        (reward) =>
          commercial.settings.economy.premiumEconomyPublic ||
          reward.type !== "ONYX",
      ),
    ),
  ]);
  const labelByKey = new Map(
    [
      ...document.settings.rouletteRewards,
      ...document.settings.roulettePaidRewards,
    ].map((reward) => [
      reward.id,
      configuredRewardLabel(
        reward.label,
        commercial.settings.economy.coinPlural,
      ),
    ]),
  );
  const premiumEconomyPublic =
    commercial.settings.economy.premiumEconomyPublic;
  const paidCosts = {
    SHARDS: document.settings.roulettePaidSpinShardCost,
    ONYX: document.settings.roulettePaidSpinOnyxCost,
  };
  const paidCurrencies = document.settings.roulettePaidCurrencies.filter(
    (currency) =>
      commercial.settings.economy.premiumEconomyPublic ||
      currency !== "ONYX",
  );
  const canAffordPaidSpin = paidCurrencies.some(
    (currency) =>
      Number(
        currency === "SHARDS"
          ? balances.shards.balance
          : balances.onyx.balance,
      ) >= paidCosts[currency],
  );
  const freeSpinBalance = Number(state?.freeSpinBalance ?? 0);
  const publicSettings = premiumEconomyPublic
    ? document.settings
    : {
        ...document.settings,
        roulettePaidSpinOnyxCost: 0,
        roulettePaidCurrencies:
          document.settings.roulettePaidCurrencies.filter(
            (currency) => currency !== "ONYX",
          ),
        rouletteRewards: document.settings.rouletteRewards.filter(
          (reward) => reward.type !== "ONYX",
        ),
        roulettePaidRewards: document.settings.roulettePaidRewards.filter(
          (reward) => reward.type !== "ONYX",
        ),
      };
  const publicHistory = history.results.filter(
    (spin) =>
      premiumEconomyPublic ||
      (spin.rewardType !== "ONYX" && spin.costCurrency !== "ONYX"),
  );
  return {
    settings: publicSettings,
    settingsRevision: document.revision,
    premiumEconomyPublic,
    coin: premiumEconomyPublic
      ? {
          name: commercial.settings.economy.coinName,
          plural: commercial.settings.economy.coinPlural,
          icon: commercial.settings.economy.coinIcon,
          iconUrl: commercial.settings.economy.coinIconKey
            ? `/api/v1/coin-icon?v=${commercial.settings.economy.coinIconRevision}`
            : null,
        }
      : null,
    eligible,
    canSpin: eligible && candidates.length > 0,
    canDailySpin: eligible && candidates.length > 0,
    canTaskSpin: freeSpinBalance > 0 && candidates.length > 0,
    canPaidSpin:
      document.settings.roulettePaidSpinsEnabled &&
      paidCandidates.length > 0 &&
      canAffordPaidSpin,
    freeSpinBalance,
    paidSpinCosts: premiumEconomyPublic
      ? paidCosts
      : { SHARDS: paidCosts.SHARDS, ONYX: 0 },
    paidSpinCurrencies: paidCurrencies,
    paidSpinCostShards: document.settings.roulettePaidSpinShardCost,
    unavailableReason:
      candidates.length === 0
        ? "No unowned Roulette rewards are currently available."
        : !eligible
          ? `Your next spin is available at ${nextEligibleAt}.`
          : null,
    availableRewards: candidates.map((reward) =>
      rewardWithMedia(reward, commercial.settings.economy.coinPlural),
    ),
    freeRewards: candidates.map((reward) =>
      rewardWithMedia(reward, commercial.settings.economy.coinPlural),
    ),
    paidRewards: paidCandidates.map((reward) =>
      rewardWithMedia(reward, commercial.settings.economy.coinPlural),
    ),
    weekly,
    nextEligibleAt,
    history: publicHistory.map((spin) =>
      mapSpin(spin, labelByKey.get(spin.rewardKey) ?? null),
    ),
    balances: premiumEconomyPublic
      ? balances
      : { shards: balances.shards },
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
    if (payload.action === "CLAIM_TASK") {
      const weekly = await weeklyTaskProgress(actor.id);
      const task = weekly.tasks.find((candidate) => candidate.id === payload.taskId);
      if (!task) {
        throw new ApiError(
          404,
          "ROULETTE_TASK_NOT_FOUND",
          "This weekly Roulette task is no longer available.",
        );
      }
      if (!task.complete) {
        throw new ApiError(
          409,
          "ROULETTE_TASK_INCOMPLETE",
          `Complete ${task.label} before claiming its free spin${
            task.rewardSpins === 1 ? "" : "s"
          }.`,
        );
      }
      const existingClaim = await db
        .prepare(
          `SELECT awarded_spins AS awardedSpins, claimed_at AS claimedAt
             FROM roulette_task_claims
            WHERE user_id = ? AND task_id = ? AND week_start = ?
            LIMIT 1`,
        )
        .bind(actor.id, task.id, weekly.weekStart)
        .first<{ awardedSpins: number; claimedAt: string }>();
      if (!existingClaim) {
        const results = await db.batch([
          db.prepare(
            `INSERT OR IGNORE INTO roulette_task_claims
             (user_id, task_id, week_start, awarded_spins, idempotency_key)
             VALUES (?, ?, ?, ?, ?)`,
          ).bind(
            actor.id,
            task.id,
            weekly.weekStart,
            task.rewardSpins,
            payload.idempotencyKey,
          ),
          db.prepare(
            `INSERT INTO roulette_state
             (user_id, next_eligible_at, free_spin_balance, revision)
             SELECT ?, '1970-01-01T00:00:00.000Z', ?, 1
              WHERE changes() = 1
             ON CONFLICT(user_id) DO UPDATE SET
               free_spin_balance = roulette_state.free_spin_balance + excluded.free_spin_balance,
               revision = roulette_state.revision + 1,
               updated_at = CURRENT_TIMESTAMP`,
          ).bind(actor.id, task.rewardSpins),
        ]);
        if (!results[0]?.meta.changes) {
          const winner = await db
            .prepare(
              `SELECT awarded_spins AS awardedSpins, claimed_at AS claimedAt
                 FROM roulette_task_claims
                WHERE user_id = ? AND task_id = ? AND week_start = ?
                LIMIT 1`,
            )
            .bind(actor.id, task.id, weekly.weekStart)
            .first<{ awardedSpins: number; claimedAt: string }>();
          if (!winner) {
            throw new ApiError(
              409,
              "ROULETTE_TASK_CLAIM_FAILED",
              "The task reward could not be claimed. Try again.",
            );
          }
        }
      }
      return json(
        requestId,
        {
          claimedTaskId: task.id,
          awardedSpins: task.rewardSpins,
          replayed: Boolean(existingClaim),
          state: await responseData(actor.id),
        },
        { headers: privateHeaders },
      );
    }
    const existing = await db
      .prepare(
        `SELECT id, reward_key AS rewardKey, reward_type AS rewardType,
                reward_amount AS rewardAmount, store_item_id AS storeItemId,
                spin_mode AS spinMode, cost_shards AS costShards,
                cost_currency AS costCurrency, cost_amount AS costAmount,
                next_eligible_at AS nextEligibleAt,
                global_spin_number AS globalSpinNumber, spun_at AS spunAt
           FROM roulette_spins
          WHERE user_id = ? AND idempotency_key = ?
          LIMIT 1`,
      )
      .bind(actor.id, payload.idempotencyKey)
      .first<SpinRow>();
    if (existing) {
      if (
        existing.spinMode !== payload.mode ||
        (payload.mode === "PAID" &&
          payload.currency &&
          existing.costCurrency !== payload.currency)
      ) {
        throw new ApiError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "This Roulette request key was already used for a different spin.",
        );
      }
      const document = await getRewardSettingsDocument();
      const label =
        [
          ...document.settings.rouletteRewards,
          ...document.settings.roulettePaidRewards,
        ].find(
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
    const [document, commercial] = await Promise.all([
      getRewardSettingsDocument(),
      getCommercialSettingsDocument(),
    ]);
    if (
      payload.mode === "PAID" &&
      !document.settings.roulettePaidSpinsEnabled
    ) {
      throw new ApiError(
        409,
        "PAID_SPINS_DISABLED",
        "Extra Roulette spins are currently disabled.",
      );
    }
    const paidCurrency =
      payload.currency ??
      document.settings.roulettePaidCurrencies[0] ??
      "SHARDS";
    if (
      payload.mode === "PAID" &&
      paidCurrency === "ONYX" &&
      !commercial.settings.economy.premiumEconomyPublic
    ) {
      throw new ApiError(
        403,
        "PAID_ECONOMY_HIDDEN",
        `${commercial.settings.economy.coinPlural} spins are currently private. Shard spins remain available.`,
      );
    }
    if (
      payload.mode === "PAID" &&
      !document.settings.roulettePaidCurrencies.includes(paidCurrency)
    ) {
      throw new ApiError(
        409,
        "ROULETTE_CURRENCY_DISABLED",
        "That payment currency is not enabled for Roulette spins.",
      );
    }
    const rewardPool = (
      payload.mode === "PAID"
        ? document.settings.roulettePaidRewards
        : document.settings.rouletteRewards
    ).filter(
      (reward) =>
        commercial.settings.economy.premiumEconomyPublic ||
        reward.type !== "ONYX",
    );
    const candidates = await availableRewards(
      actor.id,
      rewardPool,
    );
    if (candidates.length === 0) {
      throw new ApiError(
        409,
        "ROULETTE_REWARDS_UNAVAILABLE",
        "No Roulette rewards are currently available.",
      );
    }
    const spinId = randomId();
    const transactionId = randomId();
    const chargeTransactionId =
      payload.mode === "PAID" ? randomId() : null;
    const currentState = await db
      .prepare(
        `SELECT next_eligible_at AS nextEligibleAt
           FROM roulette_state
          WHERE user_id = ?
          LIMIT 1`,
      )
      .bind(actor.id)
      .first<{ nextEligibleAt: string }>();
    if (
      payload.mode === "DAILY" &&
      currentState?.nextEligibleAt &&
      Date.parse(currentState.nextEligibleAt) > Date.now()
    ) {
      throw new ApiError(
        409,
        "ROULETTE_COOLDOWN",
        `Your next spin is available at ${currentState.nextEligibleAt}.`,
      );
    }
    const poolKey = payload.mode === "PAID" ? "PAID" : "FREE";
    const globalSpinNumber = await nextGlobalSpinNumber(poolKey);
    const expectedGlobalSpins = globalSpinNumber - 1;
    const cadence = await cadenceStateByReward(
      poolKey,
      rewardPool,
      globalSpinNumber,
    );
    const selection = selectRewardForGlobalSpin(
      candidates,
      globalSpinNumber,
      cadence,
    );
    const reward = selection.reward;
    const nextEligibleAt =
      payload.mode === "DAILY"
        ? new Date(
            Date.now() +
              document.settings.rouletteCooldownHours * 3_600_000,
          ).toISOString()
        : currentState?.nextEligibleAt ??
          "1970-01-01T00:00:00.000Z";
    const statements: D1PreparedStatement[] = [];
    let gateCondition = "";
    const guardedStoreItemId =
      reward.type === "STORE_ITEM" ? reward.itemId ?? null : null;
    const counterGuard = `EXISTS (
      SELECT 1
        FROM roulette_pool_counters spin_counter
       WHERE spin_counter.pool_key = ?
         AND spin_counter.total_spins = ?
         AND spin_counter.last_spin_id = ?
    )`;
    const counterGuardBindings = [poolKey, globalSpinNumber, spinId] as const;
    if (payload.mode === "DAILY") {
      statements.push(
        db.prepare(
          `UPDATE roulette_pool_counters
              SET total_spins = total_spins + 1,
                  last_spin_id = ?,
                  revision = revision + 1,
                  updated_at = CURRENT_TIMESTAMP
            WHERE pool_key = ?
              AND total_spins = ?
              AND NOT EXISTS (
                SELECT 1 FROM roulette_spins prior_spin
                 WHERE prior_spin.user_id = ?
                   AND prior_spin.idempotency_key = ?
              )
              AND (
                NOT EXISTS (
                  SELECT 1 FROM roulette_state
                   WHERE user_id = ?
                )
                OR EXISTS (
                  SELECT 1 FROM roulette_state
                   WHERE user_id = ?
                     AND datetime(next_eligible_at) <= datetime('now')
                )
              )
              AND (
                ? IS NULL
                OR NOT EXISTS (
                  SELECT 1 FROM user_store_items owned_reward
                   WHERE owned_reward.user_id = ?
                     AND owned_reward.item_id = ?
                )
              )`,
        ).bind(
          spinId,
          poolKey,
          expectedGlobalSpins,
          actor.id,
          payload.idempotencyKey,
          actor.id,
          actor.id,
          guardedStoreItemId,
          actor.id,
          guardedStoreItemId,
        ),
        db.prepare(
          `INSERT INTO roulette_state
           (user_id, next_eligible_at, last_spin_id, revision)
           SELECT ?, ?, ?, 1
            WHERE (
              ? IS NULL
              OR NOT EXISTS (
                SELECT 1 FROM user_store_items owned_reward
                 WHERE owned_reward.user_id = ?
                   AND owned_reward.item_id = ?
              )
            )
              AND ${counterGuard}
           ON CONFLICT(user_id) DO UPDATE SET
             next_eligible_at = excluded.next_eligible_at,
             last_spin_id = excluded.last_spin_id,
             revision = roulette_state.revision + 1,
             updated_at = CURRENT_TIMESTAMP
           WHERE datetime(roulette_state.next_eligible_at) <= datetime('now')
             AND (
               ? IS NULL
               OR NOT EXISTS (
                 SELECT 1 FROM user_store_items owned_reward
                  WHERE owned_reward.user_id = ?
                    AND owned_reward.item_id = ?
               )
             )
             AND ${counterGuard}`,
        ).bind(
          actor.id,
          nextEligibleAt,
          spinId,
          guardedStoreItemId,
          actor.id,
          guardedStoreItemId,
          ...counterGuardBindings,
          guardedStoreItemId,
          actor.id,
          guardedStoreItemId,
          ...counterGuardBindings,
        ),
      );
      gateCondition = `EXISTS (
        SELECT 1 FROM roulette_state
         WHERE user_id = ? AND last_spin_id = ?
      )`;
    } else if (payload.mode === "TASK") {
      statements.push(
        db.prepare(
          `UPDATE roulette_pool_counters
              SET total_spins = total_spins + 1,
                  last_spin_id = ?,
                  revision = revision + 1,
                  updated_at = CURRENT_TIMESTAMP
            WHERE pool_key = ?
              AND total_spins = ?
              AND NOT EXISTS (
                SELECT 1 FROM roulette_spins prior_spin
                 WHERE prior_spin.user_id = ?
                   AND prior_spin.idempotency_key = ?
              )
              AND EXISTS (
                SELECT 1 FROM roulette_state
                 WHERE user_id = ?
                   AND free_spin_balance > 0
              )
              AND (
                ? IS NULL
                OR NOT EXISTS (
                  SELECT 1 FROM user_store_items owned_reward
                   WHERE owned_reward.user_id = ?
                     AND owned_reward.item_id = ?
                )
              )`,
        ).bind(
          spinId,
          poolKey,
          expectedGlobalSpins,
          actor.id,
          payload.idempotencyKey,
          actor.id,
          guardedStoreItemId,
          actor.id,
          guardedStoreItemId,
        ),
        db.prepare(
          `UPDATE roulette_state
              SET free_spin_balance = free_spin_balance - 1,
                  last_spin_id = ?,
                  revision = revision + 1,
                  updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ?
              AND free_spin_balance > 0
              AND (
                ? IS NULL
                OR NOT EXISTS (
                  SELECT 1 FROM user_store_items owned_reward
                   WHERE owned_reward.user_id = ?
                     AND owned_reward.item_id = ?
                )
              )
              AND ${counterGuard}`,
        ).bind(
          spinId,
          actor.id,
          guardedStoreItemId,
          actor.id,
          guardedStoreItemId,
          ...counterGuardBindings,
        ),
      );
      gateCondition = `EXISTS (
        SELECT 1 FROM roulette_state
         WHERE user_id = ? AND last_spin_id = ?
      )`;
    } else {
      const userChargeAccountId = await ensureWalletAccount(
        db,
        actor.id,
        paidCurrency,
      );
      const spinSinkAccountId = platformAccountId(
        "roulette-spins",
        paidCurrency,
      );
      await db
        .prepare(
          `INSERT OR IGNORE INTO ledger_accounts
           (id, owner_type, owner_id, currency, account_type)
           VALUES (?, 'PLATFORM', 'NYASCANS_ROULETTE', ?, 'SINK')`,
        )
        .bind(spinSinkAccountId, paidCurrency)
        .run();
      const cost =
        paidCurrency === "SHARDS"
          ? document.settings.roulettePaidSpinShardCost
          : document.settings.roulettePaidSpinOnyxCost;
      statements.push(
        db
          .prepare(
            `UPDATE roulette_pool_counters
                SET total_spins = total_spins + 1,
                    last_spin_id = ?,
                    revision = revision + 1,
                    updated_at = CURRENT_TIMESTAMP
              WHERE pool_key = ?
                AND total_spins = ?
                AND NOT EXISTS (
                  SELECT 1 FROM roulette_spins prior_spin
                   WHERE prior_spin.user_id = ?
                     AND prior_spin.idempotency_key = ?
                )
                AND (
                  SELECT COALESCE(SUM(amount), 0)
                    FROM ledger_entries
                   WHERE account_id = ?
                ) >= ?
                AND (
                  ? IS NULL
                  OR NOT EXISTS (
                    SELECT 1 FROM user_store_items owned_reward
                     WHERE owned_reward.user_id = ?
                       AND owned_reward.item_id = ?
                  )
                )`,
          )
          .bind(
            spinId,
            poolKey,
            expectedGlobalSpins,
            actor.id,
            payload.idempotencyKey,
            userChargeAccountId,
            cost,
            guardedStoreItemId,
            actor.id,
            guardedStoreItemId,
          ),
        db
          .prepare(
            `INSERT OR IGNORE INTO ledger_transactions
             (id, kind, reference_type, reference_id, idempotency_key, memo)
             SELECT ?, 'ROULETTE_SPIN_PURCHASE', 'ROULETTE_SPIN', ?, ?, ?
              WHERE (
                SELECT COALESCE(SUM(amount), 0)
                  FROM ledger_entries
                 WHERE account_id = ?
              ) >= ?
                AND (
                  ? IS NULL
                  OR NOT EXISTS (
                    SELECT 1 FROM user_store_items owned_reward
                    WHERE owned_reward.user_id = ?
                       AND owned_reward.item_id = ?
                  )
                )
                AND ${counterGuard}`,
          )
          .bind(
            chargeTransactionId,
            spinId,
            `roulette-charge:${actor.id}:${payload.idempotencyKey}`,
            `Roulette extra spin · ${cost} ${
              paidCurrency === "SHARDS"
                ? document.settings.shardPlural
                : commercial.settings.economy.coinPlural
            }`,
            userChargeAccountId,
            cost,
            guardedStoreItemId,
            actor.id,
            guardedStoreItemId,
            ...counterGuardBindings,
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
            chargeTransactionId,
            userChargeAccountId,
            -cost,
            chargeTransactionId,
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
            chargeTransactionId,
            spinSinkAccountId,
            cost,
            chargeTransactionId,
          ),
      );
      gateCondition =
        "EXISTS (SELECT 1 FROM ledger_transactions WHERE id = ?)";
    }
    if (selection.cadence) {
      statements.push(
        db
          .prepare(
            `UPDATE roulette_reward_cadence
                SET next_due_spin = ? + interval_spins,
                    last_awarded_spin = ?,
                    last_spin_id = ?,
                    revision = revision + 1,
                    updated_at = CURRENT_TIMESTAMP
              WHERE pool_key = ?
                AND reward_key = ?
                AND next_due_spin <= ?
                AND ${counterGuard}`,
          )
          .bind(
            globalSpinNumber,
            globalSpinNumber,
            spinId,
            poolKey,
            reward.id,
            globalSpinNumber,
            ...counterGuardBindings,
          ),
      );
    }
    statements.push(
      db
        .prepare(
          `INSERT INTO ledger_transactions
           (id, kind, reference_type, reference_id, idempotency_key, memo)
           SELECT ?, 'ROULETTE_REWARD', 'ROULETTE_SPIN', ?, ?, ?
            WHERE ${gateCondition}`,
        )
        .bind(
          transactionId,
          spinId,
          `roulette:${actor.id}:${payload.idempotencyKey}`,
          `Roulette · ${reward.label}`,
          ...(payload.mode !== "PAID"
            ? [actor.id, spinId]
            : [chargeTransactionId]),
        ),
    );
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
            `INSERT INTO user_store_items
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
            reward_amount, store_item_id, spin_mode, cost_shards,
            cost_currency, cost_amount, charge_transaction_id, transaction_id,
            next_eligible_at, global_spin_number)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
          payload.mode,
          payload.mode === "PAID"
            ? paidCurrency === "SHARDS"
              ? document.settings.roulettePaidSpinShardCost
              : 0
            : 0,
          payload.mode === "PAID" ? paidCurrency : null,
          payload.mode === "PAID"
            ? paidCurrency === "SHARDS"
              ? document.settings.roulettePaidSpinShardCost
              : document.settings.roulettePaidSpinOnyxCost
            : 0,
          chargeTransactionId,
          transactionId,
          nextEligibleAt,
          globalSpinNumber,
          transactionId,
        ),
    );
    const results = await db.batch(statements);
    if (!results[0]?.meta.changes) {
      const replayedSpin = await db
        .prepare(
          `SELECT id, reward_key AS rewardKey, reward_type AS rewardType,
                  reward_amount AS rewardAmount, store_item_id AS storeItemId,
                  spin_mode AS spinMode, cost_shards AS costShards,
                  cost_currency AS costCurrency, cost_amount AS costAmount,
                  next_eligible_at AS nextEligibleAt,
                  global_spin_number AS globalSpinNumber, spun_at AS spunAt
             FROM roulette_spins
            WHERE user_id = ? AND idempotency_key = ?
            LIMIT 1`,
        )
        .bind(actor.id, payload.idempotencyKey)
        .first<SpinRow>();
      if (replayedSpin) {
        if (
          replayedSpin.spinMode !== payload.mode ||
          (payload.mode === "PAID" &&
            payload.currency &&
            replayedSpin.costCurrency !== payload.currency)
        ) {
          throw new ApiError(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "This Roulette request key was already used for a different spin.",
          );
        }
        const label =
          [
            ...document.settings.rouletteRewards,
            ...document.settings.roulettePaidRewards,
          ].find(
            (candidate) => candidate.id === replayedSpin.rewardKey,
          )?.label ?? null;
        return json(
          requestId,
          {
            spin: mapSpin(replayedSpin, label),
            replayed: true,
            state: await responseData(actor.id),
          },
          { headers: privateHeaders },
        );
      }
      const counter = await db
        .prepare(
          `SELECT total_spins AS totalSpins, last_spin_id AS lastSpinId
             FROM roulette_pool_counters
            WHERE pool_key = ?
            LIMIT 1`,
        )
        .bind(poolKey)
        .first<{ totalSpins: number; lastSpinId: string | null }>();
      if (
        Number(counter?.totalSpins ?? 0) >= globalSpinNumber &&
        counter?.lastSpinId !== spinId
      ) {
        throw new ApiError(
          409,
          "ROULETTE_BUSY",
          "Another spin completed at the same moment. Try again to reserve the next global draw.",
        );
      }
      const state = await responseData(actor.id);
      if (guardedStoreItemId) {
        const ownedReward = await db
          .prepare(
            `SELECT 1 AS owned
               FROM user_store_items
              WHERE user_id = ? AND item_id = ?
              LIMIT 1`,
          )
          .bind(actor.id, guardedStoreItemId)
          .first<{ owned: number }>();
        if (ownedReward) {
          throw new ApiError(
            409,
            "ROULETTE_REWARD_UNAVAILABLE",
            "That one-time reward is already owned. Spin again for another available reward.",
          );
        }
      }
      if (payload.mode === "PAID") {
        const cost =
          paidCurrency === "SHARDS"
            ? document.settings.roulettePaidSpinShardCost
            : document.settings.roulettePaidSpinOnyxCost;
        throw new ApiError(
          409,
          paidCurrency === "SHARDS"
            ? "INSUFFICIENT_SHARDS"
            : "INSUFFICIENT_ONYX",
          `You need ${cost} ${
            paidCurrency === "SHARDS"
              ? document.settings.shardPlural
              : commercial.settings.economy.coinPlural
          } for an extra spin.`,
        );
      }
      if (payload.mode === "TASK") {
        throw new ApiError(
          409,
          "NO_FREE_SPINS",
          "Complete and claim a weekly task to earn another free spin.",
        );
      }
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
                spin_mode AS spinMode, cost_shards AS costShards,
                cost_currency AS costCurrency, cost_amount AS costAmount,
                next_eligible_at AS nextEligibleAt,
                global_spin_number AS globalSpinNumber, spun_at AS spunAt
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
