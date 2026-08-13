# Architecture overview

## Runtime

NyaScans is a Vinext application deployed through Sites to a Cloudflare
Worker-compatible runtime. The web experience and REST API share one edge
deployment. This avoids cross-service authorization drift while the product is
young and gives every protected path the same identity and policy layer.

## Feature boundaries

```text
app/
  api/v1/                 versioned HTTP controllers
  dashboard/              publishing workspace gate
  onyx/admin/access/      administrator gate and console
components/nyascans/      product interface
lib/
  catalog.ts              original demo catalog
  permissions.mjs         role and capability rules
  server/api.ts           error envelope and response metadata
  server/policy.ts        identity, actor, role, and team scope
db/
  schema.ts               relational source of truth
drizzle/                  reviewed migration SQL and seed data
public/art/               original demo artwork
```

Controllers parse and validate requests. Policy code authenticates and
authorizes the actor. Domain rules handle ledger balancing and state changes.
D1 statements are prepared and grouped in atomic batches for multi-record
writes.

## Data

D1 stores users, roles, team scopes, titles, chapters, reader progress,
libraries, community records, products, orders, entitlements, append-only
ledger transactions, uploads, reports, notifications, audit records, and
feature flags.

R2 stores private upload bytes. Public demo artwork is versioned with the site.
Production chapter variants should use content-hashed object keys. Searchable
metadata remains in D1.

## Identity and permissions

Sites dispatch owns sign-in and forwards verified identity headers. NyaScans
creates or resolves a D1 user record for that identity. The user record has
exactly one primary role:

- `OWNER`
- `ADMINISTRATOR`
- `MANAGER`
- `MODERATOR`
- `TEAM_LEADER`
- `UPLOADER`
- `USER`

Capabilities are deny-by-default. Team boundaries are resolved from active team
memberships. Hiding a control never replaces a server policy check.

## Commerce

Onyx uses integer units. Ledger transactions are immutable and each transaction
must sum to zero. The chapter unlock endpoint checks balance, checks an existing
entitlement, posts both ledger sides, writes the entitlement, and records the
audit event in one D1 batch. Idempotency keys prevent repeat posting.

Fiat values use integer minor units. Payment-provider confirmation must arrive
through a verified server webhook before products are granted.

## Uploads

The Sites edition currently accepts bounded direct images and browser folder
selection through the role-protected Upload Center. It validates byte
signatures and image dimensions before private R2 storage, records ordered page
state and retry metadata in D1, rechecks the active team/series assignment at
each mutation, and publishes a complete chapter through guarded batch
statements. ZIP/CBZ, RAR, and Google Drive are disabled until audited
extraction/import workers exist. Upload Center requests opportunistically
cancel and clean a bounded number of expired, chapter-unlinked drafts; failed
object deletions use the existing durable cleanup/dead-letter path.

When external processing is enabled, it must update the existing upload job,
job-item, session, chapter, and page records rather than inventing a second
source of truth. Archive processing must include malware scanning, traversal
and decompression limits, nested/password-protected archive rejection, image
normalization, hashing, thumbnails, bounded retries, and atomic publication.

## Scaling path

- Add Meilisearch or OpenSearch behind the existing search contract.
- Feed upload and notification records to durable queues.
- Move analytics aggregation to scheduled jobs.
- Add a payment-provider adapter without changing wallet and entitlement rules.
- Split high-volume media work into dedicated Workers while preserving shared
  contracts and audit IDs.
