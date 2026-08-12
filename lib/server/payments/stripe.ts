import { ApiError } from "@/lib/server/api";
import { requireStripeConfig } from "@/lib/server/payments/config";

const STRIPE_API_ORIGIN = "https://api.stripe.com";
const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;

type StripeErrorEnvelope = {
  error?: { code?: string; message?: string; type?: string };
};

export type StripeCheckoutSession = {
  id: string;
  object: "checkout.session";
  url: string | null;
  expires_at: number | null;
  mode: "payment" | "subscription";
};

export type StripeBillingPortalSession = {
  id: string;
  object: "billing_portal.session";
  url: string;
};

export type StripeEvent = {
  id: string;
  object: "event";
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
};

export type StripeConnectAccount = {
  id: string;
  object: "account";
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  capabilities?: Record<string, string | null>;
};

export type StripeTransfer = {
  id: string;
  object: "transfer";
  amount: number;
  currency: string;
  destination: string;
};

export type StripeSubscription = Record<string, unknown> & {
  id: string;
  object: "subscription";
};

function stripeError(status: number, payload: StripeErrorEnvelope) {
  const providerCode = payload.error?.code ?? payload.error?.type ?? "unknown";
  const retryable = status === 429 || status >= 500;
  return new ApiError(
    retryable ? 503 : 502,
    retryable ? "PAYMENT_PROVIDER_RETRY" : "PAYMENT_PROVIDER_REJECTED",
    retryable
      ? "The payment provider is temporarily unavailable. Try again shortly."
      : "The payment provider rejected this request.",
    undefined,
    { provider: "STRIPE", providerCode },
  );
}

