import type { D1Database } from "@cloudflare/workers-types";
import { ApiError } from "@/lib/server/api";
import { requireFeature } from "@/lib/server/feature-flags";
import { createStripeCheckoutSession } from "@/lib/server/payments/stripe";
import type { Actor } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";

type CheckoutProduct = {
  id: string;
  revision: number;
  kind: "CURRENCY_PACKAGE" | "MEMBERSHIP";
  name: string;
  description: string;
  shortDescription: string;
  benefitsJson: string;
  priceMinor: number;
  billingCurrency: string;
  onyxBase: number;
  onyxBonus: number;
  metadataJson: string;
  discountPercent: number;
};

type ExistingCheckout = {
  orderId: string;
  productId: string | null;
  orderStatus: string;
  sessionStatus: string;
  checkoutUrl: string | null;
  expiresAt: string | null;
  billingCycle: "ONE_TIME" | "MONTHLY" | "ANNUAL";
};

export type CheckoutBillingCycle = "MONTHLY" | "ANNUAL";

function membershipTerms(
  metadataJson: string,
  fallbackAllowance: number,
  billingCycle: CheckoutBillingCycle,
) {
  try {
    const parsed = JSON.parse(metadataJson) as {
      annualPriceMinor?: unknown;
      monthlyCoins?: unknown;
    };
    const configured = parsed?.monthlyCoins;
    const monthlyAllowance =
      typeof configured === "number" &&
      Number.isSafeInteger(configured) &&
      configured >= 0
      ? configured
      : fallbackAllowance;
    const annualPriceMinor = parsed?.annualPriceMinor;
    return {
      amountMinor:
        billingCycle === "ANNUAL" &&
        typeof annualPriceMinor === "number" &&
        Number.isSafeInteger(annualPriceMinor)
          ? annualPriceMinor
          : null,
      allowance:
        billingCycle === "ANNUAL" ? monthlyAllowance * 12 : monthlyAllowance,
    };
  } catch {
    return {
      amountMinor: null,
      allowance:
        billingCycle === "ANNUAL" ? fallbackAllowance * 12 : fallbackAllowance,
    };
  }
}

async function purchasableProduct(db: D1Database, productId: string) {
  return db
    .prepare(
      `SELECT id, revision, kind, name, description,
              short_description AS shortDescription,
              benefits_json AS benefitsJson, price_minor AS priceMinor,
              billing_currency AS billingCurrency,
              onyx_base AS onyxBase, onyx_bonus AS onyxBonus,
              metadata_json AS metadataJson,
              discount_percent AS discountPercent
         FROM products
        WHERE id = ?
          AND kind IN ('CURRENCY_PACKAGE', 'MEMBERSHIP')
          AND active = 1 AND archived_at IS NULL
          AND lifecycle_status IN ('ACTIVE', 'SCHEDULED')
          AND (starts_at IS NULL OR datetime(starts_at) <= datetime('now'))
          AND (ends_at IS NULL OR datetime(ends_at) > datetime('now'))
        LIMIT 1`,
    )
    .bind(productId)
    .first<CheckoutProduct>();
}

async function existingCheckout(
  db: D1Database,
  userId: string,
  idempotencyKey: string,
) {
  return db
    .prepare(
      `SELECT o.id AS orderId, oi.product_id AS productId,
              o.status AS orderStatus, session.status AS sessionStatus,
              session.checkout_url AS checkoutUrl,
              session.expires_at AS expiresAt,
              session.billing_cycle AS billingCycle
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         JOIN payment_checkout_sessions session ON session.order_id = o.id
        WHERE o.user_id = ? AND o.idempotency_key = ?
        LIMIT 1`,
    )
    .bind(userId, idempotencyKey)
    .first<ExistingCheckout>();
}

