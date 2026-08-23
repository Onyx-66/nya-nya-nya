# NyaScans Bot API

The NyaScans Bot API is the versioned integration surface for a Discord bot that acts on behalf of an authenticated NyaScans user and an explicitly scoped publishing team. It is separate from Sites/ChatGPT identity headers. Every request uses a revocable `nya_bot_...` Bearer token issued in the owner/administrator API-control panel and is resolved to the underlying NyaScans actor before team or capability checks run.

## Stable public references

Series, teams, and chapters have immutable, server-generated public references. Existing rows are backfilled by migration `0055_colossal_luminals.sql`; new rows reserve their reference in `public_identifier_reservations` in the same transaction as creation.

| Entity | Format | Example |
|---|---|---|
| Series | `SR-` + 10 uppercase hexadecimal characters | `SR-4F82K1A03B` |
| Team | `TM-` + 10 uppercase hexadecimal characters | `TM-9X21A03BCD` |
| Chapter | `CH-` + 10 uppercase hexadecimal characters | `CH-A03B77C912` |

The reference is not editable, is not regenerated after a rename or soft delete, and is never reused. Internal row IDs remain private implementation details. Admins can browse references at **Admin → Security → Identifiers**. Team members can copy their `TM-...` reference from the Team Management identity section.

## Authentication and scopes

Use `Authorization: Bearer nya_bot_<prefix>_<secret>`. The token is linked to one NyaScans user and may optionally be restricted to one internal team. The API never treats a Discord user ID as the NyaScans actor; the token’s linked account supplies the live role, overrides, active team membership, suspension state, and capability checks.

The owner-managed credential panel supports the following Bot scopes:

| Scope | Use |
|---|---|
| `bot:series:read` | List a token-scoped team’s series and read canonical genres. |
| `bot:series:create` | Create a draft series for a required `TM-...` team. |
| `bot:chapter:read` | Read a materialized or reserved `CH-...` chapter status. |
| `bot:chapter:create` | Create a single upload job or queue a bulk source operation. |
| `bot:chapter:publish` | Publish an already materialized chapter when the assigned team has `can_publish`. |
| `bot:chapter:thumbnail` | Set or replace a chapter thumbnail. |
| `bot:operation:read` | Poll a long-running or bulk operation. |

The token does not create a second permission model. Series creation requires an active verified team membership and `can_upload` assignment for chapter creation. Publication additionally requires an assignment with `can_publish`. The token may be revoked, rotated, or expired from the same panel. Requests are limited to 60 per minute and 10,000 per UTC day per token; upload bytes remain subject to Upload Center’s existing page, chapter, and job limits.

## Common response and idempotency

Responses use the existing JSON envelope. Validation and authorization failures contain `error.code`, `error.message`, and the request ID. Mutations require an `Idempotency-Key` between 12 and 160 characters. The key is scoped to the linked actor and endpoint. Reusing it with a different body returns `409 IDEMPOTENCY_KEY_REUSED`; a completed retry replays the original response; an in-flight retry returns `409 IDEMPOTENCY_IN_PROGRESS`.

Every Bot action writes to `audit_logs` with `source_area = BOT_API`, the linked NyaScans user, Discord metadata from the request headers, team, command/action, public resource references, timestamp, and success/failure reason. Admins can review these entries at **Admin → Security → Bot Activity**. Secrets, page bytes, and full credentials are never placed in audit metadata.

## Series

`GET /api/v1/bot/series?teamId=TM-...&query=&page=1&limit=50` lists non-archived series available to the token’s scope. Returned identifiers are public `SR-...` and `TM-...` references.

`POST /api/v1/bot/series` creates a draft. The JSON body is:

```json
{
  "teamId": "TM-9X21A03BCD",
  "title": "Series title",
  "slug": "series-title",
  "synopsis": "A validated synopsis of at least twelve characters.",
  "alternativeTitles": ["Alternate title"],
  "publicationYear": 2026,
  "authorNames": ["Canonical author"],
  "artistNames": ["Canonical artist"],
  "publisherName": "Canonical publisher",
  "type": "MANHWA",
  "status": "ONGOING",
  "originCountry": "KR",
  "originalLanguage": "ko",
  "readingDirection": "LTR",
  "creatorNames": ["Canonical creator"],
  "genreNames": ["Action", "Fantasy"],
  "externalSources": [{ "provider": "MANGADEX", "url": "https://example.test/title/abc" }],
  "coverUrl": "https://cdn.example.test/cover.webp"
}
```

