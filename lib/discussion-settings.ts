import { z } from "zod";

export const discussionReactionOptionSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9_-]{0,31}$/),
  emoji: z.string().trim().min(1).max(24),
  label: z.string().trim().min(1).max(32),
  enabled: z.boolean(),
  assetUrl: z.string().trim().startsWith("/api/").nullable().optional(),
  animated: z.boolean().optional(),
});

export const discussionSettingsSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    reactions: z.array(discussionReactionOptionSchema).min(1).max(12),
    allowImages: z.boolean(),
    allowGifs: z.boolean(),
    maxAttachments: z.number().int().min(1).max(4),
    maxReplyDepth: z.number().int().min(1).max(4),
  })
  .superRefine((settings, context) => {
    const keys = new Set<string>();
    for (const [index, reaction] of settings.reactions.entries()) {
      if (keys.has(reaction.key)) {
        context.addIssue({
          code: "custom",
          path: ["reactions", index, "key"],
          message: "Reaction keys must be unique.",
        });
      }
      keys.add(reaction.key);
    }
    if (!settings.reactions.some((reaction) => reaction.enabled)) {
      context.addIssue({
        code: "custom",
        path: ["reactions"],
        message: "Keep at least one reaction enabled.",
      });
    }
  });

export type DiscussionSettings = z.infer<typeof discussionSettingsSchema>;
export type DiscussionReactionOption = z.infer<
  typeof discussionReactionOptionSchema
>;

export const defaultDiscussionSettings: DiscussionSettings = {
  schemaVersion: 1,
  reactions: [
    { key: "heart", emoji: "❤️", label: "Love", enabled: true },
    { key: "laugh", emoji: "😂", label: "Funny", enabled: true },
    { key: "fire", emoji: "🔥", label: "Fire", enabled: true },
    { key: "wow", emoji: "😮", label: "Wow", enabled: true },
    { key: "sad", emoji: "😢", label: "Sad", enabled: true },
    { key: "theory", emoji: "🧠", label: "Good theory", enabled: true },
  ],
  allowImages: true,
  allowGifs: true,
  maxAttachments: 4,
  maxReplyDepth: 3,
};

export function parseDiscussionSettings(value: unknown): DiscussionSettings {
  const parsed = discussionSettingsSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  return JSON.parse(
    JSON.stringify(defaultDiscussionSettings),
  ) as DiscussionSettings;
}
