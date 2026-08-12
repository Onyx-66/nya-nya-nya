import type { D1Database } from "@cloudflare/workers-types";
import { ApiError } from "@/lib/server/api";
import { auditStatement } from "@/lib/server/admin-utils";
import { userWalletAccountId } from "@/lib/server/economy";
import type { StripeEvent } from "@/lib/server/payments/stripe";
import { randomId } from "@/lib/server/random-id";

export const STRIPE_ADVERSE_EVENT_TYPES = [
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.closed",
] as const;

type StripeAdverseEventType = (typeof STRIPE_ADVERSE_EVENT_TYPES)[number];
type FinancialState = {
  id: string;
  subjectType: "ORDER" | "INVOICE";
  subjectId: string;
  orderId: string;
  userId: string;
  membershipId: string | null;
  providerChargeId: string;
  providerPaymentIntentId: string | null;
  providerInvoiceId: string | null;
  totalMinor: number;
  currency: string;
  fulfillmentOnyx: number;
  refundedMinor: number;
  reversedOnyx: number;
  membershipRiskActive: number;
  revision: number;
  lastProviderEventId: string | null;
};

type FinancialSubject = {
  subjectType: "ORDER" | "INVOICE";
  subjectId: string;
  orderId: string;
  userId: string;
  membershipId: string | null;
  totalMinor: number;
  currency: string;
  fulfillmentOnyx: number;
  providerPaymentIntentId: string | null;
  providerInvoiceId: string | null;
};

type AdverseReferences = {
  chargeId: string;
  paymentIntentId: string | null;
  invoiceId: string | null;
  currency: string;
  chargeTotalMinor: number | null;
  providerObjectId: string;
  providerObjectType: "CHARGE" | "DISPUTE";
};

