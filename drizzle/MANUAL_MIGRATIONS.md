# Manual migration baseline

Migrations `0059` through `0063` were authored as reviewed SQL migrations
before their Drizzle metadata was recorded. They remain separate deployment
steps because deployed D1 databases may already have applied some or all of
them.

The journal entry tagged `0063_paid_system_policies` is the reconciliation
baseline for that manual sequence. `meta/0063_snapshot.json` was generated from
the complete current `db/schema.ts` with Drizzle Kit 0.31.10 and has
`0058_snapshot.json` as its predecessor. This makes the schema at the end of
the manual sequence authoritative without inventing intermediate snapshots or
rewriting deployed migration history.

Every migration after `0063` must be generated with `npm run db:generate` and
must commit its SQL file, journal entry, and same-numbered snapshot together.
`npm run db:check` enforces that boundary.
