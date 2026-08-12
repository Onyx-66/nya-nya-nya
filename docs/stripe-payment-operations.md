# Stripe payment operations

NyaScans accepts Stripe events only through `POST /api/v1/payments/stripe/webhook`.
The endpoint verifies the signature against the unmodified request body, enforces
a five-minute signature tolerance, stores only a SHA-256 payload digest, and
claims each Stripe event ID idempotently. Do not log request bodies, Checkout
URLs, API keys, webhook secrets, or verification headers.

## Required webhook events

Configure the production Stripe webhook to send these event types:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `invoice.paid`
- `invoice.payment_succeeded`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `charge.refunded`
- `charge.dispute.created`
- `charge.dispute.closed`

The first six events fulfill purchases and maintain membership state. The last
three drive the adverse-payment ledger. Other signed event types are recorded as
ignored; they never grant or revoke value.

## Immutable mapping rules

Refund and dispute objects are never matched by customer-provided metadata
alone. A charge must resolve through a stored Stripe PaymentIntent or invoice ID
to a completed Checkout or immutable paid-invoice snapshot. Currency, original minor
amount, order, user, and granted Onyx must match those immutable snapshots. An
unmatched adverse event never affects a wallet and is not marked ignored: it
remains retryable because Stripe may deliver it before the fulfillment event
that creates the snapshot. Persistent unmatched events require operator review.

Partial refunds use the cumulative Stripe `amount_refunded`. Financial exposure
adds cumulative refunds to open/lost dispute amounts and caps the result at the
original payment. This covers a dispute for the unrefunded remainder as well as
Stripe's documented case where a partially refunded charge is later disputed
for its full amount, without ever reversing more Onyx than the purchase granted.
A won dispute lowers exposure and restores the prior Onyx adjustment.

An open or lost dispute has priority over the order display status. The related
order is `DISPUTED`; with no such dispute it is `REFUNDED` only when every
financial state on that order is fully refunded, otherwise it remains `PAID`.
Membership provider status remains a truthful Stripe subscription status.
Premium access separately checks the aggregate payment-risk holds for that
membership, so one won dispute cannot restore access while another invoice is
still at risk.

## Payment debt and team payouts

An adverse event first debits spendable Onyx. If the user has already spent that
value, the uncovered amount is posted to a dedicated `PAYMENT_DEBT:<state>` user
ledger account. Wallet responses report AVAILABLE plus PAYMENT_DEBT, and ledger
guards prohibit spending value that is economically encumbered by debt. Future
credits therefore reduce effective debt before becoming spendable.

New team-payout requests, approvals, and transfers fail closed while payment
debt or an open Stripe dispute exists. A transfer already persisted as
`PROCESSING` remains resumable with the same Stripe idempotency key so a risk
flag can never cause a duplicate external transfer.

Administrators with `finance.transactions.read` can inspect aggregate debt,
affected orders, dispute exposure, and immutable adjustment records through
`GET /api/v1/admin/payment-risk`.

## Required deployment configuration

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `NEXT_PUBLIC_SITE_URL`
- `STRIPE_CONNECT_ENABLED`
- `TEAM_PAYOUT_CURRENCY`
- `TEAM_PAYOUT_MINOR_PER_ONYX`

All secrets belong in deployment environment bindings. Never commit real values
to `.env` files, tests, fixtures, documentation, or migration data.
