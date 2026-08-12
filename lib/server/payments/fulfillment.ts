import type { D1Database } from "@cloudflare/workers-types";
import { ApiError } from "@/lib/server/api";
import { platformAccountId, userWalletAccountId } from "@/lib/server/economy";
import {
  isStripeAdverseEvent,
  processStripeAdverseEvent,
} from "@/lib/server/payments/adverse-events";
import {
  retrieveStripeSubscription,
  type StripeEvent,
} from "@/lib/server/payments/stripe";
import { randomId } from "@/lib/server/random-id";

type CheckoutOrder = {
  orderId: string;
  userId: string;
  orderStatus: string;
  totalMinor: number;
  billingCurrency: string;
  providerReference: string | null;
  orderItemId: string;
  productId: string;
  productVersion: number;
  productKind: "CURRENCY_PACKAGE" | "MEMBERSHIP";
  billingCycle: "ONE_TIME" | "MONTHLY" | "ANNUAL";
  productName: string;
  fulfillmentOnyx: number;
};

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function objectValue(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function unixSeconds(value: unknown) {
  const seconds = numberValue(value);
  return seconds === null || !Number.isSafeInteger(seconds) || seconds <= 0
    ? null
    : seconds;
}

function providerObjectId(value: unknown) {
  if (typeof value === "string") return value;
  return stringValue(objectValue(value).id);
}

function stripeObjectId(value: unknown, prefix: string) {
  const id = providerObjectId(value);
  return id &&
    id.startsWith(prefix) &&
    id.length <= 255 &&
    /^[A-Za-z0-9_]+$/u.test(id)
    ? id
    : null;
}

export async function claimStripeWebhookEvent(
  db: D1Database,
  event: StripeEvent,
  payloadSha256: string,
) {
  const inserted = await db
    .prepare(
      `INSERT OR IGNORE INTO payment_webhook_events
       (id, provider, event_type, payload_sha256, status, attempt_count)
       VALUES (?, 'STRIPE', ?, ?, 'RECEIVED', 0)`,
    )
    .bind(event.id, event.type, payloadSha256)
    .run();
  const current = await db
    .prepare(
      `SELECT payload_sha256 AS payloadSha256, status
         FROM payment_webhook_events WHERE id = ? LIMIT 1`,
    )
    .bind(event.id)
    .first<{ payloadSha256: string; status: string }>();
  if (!current || current.payloadSha256 !== payloadSha256) {
    throw new ApiError(
      409,
      "PAYMENT_EVENT_CONFLICT",
      "The payment event identifier was reused with different content.",
    );
  }
  if (["PROCESSED", "IGNORED"].includes(current.status)) return false;
  const claimed = await db
    .prepare(
      `UPDATE payment_webhook_events
          SET status = 'PROCESSING', attempt_count = attempt_count + 1,
              last_error_code = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND (
            status IN ('RECEIVED', 'FAILED')
            OR (status = 'PROCESSING' AND datetime(updated_at) <= datetime('now', '-5 minutes'))
          )`,
    )
    .bind(event.id)
    .run();
  return Boolean(inserted.meta.changes || claimed.meta.changes);
}

export async function markStripeWebhookFailed(
  db: D1Database,
  eventId: string,
  error: unknown,
) {
  const code =
    error instanceof ApiError
      ? error.code
      : error instanceof Error
        ? error.name.slice(0, 80)
        : "UNKNOWN_ERROR";
  await db
    .prepare(
      `UPDATE payment_webhook_events
          SET status = 'FAILED', last_error_code = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'PROCESSING'`,
    )
    .bind(code, eventId)
    .run();
}

function completeEventStatement(db: D1Database, eventId: string, ignored = false) {
  return db
    .prepare(
      `UPDATE payment_webhook_events
          SET status = ?, processed_at = CURRENT_TIMESTAMP,
              last_error_code = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'PROCESSING'`,
    )
    .bind(ignored ? "IGNORED" : "PROCESSED", eventId);
}

function completeOrderEventStatement(
  db: D1Database,
  eventId: string,
  orderItemId: string,
  kind: "ONYX" | "MEMBERSHIP",
) {
  return db
    .prepare(
      `UPDATE payment_webhook_events
          SET status = 'PROCESSED', processed_at = CURRENT_TIMESTAMP,
              last_error_code = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'PROCESSING'
          AND EXISTS (
            SELECT 1 FROM order_fulfillments fulfillment
             WHERE fulfillment.order_item_id = ? AND fulfillment.kind = ?
          )`,
    )
    .bind(eventId, orderItemId, kind);
}

function completeMembershipInvoiceEventStatement(
  db: D1Database,
  eventId: string,
  membershipId: string,
  orderId: string,
  userId: string,
  invoiceId: string,
  periodKey: string,
  amountMinor: number,
  currency: string,
  fulfillmentOnyx: number,
  requiresGrant: boolean,
) {
  return db
    .prepare(
      `UPDATE payment_webhook_events
          SET status = 'PROCESSED', processed_at = CURRENT_TIMESTAMP,
              last_error_code = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'PROCESSING'
          AND EXISTS (
            SELECT 1 FROM payment_invoice_snapshots snapshot
             WHERE snapshot.membership_id = ?
               AND snapshot.order_id = ?
               AND snapshot.user_id = ?
               AND snapshot.provider_invoice_id = ?
               AND snapshot.period_key = ?
               AND snapshot.amount_minor = ?
               AND snapshot.billing_currency = ?
               AND snapshot.fulfillment_onyx = ?
          )
          AND (
            (? = 1 AND EXISTS (
              SELECT 1 FROM membership_coin_grants grant_row
               WHERE grant_row.membership_id = ?
                 AND grant_row.provider_invoice_id = ?
                 AND grant_row.period_key = ?
            ))
            OR (? = 0 AND EXISTS (
              SELECT 1 FROM user_memberships membership
               WHERE membership.id = ?
            ))
          )`,
    )
    .bind(
      eventId,
      membershipId,
      orderId,
      userId,
      invoiceId,
      periodKey,
      amountMinor,
      currency,
      fulfillmentOnyx,
      requiresGrant ? 1 : 0,
      membershipId,
      invoiceId,
      periodKey,
      requiresGrant ? 1 : 0,
      membershipId,
    );
}

function refreshMembershipOrderStatusStatement(
  db: D1Database,
  orderId: string,
  membershipId: string,
  invoiceId: string,
  periodKey: string,
  amountMinor: number,
  currency: string,
  fulfillmentOnyx: number,
) {
  return db
    .prepare(
      `UPDATE orders
          SET status = CASE
                WHEN EXISTS (
                  SELECT 1
                    FROM payment_financial_states financial_state
                    JOIN payment_disputes dispute
                      ON dispute.state_id = financial_state.id
                   WHERE financial_state.order_id = orders.id
                     AND dispute.status IN ('OPEN', 'LOST')
                ) THEN 'DISPUTED'
                ELSE 'PAID'
              END,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND provider = 'STRIPE'
          AND status IN ('PAID', 'REFUNDED', 'DISPUTED')
          AND EXISTS (
            SELECT 1 FROM payment_invoice_snapshots snapshot
             WHERE snapshot.membership_id = ?
               AND snapshot.order_id = orders.id
               AND snapshot.provider_invoice_id = ?
               AND snapshot.period_key = ?
               AND snapshot.amount_minor = ?
               AND snapshot.billing_currency = ?
               AND snapshot.fulfillment_onyx = ?
          )`,
    )
    .bind(
      orderId,
      membershipId,
      invoiceId,
      periodKey,
      amountMinor,
      currency,
      fulfillmentOnyx,
    );
}

function completeSubscriptionEventStatement(
  db: D1Database,
  eventId: string,
  subscriptionId: string,
) {
  return db
    .prepare(
      `UPDATE payment_webhook_events
          SET status = 'PROCESSED', processed_at = CURRENT_TIMESTAMP,
              last_error_code = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'PROCESSING'
          AND EXISTS (
            SELECT 1 FROM user_memberships membership
             WHERE membership.provider = 'STRIPE'
               AND membership.provider_subscription_id = ?
               AND membership.provider_last_event_id = ?
          )`,
    )
    .bind(eventId, subscriptionId, eventId);
}

async function assertStripeEventTerminal(db: D1Database, eventId: string) {
  const event = await db
    .prepare(
      `SELECT status FROM payment_webhook_events
        WHERE id = ? AND status IN ('PROCESSED', 'IGNORED')
        LIMIT 1`,
    )
    .bind(eventId)
    .first();
  if (!event) {
    throw new ApiError(
      409,
      "PAYMENT_EVENT_NOT_TERMINAL",
      "The payment event could not be committed atomically.",
    );
  }
}

async function checkoutOrder(db: D1Database, sessionId: string) {
  return db
    .prepare(
      `SELECT o.id AS orderId, o.user_id AS userId, o.status AS orderStatus,
              o.total_minor AS totalMinor, o.billing_currency AS billingCurrency,
              o.provider_reference AS providerReference,
              oi.id AS orderItemId,
              session.product_id_snapshot AS productId,
              session.product_revision_snapshot AS productVersion,
              oi.title_snapshot AS productName,
              session.product_kind_snapshot AS productKind,
              session.billing_cycle AS billingCycle,
              session.fulfillment_onyx_snapshot AS fulfillmentOnyx
         FROM payment_checkout_sessions session
         JOIN orders o ON o.id = session.order_id
         JOIN order_items oi ON oi.order_id = o.id
        WHERE session.provider = 'STRIPE'
          AND session.provider_session_id = ?
        LIMIT 1`,
    )
    .bind(sessionId)
    .first<CheckoutOrder>();
}

function validateCheckoutCompletion(
  order: CheckoutOrder,
  session: Record<string, unknown>,
) {
  const sessionId = stringValue(session.id);
  const metadata = objectValue(session.metadata);
  const paymentStatus = stringValue(session.payment_status);
  const amountTotal = numberValue(session.amount_total);
  const currency = stringValue(session.currency)?.toUpperCase();
  const expectedMode =
    order.productKind === "MEMBERSHIP" ? "subscription" : "payment";
  if (
    !sessionId ||
    paymentStatus !== "paid" ||
    amountTotal !== Number(order.totalMinor) ||
    currency !== order.billingCurrency.toUpperCase() ||
    stringValue(session.mode) !== expectedMode ||
    stringValue(session.client_reference_id) !== order.orderId ||
    stringValue(metadata.order_id) !== order.orderId ||
    stringValue(metadata.user_id) !== order.userId ||
    stringValue(metadata.product_id) !== order.productId ||
    Number(stringValue(metadata.product_revision)) !== Number(order.productVersion) ||
    stringValue(metadata.billing_cycle) !== order.billingCycle
  ) {
    throw new ApiError(
      409,
      "PAYMENT_FULFILLMENT_MISMATCH",
      "The verified payment does not match the immutable order snapshot.",
    );
  }
}

async function fulfillOnyxOrder(
  db: D1Database,
  event: StripeEvent,
  session: Record<string, unknown>,
  order: CheckoutOrder,
) {
  const sessionId = stringValue(session.id)!;
  const paymentIntentId = stripeObjectId(session.payment_intent, "pi_");
  if (!paymentIntentId) {
    throw new ApiError(
      409,
      "PAYMENT_INTENT_REFERENCE_MISSING",
      "The paid Checkout Session has no valid Payment Intent reference.",
    );
  }
  const invoiceId = stripeObjectId(session.invoice, "in_");
  const customerId = stripeObjectId(session.customer, "cus_");
  const amountOnyx = Number(order.fulfillmentOnyx);
  if (!Number.isSafeInteger(amountOnyx) || amountOnyx <= 0) {
    throw new ApiError(409, "ORDER_REWARD_INVALID", "The order has no valid coin grant.");
  }
  const userAccountId = userWalletAccountId(order.userId, "ONYX");
  const sourceAccountId = platformAccountId("stripe", "ONYX");
  const transactionId = `lt_stripe_${order.orderId}`;
  const idempotencyKey = `stripe:checkout:${sessionId}:onyx`;
  const results = await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO ledger_accounts
       (id, owner_type, owner_id, currency, account_type)
       VALUES (?, 'USER', ?, 'ONYX', 'AVAILABLE')`,
    ).bind(userAccountId, order.userId),
    db.prepare(
      `INSERT OR IGNORE INTO ledger_accounts
       (id, owner_type, owner_id, currency, account_type)
       VALUES (?, 'PLATFORM', 'STRIPE_CLEARING', 'ONYX', 'SOURCE')`,
    ).bind(sourceAccountId),
    db.prepare(
      `INSERT OR IGNORE INTO ledger_transactions
       (id, kind, reference_type, reference_id, idempotency_key, memo)
       VALUES (?, 'ONYX_PURCHASE', 'ORDER', ?, ?, ?)`,
    ).bind(
      transactionId,
      order.orderId,
      idempotencyKey,
      `${amountOnyx} Onyx purchased through verified Stripe Checkout`,
    ),
    db.prepare(
      `INSERT INTO ledger_entries (id, transaction_id, account_id, amount)
       SELECT ?, transaction_row.id, ?, ?
         FROM ledger_transactions transaction_row
        WHERE transaction_row.id = ?
          AND NOT EXISTS (
            SELECT 1 FROM ledger_entries existing
             WHERE existing.transaction_id = transaction_row.id
          )`,
    ).bind(randomId(), sourceAccountId, -amountOnyx, transactionId),
    db.prepare(
      `INSERT INTO ledger_entries (id, transaction_id, account_id, amount)
       SELECT ?, transaction_row.id, ?, ?
         FROM ledger_transactions transaction_row
        WHERE transaction_row.id = ?
          AND (SELECT COUNT(*) FROM ledger_entries existing
                WHERE existing.transaction_id = transaction_row.id) = 1`,
    ).bind(randomId(), userAccountId, amountOnyx, transactionId),
    db.prepare(
      `INSERT OR IGNORE INTO order_fulfillments
       (id, order_id, order_item_id, kind, provider_event_id, ledger_transaction_id)
       SELECT ?, ?, ?, 'ONYX', ?, ?
        WHERE EXISTS (
          SELECT 1 FROM ledger_entries WHERE transaction_id = ?
          GROUP BY transaction_id HAVING SUM(amount) = 0 AND COUNT(*) = 2
        )`,
    ).bind(randomId(), order.orderId, order.orderItemId, event.id, transactionId, transactionId),
    db.prepare(
      `UPDATE orders SET status = 'PAID', provider = 'STRIPE',
          provider_reference = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status IN ('PENDING', 'PROCESSING', 'PAID')
          AND EXISTS (
            SELECT 1 FROM order_fulfillments fulfillment
             WHERE fulfillment.order_id = orders.id
               AND fulfillment.order_item_id = ?
               AND fulfillment.kind = 'ONYX'
               AND fulfillment.ledger_transaction_id = ?
          )`,
    ).bind(sessionId, order.orderId, order.orderItemId, transactionId),
    db.prepare(
      `UPDATE payment_checkout_sessions
          SET status = 'COMPLETED', provider_payment_intent_id = ?,
              provider_invoice_id = COALESCE(?, provider_invoice_id),
              provider_customer_id = COALESCE(?, provider_customer_id),
              revision = revision + 1,
              updated_at = CURRENT_TIMESTAMP
        WHERE provider = 'STRIPE' AND provider_session_id = ?
          AND EXISTS (
            SELECT 1 FROM order_fulfillments fulfillment
             WHERE fulfillment.order_id = payment_checkout_sessions.order_id
               AND fulfillment.order_item_id = ?
               AND fulfillment.kind = 'ONYX'
          )`,
    ).bind(
      paymentIntentId,
      invoiceId,
      customerId,
      sessionId,
      order.orderItemId,
    ),
    db.prepare(
      `INSERT OR IGNORE INTO notifications
       (id, user_id, kind, title, body, dedupe_key, action_url, metadata_json)
       SELECT ?, ?, 'PAYMENT_COMPLETED', 'Coin purchase completed', ?, ?, '/wallet', ?
        WHERE EXISTS (
          SELECT 1 FROM order_fulfillments fulfillment
           WHERE fulfillment.order_item_id = ? AND fulfillment.kind = 'ONYX'
        )`,
    ).bind(
      randomId(),
      order.userId,
      `${amountOnyx} Onyx were added to your wallet.`,
      `PAYMENT_COMPLETED:${order.orderId}`,
      JSON.stringify({ orderId: order.orderId, amountOnyx }),
      order.orderItemId,
    ),
    completeOrderEventStatement(db, event.id, order.orderItemId, "ONYX"),
  ]);
  if (!results[5]?.meta.changes) {
    const fulfilled = await db
      .prepare("SELECT id FROM order_fulfillments WHERE order_item_id = ? LIMIT 1")
      .bind(order.orderItemId)
      .first();
    if (!fulfilled) {
      throw new ApiError(409, "PAYMENT_FULFILLMENT_CONFLICT", "The coin order could not be fulfilled atomically.");
    }
  }
}

async function fulfillMembershipOrder(
  db: D1Database,
  event: StripeEvent,
  session: Record<string, unknown>,
  order: CheckoutOrder,
) {
  const sessionId = stringValue(session.id)!;
  const subscriptionId = stripeObjectId(session.subscription, "sub_");
  const customerId = stripeObjectId(session.customer, "cus_");
  const invoiceId = stripeObjectId(session.invoice, "in_");
  const paymentIntentId = stripeObjectId(session.payment_intent, "pi_");
  if (!subscriptionId || !customerId) {
    throw new ApiError(
      409,
      "SUBSCRIPTION_REFERENCE_MISSING",
      "The membership Checkout Session is missing its subscription or customer reference.",
    );
  }
  if (!["MONTHLY", "ANNUAL"].includes(order.billingCycle)) {
    throw new ApiError(
      409,
      "MEMBERSHIP_BILLING_CYCLE_INVALID",
      "The membership order has no valid billing-cycle snapshot.",
    );
  }
  const eventCreated = Number(event.created);
  const allowance = Number(order.fulfillmentOnyx);
  if (
    !Number.isSafeInteger(eventCreated) ||
    eventCreated <= 0 ||
    !Number.isSafeInteger(allowance) ||
    allowance < 0
  ) {
    throw new ApiError(
      409,
      "MEMBERSHIP_SNAPSHOT_INVALID",
      "The membership event does not match a valid immutable snapshot.",
    );
  }
  const membershipId = `membership_${order.orderId}`;
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO user_memberships
       (id, user_id, product_id, provider, provider_customer_id,
        provider_subscription_id, provider_last_event_created,
        provider_last_event_id, billing_cycle, renewal_amount_minor,
        billing_currency, onyx_allowance, status)
       VALUES (?, ?, ?, 'STRIPE', ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
       ON CONFLICT(provider, provider_subscription_id) DO UPDATE SET
         provider_customer_id = COALESCE(excluded.provider_customer_id, user_memberships.provider_customer_id),
         status = 'ACTIVE',
         provider_last_event_created = excluded.provider_last_event_created,
         provider_last_event_id = excluded.provider_last_event_id,
         revision = user_memberships.revision + 1,
         updated_at = CURRENT_TIMESTAMP
       WHERE user_memberships.user_id = excluded.user_id
         AND user_memberships.product_id = excluded.product_id
         AND excluded.provider_last_event_created > user_memberships.provider_last_event_created`,
    ).bind(
      membershipId,
      order.userId,
      order.productId,
      customerId,
      subscriptionId,
      eventCreated,
      event.id,
      order.billingCycle,
      Number(order.totalMinor),
      order.billingCurrency,
      allowance,
    ),
    db.prepare(
      `INSERT OR IGNORE INTO order_fulfillments
       (id, order_id, order_item_id, kind, provider_event_id,
        membership_id)
       SELECT ?, ?, ?, 'MEMBERSHIP', ?, ?
        WHERE EXISTS (
          SELECT 1 FROM user_memberships
           WHERE id = ? AND user_id = ? AND product_id = ?
             AND provider_subscription_id = ?
             AND billing_cycle = ? AND renewal_amount_minor = ?
             AND billing_currency = ? AND onyx_allowance = ?
        )`,
    ).bind(
      randomId(),
      order.orderId,
      order.orderItemId,
      event.id,
      membershipId,
      membershipId,
      order.userId,
      order.productId,
      subscriptionId,
      order.billingCycle,
      Number(order.totalMinor),
      order.billingCurrency,
      allowance,
    ),
    db.prepare(
      `UPDATE orders SET status = 'PAID', provider = 'STRIPE',
          provider_reference = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status IN ('PENDING', 'PROCESSING', 'PAID')
          AND EXISTS (
            SELECT 1 FROM order_fulfillments fulfillment
             WHERE fulfillment.order_id = orders.id
               AND fulfillment.order_item_id = ?
               AND fulfillment.kind = 'MEMBERSHIP'
               AND fulfillment.membership_id = ?
          )`,
    ).bind(sessionId, order.orderId, order.orderItemId, membershipId),
    db.prepare(
      `UPDATE payment_checkout_sessions
          SET status = 'COMPLETED', provider_subscription_id = ?,
              provider_customer_id = ?,
              provider_invoice_id = COALESCE(?, provider_invoice_id),
              provider_payment_intent_id = COALESCE(?, provider_payment_intent_id),
              revision = revision + 1,
              updated_at = CURRENT_TIMESTAMP
        WHERE provider = 'STRIPE' AND provider_session_id = ?
          AND EXISTS (
            SELECT 1 FROM order_fulfillments fulfillment
             WHERE fulfillment.order_id = payment_checkout_sessions.order_id
               AND fulfillment.order_item_id = ?
               AND fulfillment.kind = 'MEMBERSHIP'
          )`,
    ).bind(
      subscriptionId,
      customerId,
      invoiceId,
      paymentIntentId,
      sessionId,
      order.orderItemId,
    ),
    db.prepare(
      `INSERT OR IGNORE INTO notifications
       (id, user_id, kind, title, body, dedupe_key, action_url, metadata_json)
       SELECT ?, ?, 'MEMBERSHIP_ACTIVE', 'Membership activated', ?, ?, '/store/memberships', ?
        WHERE EXISTS (
          SELECT 1 FROM order_fulfillments fulfillment
           WHERE fulfillment.order_item_id = ?
             AND fulfillment.kind = 'MEMBERSHIP'
             AND fulfillment.membership_id = ?
        )`,
    ).bind(
      randomId(),
      order.userId,
      `${order.productName} is now active.`,
      `MEMBERSHIP_ACTIVE:${membershipId}`,
      JSON.stringify({ orderId: order.orderId, membershipId }),
      order.orderItemId,
      membershipId,
    ),
    completeOrderEventStatement(
      db,
      event.id,
      order.orderItemId,
      "MEMBERSHIP",
    ),
  ];
  await db.batch(statements);
  const fulfilled = await db
    .prepare("SELECT id FROM order_fulfillments WHERE order_item_id = ? LIMIT 1")
    .bind(order.orderItemId)
    .first();
  if (!fulfilled) {
    throw new ApiError(409, "PAYMENT_FULFILLMENT_CONFLICT", "The membership order could not be fulfilled atomically.");
  }
}