`teamId`, `title`, `slug`, `synopsis`, and `type` are required. Creator and genre names are resolved against active canonical taxonomy; up to 40 canonical genres may be sent. A cover may be multipart (`metadata` JSON plus `cover` file) or a public HTTPS image URL. Private hosts, redirects, unsupported content types, and unsafe sources are rejected. A successful response is `201` and includes the new permanent `SR-...` reference.

## Single chapter upload

`POST /api/v1/bot/chapters` requires multipart `metadata` JSON plus one or more `pages` files, **or** a JSON body with `sourceUrl`; exactly one source is required. The metadata is:

```json
{
  "teamId": "TM-9X21A03BCD",
  "seriesId": "SR-4F82K1A03B",
  "chapterNumber": "12",
  "title": "Optional chapter title",
  "language": "en",
  "version": 1,
  "volume": null,
  "accessType": "PAID",
  "priceOnyx": 108,
  "commentsEnabled": true,
  "sourceUrl": "https://cdn.example.test/chapter-12.cbz"
}
```

`teamId`, `seriesId`, `chapterNumber`, `accessType`, `priceOnyx`, and exactly one source are required. Free chapters must have price `0`; paid chapters must have a positive price. Attached pages, an attached `archive` multipart field, and external direct images, JSON page manifests, ZIP/CBZ archives, and their nested image pages are routed through `validateChapterPage`, the existing Upload Center storage keys, and Upload Center size/dimension limits. RAR is rejected because this deployment has no audited RAR worker. The response includes the reserved permanent `CH-...` reference, upload job, page count, and `READY_FOR_REVIEW` state.

## Bulk upload

`POST /api/v1/bot/chapters/bulk` accepts one public HTTPS source, a chapter range of 1–25 chapters, and an optional paid sub-range:

```json
{
  "teamId": "TM-9X21A03BCD",
  "seriesId": "SR-4F82K1A03B",
  "sourceUrl": "https://cdn.example.test/season-1.cbz",
  "chapterRange": { "start": 1, "end": 12 },
  "paidRange": { "start": 5, "end": 8, "priceOnyx": 108 },
  "language": "en",
  "version": 1,
  "titlePrefix": "Chapter"
}
```

The source URL must be public HTTPS and the paid range must be contained within the chapter range. The endpoint reserves one `CH-...` reference per chapter and returns `202` with an operation and upload-job identifier for each item. The operation status endpoint is used by the bot while the existing upload pipeline processes the source.

## Chapter status and publication

`GET /api/v1/bot/chapters/{chapterId}` accepts only a permanent `CH-...` reference and returns `200` for a materialized chapter or `202` while a reserved upload item remains in processing. `GET /api/v1/bot/operations/{operationId}` is actor-scoped and returns `202` while a bulk operation is processing.

`POST /api/v1/bot/chapters/{chapterId}/publish` requires `bot:chapter:publish`, an active assigned team with `can_publish`, and an idempotency key. It returns `409 CHAPTER_NOT_MATERIALIZED` for a reserved but not-yet-created chapter and otherwise moves the chapter to `PUBLISHED` through a guarded server-side update.

## Thumbnails

`POST /api/v1/bot/chapters/{chapterId}/thumbnail` accepts multipart `thumbnail` and the optional `replace=true`. If a thumbnail already exists and replacement is not confirmed, it returns `409` with `error.code = THUMBNAIL_EXISTS`, `confirmationRequired = true`, and the permanent chapter reference. A second request with `replace=true` performs the validated replacement.

`POST /api/v1/bot/chapters/bulk-thumbnails` accepts multipart `metadata` plus one `thumbnail:CH-...` field for each requested chapter. It first returns `409 THUMBNAILS_EXIST` with `existingChapterIds` when confirmation is required; `replace=true` in metadata allows the validated batch replacement. The response identifies every updated public chapter reference.

## Discord genre UX

The bot should fetch `GET /api/v1/bot/taxonomy/genres?page=1&query=` for a paginated 25-item choice menu. The Discord flow can show one page at a time with Next/Previous buttons and a separate multi-select confirmation step; selected canonical keys are accumulated locally and submitted as up to 40 `genreNames` in `/series`. The API validates every submitted value against the active taxonomy and rejects stale or misspelled names rather than creating new genres.
