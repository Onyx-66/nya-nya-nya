import { z } from "zod";

export const rewardCurrencyValues = ["SHARDS", "ONYX"] as const;
export type RewardCurrency = (typeof rewardCurrencyValues)[number];

export const rouletteRewardSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    label: z.string().trim().min(2).max(80),
    type: z.enum(["SHARDS", "ONYX", "STORE_ITEM"]),
    amount: z.number().int().min(0).max(1_000_000),
    weight: z.number().int().min(1).max(1_000_000),
    distributionMode: z.enum(["WEIGHT", "GLOBAL_INTERVAL"]).optional(),
    globalIntervalSpins: z
      .number()
      .int()
      .min(2)
      .max(10_000_000)
      .nullable()
      .optional(),
    itemId: z.string().trim().min(3).max(120).nullable(),
    imageKey: z.string().trim().max(320).nullable().default(null),
    enabled: z.boolean(),
  })
  .superRefine((reward, context) => {
    if (reward.type === "STORE_ITEM" && !reward.itemId) {
      context.addIssue({
        code: "custom",
        path: ["itemId"],
        message: "Choose a Store item for this Roulette reward.",
      });
    }
    if (reward.type !== "STORE_ITEM" && reward.amount < 1) {
      context.addIssue({
        code: "custom",
        path: ["amount"],
        message: "Currency rewards must grant at least one unit.",
      });
    }
    if (
      reward.distributionMode === "GLOBAL_INTERVAL" &&
      !reward.globalIntervalSpins
    ) {
      context.addIssue({
        code: "custom",
        path: ["globalIntervalSpins"],
        message: "Choose how many global spins trigger this reward.",
      });
    }
  });

export const rouletteTaskSchema = z.object({
  id: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  label: z.string().trim().min(2).max(80),
  description: z.string().trim().min(2).max(180),
  metric: z.enum([
    "CHAPTERS_READ",
    "COMMENTS_POSTED",
    "UPVOTES_RECEIVED",
  ]),
  target: z.number().int().min(1).max(100_000),
  rewardSpins: z.number().int().min(1).max(100),
  enabled: z.boolean(),
});

export const rewardSettingsSchema = z
  .object({
    schemaVersion: z.literal(1),
    shardName: z.string().trim().min(2).max(40),
    shardPlural: z.string().trim().min(2).max(48),
    shardIcon: z.string().trim().min(1).max(8),
    chapterMinimumSeconds: z.number().int().min(30).max(7_200),
    chapterCompleteShards: z.number().int().min(0).max(1_000_000),
    commentCreatedShards: z.number().int().min(0).max(100_000),
    upvoteReceivedShards: z.number().int().min(0).max(100_000),
    rouletteCooldownHours: z.number().int().min(1).max(168),
    roulettePaidSpinsEnabled: z.boolean().default(true),
    roulettePaidSpinShardCost: z
      .number()
      .int()
      .min(1)
      .max(1_000_000)
      .default(50),
    roulettePaidSpinOnyxCost: z
      .number()
      .int()
      .min(1)
      .max(1_000_000)
      .default(20),
    roulettePaidCurrencies: z
      .array(z.enum(["SHARDS", "ONYX"]))
      .min(1)
      .max(2)
      .default(["SHARDS", "ONYX"]),
    rouletteRewards: z.array(rouletteRewardSchema).min(8).max(24),
    roulettePaidRewards: z
      .array(rouletteRewardSchema)
      .min(8)
      .max(24)
      .default([
        {
          id: "paid-shards-75",
          label: "75 Shards",
          type: "SHARDS",
          amount: 75,
          weight: 40,
          itemId: null,
          imageKey: null,
          enabled: true,
        },
        {
          id: "paid-onyx-25",
          label: "25 Paw Coins",
          type: "ONYX",
          amount: 25,
          weight: 25,
          itemId: null,
          imageKey: null,
          enabled: true,
        },
        {
          id: "paid-shards-50",
          label: "50 Shards",
          type: "SHARDS",
          amount: 50,
          weight: 46,
          itemId: null,
          imageKey: null,
          enabled: true,
        },
        {
          id: "paid-shards-100",
          label: "100 Shards",
          type: "SHARDS",
          amount: 100,
          weight: 28,
          itemId: null,
          imageKey: null,
          enabled: true,
        },
        {
          id: "paid-shards-150",
          label: "150 Shards",
          type: "SHARDS",
          amount: 150,
          weight: 16,
          itemId: null,
          imageKey: null,
          enabled: true,
        },
        {
          id: "paid-onyx-15",
          label: "15 Paw Coins",
          type: "ONYX",
          amount: 15,
          weight: 34,
          itemId: null,
          imageKey: null,
          enabled: true,
        },
        {
          id: "paid-onyx-40",
          label: "40 Paw Coins",
          type: "ONYX",
          amount: 40,
          weight: 12,
          itemId: null,
          imageKey: null,
          enabled: true,
        },
        {
          id: "paid-onyx-75",
          label: "75 Paw Coins",
          type: "ONYX",
          amount: 75,
          weight: 5,
          itemId: null,
          imageKey: null,
          enabled: true,
        },
      ]),
    rouletteTasks: z
      .array(rouletteTaskSchema)
      .max(24)
      .default([
        {
          id: "read-10-chapters",
          label: "Read 10 chapters",
          description: "Complete ten published chapters this week.",
          metric: "CHAPTERS_READ",
          target: 10,
          rewardSpins: 1,
          enabled: true,
        },
        {
          id: "post-3-comments",
          label: "Join the discussion",
          description: "Post three visible comments this week.",
          metric: "COMMENTS_POSTED",
          target: 3,
          rewardSpins: 1,
          enabled: true,
        },
        {
          id: "receive-5-upvotes",
          label: "Helpful voice",
          description: "Receive five upvotes on your comments this week.",
          metric: "UPVOTES_RECEIVED",
          target: 5,
          rewardSpins: 1,
          enabled: true,
        },
      ]),
  })
  .superRefine((settings, context) => {
    for (const poolName of [
      "rouletteRewards",
      "roulettePaidRewards",
    ] as const) {
      const ids = new Set<string>();
      settings[poolName].forEach((reward, index) => {
        if (ids.has(reward.id)) {
          context.addIssue({
            code: "custom",
            path: [poolName, index, "id"],
            message: "Roulette reward IDs must be unique inside each pool.",
          });
        }
        ids.add(reward.id);
      });
      if (
        settings[poolName].filter((reward) => reward.enabled).length < 8
      ) {
        context.addIssue({
          code: "custom",
          path: [poolName],
          message: "Keep at least eight rewards enabled in this Roulette pool.",
        });
      }
      if (
        !settings[poolName].some(
          (reward) =>
            reward.enabled && reward.distributionMode !== "GLOBAL_INTERVAL",
        )
      ) {
        context.addIssue({
          code: "custom",
          path: [poolName],
          message:
            "Keep at least one weighted reward enabled so non-cadence spins always have a valid outcome.",
        });
      }
    }
    const taskIds = new Set<string>();
    settings.rouletteTasks.forEach((task, index) => {
      if (taskIds.has(task.id)) {
        context.addIssue({
          code: "custom",
          path: ["rouletteTasks", index, "id"],
          message: "Weekly Roulette task IDs must be unique.",
        });
      }
      taskIds.add(task.id);
    });
  });