async function fulfillCheckoutSession(
  db: D1Database,
  event: StripeEvent,
  session: Record<string, unknown>,
) {
  const sessionId = stringValue(session.id);
  if (!sessionId) throw new ApiError(400, "CHECKOUT_SESSION_INVALID", "The Checkout Session ID is missing.");
  const order = await checkoutOrder(db, sessionId);
  if (!order) {
    throw new ApiError(404, "CHECKOUT_ORDER_NOT_FOUND", "No immutable order matches this Checkout Session.");
  }
  validateCheckoutCompletion(order, session);
  if (order.productKind === "CURRENCY_PACKAGE") {
    await fulfillOnyxOrder(db, event, session, order);
  } else if (order.productKind === "MEMBERSHIP") {
    await fulfillMembershipOrder(db, event, session, order);
  } else {
    throw new ApiError(409, "ORDER_KIND_UNSUPPORTED", "This product cannot be fulfilled by Checkout.");
  }
}

function subscriptionIdFromInvoice(invoice: Record<string, unknown>) {
  const direct = stripeObjectId(invoice.subscription, "sub_");
  if (direct) return direct;
  const parent = objectValue(invoice.parent);
  const subscriptionDetails = objectValue(parent.subscription_details);
  return stripeObjectId(subscriptionDetails.subscription, "sub_");
}

