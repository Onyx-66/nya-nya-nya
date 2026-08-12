export type MangaUpdatesIdentifier = Readonly<{
  /** Stable decimal series_id returned by the MangaUpdates API. */
  externalId: string;
  /** Decimal identifier accepted by the MangaUpdates v1 detail API. */
  providerId: string;
  /** Base-36 token used by the public MangaUpdates series URL. */
  sourceToken: string;
  sourceUrl: string;
}>;

const maximumProviderId = 999_999_999_999;

function result(providerId: number, externalId: string): MangaUpdatesIdentifier {
  return {
    providerId: String(providerId),
    externalId: String(providerId),
    sourceToken: externalId,
    sourceUrl: `https://www.mangaupdates.com/series/${externalId}`,
  };
}

export function mangaUpdatesIdentifierFromProviderId(
  value: string,
): MangaUpdatesIdentifier | null {
  if (!/^\d{1,12}$/u.test(value)) return null;
  const providerId = Number(value);
  if (!Number.isSafeInteger(providerId) || providerId > maximumProviderId) {
    return null;
  }
  return result(providerId, providerId.toString(36));
}

export function mangaUpdatesIdentifierFromToken(
  value: string,
): MangaUpdatesIdentifier | null {
  const externalId = value.trim().toLowerCase();
  if (!/^[a-z0-9]{1,16}$/u.test(externalId)) return null;
  let providerId = 0;
  for (const character of externalId) {
    providerId =
      providerId * 36 + Number.parseInt(character, 36);
    if (!Number.isSafeInteger(providerId) || providerId > maximumProviderId) {
      return null;
    }
  }
  return result(providerId, externalId);
}

export function mangaUpdatesIdentifierFromUrl(
  value: string,
): MangaUpdatesIdentifier | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    !["mangaupdates.com", "www.mangaupdates.com"].includes(url.hostname)
  ) {
    return null;
  }

  // Legacy `series.html?id=<decimal>` links carry the provider API ID.
  const legacyProviderId = url.searchParams.get("id")?.trim();
  if (legacyProviderId) {
    return mangaUpdatesIdentifierFromProviderId(legacyProviderId);
  }

  // Current URLs are `/series/<base36-token>/<optional-human-slug>`. The
  // slug is display text and must never be mistaken for the series ID.
  const segments = url.pathname.split("/").filter(Boolean);
  const seriesIndex = segments.findIndex(
    (segment) => segment.toLowerCase() === "series",
  );
  return mangaUpdatesIdentifierFromToken(segments[seriesIndex + 1] ?? "");
}

/**
 * Values that may exist in `external_id` after the identifier contract moved
 * from public URL tokens to decimal provider IDs. The URL wins when supplied
 * because an all-numeric base-36 token would otherwise be ambiguous.
 */
export function mangaUpdatesExternalIdAliases(
  externalId: string,
  sourceUrl?: string,
): readonly string[] {
  const normalizedExternalId = externalId.trim().toLowerCase();
  const identifier =
    (sourceUrl ? mangaUpdatesIdentifierFromUrl(sourceUrl) : null) ??
    mangaUpdatesIdentifierFromProviderId(normalizedExternalId) ??
    mangaUpdatesIdentifierFromToken(normalizedExternalId);
  if (!identifier) return [normalizedExternalId];
  return [...new Set([identifier.externalId, identifier.sourceToken])];
}
