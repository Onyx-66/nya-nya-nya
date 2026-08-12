import { env } from "cloudflare:workers";
import type { D1Database } from "@cloudflare/workers-types";
import { ApiError } from "@/lib/server/api";
import { auditStatement } from "@/lib/server/admin-utils";
import { getStripeReadiness } from "@/lib/server/payments/config";
import {
  createStripeTransfer,
  retrieveStripeTransfer,
  retrieveStripeConnectAccount,
} from "@/lib/server/payments/stripe";
import type { Actor } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";

export const TEAM_PAYOUT_STATUSES = [
  "PENDING",
  "APPROVED",
  "PROCESSING",
  "PAID",
  "REJECTED",
] as const;

const STRIPE_IDEMPOTENCY_RECOVERY_WINDOW_MS = 23 * 60 * 60 * 1_000;

export type TeamPayoutStatus = (typeof TEAM_PAYOUT_STATUSES)[number];

type TeamPayoutEnvironment = Cloudflare.Env & {
  STRIPE_CONNECT_ENABLED?: string;
  TEAM_PAYOUT_CURRENCY?: string;
  TEAM_PAYOUT_MINOR_PER_ONYX?: string;
};

type PayoutRequestRow = {
  id: string;
  teamId: string;
  teamName: string;
  requestedByUserId: string;
  amountOnyx: number;
  amountMinor: number;
  currency: string;
  status: TeamPayoutStatus;
  providerTransferId: string | null;
  reason: string;
  revision: number;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
  providerAccountId: string | null;
  accountRevision: number | null;
};

export type TeamPayoutQuery = {
  q: string;
  status: "ALL" | TeamPayoutStatus;
  page: number;
  limit: number;
};

function environment() {
  return env as TeamPayoutEnvironment;
}

function requirePayoutOwner(actor: Actor, action: string) {
  const roles = new Set([actor.primaryRole, ...(actor.roles ?? [])]);
  if (!roles.has("OWNER")) {
    throw new ApiError(
      403,
      "PAYOUT_OWNER_REQUIRED",
      `Only an owner can ${action}.`,
    );
  }
}

function parseIntegrationConfiguration() {
  const configured = environment();
  const connectEnabled = /^(1|true|yes|on)$/iu.test(
    configured.STRIPE_CONNECT_ENABLED?.trim() ?? "",
  );
  const currency = configured.TEAM_PAYOUT_CURRENCY?.trim().toUpperCase() ?? "";
  const rawRate = configured.TEAM_PAYOUT_MINOR_PER_ONYX?.trim() ?? "";
  const minorPerOnyx = /^\d+$/u.test(rawRate) ? Number(rawRate) : 0;
  if (!connectEnabled) {
    return { ready: false as const, reason: "STRIPE_CONNECT_DISABLED", currency, minorPerOnyx };
  }
  if (!/^[A-Z]{3}$/u.test(currency)) {
    return { ready: false as const, reason: "TEAM_PAYOUT_CURRENCY_INVALID", currency, minorPerOnyx };
  }
  if (!Number.isSafeInteger(minorPerOnyx) || minorPerOnyx < 1 || minorPerOnyx > 1_000_000) {
    return { ready: false as const, reason: "TEAM_PAYOUT_RATE_INVALID", currency, minorPerOnyx };
  }
  const stripe = getStripeReadiness();
  if (!stripe.ready) {
    return { ready: false as const, reason: "PAYMENT_PROVIDER_NOT_READY", currency, minorPerOnyx };
  }
  return { ready: true as const, reason: null, currency, minorPerOnyx };
}

async function featureEnabled(database: D1Database) {
  const row = await database
    .prepare("SELECT enabled FROM feature_flags WHERE key = 'team_payouts' LIMIT 1")
    .first<{ enabled: number | boolean }>();
  return Boolean(row?.enabled);
}

async function unresolvedPaymentRisk(database: D1Database) {
  const row = await database
    .prepare(
      `WITH user_balances AS (
         SELECT account.owner_id,
                COALESCE(SUM(entry.amount), 0) AS effectiveBalance
           FROM ledger_accounts account
           LEFT JOIN ledger_entries entry ON entry.account_id = account.id
          WHERE account.owner_type = 'USER' AND account.currency = 'ONYX'
            AND (account.account_type = 'AVAILABLE'
                 OR account.account_type LIKE 'PAYMENT_DEBT:%')
          GROUP BY account.owner_id
       )
       SELECT COALESCE((SELECT -SUM(MIN(effectiveBalance, 0)) FROM user_balances), 0) AS debtOnyx,
              (SELECT COUNT(*) FROM payment_disputes WHERE status = 'OPEN') AS openDisputes`,
    )
    .first<{ debtOnyx: number; openDisputes: number }>();
  return {
    debtOnyx: Math.max(0, Number(row?.debtOnyx ?? 0)),
    openDisputes: Math.max(0, Number(row?.openDisputes ?? 0)),
  };
}

