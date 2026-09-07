# Preview catalogue — 49.22.21

`mangadex-series.json` is a snapshot of 19 safe-rated MangaDex catalogue entries fetched on 2026-09-07 from `https://api.mangadex.org/manga` with author, artist and cover-art relationships. Each entry records the source URL and MangaDex ID. Cover thumbnails were retrieved from `https://uploads.mangadex.org/covers/{mangaId}/{coverFile}.512.jpg` and stored under `public/art/mangadex-sample/`. Original titles, creators, origins, genres and thematic/format tags come from that metadata. Cover artwork belongs to its respective rights holders; this is a testing catalogue, not a chapter import.

All community profiles, team names, reviews, comments, announcements, chapter counts, prices, discounts, rankings and analytics are fictional fixtures. Banners reuse the corresponding cover image. Reader pages are original SVG placeholders; no MangaDex chapter scans, account identities or passwords are imported.

The Worker imports fixtures only when `NYASCANS_PREVIEW_FIXTURES=mangadex-browse-49.22.21` is configured for the requested preview site. Stable identifiers and a completion marker make the import additive and repeatable. Existing records are preserved. Chapters exercise zero, one, and ranges through 520 chapters; sales include active and expired examples. Three teams, 12 fictional readers, replies, spoilers, bookmarks, reading progress and 30 days of engagement support UI and analytics testing. Existing accounts listed in `NYASCANS_ADMIN_EMAILS` are added to the sample teams. Administrator authorization remains controlled by the existing trusted-login policy.

For this explicitly enabled preview, the import enables the public paid-content and comments flags so sample offers can appear. It does not configure a payment gateway, email provider, credentials or real purchases. External-provider integrations require their own sandbox configuration and are not proven by fixture data.

Validate the complete migration chain, additive imports and live filter predicates with:

```sh
node --test tests/browse-fixtures-and-filters.test.mjs tests/browse-chapter-range.test.mjs
```
