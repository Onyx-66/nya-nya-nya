import { env } from "cloudflare:workers";

type PaymentEnvironment = Cloudflare.Env & {
  NEXT_PUBLIC_SITE_URL?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
};

export type StripeReadiness =
  | {
      ready: true;
      siteOrigin: string;
    }
  | {
      ready: false;
      reason:
        | "STRIPE_SECRET_KEY_MISSING"
        | "STRIPE_WEBHOOK_SECRET_MISSING"
        | "SITE_URL_MISSING"
        | "SITE_URL_INVALID";
    };

function paymentEnvironment() {
  return env as PaymentEnvironment;
}

function validSecret(value: string | undefined, prefix: string) {
  return Boolean(value?.trim().startsWith(prefix) && value.trim().length >= 16);
}

export function getStripeReadiness(): StripeReadiness {
  const configured = paymentEnvironment();
  if (!validSecret(configured.STRIPE_SECRET_KEY, "sk_")) {
    return { ready: false, reason: "STRIPE_SECRET_KEY_MISSING" };
  }
  if (!validSecret(configured.STRIPE_WEBHOOK_SECRET, "whsec_")) {
    return { ready: false, reason: "STRIPE_WEBHOOK_SECRET_MISSING" };
  }
  const value = configured.NEXT_PUBLIC_SITE_URL?.trim();
  if (!value) return { ready: false, reason: "SITE_URL_MISSING" };
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return { ready: false, reason: "SITE_URL_INVALID" };
    }
    return { ready: true, siteOrigin: parsed.origin };
  } catch {
    return { ready: false, reason: "SITE_URL_INVALID" };
  }
}

export function requireStripeConfig() {
  const readiness = getStripeReadiness();
  if (!readiness.ready) return null;
  const configured = paymentEnvironment();
  return {
    secretKey: configured.STRIPE_SECRET_KEY!.trim(),
    webhookSecret: configured.STRIPE_WEBHOOK_SECRET!.trim(),
    siteOrigin: readiness.siteOrigin,
  };
}