async function stripeGetRequest<T>(path: string) {
  const config = requireStripeConfig();
  if (!config) {
    throw new ApiError(
      503,
      "PAYMENT_PROVIDER_NOT_READY",
      "The payment provider is not fully configured.",
    );
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  let response: Response;
  try {
    response = await fetch(`${STRIPE_API_ORIGIN}${path}`, {
      method: "GET",
      headers: { authorization: `Bearer ${config.secretKey}` },
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(
      503,
      "PAYMENT_PROVIDER_UNREACHABLE",
      "The payment provider could not be reached. Try again shortly.",
    );
  } finally {
    clearTimeout(timeout);
  }
  const payload = (await response.json().catch(() => ({}))) as T &
    StripeErrorEnvelope;
  if (!response.ok) throw stripeError(response.status, payload);
  return payload as T;
}

async function stripeFormRequest<T>(
  path: string,
  form: URLSearchParams,
  idempotencyKey?: string,
) {
  const config = requireStripeConfig();
  if (!config) {
    throw new ApiError(
      503,
      "PAYMENT_PROVIDER_NOT_READY",
      "Payment operations are unavailable until the provider is fully configured.",
    );
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  let response: Response;
  try {
    response = await fetch(`${STRIPE_API_ORIGIN}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      body: form,
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(
      503,
      "PAYMENT_PROVIDER_UNREACHABLE",
      "The payment provider could not be reached. Try again shortly.",
    );
  } finally {
    clearTimeout(timeout);
  }
  const payload = (await response.json().catch(() => ({}))) as T &
    StripeErrorEnvelope;
  if (!response.ok) throw stripeError(response.status, payload);
  return payload as T;
}

export async function createStripeCheckoutSession(input: {
  orderId: string;
  userId: string;
  userEmail: string;
  productId: string;
  productRevision: number;
  productName: string;
  description: string;
  amountMinor: number;
  currency: string;
  kind: "CURRENCY_PACKAGE" | "MEMBERSHIP";
  billingCycle: "ONE_TIME" | "MONTHLY" | "ANNUAL";
  idempotencyKey: string;
}) {
  const config = requireStripeConfig();
  if (!config) {
    throw new ApiError(
      503,
      "PAYMENT_PROVIDER_NOT_READY",
      "Checkout is unavailable until the payment provider is fully configured.",
    );
  }
  const form = new URLSearchParams();
  const subscription = input.kind === "MEMBERSHIP";
  if (
    (subscription && !["MONTHLY", "ANNUAL"].includes(input.billingCycle)) ||
    (!subscription && input.billingCycle !== "ONE_TIME")
  ) {
    throw new ApiError(
      422,
      "CHECKOUT_BILLING_CYCLE_INVALID",
      "The selected billing cycle does not match this offer.",
    );
  }
  form.set("mode", subscription ? "subscription" : "payment");
  form.set("client_reference_id", input.orderId);
  form.set("customer_email", input.userEmail);
  form.set("success_url", `${config.siteOrigin}/store?checkout=success&order=${encodeURIComponent(input.orderId)}`);
  form.set("cancel_url", `${config.siteOrigin}/store?checkout=cancelled&order=${encodeURIComponent(input.orderId)}`);
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", input.currency.toLowerCase());
  form.set("line_items[0][price_data][unit_amount]", String(input.amountMinor));
  form.set("line_items[0][price_data][product_data][name]", input.productName);
  form.set("line_items[0][price_data][product_data][description]", input.description.slice(0, 500));
  form.set("metadata[order_id]", input.orderId);
  form.set("metadata[user_id]", input.userId);
  form.set("metadata[product_id]", input.productId);
  form.set("metadata[product_revision]", String(input.productRevision));
  form.set("metadata[billing_cycle]", input.billingCycle);
  if (subscription) {
    form.set(
      "line_items[0][price_data][recurring][interval]",
      input.billingCycle === "ANNUAL" ? "year" : "month",
    );
    form.set("subscription_data[metadata][order_id]", input.orderId);
    form.set("subscription_data[metadata][user_id]", input.userId);
    form.set("subscription_data[metadata][product_id]", input.productId);
    form.set("subscription_data[metadata][billing_cycle]", input.billingCycle);
  } else {
    form.set("payment_intent_data[metadata][order_id]", input.orderId);
    form.set("payment_intent_data[metadata][user_id]", input.userId);
    form.set("payment_intent_data[metadata][product_id]", input.productId);
    form.set(
      "payment_intent_data[metadata][product_revision]",
      String(input.productRevision),
    );
    form.set(
      "payment_intent_data[metadata][billing_cycle]",
      input.billingCycle,
    );
  }
  return stripeFormRequest<StripeCheckoutSession>(
    "/v1/checkout/sessions",
    form,
    input.idempotencyKey,
  );
}

export async function createStripeBillingPortalSession(customerId: string) {
  if (!/^cus_[A-Za-z0-9_]{8,250}$/u.test(customerId)) {
    throw new ApiError(
      409,
      "MEMBERSHIP_CUSTOMER_REFERENCE_INVALID",
      "This membership has no valid billing-customer reference.",
    );
  }
  const config = requireStripeConfig();
  if (!config) {
    throw new ApiError(
      503,
      "PAYMENT_PROVIDER_NOT_READY",
      "Membership billing management is temporarily unavailable.",
    );
  }
  const form = new URLSearchParams();
  form.set("customer", customerId);
  form.set("return_url", `${config.siteOrigin}/store/memberships`);
  const portal = await stripeFormRequest<StripeBillingPortalSession>(
    "/v1/billing_portal/sessions",
    form,
  );
  let portalUrl: URL;
  try {
    portalUrl = new URL(portal.url);
  } catch {
    throw new ApiError(
      502,
      "BILLING_PORTAL_RESPONSE_INVALID",
      "Stripe returned an invalid billing-management URL.",
    );
  }
  if (
    portal.object !== "billing_portal.session" ||
    !/^bps_[A-Za-z0-9_]+$/u.test(portal.id) ||
    portalUrl.protocol !== "https:" ||
    (portalUrl.hostname !== "billing.stripe.com" &&
      !portalUrl.hostname.endsWith(".billing.stripe.com"))
  ) {
    throw new ApiError(
      502,
      "BILLING_PORTAL_RESPONSE_INVALID",
      "Stripe returned an invalid billing-management response.",
    );
  }
  return portal;
}

export async function retrieveStripeSubscription(subscriptionId: string) {
  if (!/^sub_[A-Za-z0-9_]{8,250}$/u.test(subscriptionId)) {
    throw new ApiError(
      409,
      "MEMBERSHIP_SUBSCRIPTION_REFERENCE_INVALID",
      "This membership has no valid provider subscription reference.",
    );
  }
  const subscription = await stripeGetRequest<StripeSubscription>(
    `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
  );
  if (
    subscription.object !== "subscription" ||
    subscription.id !== subscriptionId
  ) {
    throw new ApiError(
      502,
      "MEMBERSHIP_SUBSCRIPTION_RESPONSE_INVALID",
      "Stripe returned an invalid subscription response.",
    );
  }
  return subscription;
}

export async function retrieveStripeConnectAccount(accountId: string) {
  if (!/^acct_[A-Za-z0-9]{8,80}$/u.test(accountId)) {
    throw new ApiError(
      422,
      "STRIPE_CONNECT_ACCOUNT_INVALID",
      "Enter a valid Stripe connected-account identifier.",
    );
  }
  const account = await stripeGetRequest<StripeConnectAccount>(
    `/v1/accounts/${encodeURIComponent(accountId)}`,
  );
  if (account.object !== "account" || account.id !== accountId) {
    throw new ApiError(
      502,
      "STRIPE_CONNECT_ACCOUNT_INVALID",
      "Stripe returned an invalid connected-account response.",
    );
  }
  if (
    !account.details_submitted ||
    !account.payouts_enabled ||
    account.capabilities?.transfers !== "active"
  ) {
    throw new ApiError(
      409,
      "STRIPE_CONNECT_ACCOUNT_NOT_READY",
      "This Stripe account must finish verification and enable transfers and payouts first.",
    );
  }
  return account;
}

export async function createStripeTransfer(input: {
  payoutRequestId: string;
  teamId: string;
  destinationAccountId: string;
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
}) {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 1) {
    throw new ApiError(422, "PAYOUT_AMOUNT_INVALID", "The payout amount is invalid.");
  }
  if (!/^[A-Z]{3}$/u.test(input.currency)) {
    throw new ApiError(422, "PAYOUT_CURRENCY_INVALID", "The payout currency is invalid.");
  }
  if (!/^acct_[A-Za-z0-9]{8,80}$/u.test(input.destinationAccountId)) {
    throw new ApiError(
      422,
      "STRIPE_CONNECT_ACCOUNT_INVALID",
      "The destination Stripe account is invalid.",
    );
  }
  const form = new URLSearchParams();
  form.set("amount", String(input.amountMinor));
  form.set("currency", input.currency.toLowerCase());
  form.set("destination", input.destinationAccountId);
  form.set("transfer_group", `team_payout_${input.payoutRequestId}`.slice(0, 200));
  form.set("metadata[payout_request_id]", input.payoutRequestId);
  form.set("metadata[team_id]", input.teamId);
  form.set("description", `NyaScans team payout ${input.payoutRequestId}`.slice(0, 500));
  const transfer = await stripeFormRequest<StripeTransfer>(
    "/v1/transfers",
    form,
    input.idempotencyKey,
  );
  return validateStripeTransfer(transfer, input);
}

function validateStripeTransfer(
  transfer: StripeTransfer,
  input: {
    destinationAccountId: string;
    amountMinor: number;
    currency: string;
  },
) {
  if (
    transfer.object !== "transfer" ||
    typeof transfer.id !== "string" ||
    !/^tr_[A-Za-z0-9]+$/u.test(transfer.id) ||
    transfer.amount !== input.amountMinor ||
    transfer.currency.toUpperCase() !== input.currency ||
    transfer.destination !== input.destinationAccountId
  ) {
    throw new ApiError(
      502,
      "PAYOUT_PROVIDER_RESPONSE_INVALID",
      "Stripe returned an invalid transfer response. The payout remains resumable.",
    );
  }
  return transfer;
}

export async function retrieveStripeTransfer(input: {
  transferId: string;
  destinationAccountId: string;
  amountMinor: number;
  currency: string;
}) {
  if (!/^tr_[A-Za-z0-9]+$/u.test(input.transferId)) {
    throw new ApiError(
      409,
      "PAYOUT_TRANSFER_REFERENCE_INVALID",
      "The saved Stripe transfer reference is invalid. Reconcile this payout manually.",
    );
  }
  const transfer = await stripeGetRequest<StripeTransfer>(
    `/v1/transfers/${encodeURIComponent(input.transferId)}`,
  );
  return validateStripeTransfer(transfer, input);
}

function parseStripeSignature(header: string) {
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.trim().split("=", 2);
    if (key === "t" && /^\d{10,}$/.test(value ?? "")) {
      timestamp = Number(value);
    } else if (key === "v1" && /^[a-f0-9]{64}$/i.test(value ?? "")) {
      signatures.push(value!.toLowerCase());
    }
  }
  return { timestamp, signatures };
}

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeHexEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function verifyStripeEvent(rawBody: string, signatureHeader: string) {
  const config = requireStripeConfig();
  if (!config) {
    throw new ApiError(
      503,
      "PAYMENT_PROVIDER_NOT_READY",
      "The payment webhook is not configured.",
    );
  }
  const parsed = parseStripeSignature(signatureHeader);
  if (!parsed.timestamp || parsed.signatures.length === 0) {
    throw new ApiError(400, "STRIPE_SIGNATURE_INVALID", "The payment signature is invalid.");
  }
  const age = Math.abs(Math.floor(Date.now() / 1000) - parsed.timestamp);
  if (age > STRIPE_SIGNATURE_TOLERANCE_SECONDS) {
    throw new ApiError(400, "STRIPE_SIGNATURE_EXPIRED", "The payment signature has expired.");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(config.webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = hex(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${parsed.timestamp}.${rawBody}`),
    ),
  );
  if (!parsed.signatures.some((candidate) => constantTimeHexEqual(expected, candidate))) {
    throw new ApiError(400, "STRIPE_SIGNATURE_INVALID", "The payment signature is invalid.");
  }
  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    throw new ApiError(400, "STRIPE_EVENT_INVALID", "The payment event is not valid JSON.");
  }
  if (
    !event ||
    typeof event !== "object" ||
    typeof (event as StripeEvent).id !== "string" ||
    (event as StripeEvent).object !== "event" ||
    typeof (event as StripeEvent).type !== "string" ||
    !Number.isSafeInteger((event as StripeEvent).created) ||
    (event as StripeEvent).created <= 0 ||
    !(event as StripeEvent).data?.object
  ) {
    throw new ApiError(400, "STRIPE_EVENT_INVALID", "The payment event contract is invalid.");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawBody));
  return { event: event as StripeEvent, payloadSha256: hex(digest) };
}