function objectValue(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function integerValue(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
}

function providerObjectId(value: unknown) {
  if (typeof value === "string") return value;
  return stringValue(objectValue(value).id);
}

function eventType(event: StripeEvent) {
  return STRIPE_ADVERSE_EVENT_TYPES.includes(event.type as StripeAdverseEventType)
    ? (event.type as StripeAdverseEventType)
    : null;
}

export function isStripeAdverseEvent(event: StripeEvent) {
  return Boolean(eventType(event));
}

function referencesFor(event: StripeEvent): AdverseReferences {
  const type = eventType(event);
  if (!type) {
    throw new ApiError(400, "PAYMENT_EVENT_UNSUPPORTED", "This is not a supported adverse payment event.");
  }
  const object = objectValue(event.data.object);
  if (type === "charge.refunded") {
    const chargeId = stringValue(object.id);
    const paymentIntentId = providerObjectId(object.payment_intent);
    const invoiceId = providerObjectId(object.invoice);
    const currency = stringValue(object.currency)?.toUpperCase() ?? "";
    const chargeTotalMinor = integerValue(object.amount);
    if (
      !chargeId?.startsWith("ch_") ||
      (!paymentIntentId && !invoiceId) ||
      !/^[A-Z]{3}$/u.test(currency) ||
      chargeTotalMinor === null ||
      chargeTotalMinor < 1
    ) {
      throw new ApiError(400, "REFUND_REFERENCE_INVALID", "The Stripe refund reference is incomplete.");
    }
    return {
      chargeId,
      paymentIntentId,
      invoiceId,
      currency,
      chargeTotalMinor,
      providerObjectId: chargeId,
      providerObjectType: "CHARGE",
    };
  }
  const disputeId = stringValue(object.id);
  const expandedCharge = objectValue(object.charge);
  const chargeId = providerObjectId(object.charge);
  const paymentIntentId =
    providerObjectId(object.payment_intent) ??
    providerObjectId(expandedCharge.payment_intent);
  const invoiceId = providerObjectId(expandedCharge.invoice);
  const currency = stringValue(object.currency)?.toUpperCase() ?? "";
  if (
    !disputeId?.startsWith("dp_") ||
    !chargeId?.startsWith("ch_") ||
    (!paymentIntentId && !invoiceId) ||
    !/^[A-Z]{3}$/u.test(currency)
  ) {
    throw new ApiError(400, "DISPUTE_REFERENCE_INVALID", "The Stripe dispute reference is incomplete.");
  }
  return {
    chargeId,
    paymentIntentId,
    invoiceId,
    currency,
    chargeTotalMinor: integerValue(expandedCharge.amount),
    providerObjectId: disputeId,
    providerObjectType: "DISPUTE",
  };
}

async function subjectForReferences(
  db: D1Database,
  references: AdverseReferences,
) {
  if (references.paymentIntentId) {
    const order = await db
      .prepare(
        `SELECT 'ORDER' AS subjectType, orders.id AS subjectId,
                orders.id AS orderId, orders.user_id AS userId,
                fulfillment.membership_id AS membershipId,
                session.amount_minor AS totalMinor,
                session.billing_currency AS currency,
                session.fulfillment_onyx_snapshot AS fulfillmentOnyx,
                session.provider_payment_intent_id AS providerPaymentIntentId,
                session.provider_invoice_id AS providerInvoiceId
           FROM payment_checkout_sessions session
           JOIN orders ON orders.id = session.order_id
           JOIN order_fulfillments fulfillment ON fulfillment.order_id = orders.id
          WHERE session.provider = 'STRIPE'
            AND session.provider_payment_intent_id = ?
            AND session.status = 'COMPLETED'
            AND session.product_kind_snapshot = 'CURRENCY_PACKAGE'
            AND fulfillment.kind = 'ONYX'
            AND fulfillment.ledger_transaction_id IS NOT NULL
            AND session.user_id_snapshot = orders.user_id
            AND orders.status = 'PAID'
          LIMIT 1`,
      )
      .bind(references.paymentIntentId)
      .first<FinancialSubject>();
    if (order) return order;
  }
  if (references.paymentIntentId || references.invoiceId) {
    const invoice = await db
      .prepare(
        `SELECT 'INVOICE' AS subjectType, snapshot.id AS subjectId,
                snapshot.order_id AS orderId, snapshot.user_id AS userId,
                snapshot.membership_id AS membershipId,
                snapshot.amount_minor AS totalMinor,
                snapshot.billing_currency AS currency,
                snapshot.fulfillment_onyx AS fulfillmentOnyx,
                snapshot.provider_payment_intent_id AS providerPaymentIntentId,
                snapshot.provider_invoice_id AS providerInvoiceId
           FROM payment_invoice_snapshots snapshot
           JOIN user_memberships membership ON membership.id = snapshot.membership_id
           JOIN orders ON orders.id = snapshot.order_id
          WHERE (? IS NULL OR snapshot.provider_payment_intent_id = ?)
            AND (? IS NULL OR snapshot.provider_invoice_id = ?)
            AND (snapshot.provider_payment_intent_id = ?
                 OR snapshot.provider_invoice_id = ?)
            AND membership.user_id = snapshot.user_id
            AND orders.user_id = snapshot.user_id
            AND orders.provider = 'STRIPE'
          LIMIT 1`,
      )
      .bind(
        references.paymentIntentId,
        references.paymentIntentId,
        references.invoiceId,
        references.invoiceId,
        references.paymentIntentId,
        references.invoiceId,
      )
      .first<FinancialSubject>();
    if (invoice) return invoice;
  }
  return null;
}

async function stateByCharge(db: D1Database, chargeId: string) {
  const row = await db
    .prepare(
      `SELECT id, subject_type AS subjectType, subject_id AS subjectId,
              order_id AS orderId, user_id AS userId,
              membership_id AS membershipId,
              provider_charge_id AS providerChargeId,
              provider_payment_intent_id AS providerPaymentIntentId,
              provider_invoice_id AS providerInvoiceId,
              total_minor AS totalMinor, currency,
              fulfillment_onyx AS fulfillmentOnyx,
              refunded_minor AS refundedMinor,
              reversed_onyx AS reversedOnyx,
              membership_risk_active AS membershipRiskActive,
              revision, last_provider_event_id AS lastProviderEventId
         FROM payment_financial_states
        WHERE provider = 'STRIPE' AND provider_charge_id = ?
        LIMIT 1`,
    )
    .bind(chargeId)
    .first<FinancialState>();
  return row
    ? {
        ...row,
        totalMinor: Number(row.totalMinor),
        fulfillmentOnyx: Number(row.fulfillmentOnyx),
        refundedMinor: Number(row.refundedMinor),
        reversedOnyx: Number(row.reversedOnyx),
        membershipRiskActive: Number(row.membershipRiskActive),
        revision: Number(row.revision),
      }
    : null;
}

async function ensureFinancialState(
  db: D1Database,
  references: AdverseReferences,
) {
  const existing = await stateByCharge(db, references.chargeId);
  if (existing) {
    if (
      existing.currency !== references.currency ||
      (references.chargeTotalMinor !== null &&
        existing.totalMinor !== references.chargeTotalMinor) ||
      (references.paymentIntentId &&
        existing.providerPaymentIntentId !== references.paymentIntentId) ||
      (references.invoiceId &&
        existing.providerInvoiceId !== references.invoiceId)
    ) {
      throw new ApiError(
        409,
        "PAYMENT_ADVERSE_REFERENCE_MISMATCH",
        "The Stripe charge no longer matches its immutable payment state.",
      );
    }
    return existing;
  }
  const subject = await subjectForReferences(db, references);
  if (!subject) return null;
  const totalMinor = Number(subject.totalMinor);
  const fulfillmentOnyx = Number(subject.fulfillmentOnyx);
  const currency = String(subject.currency).toUpperCase();
  if (
    !Number.isSafeInteger(totalMinor) ||
    totalMinor < 1 ||
    !Number.isSafeInteger(fulfillmentOnyx) ||
    fulfillmentOnyx < 0 ||
    currency !== references.currency ||
    (references.chargeTotalMinor !== null && references.chargeTotalMinor !== totalMinor)
  ) {
    throw new ApiError(
      409,
      "PAYMENT_ADVERSE_SNAPSHOT_MISMATCH",
      "The adverse Stripe event does not match the immutable order snapshot.",
    );
  }
  if (
    references.paymentIntentId &&
    references.paymentIntentId !== subject.providerPaymentIntentId
  ) {
    throw new ApiError(
      409,
      "PAYMENT_ADVERSE_REFERENCE_MISMATCH",
      "The Stripe payment reference does not match this order.",
    );
  }
  if (
    references.invoiceId &&
    references.invoiceId !== subject.providerInvoiceId
  ) {
    throw new ApiError(
      409,
      "PAYMENT_ADVERSE_REFERENCE_MISMATCH",
      "The Stripe invoice reference does not match this order.",
    );
  }
  const id = `pfs_${references.chargeId}`;
  await db
    .prepare(
      `INSERT OR IGNORE INTO payment_financial_states
       (id, subject_type, subject_id, order_id, user_id, membership_id,
        provider, provider_charge_id, provider_payment_intent_id,
        provider_invoice_id, total_minor, currency, fulfillment_onyx,
        refunded_minor, reversed_onyx, revision)
       VALUES (?, ?, ?, ?, ?, ?, 'STRIPE', ?, ?, ?, ?, ?, ?, 0, 0, 1)`,
    )
    .bind(
      id,
      subject.subjectType,
      subject.subjectId,
      subject.orderId,
      subject.userId,
      subject.membershipId,
      references.chargeId,
      references.paymentIntentId ?? subject.providerPaymentIntentId,
      references.invoiceId ?? subject.providerInvoiceId,
      totalMinor,
      currency,
      fulfillmentOnyx,
    )
    .run();
  const state = await stateByCharge(db, references.chargeId);
  if (!state) {
    throw new ApiError(409, "PAYMENT_FINANCIAL_STATE_CONFLICT", "The payment state could not be created.");
  }
  if (
    state.subjectType !== subject.subjectType ||
    state.subjectId !== subject.subjectId ||
    state.orderId !== subject.orderId ||
    state.userId !== subject.userId ||
    state.membershipId !== subject.membershipId ||
    state.currency !== currency ||
    state.totalMinor !== totalMinor ||
    state.fulfillmentOnyx !== fulfillmentOnyx ||
    state.providerPaymentIntentId !==
      (references.paymentIntentId ?? subject.providerPaymentIntentId) ||
    state.providerInvoiceId !==
      (references.invoiceId ?? subject.providerInvoiceId)
  ) {
    throw new ApiError(
      409,
      "PAYMENT_FINANCIAL_STATE_CONFLICT",
      "The Stripe charge is already mapped to a different immutable order.",
    );
  }
  return state;
}

function disputeStatus(value: unknown) {
  const status = stringValue(value);
  if (status === "lost") return "LOST" as const;
  if (status === "won" || status === "warning_closed") return "WON" as const;
  return "OPEN" as const;
}

async function recordDisputeFact(
  db: D1Database,
  event: StripeEvent,
  state: FinancialState,
  references: AdverseReferences,
) {
  const dispute = objectValue(event.data.object);
  const amountMinor = integerValue(dispute.amount);
  const status = disputeStatus(dispute.status);
  if (
    amountMinor === null ||
    amountMinor < 1 ||
    amountMinor > state.totalMinor ||
    references.currency !== state.currency
  ) {
    throw new ApiError(
      409,
      "PAYMENT_DISPUTE_SNAPSHOT_MISMATCH",
      "The Stripe dispute does not match the immutable order amount.",
    );
  }
  await db
    .prepare(
      `INSERT INTO payment_disputes
       (id, state_id, amount_minor, currency, status, provider_event_created,
        provider_event_id, reason, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(id) DO UPDATE SET
        status = CASE
           WHEN payment_disputes.status IN ('WON', 'LOST')
             THEN payment_disputes.status
           ELSE excluded.status END,
         provider_event_created = CASE
           WHEN excluded.provider_event_created >= payment_disputes.provider_event_created
             THEN excluded.provider_event_created ELSE payment_disputes.provider_event_created END,
         provider_event_id = CASE
           WHEN excluded.provider_event_created >= payment_disputes.provider_event_created
             THEN excluded.provider_event_id ELSE payment_disputes.provider_event_id END,
         reason = CASE
           WHEN excluded.provider_event_created >= payment_disputes.provider_event_created
             THEN excluded.reason ELSE payment_disputes.reason END,
         revision = payment_disputes.revision + 1,
         updated_at = CURRENT_TIMESTAMP
       WHERE payment_disputes.state_id = excluded.state_id
         AND excluded.provider_event_created >= payment_disputes.provider_event_created`,
    )
    .bind(
      references.providerObjectId,
      state.id,
      amountMinor,
      state.currency,
      status,
      event.created,
      event.id,
      stringValue(dispute.reason)?.slice(0, 160) ?? "unknown",
    )
    .run();
  const stored = await db
    .prepare(
      `SELECT state_id AS stateId, status,
              amount_minor AS amountMinor, currency
         FROM payment_disputes WHERE id = ? LIMIT 1`,
    )
    .bind(references.providerObjectId)
    .first<{
      stateId: string;
      status: "OPEN" | "WON" | "LOST";
      amountMinor: number;
      currency: string;
    }>();
  if (
    !stored ||
    stored.stateId !== state.id ||
    Number(stored.amountMinor) !== amountMinor ||
    stored.currency !== state.currency
  ) {
    throw new ApiError(
      409,
      "PAYMENT_DISPUTE_CONFLICT",
      "This dispute is already mapped to a different payment.",
    );
  }
  return stored.status;
}

function proportionalOnyx(totalOnyx: number, riskMinor: number, totalMinor: number) {
  if (riskMinor <= 0 || totalOnyx <= 0) return 0;
  if (riskMinor >= totalMinor) return totalOnyx;
  const denominator = BigInt(totalMinor);
  return Number(
    (BigInt(totalOnyx) * BigInt(riskMinor) + denominator - BigInt(1)) /
      denominator,
  );
}

function processedEventStatement(db: D1Database, eventId: string) {
  return db
    .prepare(
      `UPDATE payment_webhook_events
          SET status = 'PROCESSED', processed_at = CURRENT_TIMESTAMP,
              last_error_code = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'PROCESSING'`,
    )
    .bind(eventId);
}

async function ensureRiskAccounts(
  db: D1Database,
  state: FinancialState,
) {
  const availableAccountId = userWalletAccountId(state.userId, "ONYX");
  const debtAccountType = `PAYMENT_DEBT:${state.id}`;
  const requestedDebtId = `la_debt_${state.id}`;
  const requestedClearingId = "la_platform_stripe_reversals_onyx";
  await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO ledger_accounts
       (id, owner_type, owner_id, currency, account_type)
       VALUES (?, 'USER', ?, 'ONYX', 'AVAILABLE')`,
    ).bind(availableAccountId, state.userId),
    db.prepare(
      `INSERT OR IGNORE INTO ledger_accounts
       (id, owner_type, owner_id, currency, account_type)
       VALUES (?, 'USER', ?, 'ONYX', ?)`,
    ).bind(requestedDebtId, state.userId, debtAccountType),
    db.prepare(
      `INSERT OR IGNORE INTO ledger_accounts
       (id, owner_type, owner_id, currency, account_type)
       VALUES (?, 'PLATFORM', 'STRIPE_REVERSALS', 'ONYX', 'CLEARING')`,
    ).bind(requestedClearingId),
  ]);
  const accounts = await db
    .prepare(
      `SELECT MAX(CASE WHEN owner_type = 'USER' AND owner_id = ?
                        AND account_type = 'AVAILABLE' THEN id END) AS availableId,
              MAX(CASE WHEN owner_type = 'USER' AND owner_id = ?
                        AND account_type = ? THEN id END) AS debtId,
              MAX(CASE WHEN owner_type = 'PLATFORM' AND owner_id = 'STRIPE_REVERSALS'
                        AND account_type = 'CLEARING' THEN id END) AS clearingId
         FROM ledger_accounts WHERE currency = 'ONYX'`,
    )
    .bind(state.userId, state.userId, debtAccountType)
    .first<{ availableId: string | null; debtId: string | null; clearingId: string | null }>();
  if (!accounts?.availableId || !accounts.debtId || !accounts.clearingId) {
    throw new ApiError(503, "PAYMENT_RISK_LEDGER_UNAVAILABLE", "Payment risk ledger accounts are unavailable.");
  }
  return accounts as { availableId: string; debtId: string; clearingId: string };
}

function ledgerEntriesStatement(
  db: D1Database,
  state: FinancialState,
  eventId: string,
  stateRevision: number,
  transactionId: string,
  deltaOnyx: number,
  accounts: { availableId: string; debtId: string; clearingId: string },
) {
  if (deltaOnyx > 0) {
    return db
      .prepare(
        `WITH balances AS (
           SELECT MAX(
                    COALESCE((SELECT SUM(amount) FROM ledger_entries WHERE account_id = ?), 0)
                    + COALESCE((
                        SELECT SUM(entry.amount)
                          FROM ledger_accounts account
                          LEFT JOIN ledger_entries entry ON entry.account_id = account.id
                         WHERE account.owner_type = 'USER'
                           AND account.owner_id = ?
                           AND account.currency = 'ONYX'
                           AND account.account_type LIKE 'PAYMENT_DEBT:%'
                      ), 0),
                    0
                  )
                    AS availableBalance
         ), split AS (
           SELECT MIN(availableBalance, ?) AS availableDebit,
                  ? - MIN(availableBalance, ?) AS debtDebit
             FROM balances
         )
         INSERT INTO ledger_entries (id, transaction_id, account_id, amount)
         SELECT ?, ?, ?, -availableDebit FROM split
          WHERE availableDebit > 0
            AND EXISTS (SELECT 1 FROM payment_financial_states
                         WHERE id = ? AND revision = ? AND last_provider_event_id = ?)
            AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE transaction_id = ?)
         UNION ALL
         SELECT ?, ?, ?, -debtDebit FROM split
          WHERE debtDebit > 0
            AND EXISTS (SELECT 1 FROM payment_financial_states
                         WHERE id = ? AND revision = ? AND last_provider_event_id = ?)
            AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE transaction_id = ?)
         UNION ALL
         SELECT ?, ?, ?, ? FROM split
          WHERE EXISTS (SELECT 1 FROM payment_financial_states
                         WHERE id = ? AND revision = ? AND last_provider_event_id = ?)
            AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE transaction_id = ?)`,
      )
      .bind(
        accounts.availableId,
        state.userId,
        deltaOnyx,
        deltaOnyx,
        deltaOnyx,
        randomId(),
        transactionId,
        accounts.availableId,
        state.id,
        stateRevision,
        eventId,
        transactionId,
        randomId(),
        transactionId,
        accounts.debtId,
        state.id,
        stateRevision,
        eventId,
        transactionId,
        randomId(),
        transactionId,
        accounts.clearingId,
        deltaOnyx,
        state.id,
        stateRevision,
        eventId,
        transactionId,
      );
  }
  const restoreOnyx = Math.abs(deltaOnyx);
  return db
    .prepare(
      `WITH balances AS (
         SELECT MAX(-COALESCE((SELECT SUM(amount) FROM ledger_entries WHERE account_id = ?), 0), 0)
                  AS debtBalance
       ), split AS (
         SELECT MIN(debtBalance, ?) AS debtCredit,
                ? - MIN(debtBalance, ?) AS availableCredit
           FROM balances
       )
       INSERT INTO ledger_entries (id, transaction_id, account_id, amount)
       SELECT ?, ?, ?, debtCredit FROM split
        WHERE debtCredit > 0
          AND EXISTS (SELECT 1 FROM payment_financial_states
                       WHERE id = ? AND revision = ? AND last_provider_event_id = ?)
          AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE transaction_id = ?)
       UNION ALL
       SELECT ?, ?, ?, availableCredit FROM split
        WHERE availableCredit > 0
          AND EXISTS (SELECT 1 FROM payment_financial_states
                       WHERE id = ? AND revision = ? AND last_provider_event_id = ?)
          AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE transaction_id = ?)
       UNION ALL
       SELECT ?, ?, ?, -? FROM split
        WHERE EXISTS (SELECT 1 FROM payment_financial_states
                       WHERE id = ? AND revision = ? AND last_provider_event_id = ?)
          AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE transaction_id = ?)`,
    )
    .bind(
      accounts.debtId,
      restoreOnyx,
      restoreOnyx,
      restoreOnyx,
      randomId(),
      transactionId,
      accounts.debtId,
      state.id,
      stateRevision,
      eventId,
      transactionId,
      randomId(),
      transactionId,
      accounts.availableId,
      state.id,
      stateRevision,
      eventId,
      transactionId,
      randomId(),
      transactionId,
      accounts.clearingId,
      restoreOnyx,
      state.id,
      stateRevision,
      eventId,
      transactionId,
    );
}

function adjustmentKind(
  event: StripeEvent,
  normalizedDisputeStatus: "OPEN" | "WON" | "LOST" | null,
) {
  if (event.type === "charge.refunded") return "REFUND" as const;
  if (normalizedDisputeStatus === "WON") return "DISPUTE_WON" as const;
  if (normalizedDisputeStatus === "LOST") return "DISPUTE_LOST" as const;
  return event.type === "charge.dispute.created"
    ? ("DISPUTE_OPEN" as const)
    : ("DISPUTE_UPDATE" as const);
}

function orderRiskStatusStatement(
  db: D1Database,
  state: FinancialState,
  stateRevision: number,
  eventId: string,
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
                WHEN EXISTS (
                  SELECT 1 FROM payment_financial_states financial_state
                   WHERE financial_state.order_id = orders.id
                )
                 AND NOT EXISTS (
                  SELECT 1 FROM payment_financial_states financial_state
                   WHERE financial_state.order_id = orders.id
                     AND financial_state.refunded_minor < financial_state.total_minor
                )
                 AND NOT EXISTS (
                  SELECT 1
                    FROM payment_invoice_snapshots snapshot
                    LEFT JOIN payment_financial_states financial_state
                      ON financial_state.subject_type = 'INVOICE'
                     AND financial_state.subject_id = snapshot.id
                   WHERE snapshot.order_id = orders.id
                     AND (
                       financial_state.id IS NULL
                       OR financial_state.refunded_minor < financial_state.total_minor
                     )
                ) THEN 'REFUNDED'
                ELSE 'PAID'
              END,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status IN ('PAID', 'REFUNDED', 'DISPUTED')
          AND EXISTS (
            SELECT 1 FROM payment_financial_states financial_state
             WHERE financial_state.id = ? AND financial_state.revision = ?
               AND financial_state.last_provider_event_id = ?
          )`,
    )
    .bind(state.orderId, state.id, stateRevision, eventId);
}

