import { env } from "cloudflare:workers";
import { ApiError } from "@/lib/server/api";
import { getAdUnlockReadiness } from "@/lib/server/ad-unlocks";
import { getCommercialSettingsDocument } from "@/lib/server/commercial-settings";
import { getStripeReadiness } from "@/lib/server/payments/config";
import { getTeamPayoutReadiness } from "@/lib/server/payments/team-payouts";

export const FEATURE_KEYS = [
  "payments",
  "onyx_purchases",
  "premium_unlocks",
  "memberships",
  "ad_supported_unlocks",
  "team_payouts",
  "mature_content",
  "public_comments",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type FeatureState = {
  key: FeatureKey;
  enabled: boolean;
  available: boolean;
  effective: boolean;
  wired: boolean;
  reason: string | null;
};

const wiredFeatures = new Set<FeatureKey>([
  "payments",
  "onyx_purchases",
  "premium_unlocks",
  "memberships",
  "ad_supported_unlocks",
  "team_payouts",
]);

function database(db?: D1Database) {
  const selected = db ?? env.DB;
  if (!selected) {
    throw new ApiError(503, "DATABASE_UNAVAILABLE", "Feature controls are unavailable.");
  }
  return selected;
}

export async function getFeatureStates(db?: D1Database) {
  const selected = database(db);
  const [rows, commercial, payout] = await Promise.all([
    selected
      .prepare("SELECT key, enabled FROM feature_flags")
      .all<{ key: string; enabled: number | boolean }>(),
    getCommercialSettingsDocument(),
    getTeamPayoutReadiness(selected),
  ]);
  const configured = new Map(rows.results.map((row) => [row.key, Boolean(row.enabled)]));
  const stripe = getStripeReadiness();
  const raw = (key: FeatureKey) => configured.get(key) === true;
  const paymentAvailable = stripe.ready;
  const paymentEffective = raw("payments") && paymentAvailable;
  const premiumAvailable =
    !commercial.recoveredFromInvalid &&
    commercial.settings.economy.premiumEconomyPublic;
  const premiumEffective = raw("premium_unlocks") && premiumAvailable;
  const adUnlock = getAdUnlockReadiness();

  const availability = (key: FeatureKey) => {
    switch (key) {
      case "payments":
        return { available: paymentAvailable, reason: stripe.ready ? null : stripe.reason };
      case "onyx_purchases":
        return {
          available: paymentEffective,
          reason: paymentEffective
            ? null
            : paymentAvailable
              ? "PAYMENTS_FLAG_DISABLED"
              : stripe.reason,
        };
      case "memberships":
        return { available: true, reason: null };
      case "premium_unlocks":
        return {
          available: premiumAvailable,
          reason: premiumAvailable ? null : "PAID_ECONOMY_PRIVATE",
        };
      case "ad_supported_unlocks":
        return {
          available: premiumEffective && adUnlock.ready,
          reason: !premiumEffective
            ? "PREMIUM_UNLOCKS_DISABLED"
            : adUnlock.ready
              ? null
              : adUnlock.reason,
        };
      case "team_payouts":
        return {
          available: payout.integrationReady,
          reason: payout.integrationReady ? null : payout.reason,
        };
      default:
        return { available: true, reason: null };
    }
  };

  return Object.fromEntries(
    FEATURE_KEYS.map((key) => {
      const dependency = availability(key);
      const enabled = raw(key);
      const state: FeatureState = {
        key,
        enabled,
        available: dependency.available,
        effective: enabled && dependency.available,
        wired: wiredFeatures.has(key),
        reason: enabled
          ? dependency.reason
          : dependency.available
            ? "FLAG_DISABLED"
            : dependency.reason,
      };
      return [key, state];
    }),
  ) as Record<FeatureKey, FeatureState>;
}

export async function requireFeature(key: FeatureKey, db?: D1Database) {
  const state = (await getFeatureStates(db))[key];
  if (!state.effective) {
    throw new ApiError(
      key === "premium_unlocks" ? 404 : 503,
      "FEATURE_UNAVAILABLE",
      "This feature is not available.",
      undefined,
      { feature: key, reason: state.reason },
    );
  }
  return state;
}

/**
 * The global Paid System switch is deliberately separate from Stripe
 * readiness. When administrators turn the switch off, every paid surface is
 * unavailable immediately; when it is on, checkout still has to pass the
 * provider-specific `payments.effective` check before a charge can start.
 */
export async function paidSystemIsEnabled(db?: D1Database) {
  const states = await getFeatureStates(db);
  return states.payments.enabled && states.premium_unlocks.effective;
}

export async function requirePaidSystem(db?: D1Database, status = 503) {
  const selected = database(db);
  const states = await getFeatureStates(selected);
  if (!states.payments.enabled || !states.premium_unlocks.effective) {
    throw new ApiError(
      status,
      "PAID_SYSTEM_DISABLED",
      "The Paid System is currently unavailable.",
      undefined,
      { feature: "payments" },
    );
  }
  return states;
}

export async function assertFeatureCanEnable(key: FeatureKey, db?: D1Database) {
  const state = (await getFeatureStates(db))[key];
  if (!state.wired) {
    throw new ApiError(
      409,
      "FEATURE_FLAG_NOT_CONNECTED",
      "This feature cannot be enabled until its runtime contract is connected.",
    );
  }
  if (!state.available) {
    throw new ApiError(
      409,
      "FEATURE_DEPENDENCY_UNAVAILABLE",
      "Configure this feature's required provider and parent flags first.",
      undefined,
      { feature: key, reason: state.reason },
    );
  }
}