function paymentIntentIdFromInvoice(invoice: Record<string, unknown>) {
  const direct = stripeObjectId(invoice.payment_intent, "pi_");
  if (direct) return direct;
  const payments = objectValue(invoice.payments);
  const data = Array.isArray(payments.data) ? payments.data : [];
  for (const entry of data) {
    const payment = objectValue(objectValue(entry).payment);
    const paymentIntentId = stripeObjectId(payment.payment_intent, "pi_");
    if (paymentIntentId) return paymentIntentId;
  }
  return null;
}

function invoicePeriod(invoice: Record<string, unknown>) {
  const lines = objectValue(invoice.lines);
  const data = Array.isArray(lines.data) ? lines.data : [];
  for (const entry of data) {
    const period = objectValue(objectValue(entry).period);
    const start = unixSeconds(period.start);
    const end = unixSeconds(period.end);
    if (start && end && end > start) {
      return {
        start,
        end,
        startIso: new Date(start * 1_000).toISOString(),
        endIso: new Date(end * 1_000).toISOString(),
      };
    }
  }
  return null;
}

function periodMatchesBillingCycle(
  period: { start: number; end: number },
  billingCycle: string,
) {
  const days = (period.end - period.start) / 86_400;
  return billingCycle === "ANNUAL"
    ? days >= 360 && days <= 370
    : billingCycle === "MONTHLY" && days >= 27 && days <= 32;
}

