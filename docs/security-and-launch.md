# Security and launch checklist

## Before public access

- Confirm the Sites access policy and intended audience.
- Point `nyascans.com` DNS to the verified Sites deployment and confirm TLS.
- Promote administrators through an audited operator procedure.
- Configure `ADMIN_TOTP_ENCRYPTION_KEY` as a 32-byte base64url hosted secret.
  TOTP is mandatory for Owner, Administrator, and Manager accounts; the
  server-issued administrator assurance cookie expires after one hour.
- Configure an administrator IP or trusted-device policy when appropriate.
- Set payment, webhook, email, and search secrets in hosted environment values.
- Keep payments, memberships, payouts, and mature content disabled until their
  provider, legal, and regional checks pass.
- Replace test prices and reconcile every seeded ledger fixture.
- Complete legal review of Terms, Privacy, Cookie, Copyright, Content, and
  Refund policies.

## Upload hardening

- Connect malware scanning.
- Reject path traversal, nested archives, password-protected archives, scripts,
  active SVG, and decompression bombs.
- Enforce archive entry count, extracted byte, image dimension, and processing
  time limits.
- Keep original uploads private and publish only immutable transformed variants.
- Strip EXIF and normalize orientation and color profile.

## Commerce hardening

- Use hosted payment elements or hosted checkout.
- Verify webhook signatures and use idempotency keys.
- Grant products only after server-confirmed payment.
- Reconcile orders, payments, refunds, disputes, liabilities, and payouts.
- Add four-eyes approval for high-risk manual adjustments.

## Operations

- Configure structured log export with PII redaction.
- Alert on authentication risk, queue failure, payment mismatch, upload
  processing failure, and rights expiry.
- Schedule D1 and R2 backups and complete a documented restore drill.
- Rebuild the search index from D1 and confirm the database remains authoritative.
- Run accessibility, permission, API, integration, and end-to-end tests.
- Confirm reader performance on real mobile networks.
- Review dependency and static analysis reports.
- Prepare incident response, takedown, and account recovery runbooks.
