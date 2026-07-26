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
    itemId: z.string().trim().min(3).max(120).nullable(),
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
    rouletteRewards: z.array(rouletteRewardSchema).min(1).max(24),
  })
  .superRefine((settings, context) => {
    const ids = new Set<string>();
    settings.rouletteRewards.forEach((reward, index) => {
      if (ids.has(reward.id)) {
        context.addIssue({
          code: "custom",
          path: ["rouletteRewards", index, "id"],
          message: "Roulette reward IDs must be unique.",
        });
      }
      ids.add(reward.id);
    });
    if (!settings.rouletteRewards.some((reward) => reward.enabled)) {
      context.addIssue({
        code: "custom",
        path: ["rouletteRewards"],
        message: "Enable at least one Roulette reward.",
      });
    }
  });

export type RewardSettings = z.infer<typeof rewardSettingsSchema>;
export type RouletteReward = z.infer<typeof rouletteRewardSchema>;

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
  rouletteRewards: [
    {
      id: "shards-10",
      label: "10 Shards",
      type: "SHARDS",
      amount: 10,
      weight: 34,
      itemId: null,
      enabled: true,
    },
    {
      id: "shards-25",
      label: "25 Shards",
      type: "SHARDS",
      amount: 25,
      weight: 28,
      itemId: null,
      enabled: true,
    },
    {
      id: "shards-50",
      label: "50 Shards",
      type: "SHARDS",
      amount: 50,
      weight: 18,
      itemId: null,
      enabled: true,
    },
    {
      id: "onyx-5",
      label: "5 Onyx Coins",
      type: "ONYX",
      amount: 5,
      weight: 14,
      itemId: null,
      enabled: true,
    },
    {
      id: "onyx-15",
      label: "15 Onyx Coins",
      type: "ONYX",
      amount: 15,
      weight: 6,
      itemId: null,
      enabled: true,
    },
  ],
};

export function parseRewardSettings(value: unknown): RewardSettings {
  const parsed = rewardSettingsSchema.safeParse(value);
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
  return `${amount.toLocaleString("en-US")} Onyx Coin${
    Math.abs(amount) === 1 ? "" : "s"
  }`;
}