export async function getTeamPayoutReadiness(database: D1Database) {
  const [enabled, integration, risk] = await Promise.all([
    featureEnabled(database),
    Promise.resolve(parseIntegrationConfiguration()),
    unresolvedPaymentRisk(database),
  ]);
  const financiallyClear = risk.debtOnyx === 0 && risk.openDisputes === 0;
  return {
    featureEnabled: enabled,
    integrationReady: integration.ready,
    financiallyClear,
    debtOnyx: risk.debtOnyx,
    openDisputes: risk.openDisputes,
    ready: enabled && integration.ready && financiallyClear,
    reason: !integration.ready
      ? integration.reason
      : !enabled
        ? "TEAM_PAYOUTS_DISABLED"
        : risk.debtOnyx > 0
          ? "PAYMENT_DEBT_OUTSTANDING"
          : risk.openDisputes > 0
            ? "PAYMENT_RISK_UNRESOLVED"
            : null,
    currency: integration.currency || null,
    minorPerOnyx: integration.minorPerOnyx || null,
  };
}

async function requirePayoutReadiness(database: D1Database, requireFeature = true) {
  const readiness = await getTeamPayoutReadiness(database);
  if (!readiness.integrationReady) {
    throw new ApiError(
      503,
      "TEAM_PAYOUT_INTEGRATION_NOT_READY",
      "Stripe Connect and the server-side payout conversion must be configured before this action.",
      undefined,
      { readiness: readiness.reason },
    );
  }
  if (requireFeature && !readiness.featureEnabled) {
    throw new ApiError(
      409,
      "TEAM_PAYOUTS_DISABLED",
      "Enable the team payouts feature before creating or approving a payout.",
    );
  }
  if (requireFeature && !readiness.financiallyClear) {
    throw new ApiError(
      409,
      readiness.debtOnyx > 0
        ? "PAYMENT_DEBT_OUTSTANDING"
        : "PAYMENT_RISK_UNRESOLVED",
      readiness.debtOnyx > 0
        ? "New team payouts are blocked while verified payment debt remains outstanding."
        : "New team payouts are blocked while a Stripe dispute remains unresolved.",
      undefined,
      {
        debtOnyx: readiness.debtOnyx,
        openDisputes: readiness.openDisputes,
      },
    );
  }
  return readiness as typeof readiness & { currency: string; minorPerOnyx: number };
}

