const MOCK_MEDIA_ROOT = "/art/mangadex-preview";

function stableIndex(seed: string, size: number) {
  let total = 0;
  for (const character of seed) total = (total * 31 + character.charCodeAt(0)) >>> 0;
  return total % size;
}

function padded(value: number, width: number) {
  return String(value).padStart(width, "0");
}

/**
 * Bundled preview-only art keeps public demo surfaces populated when a local
 * seed row has no uploaded media. Real API media always takes precedence.
 */
export function mockAvatarUrl(seed: string) {
  return `${MOCK_MEDIA_ROOT}/cover-${padded(stableIndex(seed, 100), 3)}.jpg`;
}

export function mockProfileBannerUrl(seed: string) {
  return `${MOCK_MEDIA_ROOT}/banner-${padded(stableIndex(`${seed}:banner`, 100), 3)}.jpg`;
}

export function mockTeamLogoUrl(seed: string) {
  return `${MOCK_MEDIA_ROOT}/team-logo-${padded(stableIndex(seed, 12), 2)}.jpg`;
}

export function mockTeamBannerUrl(seed: string) {
  return `${MOCK_MEDIA_ROOT}/team-banner-${padded(stableIndex(`${seed}:banner`, 12), 2)}.jpg`;
}
