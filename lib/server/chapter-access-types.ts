export type ChapterAccessType = "FREE" | "PAID";
export type ChapterAccessLevel = ChapterAccessType | "PREMIUM";

export type ChapterAccessDecision = {
  chapterId: string;
  seriesId: string;
  teamId: string | null;
  seriesSlug: string;
  chapterSlug: string;
  chapterNumber: string;
  chapterLabel: string;
  language: string;
  version: number;
  teamName: string | null;
  accessType: ChapterAccessType;
  accessLevel: ChapterAccessLevel;
  priceOnyx: number;
  basePriceOnyx: number;
  discountId: string | null;
  discountRevision: number | null;
  discountTargetType: "SERIES" | "CHAPTER" | null;
  discountPercentage: number | null;
  discountEndsAt: string | null;
  publishedAt: string | null;
  canRead: boolean;
  isUnlocked: boolean;
  administratorPreview: boolean;
  reason:
    | "FREE"
    | "UNLOCKED"
    | "MEMBERSHIP"
    | "ADMINISTRATOR_PREVIEW"
    | "SIGN_IN_REQUIRED"
    | "PURCHASE_REQUIRED"
    | "MEMBERSHIP_REQUIRED"
    | "UNAVAILABLE";
};