export type RewardSettings = z.infer<typeof rewardSettingsSchema>;
export type RouletteReward = z.infer<typeof rouletteRewardSchema>;
export type RouletteTask = z.infer<typeof rouletteTaskSchema>;

export const defaultRewardSettings: RewardSettings = {
  schemaVersion: 1,
  shardName: "Shard",
  shardPlural: "Shards",
  shardIcon: "✦",
  chapterMinimumSeconds: 210,
  chapterCompleteShards: 25,
  commentCreatedShards: 3,
  upvoteReceivedShards: 1,
  rouletteCooldownHours: 24,
  roulettePaidSpinsEnabled: true,
  roulettePaidSpinShardCost: 50,
  roulettePaidSpinOnyxCost: 20,
  roulettePaidCurrencies: ["SHARDS", "ONYX"],
  rouletteRewards: [
    {
      id: "shards-10",
      label: "10 Shards",
      type: "SHARDS",
      amount: 10,
      weight: 34,
      itemId: null,
      imageKey: null,
      enabled: true,
    },
    {
      id: "shards-25",
      label: "25 Shards",
      type: "SHARDS",
      amount: 25,
      weight: 28,
      itemId: null,
      imageKey: null,
      enabled: true,
    },
    {
      id: "shards-50",
      label: "50 Shards",
      type: "SHARDS",
      amount: 50,
      weight: 18,
      itemId: null,
      imageKey: null,
      enabled: true,
    },
    {
      id: "onyx-5",
      label: "5 Paw Coins",
      type: "ONYX",
      amount: 5,
      weight: 14,
      itemId: null,
      imageKey: null,
      enabled: true,
    },
    {
      id: "onyx-15",
      label: "15 Paw Coins",
      type: "ONYX",
      amount: 15,
      weight: 6,
      itemId: null,
      imageKey: null,
      enabled: true,
    },
    {
      id: "shards-5",
      label: "5 Shards",
      type: "SHARDS",
      amount: 5,
      weight: 40,
      itemId: null,
      imageKey: null,
      enabled: true,
    },
    {
      id: "shards-75",
      label: "75 Shards",
      type: "SHARDS",
      amount: 75,
      weight: 10,
      itemId: null,
      imageKey: null,
      enabled: true,
    },
    {
      id: "onyx-8",
      label: "8 Paw Coins",
      type: "ONYX",
      amount: 8,
      weight: 9,
      itemId: null,
      imageKey: null,
      enabled: true,
    },
  ],
  roulettePaidRewards: [
    {
      id: "paid-shards-75",
      label: "75 Shards",
      type: "SHARDS",
      amount: 75,
      weight: 40,
      itemId: null,
      imageKey: null,
      enabled: true,
    },
    {
      id: "paid-onyx-25",
      label: "25 Paw Coins",
      type: "ONYX",
      amount: 25,
      weight: 25,
      itemId: null,
      imageKey: null,
      enabled: true,
    },
    {
      id: "paid-shards-50",
      label: "50 Shards",
      type: "SHARDS",
      amount: 50,
      weight: 46,
      itemId: null,
      imageKey: null,
      enabled: true,
    },
    {
      id: "paid-shards-100",
      label: "100 Shards",
      type: "SHARDS",
      amount: 100,
      weight: 28,
      itemId: null,
      imageKey: null,
      enabled: true,
    },
    {
      id: "paid-shards-150",
      label: "150 Shards",
      type: "SHARDS",
      amount: 150,
      weight: 16,
      itemId: null,
      imageKey: null,
      enabled: true,
    },
    {
      id: "paid-onyx-15",
      label: "15 Paw Coins",
      type: "ONYX",
      amount: 15,
      weight: 34,
      itemId: null,
      imageKey: null,
      enabled: true,
    },
    {
      id: "paid-onyx-40",
      label: "40 Paw Coins",
      type: "ONYX",
      amount: 40,
      weight: 12,
      itemId: null,
      imageKey: null,
      enabled: true,
    },
    {
      id: "paid-onyx-75",
      label: "75 Paw Coins",
      type: "ONYX",
      amount: 75,
      weight: 5,
      itemId: null,
      imageKey: null,
      enabled: true,
    },
  ],
  rouletteTasks: [
    {
      id: "read-10-chapters",
      label: "Read 10 chapters",
      description: "Complete ten published chapters this week.",
      metric: "CHAPTERS_READ",
      target: 10,
      rewardSpins: 1,
      enabled: true,
    },
    {
      id: "post-3-comments",
      label: "Join the discussion",
      description: "Post three visible comments this week.",
      metric: "COMMENTS_POSTED",
      target: 3,
      rewardSpins: 1,
      enabled: true,
    },
    {
      id: "receive-5-upvotes",
      label: "Helpful voice",
      description: "Receive five upvotes on your comments this week.",
      metric: "UPVOTES_RECEIVED",
      target: 5,
      rewardSpins: 1,
      enabled: true,
    },
  ],
};