async function expireStaleMembershipCheckouts(
  db: D1Database,
  userId: string,
  productId: string,
) {
  await db.batch([
    db.prepare(
      `UPDATE payment_checkout_sessions
          SET status = 'EXPIRED', revision = revision + 1,
              updated_at = CURRENT_TIMESTAMP
        WHERE mode = 'SUBSCRIPTION' AND user_id_snapshot = ?
          AND product_id_snapshot = ? AND status = 'OPEN'
          AND expires_at IS NOT NULL AND datetime(expires_at) <= datetime('now')`,
    ).bind(userId, productId),
    db.prepare(
      `UPDATE payment_checkout_sessions
          SET status = 'FAILED', revision = revision + 1,
              updated_at = CURRENT_TIMESTAMP
        WHERE mode = 'SUBSCRIPTION' AND user_id_snapshot = ?
          AND product_id_snapshot = ? AND status = 'CREATING'
          AND datetime(updated_at) <= datetime('now', '-2 minutes')`,
    ).bind(userId, productId),
  ]);
}

async function pendingMembershipCheckout(
  db: D1Database,
  userId: string,
  productId: string,
) {
  return db
    .prepare(
      `SELECT o.id AS orderId, oi.product_id AS productId,
              o.status AS orderStatus, session.status AS sessionStatus,
              session.checkout_url AS checkoutUrl,
              session.expires_at AS expiresAt,
              session.billing_cycle AS billingCycle
         FROM payment_checkout_sessions session
         JOIN orders o ON o.id = session.order_id
         JOIN order_items oi ON oi.order_id = o.id
        WHERE session.mode = 'SUBSCRIPTION'
          AND session.user_id_snapshot = ?
          AND session.product_id_snapshot = ?
          AND session.status IN ('CREATING', 'OPEN')
        ORDER BY session.created_at ASC
        LIMIT 1`,
    )
    .bind(userId, productId)
    .first<ExistingCheckout>();
}

function reusePendingMembership(
  pending: ExistingCheckout,
  billingCycle: CheckoutBillingCycle,
) {
  if (
    pending.billingCycle === billingCycle &&
    pending.sessionStatus === "OPEN" &&
    validStripeCheckoutUrl(pending.checkoutUrl) &&
    (!pending.expiresAt || Date.parse(pending.expiresAt) > Date.now())
  ) {
    return {
      orderId: pending.orderId,
      checkoutUrl: pending.checkoutUrl!,
      expiresAt: pending.expiresAt,
      billingCycle,
      reused: true,
    };
  }
  throw new ApiError(
    409,
    "MEMBERSHIP_CHECKOUT_ALREADY_PENDING",
    "A Checkout Session for this membership is already in progress.",
  );
}

function validStripeCheckoutUrl(value: string | null) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "checkout.stripe.com" || url.hostname.endsWith(".checkout.stripe.com"))
    );
  } catch {
    return false;
  }
}