async function fulfillMembershipInvoice(
  db: D1Database,
  event: StripeEvent,
  invoice: Record<string, unknown>,
) {
  const billingReason = stringValue(invoice.billing_reason);
  if (
    !["subscription_create", "subscription_cycle"].includes(
      billingReason ?? "",
    )
  ) {
    await db.batch([completeEventStatement(db, event.id, true)]);
    return;
  }
  const subscriptionId = subscriptionIdFromInvoice(invoice);
  const invoiceId = stripeObjectId(invoice.id, "in_");
  if (!subscriptionId || !invoiceId) {
    throw new ApiError(400, "INVOICE_REFERENCE_INVALID", "The membership invoice is missing its subscription reference.");
  }
  const amountPaid = numberValue(invoice.amount_paid);
  const currency = stringValue(invoice.currency)?.toUpperCase() ?? null;
  const period = invoicePeriod(invoice);
  if (
    (invoice.paid !== true && stringValue(invoice.status) !== "paid") ||
    amountPaid === null ||
    !Number.isSafeInteger(amountPaid) ||
    amountPaid <= 0 ||
    !currency ||
    !/^[A-Z]{3}$/u.test(currency) ||
    !period
  ) {
    throw new ApiError(
      409,
      "MEMBERSHIP_INVOICE_INVALID",
      "The paid membership invoice has no valid amount, currency, or billing period.",
    );
  }
  const membership = await db
    .prepare(
      `SELECT membership.id, membership.user_id AS userId,
              membership.onyx_allowance AS onyxAllowance,
              membership.billing_cycle AS billingCycle,
              membership.renewal_amount_minor AS renewalAmountMinor,
              membership.billing_currency AS billingCurrency,
              (SELECT fulfillment.order_id
                 FROM order_fulfillments fulfillment
                WHERE fulfillment.membership_id = membership.id
                LIMIT 1) AS orderId
         FROM user_memberships membership
        WHERE membership.provider = 'STRIPE'
          AND membership.provider_subscription_id = ?
        LIMIT 1`,
    )
    .bind(subscriptionId)
    .first<{
      id: string;
      userId: string;
      onyxAllowance: number;
      billingCycle: "MONTHLY" | "ANNUAL";
      renewalAmountMinor: number;
      billingCurrency: string;
      orderId: string | null;
    }>();
  if (!membership || !membership.orderId) {
    throw new ApiError(404, "MEMBERSHIP_NOT_FOUND", "The paid subscription has no membership entitlement.");
  }
  const amount = Number(membership.onyxAllowance);
  if (
    amountPaid !== Number(membership.renewalAmountMinor) ||
    currency !== membership.billingCurrency ||
    !periodMatchesBillingCycle(period, membership.billingCycle) ||
    !Number.isSafeInteger(amount) ||
    amount < 0
  ) {
    throw new ApiError(
      409,
      "MEMBERSHIP_INVOICE_SNAPSHOT_MISMATCH",
      "The paid membership invoice does not match the stored subscription terms.",
    );
  }
  const periodKey = `${period.start}:${period.end}`;
  const paymentIntentId = paymentIntentIdFromInvoice(invoice);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    await db.batch([
      db.prepare(
        `INSERT OR IGNORE INTO payment_invoice_snapshots
         (id, membership_id, order_id, user_id, provider_event_id,
          provider_invoice_id, provider_payment_intent_id, amount_minor,
          billing_currency, fulfillment_onyx, period_key, period_start, period_end)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      ).bind(
        `pis_${invoiceId}`,
        membership.id,
        membership.orderId,
        membership.userId,
        event.id,
        invoiceId,
        paymentIntentId,
        amountPaid,
        currency,
        periodKey,
        period.startIso,
        period.endIso,
      ),
      db.prepare(
        `UPDATE user_memberships
            SET current_period_start = CASE
                  WHEN current_period_start IS NULL
                    OR datetime(?) >= datetime(current_period_start)
                  THEN ? ELSE current_period_start END,
                current_period_end = CASE
                  WHEN current_period_start IS NULL
                    OR datetime(?) >= datetime(current_period_start)
                  THEN ? ELSE current_period_end END,
                provider_latest_invoice_id = CASE
                  WHEN current_period_start IS NULL
                    OR datetime(?) >= datetime(current_period_start)
                  THEN ? ELSE provider_latest_invoice_id END,
            revision = revision + 1, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND EXISTS (
              SELECT 1 FROM payment_invoice_snapshots snapshot
               WHERE snapshot.membership_id = user_memberships.id
                 AND snapshot.provider_invoice_id = ?
                 AND snapshot.period_key = ?
                 AND snapshot.amount_minor = ?
                 AND snapshot.billing_currency = ?
                 AND snapshot.fulfillment_onyx = 0
            )`,
      ).bind(
        period.startIso,
        period.startIso,
        period.startIso,
        period.endIso,
        period.startIso,
        invoiceId,
        membership.id,
        invoiceId,
        periodKey,
        amountPaid,
        currency,
      ),
      refreshMembershipOrderStatusStatement(
        db,
        membership.orderId,
        membership.id,
        invoiceId,
        periodKey,
        amountPaid,
        currency,
        0,
      ),
      completeMembershipInvoiceEventStatement(
        db,
        event.id,
        membership.id,
        membership.orderId,
        membership.userId,
        invoiceId,
        periodKey,
        amountPaid,
        currency,
        0,
        false,
      ),
    ]);
    return;
  }
  const transactionId = `lt_membership_${membership.id}_${period.start}_${period.end}`;
  const userAccountId = userWalletAccountId(membership.userId, "ONYX");
  const sourceAccountId = platformAccountId("memberships", "ONYX");
  await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO ledger_accounts
       (id, owner_type, owner_id, currency, account_type)
       VALUES (?, 'USER', ?, 'ONYX', 'AVAILABLE')`,
    ).bind(userAccountId, membership.userId),
    db.prepare(
      `INSERT OR IGNORE INTO ledger_accounts
       (id, owner_type, owner_id, currency, account_type)
       VALUES (?, 'PLATFORM', 'NYASCANS_MEMBERSHIPS', 'ONYX', 'SOURCE')`,
    ).bind(sourceAccountId),
    db.prepare(
      `INSERT OR IGNORE INTO ledger_transactions
       (id, kind, reference_type, reference_id, idempotency_key, memo)
       VALUES (?, 'MEMBERSHIP_GRANT', 'MEMBERSHIP', ?, ?, ?)`,
    ).bind(
      transactionId,
      membership.id,
      `stripe:membership:${membership.id}:period:${periodKey}`,
      `${membership.billingCycle === "ANNUAL" ? "Annual" : "Monthly"} ${amount} Onyx membership allowance`,
    ),
    db.prepare(
      `INSERT INTO ledger_entries (id, transaction_id, account_id, amount)
       SELECT ?, transaction_row.id, ?, ?
         FROM ledger_transactions transaction_row
        WHERE transaction_row.id = ?
          AND NOT EXISTS (
            SELECT 1 FROM ledger_entries existing
             WHERE existing.transaction_id = transaction_row.id
          )`,
    ).bind(randomId(), sourceAccountId, -amount, transactionId),
    db.prepare(
      `INSERT INTO ledger_entries (id, transaction_id, account_id, amount)
       SELECT ?, transaction_row.id, ?, ?
         FROM ledger_transactions transaction_row
        WHERE transaction_row.id = ?
          AND (SELECT COUNT(*) FROM ledger_entries existing
                WHERE existing.transaction_id = transaction_row.id) = 1`,
    ).bind(randomId(), userAccountId, amount, transactionId),
    db.prepare(
      `INSERT OR IGNORE INTO membership_coin_grants
       (id, membership_id, provider_event_id, provider_invoice_id,
        provider_payment_intent_id, ledger_transaction_id, amount_onyx,
        amount_minor, billing_currency, period_key, period_start, period_end)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM ledger_entries WHERE transaction_id = ?
          GROUP BY transaction_id HAVING SUM(amount) = 0 AND COUNT(*) = 2
        )`,
    ).bind(
      randomId(),
      membership.id,
      event.id,
      invoiceId,
      paymentIntentId,
      transactionId,
      amount,
      amountPaid,
      currency,
      periodKey,
      period.startIso,
      period.endIso,
      transactionId,
    ),
    db.prepare(
      `INSERT OR IGNORE INTO payment_invoice_snapshots
       (id, membership_id, order_id, user_id, provider_event_id,
        provider_invoice_id, provider_payment_intent_id, amount_minor,
        billing_currency, fulfillment_onyx, period_key, period_start, period_end)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM membership_coin_grants grant_row
           WHERE grant_row.membership_id = ?
             AND grant_row.provider_event_id = ?
             AND grant_row.provider_invoice_id = ?
             AND grant_row.provider_payment_intent_id IS ?
             AND grant_row.ledger_transaction_id = ?
             AND grant_row.amount_onyx = ?
             AND grant_row.amount_minor = ?
             AND grant_row.billing_currency = ?
             AND grant_row.period_key = ?
             AND grant_row.period_start = ?
             AND grant_row.period_end = ?
        )`,
    ).bind(
      `pis_${invoiceId}`,
      membership.id,
      membership.orderId,
      membership.userId,
      event.id,
      invoiceId,
      paymentIntentId,
      amountPaid,
      currency,
      amount,
      periodKey,
      period.startIso,
      period.endIso,
      membership.id,
      event.id,
      invoiceId,
      paymentIntentId,
      transactionId,
      amount,
      amountPaid,
      currency,
      periodKey,
      period.startIso,
      period.endIso,
    ),
    db.prepare(
      `UPDATE user_memberships
          SET current_period_start = CASE
                WHEN current_period_start IS NULL
                  OR datetime(?) >= datetime(current_period_start)
                THEN ? ELSE current_period_start END,
              current_period_end = CASE
                WHEN current_period_start IS NULL
                  OR datetime(?) >= datetime(current_period_start)
                THEN ? ELSE current_period_end END,
              provider_latest_invoice_id = CASE
                WHEN current_period_start IS NULL
                  OR datetime(?) >= datetime(current_period_start)
                THEN ? ELSE provider_latest_invoice_id END,
          revision = revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND EXISTS (
            SELECT 1 FROM payment_invoice_snapshots snapshot
             WHERE snapshot.membership_id = user_memberships.id
               AND snapshot.provider_invoice_id = ?
               AND snapshot.period_key = ?
               AND snapshot.amount_minor = ?
               AND snapshot.billing_currency = ?
               AND snapshot.fulfillment_onyx = ?
          )`,
    ).bind(
      period.startIso,
      period.startIso,
      period.startIso,
      period.endIso,
      period.startIso,
      invoiceId,
      membership.id,
      invoiceId,
      periodKey,
      amountPaid,
      currency,
      amount,
    ),
    refreshMembershipOrderStatusStatement(
      db,
      membership.orderId,
      membership.id,
      invoiceId,
      periodKey,
      amountPaid,
      currency,
      amount,
    ),
    completeMembershipInvoiceEventStatement(
      db,
      event.id,
      membership.id,
      membership.orderId,
      membership.userId,
      invoiceId,
      periodKey,
      amountPaid,
      currency,
      amount,
      true,
    ),
  ]);
}