export async function processStripeAdverseEvent(
  db: D1Database,
  event: StripeEvent,
) {
  if (!isStripeAdverseEvent(event)) return null;
  const existingAdjustment = await db
    .prepare("SELECT id FROM payment_adverse_adjustments WHERE provider_event_id = ? LIMIT 1")
    .bind(event.id)
    .first();
  if (existingAdjustment) {
    await db.batch([processedEventStatement(db, event.id)]);
    const terminal = await db
      .prepare(
        `SELECT 1 FROM payment_webhook_events
          WHERE id = ? AND status = 'PROCESSED' LIMIT 1`,
      )
      .bind(event.id)
      .first();
    if (!terminal) {
      throw new ApiError(
        409,
        "PAYMENT_ADVERSE_EVENT_NOT_TERMINAL",
        "The adverse payment adjustment exists but its webhook is not terminal; retry safely.",
      );
    }
    return "PROCESSED" as const;
  }
  const references = referencesFor(event);
  const state = await ensureFinancialState(db, references);
  if (!state) {
    throw new ApiError(
      409,
      "PAYMENT_ADVERSE_SUBJECT_NOT_READY",
      "The verified adverse event arrived before its immutable payment fulfillment snapshot; retry it after fulfillment.",
    );
  }
  let normalizedDisputeStatus: "OPEN" | "WON" | "LOST" | null = null;
  if (event.type !== "charge.refunded") {
    normalizedDisputeStatus = await recordDisputeFact(
      db,
      event,
      state,
      references,
    );
  }
  const object = objectValue(event.data.object);
  const incomingRefunded = event.type === "charge.refunded"
    ? integerValue(object.amount_refunded)
    : null;
  if (
    event.type === "charge.refunded" &&
    (incomingRefunded === null || incomingRefunded < 1 || incomingRefunded > state.totalMinor)
  ) {
    throw new ApiError(
      409,
      "PAYMENT_REFUND_SNAPSHOT_MISMATCH",
      "The cumulative refund exceeds the immutable order amount.",
    );
  }
  const disputeRisk = await db
    .prepare(
      `SELECT COALESCE(SUM(amount_minor), 0) AS amount
         FROM payment_disputes
        WHERE state_id = ? AND status IN ('OPEN', 'LOST')`,
    )
    .bind(state.id)
    .first<{ amount: number }>();
  const refundedMinor = Math.max(
    state.refundedMinor,
    incomingRefunded ?? state.refundedMinor,
  );
  const effectiveRiskMinor = Math.min(
    state.totalMinor,
    refundedMinor + Number(disputeRisk?.amount ?? 0),
  );
  const targetOnyx = proportionalOnyx(
    state.fulfillmentOnyx,
    effectiveRiskMinor,
    state.totalMinor,
  );
  const deltaOnyx = targetOnyx - state.reversedOnyx;
  const kind = adjustmentKind(event, normalizedDisputeStatus);
  const nextRevision = state.revision + 1;
  const transactionId = `lt_adverse_${event.id}`;
  const adjustmentId = `pae_${event.id}`;
  const accounts = await ensureRiskAccounts(db, state);
  const stateUpdate = db
    .prepare(
      `UPDATE payment_financial_states
          SET refunded_minor = ?, reversed_onyx = ?, revision = revision + 1,
              membership_risk_active = CASE
                WHEN membership_id IS NOT NULL AND ? > 0 THEN 1 ELSE 0 END,
              last_provider_event_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND revision = ?
          AND NOT EXISTS (
            SELECT 1 FROM payment_adverse_adjustments
             WHERE provider_event_id = ?
          )`,
    )
    .bind(
      refundedMinor,
      targetOnyx,
      effectiveRiskMinor,
      event.id,
      state.id,
      state.revision,
      event.id,
    );
  const transactionInsert = db
    .prepare(
      `INSERT OR IGNORE INTO ledger_transactions
       (id, kind, reference_type, reference_id, idempotency_key, memo)
       SELECT ?, ?, 'PAYMENT_FINANCIAL_STATE', ?, ?, ?
        WHERE ? <> 0
          AND EXISTS (
            SELECT 1 FROM payment_financial_states
             WHERE id = ? AND revision = ? AND last_provider_event_id = ?
          )`,
    )
    .bind(
      transactionId,
      deltaOnyx > 0 ? "PAYMENT_REVERSAL" : "PAYMENT_REVERSAL_RELEASE",
      state.id,
      `stripe:adverse:${event.id}`,
      `${kind} adjusted ${Math.abs(deltaOnyx)} Onyx for order ${state.orderId}`,
      deltaOnyx,
      state.id,
      nextRevision,
      event.id,
    );
  const statements: D1PreparedStatement[] = [
    stateUpdate,
    orderRiskStatusStatement(db, state, nextRevision, event.id),
    transactionInsert,
  ];
  if (deltaOnyx !== 0) {
    statements.push(
      ledgerEntriesStatement(
        db,
        state,
        event.id,
        nextRevision,
        transactionId,
        deltaOnyx,
        accounts,
      ),
    );
  }
  const ledgerCondition = deltaOnyx === 0
    ? "1 = 1"
    : `(EXISTS (
         SELECT 1 FROM ledger_transactions transaction_row
          WHERE transaction_row.id = ?
            AND transaction_row.reference_type = 'PAYMENT_FINANCIAL_STATE'
            AND transaction_row.reference_id = ?
            AND transaction_row.idempotency_key = ?
       )
       AND (SELECT COALESCE(SUM(amount), 0) FROM ledger_entries
             WHERE transaction_id = ?) = 0
       AND (SELECT COALESCE(SUM(amount), 0) FROM ledger_entries
             WHERE transaction_id = ? AND account_id = ?) = ?
       AND (SELECT COALESCE(SUM(amount), 0) FROM ledger_entries
             WHERE transaction_id = ? AND account_id IN (?, ?)) = ?)`;
  const adjustmentBindings: unknown[] = [
    adjustmentId,
    state.id,
    event.id,
    references.providerObjectType,
    references.providerObjectId,
    kind,
    effectiveRiskMinor,
    deltaOnyx,
    deltaOnyx === 0 ? null : transactionId,
    state.id,
    nextRevision,
    event.id,
  ];
  if (deltaOnyx !== 0) {
    adjustmentBindings.push(
      transactionId,
      state.id,
      `stripe:adverse:${event.id}`,
      transactionId,
      transactionId,
      accounts.clearingId,
      deltaOnyx,
      transactionId,
      accounts.availableId,
      accounts.debtId,
      -deltaOnyx,
    );
  }
  const adjustmentStatement = db
    .prepare(
        `INSERT OR IGNORE INTO payment_adverse_adjustments
         (id, state_id, provider_event_id, provider_object_type,
          provider_object_id, kind, at_risk_minor_after, onyx_delta,
          ledger_transaction_id)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM payment_financial_states
             WHERE id = ? AND revision = ? AND last_provider_event_id = ?
          )
            AND ${ledgerCondition}`,
      )
    .bind(...adjustmentBindings);
  statements.push(
    adjustmentStatement,
    auditStatement(
      db,
      null,
      event.id,
      {
        action: `payment.${kind.toLowerCase()}`,
        category: "COMMERCE_STORE",
        sourceArea: "STRIPE_WEBHOOK",
        targetType: "ORDER",
        targetId: state.orderId,
        reason: "Verified Stripe adverse payment event.",
        metadata: {
          provider: "STRIPE",
          providerEventId: event.id,
          providerObjectId: references.providerObjectId,
          financialStateId: state.id,
        },
        oldValue: {
          refundedMinor: state.refundedMinor,
          reversedOnyx: state.reversedOnyx,
        },
        newValue: {
          refundedMinor,
          effectiveRiskMinor,
          reversedOnyx: targetOnyx,
          onyxDelta: deltaOnyx,
        },
      },
      "changes() = 1",
    ),
    db
      .prepare(
        `INSERT OR IGNORE INTO notifications
         (id, user_id, kind, title, body, dedupe_key, action_url, metadata_json)
         SELECT ?, ?, ?, ?, ?, ?, '/wallet', ?
          WHERE EXISTS (
            SELECT 1 FROM payment_adverse_adjustments
             WHERE provider_event_id = ?
          )`,
      )
      .bind(
        randomId(),
        state.userId,
        kind.startsWith("DISPUTE") ? "PAYMENT_DISPUTE" : "PAYMENT_REFUNDED",
        kind === "DISPUTE_WON"
          ? "Payment dispute resolved"
          : kind === "REFUND"
            ? "Payment refund recorded"
            : "Payment dispute update",
        deltaOnyx < 0
          ? `${Math.abs(deltaOnyx)} Onyx were restored after the payment dispute was resolved.`
          : deltaOnyx > 0
            ? `${deltaOnyx} Onyx were reversed because of a refund or payment dispute. Any uncovered amount is held as payment debt.`
            : "The payment risk status changed without an additional Onyx adjustment.",
        `PAYMENT_ADVERSE:${event.id}`,
        JSON.stringify({
          orderId: state.orderId,
          kind,
          effectiveRiskMinor,
          onyxDelta: deltaOnyx,
        }),
        event.id,
      ),
    processedEventStatement(db, event.id),
  );
  await db.batch(statements);
  const applied = await db
    .prepare("SELECT id FROM payment_adverse_adjustments WHERE provider_event_id = ? LIMIT 1")
    .bind(event.id)
    .first();
  if (!applied) {
    throw new ApiError(
      409,
      "PAYMENT_ADVERSE_CAS_CONFLICT",
      "The payment state changed concurrently; retry this verified event.",
    );
  }
  const terminal = await db
    .prepare(
      `SELECT 1 FROM payment_webhook_events
        WHERE id = ? AND status = 'PROCESSED' LIMIT 1`,
    )
    .bind(event.id)
    .first();
  if (!terminal) {
    throw new ApiError(
      409,
      "PAYMENT_ADVERSE_EVENT_NOT_TERMINAL",
      "The adverse payment adjustment exists but its webhook is not terminal; retry safely.",
    );
  }
  return "PROCESSED" as const;
}

