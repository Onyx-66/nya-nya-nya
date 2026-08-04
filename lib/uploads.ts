export const UPLOAD_LIMITS = Object.freeze({
  maxChaptersPerJob: 25,
  maxPagesPerChapter: 500,
  maxPageBytes: 25 * 1024 * 1024,
  maxChapterBytes: 250 * 1024 * 1024,
  maxJobBytes: 7 * 1024 * 1024 * 1024,
  maxPixelsPerPage: 64_000_000,
  maxWidth: 16_384,
  maxHeight: 32_768,
  draftLifetimeDays: 14,
});

export const UPLOAD_METHODS = Object.freeze([
  {
    id: "DIRECT_IMAGES",
    label: "Direct images",
    supported: true,
    reason: "Upload verified JPEG, PNG, or WebP pages.",
  },
  {
    id: "DIRECT_FOLDER",
    label: "Folder selection",
    supported: true,
    reason:
      "The browser sends image files from one chapter folder or chapter subfolders.",
  },
  {
    id: "ZIP",
    label: "ZIP / CBZ",
    supported: true,
    reason:
      "Extracted locally with traversal, compression-ratio, file-count, and byte limits before verified page upload.",
  },
  {
    id: "RAR",
    label: "RAR",
    supported: false,
    reason:
      "Disabled because this deployment has no audited RAR extraction worker.",
  },
  {
    id: "GOOGLE_DRIVE",
    label: "Google Drive",
    supported: false,
    reason:
      "Disabled because no Google Drive connector or import worker is configured.",
  },
] as const);

export type SupportedUploadMethod = "DIRECT_IMAGES" | "DIRECT_FOLDER";
export type ClientUploadMethod = SupportedUploadMethod | "ZIP";
export type UploadJobKind = "SINGLE" | "BATCH";

const naturalCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

export function naturalCompare(left: string, right: string) {
  return naturalCollator.compare(
    left.normalize("NFKC"),
    right.normalize("NFKC"),
  );
}

export function normalizeUploadPath(value: string) {
  const normalized = value.normalize("NFKC").replaceAll("\\", "/").trim();
  if (
    !normalized ||
    normalized.length > 500 ||
    normalized.startsWith("/") ||
    normalized.includes("\0") ||
    /^[A-Za-z]:\//.test(normalized)
  ) {
    return null;
  }
  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.startsWith(".") ||
        segment.toUpperCase() === "__MACOSX" ||
        ["THUMBS.DB", "DESKTOP.INI"].includes(segment.toUpperCase()),
    )
  ) {
    return null;
  }
  return segments.join("/");
}

export function pathLeaf(value: string) {
  return value.replaceAll("\\", "/").split("/").at(-1) ?? value;
}

export function pathParent(value: string) {
  const segments = value.replaceAll("\\", "/").split("/").filter(Boolean);
  return segments.length > 1 ? segments.at(-2)! : "Chapter";
}

export type DetectedBatchChapter = {
  sourceLabel: string;
  volume: string;
  chapterNumber: string;
  title: string;
};

export function detectBatchChapter(
  sourceLabel: string,
  fallbackChapterNumber: number,
): DetectedBatchChapter {
  const label = sourceLabel
    .normalize("NFKC")
    .replace(/\.[a-z0-9]{1,8}$/i, "")
    .trim();
  const volume =
    label.match(/\b(?:vol(?:ume)?)[\s._-]*(\d+(?:\.\d+)?)\b/i)?.[1] ?? "";
  const chapter =
    label.match(/\b(?:ch(?:apter)?)[\s._-]*(\d+(?:\.\d+)?(?:[a-z])?)\b/i)?.[1] ??
    label.match(/(?:^|[\s._-])(\d+(?:\.\d+)?(?:[a-z])?)(?:$|[\s._-])/i)?.[1] ??
    String(fallbackChapterNumber);
  const title = label
    .replace(/\b(?:vol(?:ume)?)[\s._-]*\d+(?:\.\d+)?\b/gi, "")
    .replace(/\b(?:ch(?:apter)?)[\s._-]*\d+(?:\.\d+)?(?:[a-z])?\b/gi, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return {
    sourceLabel: label || `Chapter ${chapter}`,
    volume,
    chapterNumber: chapter,
    title,
  };
}

export function uploadStatusLabel(status: string) {
  return (
    {
      DRAFT: "Draft",
      UPLOADING: "Uploading",
      VALIDATING: "Validating",
      READY: "Ready",
      PUBLISHING: "Publishing",
      PENDING_REVIEW: "Pending review",
      PUBLISHED: "Published",
      SCHEDULED: "Scheduled",
      REJECTED: "Rejected",
      FAILED: "Failed",
      CANCELLED: "Cancelled",
    }[status] ?? status.replaceAll("_", " ").toLowerCase()
  );
}