function searchPattern(value: string) {
  return `%${value.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

async function payoutRequest(database: D1Database, id: string) {
  return database
    .prepare(
      `SELECT request.id,
              request.team_id AS teamId,
              team.name AS teamName,
              request.requested_by_user_id AS requestedByUserId,
              request.amount_onyx AS amountOnyx,
              request.amount_minor AS amountMinor,
              request.currency,
              request.status,
              request.provider_transfer_id AS providerTransferId,
              request.reason,
              request.revision,
              request.reviewed_by_user_id AS reviewedByUserId,
              request.reviewed_at AS reviewedAt,
              request.paid_at AS paidAt,
              request.created_at AS createdAt,
              request.updated_at AS updatedAt,
              account.provider_account_id AS providerAccountId,
              account.revision AS accountRevision
         FROM team_payout_requests request
         JOIN teams team ON team.id = request.team_id
         LEFT JOIN team_payout_accounts account ON account.team_id = request.team_id
        WHERE request.id = ?
        LIMIT 1`,
    )
    .bind(id)
    .first<PayoutRequestRow>();
}

async function requirePayoutRequest(database: D1Database, id: string) {
  const row = await payoutRequest(database, id);
  if (!row) {
    throw new ApiError(404, "TEAM_PAYOUT_NOT_FOUND", "This payout request no longer exists.");
  }
  return {
    ...row,
    amountOnyx: Number(row.amountOnyx),
    amountMinor: Number(row.amountMinor),
    revision: Number(row.revision),
    accountRevision: row.accountRevision === null ? null : Number(row.accountRevision),
  };
}

export async function listTeamPayouts(
  database: D1Database,
  query: TeamPayoutQuery,
) {
  const pattern = searchPattern(query.q);
  const offset = (query.page - 1) * query.limit;
  const [readiness, summary, teams, records, count] = await Promise.all([
    getTeamPayoutReadiness(database),
    database
      .prepare(
        `WITH canonical_receipts AS (
           SELECT team_id AS teamId, amount
             FROM chapter_unlock_receipts
            WHERE team_id IS NOT NULL AND currency = 'ONYX'
           UNION ALL
           SELECT team_id, coin_amount FROM team_support_receipts
         ), posted AS (
           SELECT account.owner_id AS teamId, COALESCE(SUM(entry.amount), 0) AS amount
             FROM ledger_accounts account
             LEFT JOIN ledger_entries entry ON entry.account_id = account.id
            WHERE account.owner_type = 'TEAM' AND account.currency = 'ONYX'
              AND account.account_type IN ('EARNED', 'SUPPORT')
            GROUP BY account.owner_id
         )
         SELECT COALESCE((SELECT SUM(amount) FROM canonical_receipts), 0) AS totalReceivedOnyx,
                COALESCE((SELECT SUM(amount) FROM posted), 0) AS postedBalanceOnyx,
                COALESCE(SUM(CASE WHEN status = 'PENDING' THEN amount_onyx ELSE 0 END), 0) AS pendingOnyx,
                COALESCE(SUM(CASE WHEN status IN ('APPROVED', 'PROCESSING') THEN amount_onyx ELSE 0 END), 0) AS approvedOnyx,
                COALESCE(SUM(CASE WHEN status = 'PAID' THEN amount_onyx ELSE 0 END), 0) AS paidOnyx,
                COUNT(*) AS payoutRecordCount
           FROM team_payout_requests`,
      )
      .first<Record<string, unknown>>(),
    database
      .prepare(
        `WITH posted AS (
           SELECT account.owner_id AS teamId, COALESCE(SUM(entry.amount), 0) AS amount
             FROM ledger_accounts account
             LEFT JOIN ledger_entries entry ON entry.account_id = account.id
            WHERE account.owner_type = 'TEAM' AND account.currency = 'ONYX'
              AND account.account_type IN ('EARNED', 'SUPPORT')
            GROUP BY account.owner_id
         ), reserved AS (
           SELECT team_id AS teamId, COALESCE(SUM(amount_onyx), 0) AS amount
             FROM team_payout_requests
            WHERE status IN ('PENDING', 'APPROVED', 'PROCESSING')
            GROUP BY team_id
         ), paid AS (
           SELECT team_id AS teamId, COALESCE(SUM(amount_onyx), 0) AS amount
             FROM team_payout_requests WHERE status = 'PAID' GROUP BY team_id
         ), receipts AS (
           SELECT team_id AS teamId, SUM(amount) AS amount, MAX(created_at) AS lastEarnedAt
             FROM chapter_unlock_receipts
            WHERE team_id IS NOT NULL AND currency = 'ONYX' GROUP BY team_id
           UNION ALL
           SELECT team_id, SUM(coin_amount), MAX(created_at)
             FROM team_support_receipts GROUP BY team_id
         ), receipt_totals AS (
           SELECT teamId, SUM(amount) AS amount, MAX(lastEarnedAt) AS lastEarnedAt
             FROM receipts GROUP BY teamId
         )
         SELECT team.id, team.slug, team.name,
                team.verification_status AS verificationStatus,
                COALESCE(receipt_totals.amount, 0) AS totalReceivedOnyx,
                COALESCE(posted.amount, 0) AS postedBalanceOnyx,
                COALESCE(reserved.amount, 0) AS reservedOnyx,
                MAX(COALESCE(posted.amount, 0) - COALESCE(reserved.amount, 0), 0) AS availableOnyx,
                COALESCE(paid.amount, 0) AS paidOnyx,
                receipt_totals.lastEarnedAt,
                account.provider,
                account.provider_account_id AS providerAccountId,
                account.revision AS accountRevision
           FROM teams team
           LEFT JOIN posted ON posted.teamId = team.id
           LEFT JOIN reserved ON reserved.teamId = team.id
           LEFT JOIN paid ON paid.teamId = team.id
           LEFT JOIN receipt_totals ON receipt_totals.teamId = team.id
           LEFT JOIN team_payout_accounts account ON account.team_id = team.id
          WHERE team.is_archived = 0
            AND (? = '' OR team.name LIKE ? ESCAPE '\\' COLLATE NOCASE
                 OR team.slug LIKE ? ESCAPE '\\' COLLATE NOCASE)
          ORDER BY CASE WHEN team.verification_status = 'VERIFIED' THEN 0 ELSE 1 END,
                   availableOnyx DESC, team.name COLLATE NOCASE
          LIMIT 150`,
      )
      .bind(query.q, pattern, pattern)
      .all<Record<string, unknown>>(),
    database
      .prepare(
        `SELECT request.id, request.team_id AS teamId, team.name AS teamName,
                requester.display_name AS requestedByName,
                reviewer.display_name AS reviewedByName,
                request.amount_onyx AS amountOnyx,
                request.amount_minor AS amountMinor, request.currency,
                request.status, request.provider_transfer_id AS providerTransferId,
                request.reason, request.revision,
                request.reviewed_at AS reviewedAt, request.paid_at AS paidAt,
                request.created_at AS createdAt, request.updated_at AS updatedAt
           FROM team_payout_requests request
           JOIN teams team ON team.id = request.team_id
           JOIN users requester ON requester.id = request.requested_by_user_id
           LEFT JOIN users reviewer ON reviewer.id = request.reviewed_by_user_id
          WHERE (? = 'ALL' OR request.status = ?)
            AND (? = '' OR team.name LIKE ? ESCAPE '\\' COLLATE NOCASE
                 OR team.slug LIKE ? ESCAPE '\\' COLLATE NOCASE
                 OR request.id LIKE ? ESCAPE '\\' COLLATE NOCASE)
          ORDER BY datetime(request.created_at) DESC, request.id DESC
          LIMIT ? OFFSET ?`,
      )
      .bind(
        query.status,
        query.status,
        query.q,
        pattern,
        pattern,
        pattern,
        query.limit,
        offset,
      )
      .all<Record<string, unknown>>(),
    database
      .prepare(
        `SELECT COUNT(*) AS count
           FROM team_payout_requests request
           JOIN teams team ON team.id = request.team_id
          WHERE (? = 'ALL' OR request.status = ?)
            AND (? = '' OR team.name LIKE ? ESCAPE '\\' COLLATE NOCASE
                 OR team.slug LIKE ? ESCAPE '\\' COLLATE NOCASE
                 OR request.id LIKE ? ESCAPE '\\' COLLATE NOCASE)`,
      )
      .bind(query.status, query.status, query.q, pattern, pattern, pattern)
      .first<{ count: number }>(),
  ]);
  const total = Number(count?.count ?? 0);
  return {
    readiness,
    summary: {
      totalReceivedOnyx: Number(summary?.totalReceivedOnyx ?? 0),
      postedBalanceOnyx: Number(summary?.postedBalanceOnyx ?? 0),
      pendingOnyx: Number(summary?.pendingOnyx ?? 0),
      approvedOnyx: Number(summary?.approvedOnyx ?? 0),
      paidOnyx: Number(summary?.paidOnyx ?? 0),
      payoutRecordCount: Number(summary?.payoutRecordCount ?? 0),
    },
    teams: teams.results.map((team) => ({
      ...team,
      totalReceivedOnyx: Number(team.totalReceivedOnyx ?? 0),
      postedBalanceOnyx: Number(team.postedBalanceOnyx ?? 0),
      reservedOnyx: Number(team.reservedOnyx ?? 0),
      availableOnyx: Number(team.availableOnyx ?? 0),
      paidOnyx: Number(team.paidOnyx ?? 0),
      accountRevision:
        team.accountRevision === null || team.accountRevision === undefined
          ? null
          : Number(team.accountRevision),
    })),
    records: records.results.map((record) => ({
      ...record,
      amountOnyx: Number(record.amountOnyx),
      amountMinor: Number(record.amountMinor),
      revision: Number(record.revision),
    })),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
}

export async function setTeamPayoutAccount(
  database: D1Database,
  actor: Actor,
  requestId: string,
  input: {
    teamId: string;
    providerAccountId: string;
    expectedRevision: number;
    reason: string;
  },
) {
  requirePayoutOwner(actor, "change a verified payout destination");
  await requirePayoutReadiness(database, false);
  await retrieveStripeConnectAccount(input.providerAccountId);
  const team = await database
    .prepare(
      `SELECT id, name, verification_status AS verificationStatus, is_archived AS isArchived
         FROM teams WHERE id = ? LIMIT 1`,
    )
    .bind(input.teamId)
    .first<{ id: string; name: string; verificationStatus: string; isArchived: number }>();
  if (!team || team.isArchived || team.verificationStatus !== "VERIFIED") {
    throw new ApiError(
      409,
      "TEAM_NOT_PAYOUT_ELIGIBLE",
      "Only active, verified teams can receive payouts.",
    );
  }
  const existing = await database
    .prepare(
      `SELECT provider_account_id AS providerAccountId, revision
         FROM team_payout_accounts WHERE team_id = ? LIMIT 1`,
    )
    .bind(input.teamId)
    .first<{ providerAccountId: string; revision: number }>();
  if (
    (existing && Number(existing.revision) !== input.expectedRevision) ||
    (!existing && input.expectedRevision !== 0)
  ) {
    throw new ApiError(409, "REVISION_CONFLICT", "Reload the payout account before saving.");
  }
  const mutation = existing
    ? database
        .prepare(
          `UPDATE team_payout_accounts
              SET provider = 'STRIPE', provider_account_id = ?,
                  revision = revision + 1, updated_by_user_id = ?,
                  updated_at = CURRENT_TIMESTAMP
            WHERE team_id = ? AND revision = ?
              AND NOT EXISTS (
                SELECT 1 FROM team_payout_requests
                 WHERE team_id = ? AND status IN ('APPROVED', 'PROCESSING')
              )`,
        )
        .bind(
          input.providerAccountId,
          actor.id,
          input.teamId,
          input.expectedRevision,
          input.teamId,
        )
    : database
        .prepare(
          `INSERT INTO team_payout_accounts
           (team_id, provider, provider_account_id, revision, updated_by_user_id)
           SELECT ?, 'STRIPE', ?, 1, ?
            WHERE NOT EXISTS (
              SELECT 1 FROM team_payout_requests
               WHERE team_id = ? AND status IN ('APPROVED', 'PROCESSING')
            )`,
        )
        .bind(input.teamId, input.providerAccountId, actor.id, input.teamId);
  const results = await database.batch([
    mutation,
    auditStatement(
      database,
      actor,
      requestId,
      {
        action: "team_payout.account.set",
        category: "COMMERCE_STORE",
        sourceArea: "PAYOUTS",
        targetType: "TEAM",
        targetId: input.teamId,
        targetLabel: team.name,
        reason: input.reason,
        oldValue: existing
          ? { provider: "STRIPE", providerAccountId: existing.providerAccountId, revision: existing.revision }
          : null,
        newValue: {
          provider: "STRIPE",
          providerAccountId: input.providerAccountId,
          revision: input.expectedRevision + 1,
        },
      },
      "changes() = 1",
    ),
  ]);
  if (Number(results[0]?.meta.changes ?? 0) !== 1) {
    throw new ApiError(
      409,
      "PAYOUT_ACCOUNT_LOCKED",
      "Reject or complete approved payouts before changing this destination account.",
    );
  }
}

export async function requestTeamPayout(
  database: D1Database,
  actor: Actor,
  requestId: string,
  input: {
    teamId: string;
    amountOnyx: number;
    clientMutationId: string;
    reason: string;
  },
) {
  const id = `tpr_${input.clientMutationId.replaceAll("-", "")}`;
  const duplicate = await payoutRequest(database, id);
  if (duplicate) {
    if (
      duplicate.teamId === input.teamId &&
      duplicate.requestedByUserId === actor.id &&
      Number(duplicate.amountOnyx) === input.amountOnyx
    ) {
      return duplicate;
    }
    throw new ApiError(
      409,
      "IDEMPOTENCY_KEY_REUSED",
      "Use a new request identifier for this payout.",
    );
  }
  const readiness = await requirePayoutReadiness(database);
  if (input.amountOnyx > Math.floor(Number.MAX_SAFE_INTEGER / readiness.minorPerOnyx)) {
    throw new ApiError(422, "PAYOUT_AMOUNT_INVALID", "The payout amount is too large.");
  }
  const amountMinor = input.amountOnyx * readiness.minorPerOnyx;
  const mutation = database
    .prepare(
      `INSERT OR IGNORE INTO team_payout_requests
       (id, team_id, requested_by_user_id, amount_onyx, amount_minor,
        currency, status, reason, revision)
       SELECT ?, team.id, ?, ?, ?, ?, 'PENDING', ?, 1
         FROM teams team
         JOIN team_payout_accounts account ON account.team_id = team.id
        WHERE team.id = ? AND team.is_archived = 0
          AND team.verification_status = 'VERIFIED'
          AND account.provider = 'STRIPE'
          AND (
            COALESCE((
              SELECT SUM(entry.amount)
                FROM ledger_accounts ledger_account
                LEFT JOIN ledger_entries entry ON entry.account_id = ledger_account.id
               WHERE ledger_account.owner_type = 'TEAM'
                 AND ledger_account.owner_id = team.id
                 AND ledger_account.currency = 'ONYX'
                 AND ledger_account.account_type IN ('EARNED', 'SUPPORT')
            ), 0) - COALESCE((
              SELECT SUM(active.amount_onyx)
                FROM team_payout_requests active
               WHERE active.team_id = team.id
                 AND active.status IN ('PENDING', 'APPROVED', 'PROCESSING')
            ), 0)
          ) >= ?`,
    )
    .bind(
      id,
      actor.id,
      input.amountOnyx,
      amountMinor,
      readiness.currency,
      input.reason,
      input.teamId,
      input.amountOnyx,
    );
  const results = await database.batch([
    mutation,
    auditStatement(
      database,
      actor,
      requestId,
      {
        action: "team_payout.request",
        category: "COMMERCE_STORE",
        sourceArea: "PAYOUTS",
        targetType: "TEAM_PAYOUT_REQUEST",
        targetId: id,
        reason: input.reason,
        newValue: {
          teamId: input.teamId,
          amountOnyx: input.amountOnyx,
          amountMinor,
          currency: readiness.currency,
          status: "PENDING",
        },
      },
      "changes() = 1",
    ),
  ]);
  if (Number(results[0]?.meta.changes ?? 0) !== 1) {
    throw new ApiError(
      409,
      "PAYOUT_BALANCE_RESERVED",
      "The verified team needs a ready Stripe account and enough unreserved Onyx balance.",
    );
  }
  return requirePayoutRequest(database, id);
}

async function transitionPayout(
  database: D1Database,
  actor: Actor,
  requestId: string,
  input: { requestId: string; expectedRevision: number; reason: string },
  transition: "APPROVE" | "REJECT",
) {
  const current = await requirePayoutRequest(database, input.requestId);
  if (current.revision !== input.expectedRevision) {
    throw new ApiError(409, "REVISION_CONFLICT", "Reload this payout before reviewing it.");
  }
  if (transition === "APPROVE") await requirePayoutReadiness(database);
  if (transition === "APPROVE" && current.requestedByUserId === actor.id) {
    throw new ApiError(
      409,
      "PAYOUT_INDEPENDENT_REVIEW_REQUIRED",
      "A payout must be approved by a different administrator than the requester.",
    );
  }
  const allowedStatuses = transition === "APPROVE" ? ["PENDING"] : ["PENDING", "APPROVED"];
  if (!allowedStatuses.includes(current.status)) {
    throw new ApiError(
      409,
      "PAYOUT_STATUS_CONFLICT",
      `A ${current.status.toLowerCase()} payout cannot be ${transition.toLowerCase()}d.`,
    );
  }
  const nextStatus = transition === "APPROVE" ? "APPROVED" : "REJECTED";
  const balanceGuard = transition === "APPROVE"
    ? `AND COALESCE((
         SELECT SUM(entry.amount)
           FROM ledger_accounts account
           LEFT JOIN ledger_entries entry ON entry.account_id = account.id
          WHERE account.owner_type = 'TEAM'
            AND account.owner_id = team_payout_requests.team_id
            AND account.currency = 'ONYX'
            AND account.account_type IN ('EARNED', 'SUPPORT')
       ), 0) >= COALESCE((
         SELECT SUM(active.amount_onyx)
           FROM team_payout_requests active
          WHERE active.team_id = team_payout_requests.team_id
            AND active.status IN ('PENDING', 'APPROVED', 'PROCESSING')
       ), 0)`
    : "";
  const mutation = database
    .prepare(
      `UPDATE team_payout_requests
          SET status = ?, reason = ?, revision = revision + 1,
              reviewed_by_user_id = ?, reviewed_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND revision = ? AND status = ?
        ${balanceGuard}`,
    )
    .bind(
      nextStatus,
      input.reason,
      actor.id,
      input.requestId,
      input.expectedRevision,
      current.status,
    );
  const results = await database.batch([
    mutation,
    auditStatement(
      database,
      actor,
      requestId,
      {
        action: `team_payout.${transition.toLowerCase()}`,
        category: "COMMERCE_STORE",
        sourceArea: "PAYOUTS",
        targetType: "TEAM_PAYOUT_REQUEST",
        targetId: input.requestId,
        targetLabel: current.teamName,
        reason: input.reason,
        oldValue: { status: current.status, revision: current.revision },
        newValue: { status: nextStatus, revision: current.revision + 1 },
      },
      "changes() = 1",
    ),
  ]);
  if (Number(results[0]?.meta.changes ?? 0) !== 1) {
    throw new ApiError(
      409,
      transition === "APPROVE" ? "PAYOUT_BALANCE_CHANGED" : "REVISION_CONFLICT",
      transition === "APPROVE"
        ? "The team balance no longer covers all active payout reservations."
        : "Reload this payout before reviewing it.",
    );
  }
  return requirePayoutRequest(database, input.requestId);
}

export function approveTeamPayout(
  database: D1Database,
  actor: Actor,
  requestId: string,
  input: { requestId: string; expectedRevision: number; reason: string },
) {
  return transitionPayout(database, actor, requestId, input, "APPROVE");
}

export function rejectTeamPayout(
  database: D1Database,
  actor: Actor,
  requestId: string,
  input: { requestId: string; expectedRevision: number; reason: string },
) {
  return transitionPayout(database, actor, requestId, input, "REJECT");
}

async function ensurePayoutLedgerAccounts(database: D1Database, teamId: string) {
  await database.batch([
    database
      .prepare(
        `INSERT OR IGNORE INTO ledger_accounts
         (id, owner_type, owner_id, currency, account_type)
         VALUES (?, 'TEAM', ?, 'ONYX', 'EARNED')`,
      )
      .bind(`la_team_${teamId}_earned_onyx`, teamId),
    database
      .prepare(
        `INSERT OR IGNORE INTO ledger_accounts
         (id, owner_type, owner_id, currency, account_type)
         VALUES (?, 'TEAM', ?, 'ONYX', 'SUPPORT')`,
      )
      .bind(`la_team_${teamId}_support_onyx`, teamId),
    database
      .prepare(
        `INSERT OR IGNORE INTO ledger_accounts
         (id, owner_type, owner_id, currency, account_type)
         VALUES ('la_platform_team_payout_clearing_onyx', 'PLATFORM',
                 'NYASCANS_TEAM_PAYOUTS', 'ONYX', 'PAYOUT_CLEARING')`,
      ),
  ]);
  const accounts = await database
    .prepare(
      `SELECT MAX(CASE WHEN owner_type = 'TEAM' AND owner_id = ? AND account_type = 'EARNED' THEN id END) AS earnedId,
              MAX(CASE WHEN owner_type = 'TEAM' AND owner_id = ? AND account_type = 'SUPPORT' THEN id END) AS supportId,
              MAX(CASE WHEN owner_type = 'PLATFORM' AND owner_id = 'NYASCANS_TEAM_PAYOUTS'
                        AND account_type = 'PAYOUT_CLEARING' THEN id END) AS clearingId
         FROM ledger_accounts
        WHERE currency = 'ONYX'`,
    )
    .bind(teamId, teamId)
    .first<{ earnedId: string | null; supportId: string | null; clearingId: string | null }>();
  if (!accounts?.earnedId || !accounts.supportId || !accounts.clearingId) {
    throw new ApiError(503, "PAYOUT_LEDGER_UNAVAILABLE", "Payout ledger accounts are unavailable.");
  }
  return { earnedId: accounts.earnedId, supportId: accounts.supportId, clearingId: accounts.clearingId };
}

export async function payTeamPayout(
  database: D1Database,
  actor: Actor,
  requestId: string,
  input: { requestId: string; expectedRevision: number; reason: string },
) {
  requirePayoutOwner(actor, "send a team payout");
  let current = await requirePayoutRequest(database, input.requestId);
  if (current.status === "PAID") return current;
  if (current.revision !== input.expectedRevision) {
    throw new ApiError(409, "REVISION_CONFLICT", "Reload this payout before paying it.");
  }
  if (current.status !== "APPROVED" && current.status !== "PROCESSING") {
    throw new ApiError(
      409,
      "PAYOUT_STATUS_CONFLICT",
      "Only approved or processing payouts can be paid.",
    );
  }
  if (
    current.requestedByUserId === actor.id ||
    !current.reviewedByUserId ||
    current.reviewedByUserId === current.requestedByUserId
  ) {
    throw new ApiError(
      409,
      "PAYOUT_INDEPENDENT_REVIEW_REQUIRED",
      "This payout needs an independent approval before an owner can send it.",
    );
  }
  await requirePayoutReadiness(
    database,
    current.status !== "PROCESSING",
  );
  if (!current.providerAccountId) {
    throw new ApiError(
      409,
      "PAYOUT_ACCOUNT_MISSING",
      "Configure a verified Stripe destination for this team first.",
    );
  }
  if (current.status === "APPROVED") {
    const reservation = database
      .prepare(
        `UPDATE team_payout_requests
            SET status = 'PROCESSING', revision = revision + 1,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND revision = ? AND status = 'APPROVED'`,
      )
      .bind(current.id, current.revision);
    const results = await database.batch([
      reservation,
      auditStatement(
        database,
        actor,
        requestId,
        {
          action: "team_payout.processing",
          category: "COMMERCE_STORE",
          sourceArea: "PAYOUTS",
          targetType: "TEAM_PAYOUT_REQUEST",
          targetId: current.id,
          targetLabel: current.teamName,
          reason: input.reason,
          oldValue: { status: "APPROVED", revision: current.revision },
          newValue: { status: "PROCESSING", revision: current.revision + 1 },
        },
        "changes() = 1",
      ),
    ]);
    if (Number(results[0]?.meta.changes ?? 0) !== 1) {
      const raced = await requirePayoutRequest(database, current.id);
      if (raced.status === "PAID") return raced;
      throw new ApiError(409, "REVISION_CONFLICT", "Another payout worker claimed this request.");
    }
    current = await requirePayoutRequest(database, current.id);
  }

  if (!current.providerAccountId) {
    throw new ApiError(
      409,
      "PAYOUT_ACCOUNT_MISSING",
      "Configure a verified Stripe destination for this team first.",
    );
  }

  const accounts = await ensurePayoutLedgerAccounts(database, current.teamId);
  let transfer;
  if (current.providerTransferId) {
    transfer = await retrieveStripeTransfer({
      transferId: current.providerTransferId,
      destinationAccountId: current.providerAccountId,
      amountMinor: current.amountMinor,
      currency: current.currency,
    });
  } else {
    const processingAge = Date.now() - Date.parse(current.updatedAt);
    if (
      !Number.isFinite(processingAge) ||
      processingAge > STRIPE_IDEMPOTENCY_RECOVERY_WINDOW_MS
    ) {
      throw new ApiError(
        409,
        "PAYOUT_PROVIDER_RECONCILIATION_REQUIRED",
        "This processing payout is outside the provider idempotency window. Reconcile it in Stripe before retrying.",
      );
    }
    const coverage = await database
      .prepare(
        `SELECT
           COALESCE((
             SELECT SUM(entry.amount)
               FROM ledger_accounts account
               LEFT JOIN ledger_entries entry ON entry.account_id = account.id
              WHERE account.owner_type = 'TEAM'
                AND account.owner_id = ?
                AND account.currency = 'ONYX'
                AND account.account_type IN ('EARNED', 'SUPPORT')
           ), 0) AS posted,
           COALESCE((
             SELECT SUM(active.amount_onyx)
               FROM team_payout_requests active
              WHERE active.team_id = ?
                AND active.status IN ('PENDING', 'APPROVED', 'PROCESSING')
           ), 0) AS reserved`,
      )
      .bind(current.teamId, current.teamId)
      .first<{ posted: number; reserved: number }>();
    if (Number(coverage?.posted ?? 0) < Number(coverage?.reserved ?? 0)) {
      throw new ApiError(
        409,
        "PAYOUT_BALANCE_CHANGED",
        "The team ledger no longer covers its active payout reservations.",
      );
    }
    transfer = await createStripeTransfer({
      payoutRequestId: current.id,
      teamId: current.teamId,
      destinationAccountId: current.providerAccountId,
      amountMinor: current.amountMinor,
      currency: current.currency,
      idempotencyKey: `nya-team-payout-${current.id}`,
    });
  }

  if (!current.providerTransferId) {
    const providerMutation = database.prepare(
        `UPDATE team_payout_requests
            SET provider_transfer_id = ?, revision = revision + 1,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND revision = ? AND status = 'PROCESSING'
            AND provider_transfer_id IS NULL`,
      )
      .bind(transfer.id, current.id, current.revision);
    const providerResults = await database.batch([
      providerMutation,
      auditStatement(
        database,
        actor,
        requestId,
        {
          action: "team_payout.transfer.accepted",
          category: "COMMERCE_STORE",
          sourceArea: "PAYOUTS",
          targetType: "TEAM_PAYOUT_REQUEST",
          targetId: current.id,
          targetLabel: current.teamName,
          reason: input.reason,
          metadata: { provider: "STRIPE", providerTransferId: transfer.id },
          oldValue: { status: "PROCESSING", providerTransferId: null, revision: current.revision },
          newValue: {
            status: "PROCESSING",
            providerTransferId: transfer.id,
            revision: current.revision + 1,
          },
        },
        "changes() = 1",
      ),
    ]);
    if (Number(providerResults[0]?.meta.changes ?? 0) === 1) {
      current = await requirePayoutRequest(database, current.id);
    } else {
      const raced = await requirePayoutRequest(database, current.id);
      if (raced.status === "PAID") return raced;
      if (raced.providerTransferId !== transfer.id) {
        throw new ApiError(
          409,
          "PAYOUT_TRANSFER_CONFLICT",
          "This payout is already linked to a different provider transfer.",
        );
      }
      current = raced;
    }
  } else if (current.providerTransferId !== transfer.id) {
    throw new ApiError(
      409,
      "PAYOUT_TRANSFER_CONFLICT",
      "Stripe returned a different transfer for this payout request.",
    );
  }

  const transactionId = `ltx_${current.id}`;
  const transactionInsert = database
    .prepare(
      `INSERT OR IGNORE INTO ledger_transactions
       (id, kind, reference_type, reference_id, idempotency_key, memo)
       VALUES (?, 'TEAM_PAYOUT', 'TEAM_PAYOUT_REQUEST', ?, ?, ?)`,
    )
    .bind(
      transactionId,
      current.id,
      `team-payout:${current.id}`,
      `Paid ${current.amountOnyx} Onyx to ${current.teamName}`,
    );
  const entriesInsert = database
    .prepare(
      `WITH balances AS (
         SELECT COALESCE((SELECT SUM(amount) FROM ledger_entries WHERE account_id = ?), 0) AS earnedBalance,
                COALESCE((SELECT SUM(amount) FROM ledger_entries WHERE account_id = ?), 0) AS supportBalance
       ), split AS (
         SELECT CASE
                  WHEN earnedBalance <= 0 THEN 0
                  WHEN earnedBalance >= ? THEN ?
                  ELSE earnedBalance
                END AS earnedDebit,
                ? - CASE
                  WHEN earnedBalance <= 0 THEN 0
                  WHEN earnedBalance >= ? THEN ?
                  ELSE earnedBalance
                END AS supportDebit,
                CASE WHEN earnedBalance + supportBalance >= ? THEN 1 ELSE 0 END AS sufficient
           FROM balances
       )
       INSERT INTO ledger_entries (id, transaction_id, account_id, amount)
       SELECT ?, ?, ?, -earnedDebit FROM split
        WHERE sufficient = 1 AND earnedDebit > 0
          AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE transaction_id = ?)
       UNION ALL
       SELECT ?, ?, ?, -supportDebit FROM split
        WHERE sufficient = 1 AND supportDebit > 0
          AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE transaction_id = ?)
       UNION ALL
       SELECT ?, ?, CASE WHEN sufficient = 1 THEN ? ELSE NULL END, ? FROM split
        WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE transaction_id = ?)`,
    )
    .bind(
      accounts.earnedId,
      accounts.supportId,
      current.amountOnyx,
      current.amountOnyx,
      current.amountOnyx,
      current.amountOnyx,
      current.amountOnyx,
      current.amountOnyx,
      randomId(),
      transactionId,
      accounts.earnedId,
      transactionId,
      randomId(),
      transactionId,
      accounts.supportId,
      transactionId,
      randomId(),
      transactionId,
      accounts.clearingId,
      current.amountOnyx,
      transactionId,
    );
  const markPaid = database
    .prepare(
      `UPDATE team_payout_requests
          SET status = 'PAID', paid_at = CURRENT_TIMESTAMP,
              reviewed_by_user_id = ?, reviewed_at = COALESCE(reviewed_at, CURRENT_TIMESTAMP),
              reason = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND revision = ? AND status = 'PROCESSING'
          AND provider_transfer_id = ?
          AND EXISTS (
            SELECT 1 FROM ledger_transactions
             WHERE id = ? AND kind = 'TEAM_PAYOUT'
               AND reference_type = 'TEAM_PAYOUT_REQUEST'
               AND reference_id = ? AND idempotency_key = ?
          )
          AND (SELECT COALESCE(SUM(amount), 0) FROM ledger_entries WHERE transaction_id = ?) = 0
          AND (SELECT COALESCE(SUM(amount), 0) FROM ledger_entries
                WHERE transaction_id = ? AND account_id = ?) = ?
          AND (SELECT COALESCE(SUM(amount), 0) FROM ledger_entries
                WHERE transaction_id = ? AND account_id IN (?, ?)) = ?`,
    )
    .bind(
      actor.id,
      input.reason,
      current.id,
      current.revision,
      transfer.id,
      transactionId,
      current.id,
      `team-payout:${current.id}`,
      transactionId,
      transactionId,
      accounts.clearingId,
      current.amountOnyx,
      transactionId,
      accounts.earnedId,
      accounts.supportId,
      -current.amountOnyx,
    );
  try {
    const results = await database.batch([
      transactionInsert,
      entriesInsert,
      markPaid,
      auditStatement(
        database,
        actor,
        requestId,
        {
          action: "team_payout.paid",
          category: "COMMERCE_STORE",
          sourceArea: "PAYOUTS",
          targetType: "TEAM_PAYOUT_REQUEST",
          targetId: current.id,
          targetLabel: current.teamName,
          reason: input.reason,
          metadata: { provider: "STRIPE", providerTransferId: transfer.id },
          oldValue: { status: "PROCESSING", revision: current.revision },
          newValue: {
            status: "PAID",
            revision: current.revision + 1,
            ledgerTransactionId: transactionId,
            amountOnyx: current.amountOnyx,
          },
        },
        "changes() = 1",
      ),
    ]);
    if (Number(results[2]?.meta.changes ?? 0) !== 1) {
      const raced = await requirePayoutRequest(database, current.id);
      if (raced.status === "PAID" && raced.providerTransferId === transfer.id) return raced;
      throw new ApiError(
        409,
        "PAYOUT_LEDGER_RECONCILIATION_REQUIRED",
        "Stripe accepted the transfer, but the payout ledger needs reconciliation. Resume this processing payout; the provider call is idempotent.",
      );
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      409,
      "PAYOUT_LEDGER_RECONCILIATION_REQUIRED",
      "Stripe accepted the transfer, but the payout ledger needs reconciliation. Resume this processing payout; the provider call is idempotent.",
    );
  }
  return requirePayoutRequest(database, current.id);
}
