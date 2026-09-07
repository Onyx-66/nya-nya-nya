import { env } from "cloudflare:workers";

export type AdUnlockEnvironment = {
  AD_REWARD_PROVIDER_URL?: string;
  AD_REWARD_WEBHOOK_SECRET?: string;
  AD_UNLOCK_HOURS?: string;
};

export type AdUnlockReadiness = {
  ready: boolean;
  reason: string | null;
  providerOrigin: string | null;
  unlockHours: number | null;
};

export function configuredAdUnlockEnvironment() {
  return env as unknown as AdUnlockEnvironment;
}

export function parsedAdProviderUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

export function getAdUnlockReadiness(): AdUnlockReadiness {
  const configured = configuredAdUnlockEnvironment();
  const providerUrl = parsedAdProviderUrl(configured.AD_REWARD_PROVIDER_URL?.trim());
  if (!providerUrl) return { ready: false, reason: "AD_REWARD_PROVIDER_URL_INVALID", providerOrigin: null, unlockHours: null };
  if ((configured.AD_REWARD_WEBHOOK_SECRET ?? "").length < 32) {
    return { ready: false, reason: "AD_REWARD_WEBHOOK_SECRET_INVALID", providerOrigin: providerUrl.origin, unlockHours: null };
  }
  const unlockHours = Number(configured.AD_UNLOCK_HOURS);
  if (!Number.isInteger(unlockHours) || unlockHours < 1 || unlockHours > 168) {
    return { ready: false, reason: "AD_UNLOCK_HOURS_INVALID", providerOrigin: providerUrl.origin, unlockHours: null };
  }
  return { ready: true, reason: null, providerOrigin: providerUrl.origin, unlockHours };
}
