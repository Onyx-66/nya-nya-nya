import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("public cover and team media preserve valid local assets and hide invalid records", async () => {
  const [newSeries, seriesDetail, teams, teamDetail, profiles, library] =
    await Promise.all([
      read("app/api/v1/new-series/route.ts"),
      read("app/api/v1/series-detail/route.ts"),
      read("app/api/v1/public-teams/route.ts"),
      read("app/api/v1/public-team/route.ts"),
      read("app/api/v1/profiles/route.ts"),
      read("app/api/v1/library-data/route.ts"),
    ]);

  for (const source of [
    newSeries,
    seriesDetail,
    teams,
    teamDetail,
    profiles,
    library,
  ]) {
    assert.match(source, /startsWith\("\/"\)/);
    assert.match(source, /https\?:\\\/\\\/|parsed\.protocol === "https:"/);
  }
  assert.match(teams, /verification_status = 'VERIFIED'/);
  assert.match(teams, /sta\.revoked_at IS NULL/);
  assert.match(teamDetail, /s\.status NOT IN \('DRAFT', 'REJECTED', 'ARCHIVED'\)/);
  assert.match(profiles, /c\.visibility = 'PUBLIC'/);
  assert.match(library, /c\.visibility = 'PUBLIC'/);
});

test("header uses a standalone notification control and keeps upload/account actions in the profile menu", async () => {
  const app = await read("components/nyascans/NyaScansApp.tsx");
  const header = app.slice(
    app.indexOf("function SiteHeader"),
    app.indexOf("function MobileNav"),
  );
  const account = app.slice(
    app.indexOf("function AccountView"),
    app.indexOf("function StatusView"),
  );

  assert.match(header, /className="header-notifications"/);
  assert.match(header, /className="header-profile-trigger"/);
  assert.match(header, /CloudArrowUp size=\{18\} \/> Upload Center/);
  assert.match(header, /href="\/signout-with-chatgpt\?return_to=%2F"/);
  assert.doesNotMatch(header, /className="header-upload-link"/);
  assert.doesNotMatch(account, /Open Admin Panel|Open Team Workspace/);
});

test("homepage discovery carousels have centered interaction, fallbacks, and no native progress scrollbar", async () => {
  const [discovery, app, css] = await Promise.all([
    read("components/nyascans/PublicDiscoverySections.tsx"),
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/globals.css"),
  ]);

  assert.match(discovery, /data-active=\{active \? "true" : "false"\}/);
  assert.match(discovery, /card\.offsetLeft - \(rail\.clientWidth - card\.clientWidth\) \/ 2/);
  assert.match(discovery, /onKeyDown/);
  assert.match(discovery, /Cover pending/);
  assert.match(css, /\.team-carousel-logo[\s\S]*margin: -2\.9rem auto 0/);
  assert.match(css, /\.team-carousel-card\[data-active="true"\]/);
  assert.match(css, /\.teams-carousel-dots button\[aria-pressed="true"\]/);
  assert.match(css, /\.trending-rail::\-webkit-scrollbar[\s\S]*display: none/);
  assert.match(app, /aria-label="Trending series"[\s\S]*tabIndex=\{0\}/);
});

test("Editor's Pick follows the reference carousel and persists its Library action", async () => {
  const [app, css] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/globals.css"),
  ]);
  const editor = app.slice(
    app.indexOf("function EditorsPickSection"),
    app.indexOf("function HomeView"),
  );

  assert.match(editor, /editors-pick-cover-back-left/);
  assert.match(editor, /editors-pick-cover-back-right/);
  assert.match(editor, /onPointerDown/);
  assert.match(editor, /aria-pressed=\{index === safeActive\}/);
  assert.match(editor, /fetch\("\/api\/v1\/library"/);
  assert.match(editor, /method: "POST"/);
  assert.match(css, /\.editors-pick-card[\s\S]*grid-template-columns/);
  assert.match(css, /\.editors-pick-dots button\[aria-pressed="true"\]/);
});

