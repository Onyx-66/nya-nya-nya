export type SeriesMediaSlot = "cover" | "banner" | "slider";

export function seriesMediaUrl(
  seriesId: string,
  slot: SeriesMediaSlot,
  key: unknown,
  revision?: unknown,
) {
  const normalized = typeof key === "string" ? key.trim() : "";
  if (!normalized) return null;
  if (normalized.startsWith("/") || /^https?:\/\//i.test(normalized)) {
    return normalized;
  }
  const version = Number(revision);
  return `/api/v1/series-media?id=${encodeURIComponent(seriesId)}&slot=${slot}${Number.isFinite(version) && version > 0 ? `&v=${version}` : ""}`;
}

export function preferredSeriesArtworkUrl(
  seriesId: string,
  revision: unknown,
  artwork: ReadonlyArray<readonly [SeriesMediaSlot, unknown]>,
) {
  for (const [slot, key] of artwork) {
    const url = seriesMediaUrl(seriesId, slot, key, revision);
    if (url) return url;
  }
  return null;
}