export async function paymentRiskSnapshot(
  db: D1Database,
  query: { q: string; page: number; limit: number },
) {
  const pattern = `%${query.q.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const offset = (query.page - 1) * query.limit;
  const [summary, states, adjustments, count] = await Promise.all([
    db.prepare(
      `WITH user_balances AS (
         SELECT account.owner_id AS userId,
                COALESCE(SUM(entry.amount), 0) AS effectiveBalance
           FROM ledger_accounts account
           LEFT JOIN ledger_entries entry ON entry.account_id = account.id
          WHERE account.owner_type = 'USER' AND account.currency = 'ONYX'
            AND (account.account_type = 'AVAILABLE'
                 OR account.account_type LIKE 'PAYMENT_DEBT:%')
          GROUP BY account.owner_id
       )
       SELECT COALESCE((SELECT -SUM(MIN(effectiveBalance, 0)) FROM user_balances), 0) AS debtOnyx,
              COALESCE((SELECT SUM(reversed_onyx) FROM payment_financial_states), 0) AS reversedOnyx,
              COALESCE((SELECT SUM(refunded_minor) FROM payment_financial_states), 0) AS refundedMinor,
              (SELECT COUNT(*) FROM payment_disputes WHERE status = 'OPEN') AS openDisputes,
              (SELECT COUNT(*) FROM payment_financial_states) AS affectedPayments`,
    ).first<Record<string, unknown>>(),
    db.prepare(
      `SELECT state.id, state.subject_type AS subjectType,
              state.subject_id AS subjectId, state.order_id AS orderId,
              state.user_id AS userId, users.display_name AS userName,
              users.email, state.total_minor AS totalMinor, state.currency,
              state.fulfillment_onyx AS fulfillmentOnyx,
              state.refunded_minor AS refundedMinor,
              state.reversed_onyx AS reversedOnyx,
              state.revision, state.updated_at AS updatedAt,
              COALESCE(-(
                SELECT SUM(entry.amount)
                  FROM ledger_accounts account
                  LEFT JOIN ledger_entries entry ON entry.account_id = account.id
                 WHERE account.owner_type = 'USER'
                   AND account.owner_id = state.user_id
                   AND account.currency = 'ONYX'
                   AND account.account_type = 'PAYMENT_DEBT:' || state.id
              ), 0) AS debtOnyx,
              COALESCE((
                SELECT SUM(dispute.amount_minor) FROM payment_disputes dispute
                 WHERE dispute.state_id = state.id
                   AND dispute.status IN ('OPEN', 'LOST')
              ), 0) AS disputeRiskMinor
         FROM payment_financial_states state
         JOIN users ON users.id = state.user_id
        WHERE (? = '' OR users.display_name LIKE ? ESCAPE '\\' COLLATE NOCASE
               OR users.email LIKE ? ESCAPE '\\' COLLATE NOCASE
               OR state.order_id LIKE ? ESCAPE '\\' COLLATE NOCASE)
        ORDER BY datetime(state.updated_at) DESC, state.id DESC
        LIMIT ? OFFSET ?`,
    ).bind(query.q, pattern, pattern, pattern, query.limit, offset).all<Record<string, unknown>>(),
    db.prepare(
      `SELECT adjustment.id, adjustment.provider_event_id AS providerEventId,
              adjustment.provider_object_type AS providerObjectType,
              adjustment.provider_object_id AS providerObjectId,
              adjustment.kind, adjustment.at_risk_minor_after AS atRiskMinorAfter,
              adjustment.onyx_delta AS onyxDelta,
              adjustment.ledger_transaction_id AS ledgerTransactionId,
              adjustment.created_at AS createdAt,
              state.order_id AS orderId, users.display_name AS userName
         FROM payment_adverse_adjustments adjustment
         JOIN payment_financial_states state ON state.id = adjustment.state_id
         JOIN users ON users.id = state.user_id
        ORDER BY datetime(adjustment.created_at) DESC, adjustment.id DESC
        LIMIT 50`,
    ).all<Record<string, unknown>>(),
    db.prepare(
      `SELECT COUNT(*) AS count
         FROM payment_financial_states state JOIN users ON users.id = state.user_id
        WHERE (? = '' OR users.display_name LIKE ? ESCAPE '\\' COLLATE NOCASE
               OR users.email LIKE ? ESCAPE '\\' COLLATE NOCASE
               OR state.order_id LIKE ? ESCAPE '\\' COLLATE NOCASE)`,
    ).bind(query.q, pattern, pattern, pattern).first<{ count: number }>(),
  ]);
  const total = Number(count?.count ?? 0);
  return {
    summary: {
      debtOnyx: Number(summary?.debtOnyx ?? 0),
      reversedOnyx: Number(summary?.reversedOnyx ?? 0),
      refundedMinor: Number(summary?.refundedMinor ?? 0),
      openDisputes: Number(summary?.openDisputes ?? 0),
      affectedPayments: Number(summary?.affectedPayments ?? 0),
    },
    states: states.results.map((state) => ({
      ...state,
      totalMinor: Number(state.totalMinor),
      fulfillmentOnyx: Number(state.fulfillmentOnyx),
      refundedMinor: Number(state.refundedMinor),
      reversedOnyx: Number(state.reversedOnyx),
      debtOnyx: Math.max(0, Number(state.debtOnyx ?? 0)),
      disputeRiskMinor: Number(state.disputeRiskMinor ?? 0),
      revision: Number(state.revision),
    })),
    adjustments: adjustments.results.map((adjustment) => ({
      ...adjustment,
      atRiskMinorAfter: Number(adjustment.atRiskMinorAfter),
      onyxDelta: Number(adjustment.onyxDelta),
    })),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
}
