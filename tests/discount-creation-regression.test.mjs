import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

const root = process.cwd();
const read = (file) => readFile(path.join(root, file), "utf8");

test("admin discount POST persists a series offer that public lists, badges, and chapter pricing consume", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "nyascans-discount-route-"));
  const workerPath = path.join(temporary, "worker.mjs");
  const entryPath = path.join(temporary, "entry.ts");
  const policyMockPath = path.join(temporary, "policy.ts");
  const adminUtilsMockPath = path.join(temporary, "admin-utils.ts");
  const featureFlagsMockPath = path.join(temporary, "feature-flags.ts");
  const appRoute = path.join(root, "app/api/v1/admin/discounts/route.ts");
  const publicRoute = path.join(root, "app/api/v1/discounts/route.ts");
  const discountService = path.join(root, "lib/server/content-discounts.ts");
  const commercialSettings = path.join(root, "lib/commercial-settings.ts");
  const badgeComponent = path.join(root, "components/nyascans/ActiveDiscountBadge.tsx");

  await Promise.all([
    writeFile(
      policyMockPath,
      `export async function requireActor() {
        return {
          id: "owner_1", email: "owner@example.test", displayName: "Owner",
          primaryRole: "OWNER", roles: ["OWNER"], avatarUrl: null,
          teamIds: [], managedTeamIds: [], requestTeamIds: [], uploadTeamIds: [],
          canUseUploadCenter: true, authMethod: "CHATGPT", adminMfaRequired: false,
          adminMfaEnrolled: false, adminMfaVerified: true, adminMfaExpiresAt: null,
          permissionOverrides: [],
        };
      }
      export function requireAdminCapability(actor, capability) {
        if (actor?.primaryRole !== "OWNER" || capability !== "discounts.manage") {
          const error = new Error("Forbidden");
          Object.assign(error, { status: 403, code: "FORBIDDEN" });
          throw error;
        }
      }`,
    ),
    writeFile(
      adminUtilsMockPath,
      `import { ApiError } from "@/lib/server/api";
      export function requestIdFor(request) {
        return request.headers.get("x-request-id") || "discount-test-request";
      }
      export function assertSameOrigin(request) {
        if (request.headers.get("origin") !== new URL(request.url).origin) {
          throw new ApiError(403, "ORIGIN_MISMATCH", "This action must come from NyaScans.");
        }
      }
      export function auditStatement(db, actor, requestId, input, condition = "1 = 1") {
        return db.prepare(
          \`INSERT INTO audit_logs (id, actor_user_id, action, target_id, request_id)
             SELECT lower(hex(randomblob(16))), ?, ?, ?, ? WHERE \${condition}\`,
        ).bind(actor?.id ?? null, input.action, input.targetId, requestId);
      }`,
    ),
    writeFile(
      featureFlagsMockPath,
      `export async function getFeatureStates() {
        return {
          premium_unlocks: {
            key: "premium_unlocks", enabled: true, available: true,
            effective: true, wired: true, reason: null,
          },
          payments: {
            key: "payments", enabled: true, available: true,
            effective: true, wired: true, reason: null,
          },
        };
      }`,
    ),
    writeFile(
      entryPath,
      `import { env } from "cloudflare:workers";
      import { POST as createDiscount } from ${JSON.stringify(appRoute)};
      import { GET as listDiscounts } from ${JSON.stringify(publicRoute)};
      import { resolveActiveChapterDiscount } from ${JSON.stringify(discountService)};
      import { defaultCommercialSettings } from ${JSON.stringify(commercialSettings)};
      import { activeDiscountPercentages } from ${JSON.stringify(badgeComponent)};

      const schema = \`
        CREATE TABLE users (id TEXT PRIMARY KEY);
        CREATE TABLE series (
          id TEXT PRIMARY KEY, slug TEXT NOT NULL, title TEXT NOT NULL,
          cover_key TEXT, revision INTEGER NOT NULL DEFAULT 1,
          is_published INTEGER NOT NULL DEFAULT 1, archived_at TEXT
        );
        CREATE TABLE chapters (
          id TEXT PRIMARY KEY, series_id TEXT NOT NULL REFERENCES series(id),
          slug TEXT NOT NULL, chapter_number TEXT NOT NULL, title TEXT,
          price_onyx INTEGER NOT NULL DEFAULT 0, access_type TEXT NOT NULL,
          state TEXT NOT NULL, visibility TEXT NOT NULL, published_at TEXT
        );
        CREATE TABLE genres (id TEXT PRIMARY KEY, name TEXT NOT NULL, archived_at TEXT);
        CREATE TABLE series_genres (series_id TEXT NOT NULL, genre_id TEXT NOT NULL);
        CREATE TABLE content_discounts (
          id TEXT PRIMARY KEY, target_type TEXT NOT NULL, series_id TEXT NOT NULL REFERENCES series(id),
          chapter_id TEXT REFERENCES chapters(id), discount_type TEXT NOT NULL,
          discount_value INTEGER NOT NULL, original_price INTEGER NOT NULL,
          reduced_price INTEGER NOT NULL, headline TEXT NOT NULL DEFAULT '',
          starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
          revision INTEGER NOT NULL DEFAULT 1, created_by_user_id TEXT REFERENCES users(id),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE commercial_settings (
          id TEXT PRIMARY KEY, settings_json TEXT NOT NULL,
          revision INTEGER NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE feature_flags (key TEXT PRIMARY KEY, enabled INTEGER NOT NULL);
        CREATE TABLE audit_logs (
          id TEXT PRIMARY KEY, actor_user_id TEXT, action TEXT NOT NULL,
          target_id TEXT NOT NULL, request_id TEXT NOT NULL
        );
      \`;

      async function seed() {
        for (const statement of schema.split(";").map((value) => value.trim()).filter(Boolean)) {
          await env.DB.prepare(statement).run();
        }
        await env.DB.batch([
          env.DB.prepare("INSERT INTO users (id) VALUES ('owner_1')"),
          env.DB.prepare("INSERT INTO series (id, slug, title) VALUES ('series_1', 'after-school-exorcists', 'After School Exorcists')"),
          env.DB.prepare(\`INSERT INTO chapters
            (id, series_id, slug, chapter_number, title, price_onyx, access_type, state, visibility, published_at)
            VALUES ('chapter_1', 'series_1', 'chapter-1', '1', 'First Bell', 120, 'PAID', 'PUBLISHED', 'PUBLIC', datetime('now', '-1 day'))\`),
          env.DB.prepare(\`INSERT INTO chapters
            (id, series_id, slug, chapter_number, title, price_onyx, access_type, state, visibility, published_at)
            VALUES ('chapter_2', 'series_1', 'chapter-2', '2', 'Night Class', 200, 'PAID', 'PUBLISHED', 'PUBLIC', datetime('now', '-1 day'))\`),
          env.DB.prepare("INSERT INTO commercial_settings (id, settings_json, revision) VALUES ('active', ?, 1)")
            .bind(JSON.stringify(defaultCommercialSettings)),
          env.DB.prepare("INSERT INTO feature_flags (key, enabled) VALUES ('premium_unlocks', 1)"),
        ]);
      }

      export default {
        async fetch(request) {
          const pathname = new URL(request.url).pathname;
          if (pathname === "/__seed") {
            await seed();
            return Response.json({ seeded: true });
          }
          if (pathname === "/api/v1/admin/discounts") return createDiscount(request);
          if (pathname === "/api/v1/discounts") return listDiscounts(request);
          if (pathname === "/__resolve") {
            return Response.json(await resolveActiveChapterDiscount("series_1", "chapter_2", 200));
          }
          if (pathname === "/__badge") {
            const response = await listDiscounts(new Request("https://discount.test/api/v1/discounts?sort=discount"));
            const payload = await response.json();
            return Response.json({
              percentage: activeDiscountPercentages(payload.data).get("after-school-exorcists") ?? 0,
            });
          }
          return new Response("Not found", { status: 404 });
        },
      };`,
    ),
  ]);

  const exactAliases = new Map([
    ["@/lib/server/policy", policyMockPath],
    ["@/lib/server/admin-utils", adminUtilsMockPath],
    ["@/lib/server/feature-flags", featureFlagsMockPath],
  ]);
  await build({
    entryPoints: [entryPath],
    outfile: workerPath,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    external: ["cloudflare:workers", "node:*"],
    logLevel: "silent",
    plugins: [
      {
        name: "nyascans-test-aliases",
        setup(builder) {
          builder.onResolve({ filter: /^@\// }, (args) => ({
            path:
              exactAliases.get(args.path) ??
              `${path.join(root, args.path.slice(2))}.ts`,
          }));
        },
      },
    ],
  });

  const runtime = new Miniflare({
    modules: true,
    script: await readFile(workerPath, "utf8"),
    compatibilityDate: "2026-05-22",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: ["DB"],
  });

  try {
    const seeded = await runtime.dispatchFetch("https://discount.test/__seed");
    assert.equal(seeded.status, 200, await seeded.clone().text());

    const now = Date.now();
    const rejected = await runtime.dispatchFetch(
      "https://discount.test/api/v1/admin/discounts",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://discount.test",
          "x-request-id": "discount-invalid-test-001",
        },
        body: JSON.stringify({
          targetType: "SERIES",
          seriesId: "series_1",
          chapterId: null,
          discountType: "PERCENT",
          discountValue: 100,
          headline: "READ THE WHOLE VOLUME",
          startsAt: new Date(now - 60_000).toISOString(),
          endsAt: new Date(now + 86_400_000).toISOString(),
          active: true,
        }),
      },
    );
    assert.equal(rejected.status, 422);
    const rejectedPayload = await rejected.json();
    assert.equal(rejectedPayload.error.code, "VALIDATION_ERROR");
    assert.match(
      rejectedPayload.error.fields[0].message,
      /between 1 and 99/u,
    );
    const database = await runtime.getD1Database("DB");
    assert.equal(
      (await database.prepare("SELECT COUNT(*) AS count FROM content_discounts").first()).count,
      0,
    );

    const created = await runtime.dispatchFetch(
      "https://discount.test/api/v1/admin/discounts",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://discount.test",
          "x-request-id": "discount-create-test-001",
        },
        body: JSON.stringify({
          targetType: "SERIES",
          seriesId: "series_1",
          chapterId: null,
          discountType: "PERCENT",
          discountValue: 15,
          headline: "READ THE WHOLE VOLUME",
          startsAt: new Date(now - 60_000).toISOString(),
          endsAt: new Date(now + 86_400_000).toISOString(),
          active: true,
        }),
      },
    );
    assert.equal(created.status, 201, await created.clone().text());
    const adminPayload = await created.json();
    assert.equal(adminPayload.discounts.length, 1);
    assert.equal(adminPayload.discounts[0].seriesSlug, "after-school-exorcists");
    assert.equal(adminPayload.discounts[0].originalPrice, 120);
    assert.equal(adminPayload.discounts[0].reducedPrice, 102);
    assert.equal(adminPayload.discounts[0].percentage, 15);
    assert.equal(adminPayload.discounts[0].status, "ACTIVE");

    const persisted = await database
      .prepare("SELECT discount_value AS discountValue, original_price AS originalPrice, reduced_price AS reducedPrice FROM content_discounts")
      .first();
    assert.deepEqual(
      { ...persisted },
      { discountValue: 15, originalPrice: 120, reducedPrice: 102 },
    );

    const publicResponse = await runtime.dispatchFetch(
      "https://discount.test/api/v1/discounts?sort=discount",
    );
    assert.equal(publicResponse.status, 200, await publicResponse.clone().text());
    const publicPayload = await publicResponse.json();
    assert.equal(publicPayload.data.length, 1);
    assert.equal(publicPayload.data[0].percentage, 15);
    assert.equal(publicPayload.data[0].href, "/title/after-school-exorcists");

    const badgeResponse = await runtime.dispatchFetch("https://discount.test/__badge");
    assert.deepEqual(await badgeResponse.json(), { percentage: 15 });

    const resolvedResponse = await runtime.dispatchFetch("https://discount.test/__resolve");
    assert.deepEqual(await resolvedResponse.json(), {
      basePriceOnyx: 200,
      priceOnyx: 170,
      discountId: adminPayload.discounts[0].id,
      discountRevision: 1,
      discountTargetType: "SERIES",
      discountPercentage: 15,
      discountEndsAt: adminPayload.discounts[0].endsAt,
    });
  } finally {
    await runtime.dispose();
    await rm(temporary, { recursive: true, force: true });
  }
});

