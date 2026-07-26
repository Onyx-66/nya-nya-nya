export type ReadingProgressTone =
  | "empty"
  | "starting"
  | "building"
  | "halfway"
  | "strong"
  | "nearly"
  | "complete";

function finiteNonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function seriesReadingProgress(
  chaptersRead: number,
  chaptersTotal: number,
) {
  const total = finiteNonNegative(chaptersTotal);
  if (total === 0) return 0;
  const read = Math.min(total, finiteNonNegative(chaptersRead));
  return Math.min(100, Math.max(0, (read / total) * 100));
}

export function readingProgressTone(progress: number): ReadingProgressTone {
  const value = Math.min(100, finiteNonNegative(progress));
  if (value === 0) return "empty";
  if (value < 25) return "starting";
  if (value < 50) return "building";
  if (value < 70) return "halfway";
  if (value < 90) return "strong";
  if (value < 100) return "nearly";
  return "complete";
}
