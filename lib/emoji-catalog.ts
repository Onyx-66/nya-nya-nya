import keywordData from "emojilib";
import groupData from "unicode-emoji-json/data-by-group.json";

type EmojiGroupRecord = {
  name: string;
  slug: string;
  emojis: Array<{
    emoji: string;
    name: string;
    slug: string;
    skin_tone_support: boolean;
  }>;
};

export type EmojiCatalogEntry = {
  emoji: string;
  name: string;
  slug: string;
  group: string;
  groupSlug: string;
  keywords: string[];
  skinToneSupport: boolean;
  searchText: string;
};

const keywords = keywordData as Record<string, string[]>;

export const emojiCatalog: EmojiCatalogEntry[] = (
  groupData as EmojiGroupRecord[]
).flatMap((group) =>
  group.emojis.map((entry) => {
    const entryKeywords = keywords[entry.emoji] ?? [];
    return {
      emoji: entry.emoji,
      name: entry.name,
      slug: entry.slug,
      group: group.name,
      groupSlug: group.slug,
      keywords: entryKeywords,
      skinToneSupport: entry.skin_tone_support,
      searchText: [
        entry.name,
        entry.slug.replaceAll("_", " "),
        group.name,
        ...entryKeywords,
      ]
        .join(" ")
        .toLowerCase(),
    };
  }),
);

export function searchEmojiCatalog(
  query: string,
  groupSlug = "all",
  limit = 240,
) {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return emojiCatalog
    .filter(
      (entry) =>
        (groupSlug === "all" || entry.groupSlug === groupSlug) &&
        terms.every((term) => entry.searchText.includes(term)),
    )
    .slice(0, limit);
}

export const emojiGroups = [
  { slug: "all", name: "All" },
  ...(groupData as EmojiGroupRecord[]).map((group) => ({
    slug: group.slug,
    name: group.name,
  })),
];