test("discount creation UI never hides client or server validation and the public badge is mounted on discovery cards", async () => {
  const [panel, home, discovery, badge, route] = await Promise.all([
    read("components/nyascans/admin/DiscountsPanel.tsx"),
    read("components/nyascans/HomeFeatureSections.tsx"),
    read("components/nyascans/PublicDiscoverySections.tsx"),
    read("components/nyascans/ActiveDiscountBadge.tsx"),
    read("app/api/v1/admin/discounts/route.ts"),
  ]);
  assert.match(panel, /validateDiscountDraft/u);
  assert.match(panel, /role="alert"/u);
  assert.match(panel, /disabled=\{busy\}/u);
  assert.doesNotMatch(panel, /disabled=\{busy \|\| !draftIsValid\}/u);
  assert.match(panel, /payload\.error\?\.fields/u);
  assert.match(panel, /dispatchEvent\(new Event\(DISCOUNTS_UPDATED_EVENT\)\)/u);
  assert.match(route, /await saveDiscount\(payload, actor, requestId\)/u);
  assert.match(badge, /activeDiscountPercentages\(payload\.data \?\? \[\]\)/u);
  assert.match(badge, /ACTIVE_DISCOUNT_CACHE_MS = 20_000/u);
  assert.match(badge, /addEventListener\(DISCOUNTS_UPDATED_EVENT, refresh\)/u);
  assert.match(home, /<ActiveDiscountBadge/u);
  assert.match(discovery, /<ActiveDiscountBadge/u);
});
