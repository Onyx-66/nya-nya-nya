# Current release contracts

The release gate runs the maintained behavior, authorization, ledger,
idempotency, media-cleanup, discussion, team-creation, and audit-hardening
contracts listed by `test:current` in `package.json`.

The remaining root test files are retained as historical acceptance evidence.
Many intentionally match version-specific source text or superseded UI shapes;
they are not release contracts and must not drive production code backward.
When a historical invariant is still relevant, migrate it into a maintained
behavior-level contract and add that file to `test:current`.
