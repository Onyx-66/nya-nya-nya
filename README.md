# NyaScans

NyaScans is an original, mobile-first manga and webtoon platform built for
readers, publishing teams, uploaders, and administrators. The deployed Sites
edition runs as one Vinext edge application with D1 for relational state, R2
for private uploads, and dispatch-owned ChatGPT sign-in.

## What is included

- Public home, browse, ranking, title, reader, team, store, status, support, and
  legal experiences
- Mobile bottom navigation and responsive desktop navigation
- Vertical, single-page, and double-page reader modes
- Signed-in library, progress, wallet, notification, and account surfaces
- Team workspace and protected administrator console
- D1 schema and migration for identity, permissions, catalog, chapters,
  reading progress, community, commerce, audit, upload, and feature-flag data
- R2 upload endpoints with live team-right checks, byte-signature and dimension
  validation, bounded sizes, private object keys, resumable job state, and
  relational page manifests
- Dedicated permission-gated upload hub with single and multi-chapter routes,
  direct image and browser-folder intake, drafts, history, retry, review status,
  rights, ordered previews, and atomic publication
- Team-scoped new-series requests with drafts, duplicate detection, revisioned
  review, shared cached/rate-limited MangaDex previews, per-field acceptance,
  administrator approval, structured feedback, and transactional
  canonical-series creation
- Database-backed ratings and written reviews with one review per reader,
  editable scores, aggregate distribution, spoiler masking, and deletion
- Multi-team series assignments and team-attributed chapter releases
- Versioned REST endpoints under `/api/v1`
- Append-only Onyx ledger entries and atomic chapter unlock flow
- Original generated platform artwork only
- Sitemap, robots policy, noindex controls, custom error states, light mode,
  reduced-motion behavior, and accessible interaction states

## Architecture decisions

- **Structure:** feature-first modules inside one edge monolith. This keeps
  public rendering, API policy checks, and data access in one deployable unit.
- **API:** versioned REST with typed JSON errors and Zod boundary validation.
- **Identity:** dispatch-owned ChatGPT sign-in. D1 stores the NyaScans role and
  team scope for the verified email.
- **Database:** Cloudflare D1 with Drizzle migrations. Money is stored in minor
  units and Onyx in integer units.
- **Uploads:** R2 stores bytes; D1 stores ownership, MIME, size, validation, and
  processing state. Direct images and browser folder selection are enabled.
  ZIP/CBZ, RAR, and Google Drive intake stay disabled until an audited
  extraction/import worker is configured; the interface explains that boundary
  instead of presenting a failing action. Expired private drafts are cancelled
  and cleaned in bounded, resumable work during Upload Center traffic, with
  durable deletion retries.
- **Updates:** durable records and conditional client polling fit the Sites runtime. External
  processors can later consume upload and notification outbox records.
- **Search:** published D1 series drive the paginated catalog and typed search
  endpoints. A large production catalog can add an external search provider
  behind the same `/api/v1/search` contract.

More detail is in [docs/architecture.md](docs/architecture.md).

## Local commands

```bash
npm run install:ci
npm run dev
npm run lint
npm run db:generate
npm test
```

The Sites lifecycle owns production builds, source versions, migrations, and
deployments. `.openai/hosting.json` declares the logical `DB` and `BUCKET`
bindings.

## Authentication and authorization

Public pages remain anonymous-compatible. Account, library, wallet, upload,
dashboard, and administrator actions resolve the signed-in identity on the
server. Every protected API action checks the stored primary role and, where
needed, team assignment.

Administrator access is only under `/onyx/admin/access`. It is excluded from
robots and sitemaps. A production administrator must be promoted through a
controlled database operation or a temporary operator bootstrap procedure.
Do not add a public first-user-wins bootstrap.

## Production integrations

The following require platform or provider configuration before a commercial
launch:

- Custom domain and DNS for `nyascans.com`
- Transactional email provider
- Payment provider and signed webhook secrets
- Tax, refund, and regional price configuration
- Malware scanning and image transformation worker
- Audited archive extraction worker before enabling ZIP/CBZ or RAR uploads
- Google Drive connector and import worker before enabling Drive intake
- Official provider configuration before adding Google, Apple, Facebook, or
  email/password buttons; the Sites build currently exposes only its
  dispatch-owned ChatGPT identity
- External search engine when the catalog outgrows D1 search
- Legal review for all editable policy templates
- Administrator email promotion and MFA enforcement policy
- Monitoring, alert routing, backup schedule, and restore drill

The interface keeps unconfigured commerce disabled. Payments, memberships,
payouts, and mature content remain behind server-side feature flags until their
providers and legal requirements are configured.