function normalizedMembershipStatus(value: unknown) {
  switch (stringValue(value)) {
    case "active":
      return "ACTIVE";
    case "trialing":
      return "TRIALING";
    case "past_due":
    case "unpaid":
      return "PAST_DUE";
    case "canceled":
      return "CANCELED";
    default:
      return "EXPIRED";
  }
}

function subscriptionPeriod(subscription: Record<string, unknown>) {
  let start = unixSeconds(subscription.current_period_start);
  let end = unixSeconds(subscription.current_period_end);
  if (!start || !end) {
    const items = objectValue(subscription.items);
    const firstItem = Array.isArray(items.data)
      ? objectValue(items.data[0])
      : {};
    start ??= unixSeconds(firstItem.current_period_start);
    end ??= unixSeconds(firstItem.current_period_end);
  }
  return {
    start: start ? new Date(start * 1_000).toISOString() : null,
    end: end ? new Date(end * 1_000).toISOString() : null,
  };
}

async function updateSubscription(
  db: D1Database,
  event: StripeEvent,
  subscription: Record<string, unknown>,
) {
  const subscriptionId = stripeObjectId(subscription.id, "sub_");
  const eventCreated = Number(event.created);
  if (
    !subscriptionId ||
    !Number.isSafeInteger(eventCreated) ||
    eventCreated <= 0
  ) {
    throw new ApiError(
      400,
      "SUBSCRIPTION_REFERENCE_INVALID",
      "The subscription ID or provider event order is invalid.",
    );
  }
  const existing = await db
    .prepare(
      `SELECT id, revision FROM user_memberships
        WHERE provider = 'STRIPE' AND provider_subscription_id = ?
        LIMIT 1`,
    )
    .bind(subscriptionId)
    .first<{ id: string; revision: number }>();
  if (!existing) {
    throw new ApiError(404, "MEMBERSHIP_NOT_FOUND", "The subscription has no membership entitlement.");
  }
  // Stripe does not guarantee webhook ordering and `event.created` has
  // second-level precision. Re-read the provider object so equal-timestamp or
  // delayed events can never overwrite a newer subscription state.
  const providerSubscription = await retrieveStripeSubscription(subscriptionId);
  const period = subscriptionPeriod(providerSubscription);
  await db.batch([
    db.prepare(
      `UPDATE user_memberships
          SET status = ?,
              provider_customer_id = COALESCE(?, provider_customer_id),
              current_period_start = COALESCE(?, current_period_start),
              current_period_end = COALESCE(?, current_period_end),
              cancel_at_period_end = ?,
              provider_last_event_created = MAX(provider_last_event_created, ?),
              provider_last_event_id = ?,
              revision = revision + 1,
              updated_at = CURRENT_TIMESTAMP
        WHERE provider = 'STRIPE' AND provider_subscription_id = ?
          AND revision = ?`,
    ).bind(
      normalizedMembershipStatus(providerSubscription.status),
      stripeObjectId(providerSubscription.customer, "cus_"),
      period.start,
      period.end,
      providerSubscription.cancel_at_period_end === true ? 1 : 0,
      eventCreated,
      event.id,
      subscriptionId,
      Number(existing.revision),
    ),
    completeSubscriptionEventStatement(db, event.id, subscriptionId),
  ]);
}

export async function fulfillStripeEvent(db: D1Database, event: StripeEvent) {
  if (isStripeAdverseEvent(event)) {
    const adverseResult = await processStripeAdverseEvent(db, event);
    if (!adverseResult) {
      throw new ApiError(
        400,
        "PAYMENT_EVENT_UNSUPPORTED",
        "The payment event could not be dispatched safely.",
      );
    }
    return adverseResult;
  }
  const object = objectValue(event.data.object);
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await fulfillCheckoutSession(db, event, object);
      await assertStripeEventTerminal(db, event.id);
      return "PROCESSED" as const;
    case "invoice.paid":
    case "invoice.payment_succeeded":
      await fulfillMembershipInvoice(db, event, object);
      await assertStripeEventTerminal(db, event.id);
      return "PROCESSED" as const;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await updateSubscription(db, event, object);
      await assertStripeEventTerminal(db, event.id);
      return "PROCESSED" as const;
    default:
      await db.batch([completeEventStatement(db, event.id, true)]);
      await assertStripeEventTerminal(db, event.id);
      return "IGNORED" as const;
  }
}