test("notifications are actor-scoped, filterable, persisted, and rendered without demo rows", async () => {
  const [api, view, app] = await Promise.all([
    read("app/api/v1/notifications/route.ts"),
    read("components/nyascans/NotificationsView.tsx"),
    read("components/nyascans/NyaScansApp.tsx"),
  ]);

  assert.match(api, /enum\(\["ALL", "UPDATES", "ANNOUNCEMENTS", "SOCIAL"\]\)/);
  assert.match(api, /enum\(\["UNREAD", "READ", "ALL"\]\)/);
  assert.match(api, /WHERE user_id = \?/);
  assert.match(api, /action: z\.enum\(\["READ", "UNREAD", "READ_ALL"\]\)/);
  assert.match(api, /rawActionUrl\.startsWith\("\/"\)/);
  for (const label of ["All", "Updates", "Announcements", "Social", "Unread", "Read"]) {
    assert.match(view, new RegExp(`label: "${label}"`));
  }
  assert.match(view, /nyascans:notifications-changed/);
  assert.match(app, /<NotificationsView actor=\{actor\} \/>/);
  assert.doesNotMatch(app, /Neon Ronin chapter 48 is ready/);
});

test("Latest Updates requests twenty series and exposes Previous and Next pagination", async () => {
  const [app, api] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/api/v1/[...resource]/route.ts"),
  ]);
  const latest = app.slice(
    app.indexOf("function LatestUpdatesGrid"),
    app.indexOf("function TrendingShowcase"),
  );

  assert.match(latest, /pageSize=\{20\}/);
  assert.match(latest, /> Previous/);
  assert.match(latest, /Next <CaretRight/);
  assert.match(api, /if \(path === "latest-releases"\)/);
  assert.match(api, /\.max\(24\)/);
  assert.match(api, /LIMIT \? OFFSET \?/);
});

test("reader chapter drawer and release-scoped Previous/Next navigation are wired end to end", async () => {
  const [app, api, css] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/api/v1/[...resource]/route.ts"),
    read("app/globals.css"),
  ]);
  const reader = app.slice(
    app.indexOf("function ReaderView"),
    app.indexOf("type WalletActivity"),
  );
  const context = api.slice(
    api.indexOf('if (path === "reader-context")'),
    api.indexOf('if (path === "chapter-access-list")'),
  );

  assert.match(reader, /<List size=\{20\} \/>/);
  assert.match(reader, /id="reader-chapter-drawer"/);
  assert.match(reader, /chapter-access-list\?series=/);
  assert.match(reader, /Manage current release/);
  assert.match(reader, /aria-label="Previous and next chapters"/);
  assert.match(reader, /rel="prev"/);
  assert.match(reader, /rel="next"/);
  assert.doesNotMatch(reader, /Manage chapter/);
  assert.match(context, /previousChapter: previous/);
  assert.match(context, /nextChapter: next/);
  assert.match(context, /AND language = \?/);
  assert.match(context, /team_id = \?/);
  assert.match(css, /\.reader-chapter-drawer/);
  assert.match(css, /\.reader-chapter-navigation[\s\S]*grid-template-columns: repeat\(2/);
});

test("series Follow is persisted and Follow/Share share one professional two-column layout", async () => {
  const [followApi, app, css] = await Promise.all([
    read("app/api/v1/series-follow/route.ts"),
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/globals.css"),
  ]);
  const title = app.slice(
    app.indexOf("function TitleView"),
    app.indexOf("type ChapterAccessData"),
  );

  assert.match(followApi, /INSERT OR IGNORE INTO follows/);
  assert.match(followApi, /DELETE FROM follows/);
  assert.match(followApi, /follower_count =/);
  assert.match(title, /method: followed \? "DELETE" : "POST"/);
  assert.match(title, /navigator\.share/);
  assert.match(title, /navigator\.clipboard\.writeText/);
  assert.match(css, /\.title-actions[\s\S]*grid-template-columns: repeat\(2/);
  assert.match(css, /\.title-actions > \.button-primary[\s\S]*grid-column: 1 \/ -1/);
  assert.match(css, /\.title-actions \.series-secondary-action[\s\S]*width: 100%/);
});