export async function createHostedCheckout(
  db: D1Database,
  actor: Actor,
  input: {
    productId: string;
    idempotencyKey: string;
    billingCycle?: CheckoutBillingCycle;
  },
) {
  const product = await purchasableProduct(db, input.productId);
  if (!product) {
    throw new ApiError(404, "OFFER_NOT_FOUND", "This offer is no longer available.");
  }
  await requireFeature(
    product.kind === "MEMBERSHIP" ? "memberships" : "onyx_purchases",
    db,
  );
  await requireFeature("payments", db);
  const billingCycle: "ONE_TIME" | CheckoutBillingCycle =
    product.kind === "MEMBERSHIP"
      ? (input.billingCycle ?? "MONTHLY")
      : "ONE_TIME";
  const membership =
    product.kind === "MEMBERSHIP"
      ? membershipTerms(
          product.metadataJson,
          Number(product.onyxBonus),
          billingCycle as CheckoutBillingCycle,
        )
      : null;
  const amountMinor =
    billingCycle === "ANNUAL"
      ? Number(membership?.amountMinor ?? 0)
      : Number(product.priceMinor);
  if (
    !Number.isSafeInteger(amountMinor) ||
    Number(amountMinor) <= 0 ||
    !/^[A-Z]{3}$/.test(product.billingCurrency)
  ) {
    throw new ApiError(
      409,
      billingCycle === "ANNUAL"
        ? "OFFER_ANNUAL_PRICE_INVALID"
        : "OFFER_PRICE_INVALID",
      "This offer has no valid price for the selected billing cycle.",
    );
  }
  const fulfillmentOnyx = product.kind === "CURRENCY_PACKAGE"
    ? Number(product.onyxBase) + Number(product.onyxBonus)
    : Number(membership?.allowance);
  if (
    !Number.isSafeInteger(fulfillmentOnyx) ||
    fulfillmentOnyx < 0 ||
    (product.kind === "CURRENCY_PACKAGE" && fulfillmentOnyx === 0)
  ) {
    throw new ApiError(
      409,
      "OFFER_REWARD_INVALID",
      "This offer has no valid fulfillment reward.",
    );
  }
  if (product.kind === "MEMBERSHIP") {
    const activeMembership = await db
      .prepare(
        `SELECT id FROM user_memberships
          WHERE user_id = ? AND product_id = ?
            AND status IN ('ACTIVE', 'TRIALING', 'PAST_DUE')
          LIMIT 1`,
      )
      .bind(actor.id, product.id)
      .first();
    if (activeMembership) {
      throw new ApiError(409, "MEMBERSHIP_ALREADY_EXISTS", "This membership already belongs to your account.");
    }
  }

  const scopedKey = `${actor.id}:${input.idempotencyKey}`;
  let prior = await existingCheckout(db, actor.id, scopedKey);
  if (
    prior &&
    (prior.productId !== product.id || prior.billingCycle !== billingCycle)
  ) {
    throw new ApiError(
      409,
      "IDEMPOTENCY_KEY_REUSED",
      "Use a new checkout request identifier for a different offer.",
    );
  }
  if (
    prior?.sessionStatus === "OPEN" &&
    validStripeCheckoutUrl(prior.checkoutUrl) &&
    (!prior.expiresAt || Date.parse(prior.expiresAt) > Date.now())
  ) {
    return {
      orderId: prior.orderId,
      checkoutUrl: prior.checkoutUrl!,
      expiresAt: prior.expiresAt,
      billingCycle,
      reused: true,
    };
  }
  if (prior?.sessionStatus === "OPEN") {
    throw new ApiError(
      409,
      "CHECKOUT_SESSION_EXPIRED",
      "This Checkout Session expired. Start again with a new request identifier.",
    );
  }
  if (prior?.orderStatus === "PAID") {
    throw new ApiError(409, "ORDER_ALREADY_PAID", "This order was already paid and fulfilled.");
  }

  if (!prior && product.kind === "MEMBERSHIP") {
    await expireStaleMembershipCheckouts(db, actor.id, product.id);
    const pending = await pendingMembershipCheckout(db, actor.id, product.id);
    if (pending) return reusePendingMembership(pending, billingCycle as CheckoutBillingCycle);
  }

  if (!prior) {
    const orderId = `order_${randomId()}`;
    const orderItemId = `order_item_${randomId()}`;
    const sessionId = `checkout_${randomId()}`;
    try {
      await db.batch([
      db.prepare(
        `INSERT OR IGNORE INTO orders
         (id, user_id, status, total_minor, billing_currency,
          provider, idempotency_key)
         VALUES (?, ?, 'PENDING', ?, ?, 'STRIPE', ?)`,
      ).bind(
        orderId,
        actor.id,
        amountMinor,
        product.billingCurrency,
        scopedKey,
      ),
      db.prepare(
        `INSERT INTO order_items
         (id, order_id, product_id, product_version, title_snapshot,
          description_snapshot, benefits_snapshot_json, quantity,
          unit_price_minor, billing_currency, bonus_snapshot,
          discount_snapshot)
         SELECT ?, id, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?
           FROM orders WHERE id = ?`,
      ).bind(
        orderItemId,
        product.id,
        product.revision,
        product.name,
        product.shortDescription || product.description,
        product.benefitsJson,
        amountMinor,
        product.billingCurrency,
        product.kind === "MEMBERSHIP" ? fulfillmentOnyx : product.onyxBonus,
        product.discountPercent,
        orderId,
      ),
      db.prepare(
        `INSERT INTO payment_checkout_sessions
         (id, order_id, provider, mode, product_id_snapshot,
          product_revision_snapshot, product_kind_snapshot,
          fulfillment_onyx_snapshot, status, amount_minor, billing_currency,
          billing_cycle, user_id_snapshot)
         SELECT ?, id, 'STRIPE', ?, ?, ?, ?, ?, 'CREATING', ?, ?, ?, ?
           FROM orders WHERE id = ?`,
      ).bind(
        sessionId,
        product.kind === "MEMBERSHIP" ? "SUBSCRIPTION" : "PAYMENT",
        product.id,
        product.revision,
        product.kind,
        fulfillmentOnyx,
        amountMinor,
        product.billingCurrency,
        billingCycle,
        actor.id,
        orderId,
      ),
      ]);
    } catch (error) {
      if (product.kind === "MEMBERSHIP") {
        const pending = await pendingMembershipCheckout(db, actor.id, product.id);
        if (pending) {
          return reusePendingMembership(
            pending,
            billingCycle as CheckoutBillingCycle,
          );
        }
      }
      throw error;
    }
    prior = await existingCheckout(db, actor.id, scopedKey);
  }
  if (!prior) {
    throw new ApiError(409, "CHECKOUT_CONFLICT", "The checkout could not be reserved.");
  }

  await db.batch([
    db.prepare(
      `UPDATE payment_checkout_sessions
          SET status = 'CREATING', checkout_url = NULL, expires_at = NULL,
              revision = revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE order_id = ? AND status IN ('CREATING', 'FAILED', 'EXPIRED')`,
    ).bind(prior.orderId),
    db.prepare(
      `UPDATE orders SET status = 'PROCESSING', updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status IN ('PENDING', 'FAILED', 'PROCESSING')`,
    ).bind(prior.orderId),
  ]);

  try {
    const session = await createStripeCheckoutSession({
      orderId: prior.orderId,
      userId: actor.id,
      userEmail: actor.email,
      productId: product.id,
      productRevision: Number(product.revision),
      productName: product.name,
      description: product.shortDescription || product.description,
      amountMinor,
      currency: product.billingCurrency,
      kind: product.kind,
      billingCycle,
      idempotencyKey: `nyascans:${scopedKey}`,
    });
    if (!validStripeCheckoutUrl(session.url)) {
      throw new ApiError(502, "PAYMENT_PROVIDER_RESPONSE_INVALID", "The payment provider returned an invalid Checkout URL.");
    }
    const expiresAt = session.expires_at
      ? new Date(session.expires_at * 1_000).toISOString()
      : null;
    const updated = await db
      .prepare(
        `UPDATE payment_checkout_sessions
            SET provider_session_id = ?, checkout_url = ?, status = 'OPEN',
                expires_at = ?, revision = revision + 1,
                updated_at = CURRENT_TIMESTAMP
          WHERE order_id = ? AND status = 'CREATING'
            AND amount_minor = ? AND billing_currency = ?`,
      )
      .bind(
        session.id,
        session.url,
        expiresAt,
        prior.orderId,
        amountMinor,
        product.billingCurrency,
      )
      .run();
    if (!updated.meta.changes) {
      throw new ApiError(409, "CHECKOUT_CONFLICT", "The checkout changed before its provider session was stored.");
    }
    await db
      .prepare(
        `UPDATE orders SET provider_reference = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = 'PROCESSING'`,
      )
      .bind(session.id, prior.orderId)
      .run();
    return {
      orderId: prior.orderId,
      checkoutUrl: session.url!,
      expiresAt,
      billingCycle,
      reused: false,
    };
  } catch (error) {
    await db.batch([
      db.prepare(
        `UPDATE payment_checkout_sessions
            SET status = 'FAILED', revision = revision + 1,
                updated_at = CURRENT_TIMESTAMP
          WHERE order_id = ? AND status = 'CREATING'`,
      ).bind(prior.orderId),
      db.prepare(
        `UPDATE orders SET status = 'FAILED', updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = 'PROCESSING'`,
      ).bind(prior.orderId),
    ]).catch(() => undefined);
    throw error;
  }
}
