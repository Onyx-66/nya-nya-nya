import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url);
const read = (relative) => fs.readFileSync(new URL(relative, root), "utf8");
const teams = read("components/nyascans/PublicDiscoverySections.tsx");
const app = read("components/nyascans/NyaScansApp.tsx");
const globals = read("app/globals.css");
const surfaces = read("app/theme-surfaces.css");
const themeBuilder = read("components/nyascans/ThemeBuilderPage.tsx");
const browse = read("components/nyascans/BrowseFixes.module.css");
const popular = read("components/nyascans/HotThisWeek.tsx");
const popularApi = read("app/api/v1/hot-this-week/route.ts");
const leaderboard = read("components/nyascans/UserLeaderboardView.tsx");
const leaderboardApi = read("app/api/v1/leaderboard/route.ts");
const themeSystem = read("lib/theme-system.ts");
const siteConfiguration = read("lib/server/site-configuration.ts");
const promotionsApi = read("app/api/v1/home-promotions/route.ts");

test("Top Teams uses compact fixed medals and adjacent mobile actions", () => {
  assert.match(teams, /team-rank-medal/);
  assert.match(teams, /<strong aria-hidden="true">\{record\.rank\}<\/strong>/);
  assert.doesNotMatch(teams, /team-podium-decor/);
  assert.match(globals, /team-rank-medal\.rank-1[\s\S]*#d4af37/i);
  assert.match(globals, /team-rank-medal\.rank-2[\s\S]*#c0c0c0/i);
  assert.match(globals, /team-rank-medal\.rank-3[\s\S]*#cd7f32/i);
  assert.match(globals, /team-carousel-card\.is-ranked-1,[\s\S]*min-height: 0 !important/);
  assert.match(globals, /@media \(max-width: 720px\)[\s\S]*public-teams \.section-heading \.section-heading-main[\s\S]*flex: 1 1 auto !important/);
  assert.match(globals, /teams-heading-actions > \.compact-language-menu > summary[\s\S]*color: var\(--section-accent, var\(--theme-primary\)\) !important/);
});

test("New Series interaction states have no shadow", () => {
  assert.match(surfaces, /public-new-series \.new-series-card:is\(:hover, :focus-visible, :active\)[\s\S]*box-shadow: none !important/);
});

test("Announcement cards expose fixed semantic palettes", () => {
  assert.match(surfaces, /home-announcement-slider > article:is\(\[data-type="notice"\], \[data-type="info"\]\)[\s\S]*#58a6ff/);
  assert.match(surfaces, /home-announcement-slider > article:is\(\[data-type="update"\], \[data-type="success"\]\)[\s\S]*#4fd18b/);
  assert.match(surfaces, /home-announcement-slider > article:is\(\[data-type="issue"\], \[data-type="warning"\]\)[\s\S]*#f1c75b/);
  assert.match(surfaces, /home-announcement-slider > article:is\(\[data-type="support"\], \[data-type="alert"\], \[data-type="promotional"\]\)[\s\S]*#f15b78/);
  assert.match(app, /data-category=\{floatingCampaignCategory\(campaign\)\}/);
});

test("Theme Builder action and export labels match the requested structure", () => {
  assert.match(themeBuilder, /Use as new base/);
  assert.match(themeBuilder, /className="button button-secondary" type="button" onClick=\{createNew\}>Use as new base/);
  assert.match(themeBuilder, /className="button button-secondary" type="button" onClick=\{\(\) => loadSavedTheme\(\)\} disabled=\{!customThemes\.length\}>Load</);
  assert.match(themeBuilder, /theme-builder-secondary-actions/);
  assert.match(themeBuilder, /<strong>Share<\/strong>/);
  assert.match(themeBuilder, /<strong>Download<\/strong>/);
  assert.equal((themeBuilder.match(/>\s*Copy URL\s*<\/button>/g) ?? []).length, 2);
  assert.equal((themeBuilder.match(/>\s*Current\s*<\/button>/g) ?? []).length, 2);
  assert.equal((themeBuilder.match(/>\s*Template\s*<\/button>/g) ?? []).length, 2);
  assert.match(themeBuilder, /<h2>Test theme<\/h2>/);
  assert.match(themeBuilder, /<Eye size=\{17\} \/> Test theme/);
  assert.match(themeBuilder, /Upload JSON \/ Markdown file/);
  assert.match(globals, /theme-builder-card > header > span[\s\S]*width: max-content/);
  assert.match(globals, /theme-builder-download-grid[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test("Most Popular exposes live catalog totals rather than only period activity counters", () => {
  assert.match(popularApi, /AS viewCount/);
  assert.match(popularApi, /AS chapterCount/);
  assert.match(popularApi, /AS commentTotal/);
  assert.match(popularApi, /AS followerCount/);
  assert.match(popular, /value=\{record\.viewCount\} label="Views"/);
  assert.match(popular, /value=\{record\.chapterCount\} label="Chapters"/);
  assert.match(popular, /value=\{record\.commentTotal\} label="Comments"/);
  assert.match(popular, /value=\{record\.followerCount\} label="Followers"/);
});

test("Leaderboard rename, responsive metrics, theme tokens, and checkbox placement are covered", () => {
  assert.match(leaderboard, /<h1 id="leaderboard-title">Leaderboard<\/h1>/);
  assert.match(leaderboard, /label="Reacts"/);
  assert.match(leaderboard, /label="Chapters"/);
  assert.match(leaderboard, /BookOpenText weight="fill" aria-hidden="true"/);
  assert.match(leaderboard, /user-ranking-medal rank-\$\{entry\.rank\}/);
  assert.match(leaderboard, /<Medal className="user-ranking-award-icon" size=\{40\} aria-hidden="true" \/>/);
  assert.match(leaderboard, /<span className="user-ranking-score-label">Score<\/span>/);
  assert.doesNotMatch(leaderboard, /<span className="user-ranking-kicker">The rest of the board<\/span>/);
  assert.doesNotMatch(leaderboard, /<h2 id="user-ranking-list-title">Leaderboard entries<\/h2>/);
  assert.match(leaderboard, /aria-label="Lower-ranked users"/);
  assert.doesNotMatch(leaderboard, /<small>\{label\}<\/small>/);
  assert.match(leaderboard, /user-ranking-podium-score/);
  assert.match(leaderboard, /user-ranking-podium-secondary/);
  assert.match(leaderboard, /value=\{number\(entry\.commentCount\)\}/);
  assert.match(leaderboard, /value=\{number\(entry\.upvotes\)\}/);
  assert.match(leaderboardApi, /COALESCE\(raw_comments\.commentCount, 0\) AS commentCount/);
  assert.match(leaderboardApi, /COALESCE\(raw_votes\.upvotes, 0\) AS upvotes/);
  assert.match(themeSystem, /id: "home-leaderboard"/);
  assert.match(themeSystem, /homeLeaderboardAccent/);
  assert.match(siteConfiguration, /normalizeLegacyLeaderboardLabels/);
  assert.match(promotionsApi, /canonicalInternalUrl/);
  assert.match(app, /href="\/leaderboard"/);
  assert.doesNotMatch(app, /> Ranking<|Users Ranking/);
  assert.match(globals, /\.reader-setting-toggle > input[\s\S]*grid-column: 1/);
  assert.match(globals, /\.library-record-copy h3[\s\S]*text-overflow: ellipsis/);
  assert.match(globals, /\.user-leaderboard \.user-ranking-periods[\s\S]*display: grid !important/);
  assert.match(globals, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(globals, /\.user-leaderboard \.user-ranking-periods button[\s\S]*width: 100%/);
  assert.match(globals, /white-space: nowrap/);
  assert.match(globals, /user-ranking-controls-copy[\s\S]*display: none !important/);
  assert.match(globals, /user-ranking-controls[\s\S]*border: 0 !important/);
  assert.match(globals, /user-ranking-periods[\s\S]*width: 100% !important/);
  assert.match(globals, /user-ranking-place[\s\S]*top: -1\.7rem/);
  assert.match(globals, /user-ranking-podium-secondary[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(globals, /user-ranking-list-heading[\s\S]*display: grid[\s\S]*grid-template-columns: 2\.6rem 3\.2rem minmax\(0, 1fr\) minmax\(19rem, 0\.72fr\)/);
  assert.match(globals, /user-ranking-list-labels[\s\S]*grid-column: 4[\s\S]*justify-items: center/);
  assert.match(globals, /user-ranking-row-metrics > \.user-ranking-metric:first-child[\s\S]*transform: translateX\(-\.55rem\)/);
  assert.match(globals, /user-ranking-metric[\s\S]*display: inline-flex/);
  assert.match(globals, /user-ranking-place\.user-ranking-medal[\s\S]*border: 0/);
  assert.match(globals, /user-ranking-place\.user-ranking-medal\.rank-1[\s\S]*--medal-fill: var\(--leaderboard-first\)/);
  assert.match(globals, /user-ranking-place\.user-ranking-medal\.rank-2[\s\S]*--medal-fill: var\(--leaderboard-second\)/);
  assert.match(globals, /user-ranking-place\.user-ranking-medal\.rank-3[\s\S]*--medal-fill: var\(--leaderboard-third\)/);
  assert.match(globals, /user-ranking-podium-card\.is-rank-2[\s\S]*border-color: color-mix\(in srgb, var\(--leaderboard-second\)/);
  assert.match(globals, /user-ranking-podium-card\.is-rank-3[\s\S]*border-color: color-mix\(in srgb, var\(--leaderboard-third\)/);
  assert.match(globals, /user-ranking-list-row \.user-ranking-avatar[\s\S]*aspect-ratio: 1 \/ 1[\s\S]*border-radius: 1rem/);
  assert.match(globals, /user-ranking-list-row \.user-ranking-avatar img[\s\S]*border-radius: \.85rem/);
  assert.match(globals, /user-ranking-podium-metrics[\s\S]*margin-top: 0/);
  assert.match(globals, /user-ranking-score-label[\s\S]*text-transform: uppercase/);
  assert.match(globals, /user-ranking-award-icon[\s\S]*stroke-width: 1\.45/);
  assert.match(globals, /user-ranking-list-heading[\s\S]*display: none/);
});

test("Browse Following uses the same theme button hue as Follow", () => {
  assert.doesNotMatch(browse, /browse-selected-pink|theme-status-purple/);
  assert.match(browse, /--browse-follow-fill: var\(--theme-button-accent\)/);
  assert.match(browse, /catalog-card-follow\.is-following[\s\S]*background: var\(--browse-follow-fill\) !important/);
  assert.match(browse, /list-follow-button\.is-following[\s\S]*background: var\(--browse-follow-fill\) !important/);
  assert.match(globals, /catalog-card-follow\.is-following, \.series-list-row \.list-follow-button\.is-following[\s\S]*background: var\(--theme-button-accent\) !important/);
});
