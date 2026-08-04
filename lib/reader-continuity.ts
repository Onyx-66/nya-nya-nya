export type ReaderReleaseChoice = {
  chapterSlug: string;
  teamId: string | null;
  language: string;
  version: number;
  publishedAt?: string | null;
};

export type ReaderPreference = {
  teamId: string | null;
  language: string;
};

function sameTeam(left: string | null, right: string | null) {
  return left === right;
}

export function selectPreferredRelease<T extends ReaderReleaseChoice>(
  candidates: T[],
  preference: ReaderPreference,
) {
  return (
    candidates
      .filter(
        (candidate) =>
          sameTeam(candidate.teamId, preference.teamId) &&
          candidate.language.toLowerCase() === preference.language.toLowerCase(),
      )
      .sort((left, right) => {
        if (right.version !== left.version) return right.version - left.version;
        return String(right.publishedAt ?? "").localeCompare(
          String(left.publishedAt ?? ""),
        );
      })[0] ?? null
  );
}

export function continuityFallbackReason<T extends ReaderReleaseChoice>(
  candidates: T[],
  preference: ReaderPreference,
) {
  if (!candidates.length) return null;
  const hasLanguage = candidates.some(
    (candidate) =>
      candidate.language.toLowerCase() === preference.language.toLowerCase(),
  );
  const hasTeam = candidates.some((candidate) =>
    sameTeam(candidate.teamId, preference.teamId),
  );
  if (hasLanguage && !hasTeam) return "TEAM_UNAVAILABLE" as const;
  if (hasTeam && !hasLanguage) return "LANGUAGE_UNAVAILABLE" as const;
  return "TEAM_AND_LANGUAGE_UNAVAILABLE" as const;
}