function normalizeLegacyRewardPool(
  candidate: unknown,
  poolName: "rouletteRewards" | "roulettePaidRewards",
) {
  if (!candidate || typeof candidate !== "object") return candidate;
  const document = candidate as Record<string, unknown>;
  const rawPool = document[poolName];
  if (!Array.isArray(rawPool)) return candidate;
  const pool = rawPool.map((entry) =>
    entry && typeof entry === "object"
      ? {
          distributionMode: "WEIGHT",
          globalIntervalSpins: null,
          ...(entry as Record<string, unknown>),
          label:
            typeof (entry as Record<string, unknown>).label === "string"
              ? String((entry as Record<string, unknown>).label).replace(
                  /\bOnyx Coins?\b/gi,
                  "Paw Coins",
                )
              : (entry as Record<string, unknown>).label,
        }
      : entry,
  );
  const ids = new Set(
    pool
      .map((entry) =>
        entry && typeof entry === "object"
          ? String((entry as Record<string, unknown>).id ?? "")
          : "",
      )
      .filter(Boolean),
  );
  for (const fallback of defaultRewardSettings[poolName]) {
    if (pool.length >= 8) break;
    if (ids.has(fallback.id)) continue;
    pool.push({ ...fallback });
    ids.add(fallback.id);
  }
  let enabledCount = pool.filter(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      (entry as Record<string, unknown>).enabled === true,
  ).length;
  for (const entry of pool) {
    if (enabledCount >= 8) break;
    if (
      entry &&
      typeof entry === "object" &&
      (entry as Record<string, unknown>).enabled !== true
    ) {
      (entry as Record<string, unknown>).enabled = true;
      enabledCount += 1;
    }
  }
  return { ...document, [poolName]: pool };
}

export function parseRewardSettings(value: unknown): RewardSettings {
  const withFreePool = normalizeLegacyRewardPool(value, "rouletteRewards");
  const normalized = normalizeLegacyRewardPool(
    withFreePool,
    "roulettePaidRewards",
  );
  const parsed = rewardSettingsSchema.safeParse(normalized);
  return parsed.success ? parsed.data : defaultRewardSettings;
}

export function rewardCurrencyLabel(
  amount: number,
  currency: RewardCurrency,
  settings: RewardSettings,
) {
  if (currency === "SHARDS") {
    return `${amount.toLocaleString("en-US")} ${
      Math.abs(amount) === 1 ? settings.shardName : settings.shardPlural
    }`;
  }
  return `${amount.toLocaleString("en-US")} Paw Coin${
    Math.abs(amount) === 1 ? "" : "s"
  }`;
}
