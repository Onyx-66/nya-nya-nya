export const SERIES_REPORT_CATEGORIES = [
  "PORNOGRAPHY",
  "HENTAI",
  "CHILD_SEXUAL_ABUSE_MATERIAL",
  "HATE_OR_HARASSMENT",
  "EXTREME_VIOLENCE",
  "COPYRIGHT",
  "SPAM_OR_MISLEADING",
  "OTHER",
] as const;

export type SeriesReportCategory =
  (typeof SERIES_REPORT_CATEGORIES)[number];

export const SERIES_REPORT_CATEGORY_LABELS: Record<
  SeriesReportCategory,
  string
> = {
  PORNOGRAPHY: "Pornography",
  HENTAI: "Hentai or explicit sexual content",
  CHILD_SEXUAL_ABUSE_MATERIAL: "Child sexual abuse material (CSAM)",
  HATE_OR_HARASSMENT: "Hate, harassment, or targeted abuse",
  EXTREME_VIOLENCE: "Extreme or graphic violence",
  COPYRIGHT: "Copyright or ownership violation",
  SPAM_OR_MISLEADING: "Spam, scam, or misleading information",
  OTHER: "Other serious concern",
};

export const SERIES_REPORT_STATUSES = [
  "OPEN",
  "IN_REVIEW",
  "RESOLVED",
  "DISMISSED",
] as const;

export type SeriesReportStatus = (typeof SERIES_REPORT_STATUSES)[number];

export const SERIES_REPORT_STATUS_LABELS: Record<
  SeriesReportStatus,
  string
> = {
  OPEN: "Open",
  IN_REVIEW: "In review",
  RESOLVED: "Resolved",
  DISMISSED: "Dismissed",
};
