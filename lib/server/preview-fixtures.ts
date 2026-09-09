import seriesFixtures from "../fixtures/mangadex-refresh-series.json";
import { defaultCommercialSettings } from "../commercial-settings";

export const PREVIEW_FIXTURE_VERSION = "mangadex-refresh-49.22.24";
const prefix = "pv4924";
const slugify = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const manager = `${prefix}-manager`;
export const previewPageSvg = (page: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1350" viewBox="0 0 900 1350"><rect width="900" height="1350" fill="#111827"/><text x="70" y="140" fill="#f4c542" font-family="sans-serif" font-size="44">NyaScans preview</text><text x="70" y="240" fill="white" font-family="sans-serif" font-size="34">Original test page ${page} of 3</text><text x="70" y="330" fill="#cbd5e1" font-family="sans-serif" font-size="24">Use this page to test reading, zoom and progress.</text><text x="70" y="380" fill="#cbd5e1" font-family="sans-serif" font-size="24">No manga chapter scans are included.</text><rect x="70" y="450" width="760" height="620" rx="12" fill="#1f2937" stroke="#64748b"/><text x="450" y="830" text-anchor="middle" fill="#f4c542" font-family="sans-serif" font-size="160">${page}</text><text x="70" y="1210" fill="#cbd5e1" font-family="sans-serif" font-size="24">Preview fixture — all community activity is fictional.</text></svg>`;

/** Additive fixtures: stable IDs, no account passwords, no deletion of real data. */
export function previewFixtureStatements(db: D1Database, adminEmails: string[], pageHashes: string[]) {
  const statements: D1PreparedStatement[] = [];
  const add = (sql: string, ...values: Array<string | number | null>) => statements.push(db.prepare(sql).bind(...values));
  const people = ["Hana Mori", "Yuto Kaze", "Mina Hoshino", "Ren Aoki", "Sora Takeda", "Airi Kuro", "Niko Vale", "Lena Park", "Theo Min", "Yuna Sato", "Owen Rei", "Nova Chen"];
  add("INSERT OR IGNORE INTO users (id,email,display_name,primary_role,status) VALUES (?,?,?,'MANAGER','ACTIVE')", manager, `${manager}@fixtures.invalid`, "Preview Publishing Team");
  add("INSERT OR IGNORE INTO user_roles (user_id,role) VALUES (?,'MANAGER')", manager);
  people.forEach((name, index) => {
    const id = `${prefix}-reader-${index}`; const username = `preview-${slugify(name)}`;
    add("INSERT OR IGNORE INTO users (id,email,display_name,primary_role,status) VALUES (?,?,?,'USER','ACTIVE')", id, `${id}@fixtures.invalid`, `${name} · Preview`);
    add("INSERT OR IGNORE INTO user_roles (user_id,role) VALUES (?,'USER')", id);
    add("INSERT OR IGNORE INTO user_profiles (user_id,username,normalized_username,bio,profile_visibility,banner_key) VALUES (?,?,?,?,'PUBLIC',?)", id, username, username, "Fictional preview reader generated from the refreshed MangaDex catalogue; not a MangaDex account.", seriesFixtures[index % seriesFixtures.length].cover);
  });
  ["Crimson Lantern", "Moonrise Atelier", "Paper Crane Works"].forEach((name, index) => {
    const team = `${prefix}-team-${index}`;
    add("INSERT OR IGNORE INTO teams (id,public_ref,slug,name,created_by_user_id,description,logo_key,banner_key,verification_status) VALUES (?,?,?,?,?,?,?,?,'VERIFIED')", team, `TM-PV4924-${index}`, `preview-${slugify(name)}`, `${name} · Preview`, manager, "MangaDex-referenced preview team for upload and analytics testing.", seriesFixtures[index].cover, seriesFixtures[index].cover);
    add("INSERT OR IGNORE INTO team_memberships (team_id,user_id,membership_role,status,can_request_series) VALUES (?,?,'OWNER','ACTIVE',1)", team, manager);
    for (const email of adminEmails) add("INSERT OR IGNORE INTO team_memberships (team_id,user_id,membership_role,status,can_request_series) SELECT ?,id,'LEADER','ACTIVE',1 FROM users WHERE LOWER(email)=? AND status='ACTIVE'", team, email);
  });
  seriesFixtures.forEach((fixture, index) => {
    const sid = `${prefix}-${fixture.id}`; const slug = `preview-${slugify(fixture.title).slice(0,90)}-${index}`;
    const team = `${prefix}-team-${index % 3}`; const chapters = [0, 1, 12, 25, 50, 75, 120, 240, 520][index % 9];
    const paid = index % 3 === 0 && chapters > 4;
    add(`INSERT OR IGNORE INTO series (id,public_ref,slug,title,synopsis,type,status,origin_country,original_language,reading_direction,publication_year,access_type,cover_key,banner_key,slider_key,rating_tenths,follower_count,view_count,rights_status,is_published,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,'RIGHT_TO_LEFT',?,'FREE',?,?,?,?,?,?,'TEST_ORIGINAL',1,datetime('now',?),datetime('now',?))`,
      sid, `SR-PV4924-${index}`, slug, fixture.title,
      `Preview fixture based on MangaDex catalogue metadata. All chapters, reviews, users, prices and activity here are fictional testing data. Source: ${fixture.sourceUrl}`,
      fixture.country === "KR" ? "MANHWA" : fixture.country === "CN" ? "MANHUA" : "MANGA", fixture.status,
      fixture.country, fixture.language, fixture.year, fixture.cover, fixture.cover, fixture.cover, 70 + index % 25, 40 + index * 12, 400 + index * 183, `-${40 + index} days`, `-${index * 7} minutes`);
    add("INSERT OR IGNORE INTO series_external_sources (id,series_id,source,external_id,source_url,response_hash,last_imported_by_user_id) VALUES (?,?,'MANGADEX',?,?,?,?)", `${sid}-source`, sid, fixture.id, fixture.sourceUrl, PREVIEW_FIXTURE_VERSION, manager);
    add("INSERT OR IGNORE INTO series_team_assignments (series_id,team_id,can_upload,can_publish,is_primary,assigned_by_user_id,allowed_languages_json) VALUES (?,?,1,1,1,?,'[\"en\",\"ar\",\"fr\"]')", sid, team, manager);
    fixture.genres.filter(Boolean).forEach((name) => {
      const genre = slugify(name);
      add("INSERT OR IGNORE INTO genres (id,slug,name,normalized_key) VALUES (?,?,?,?)", `${prefix}-genre-${genre}`, genre, name, genre);
      add("INSERT OR IGNORE INTO series_genres (series_id,genre_id) SELECT ?,id FROM genres WHERE slug=? OR name=? LIMIT 1", sid, genre, name);
    });
    fixture.tags.filter(Boolean).forEach((name) => {
      const tag = slugify(name);
      add("INSERT OR IGNORE INTO tags (id,slug,name) VALUES (?,?,?)", `${prefix}-tag-${tag}`, tag, name);
      add("INSERT OR IGNORE INTO series_tags (series_id,tag_id) SELECT ?,id FROM tags WHERE slug=?", sid, tag);
    });
    fixture.creators.forEach((creator) => {
      add("INSERT OR IGNORE INTO creators (id,name,normalized_name) VALUES (?,?,?)", `${prefix}-${creator.id}`, creator.name, creator.name.trim().toLowerCase());
      add("INSERT OR IGNORE INTO series_creators (series_id,creator_id,role) SELECT ?,id,? FROM creators WHERE id=? OR name=? LIMIT 1", sid, creator.role, `${prefix}-${creator.id}`, creator.name);
    });
    if (chapters) {
      add(`WITH RECURSIVE nums(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM nums WHERE n < ?)
        INSERT OR IGNORE INTO chapters (id,public_ref,series_id,team_id,uploader_user_id,slug,chapter_number,title,language,format,state,access_type,price_onyx,page_count,published_at,release_notes,thumbnail_key)
        SELECT ? || '-c' || n, ? || '-' || n, ?, ?, ?, 'chapter-' || n, CAST(n AS TEXT), 'Preview chapter ' || n, 'en', 'VERTICAL', 'PUBLISHED',
          CASE WHEN ?=1 AND n > ?-2 THEN 'PAID' ELSE 'FREE' END, CASE WHEN ?=1 AND n > ?-2 THEN 30 ELSE 0 END,
          3, datetime('now', '-' || (? - n) || ' hours'), 'Original placeholder pages for testing only; no MangaDex scans are imported.', ? FROM nums WHERE NOT EXISTS (SELECT 1 FROM chapters existing WHERE existing.id=? || '-c' || nums.n)`,
        chapters, sid, `CH-PV4924-${index}`, sid, team, manager, paid ? 1 : 0, chapters, paid ? 1 : 0, chapters, chapters, fixture.cover, sid);
      for (let page = 0; page < 3; page++) add("INSERT OR IGNORE INTO chapter_pages (id,chapter_id,page_index,object_key,width,height,sha256,processing_status) SELECT id || ?,id,?,?,900,1350,?,'READY' FROM chapters WHERE series_id=?", `-p${page}`, page, `preview/49.22.25/page-${page + 1}.svg`, pageHashes[page], sid);
    }
    if (index < 5) {
      add("INSERT OR IGNORE INTO homepage_sliders (id,series_id,title,category_label,short_description,destination_url,image_key,is_active,sort_order,created_by_user_id) SELECT ?,?,?,'PREVIEW',?,?,?,CASE WHEN (SELECT COUNT(*) FROM homepage_sliders WHERE is_active=1)<9 THEN 1 ELSE 0 END,?,?", `${sid}-slider`, sid, fixture.title, "MangaDex reference · refreshed preview chapters", `/title/${slug}`, fixture.cover, index + 100, manager);
      add("INSERT OR IGNORE INTO home_pinned_series (id,series_id,display_order,is_featured,created_by_user_id) VALUES (?,?,?,1,?)", `${sid}-pin`, sid, index + 100, manager);
      add("INSERT OR IGNORE INTO editor_picks (id,series_id,category_label,short_description,sort_order,is_published) VALUES (?,?,'Preview',?, ?,1)", `${sid}-pick`, sid, "Sample editorial pick for testing.", index + 100);
    }
    if (paid) {
      add("INSERT OR IGNORE INTO content_discounts (id,target_type,series_id,chapter_id,discount_type,discount_value,original_price,reduced_price,starts_at,ends_at,is_active,created_by_user_id,headline) VALUES (?,'CHAPTER',?,?,'PERCENT',50,30,15,datetime('now','-1 day'),datetime('now','+30 days'),1,?,'PREVIEW OFFER')", `${sid}-sale`, sid, `${sid}-c${chapters}`, manager);
      add("INSERT OR IGNORE INTO content_discounts (id,target_type,series_id,discount_type,discount_value,original_price,reduced_price,starts_at,ends_at,is_active,created_by_user_id,headline) VALUES (?,'SERIES',?,'PERCENT',20,60,48,datetime('now','-10 days'),datetime('now','-1 day'),1,?,'EXPIRED PREVIEW OFFER')", `${sid}-expired-sale`, sid, manager);
    }
    for (let n = 0; n < 3; n++) {
      const uid = `${prefix}-reader-${(index + n) % people.length}`; const cid = `${sid}-comment-${n}`;
      add("INSERT OR IGNORE INTO follows (user_id,series_id) VALUES (?,?)", uid, sid);
      add("INSERT OR IGNORE INTO library_entries (user_id,series_id,list_type) VALUES (?,?,'READING')", uid, sid);
      add("INSERT OR IGNORE INTO reviews (id,user_id,series_id,rating,body,spoiler,moderation_status,created_at) VALUES (?,?,?,?,?,?,'VISIBLE',datetime('now',?))", `${sid}-review-${n}`, uid, sid, 3 + (index + n) % 3, `[Preview review] ${fixture.title}: a sample review for testing card layout, reactions and reading preferences.`, n === 2 ? 1 : 0, `-${index + n} hours`);
      add("INSERT OR IGNORE INTO discussion_comments (id,user_id,series_slug,chapter_slug,body,spoiler,moderation_status,created_at) VALUES (?,?,?,?,?,?,'VISIBLE',datetime('now',?))", cid, uid, slug, n === 1 && chapters ? "chapter-1" : null, "[Preview comment] Testing discussion, replies, reactions, spoilers and text wrapping on this series.", n === 2 ? 1 : 0, `-${index + n} hours`);
      add("INSERT OR IGNORE INTO discussion_comments (id,user_id,series_slug,parent_id,depth,body,moderation_status) VALUES (?,?,?,?,1,'[Preview reply] Thanks! This is a fictional test conversation.','VISIBLE')", `${cid}-reply`, `${prefix}-reader-${(index + n + 1) % people.length}`, slug, cid);
      add("INSERT OR IGNORE INTO discussion_votes (user_id,comment_id,value) VALUES (?,?,1)", `${prefix}-reader-${(index + n + 2) % people.length}`, cid);
      if (chapters) add("INSERT OR IGNORE INTO reading_progress (user_id,chapter_id,page_index,progress_basis_points) VALUES (?,?,1,5000)", uid, `${sid}-c1`);
    }
    add(`WITH RECURSIVE days(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM days WHERE n < 29)
      INSERT OR IGNORE INTO analytics_events (id,session_id,visitor_id,event_type,series_slug,chapter_slug,region_code,created_at)
      SELECT ? || '-' || days.n || '-' || e.kind || '-' || v.n, ? || '-' || days.n || '-' || v.n, ?, e.kind, ?, CASE WHEN e.kind='SERIES_VIEW' THEN NULL ELSE 'chapter-1' END, ?, datetime('now','-' || days.n || ' days')
      FROM days CROSS JOIN (SELECT 'SERIES_VIEW' AS kind UNION ALL SELECT 'CHAPTER_START' UNION ALL SELECT 'CHAPTER_COMPLETE') e
      CROSS JOIN (SELECT 1 AS n UNION ALL SELECT 2 UNION ALL SELECT 3) v WHERE v.n <= 1 + (days.n % 3) AND (? > 0 OR e.kind='SERIES_VIEW')`,
      `${sid}-event`, `${sid}-session`, `${prefix}-reader-${index % people.length}`, slug, fixture.country, chapters);
  });
  add("INSERT OR IGNORE INTO site_announcements (id,type,title,body,link_label,link_url,is_active,starts_at,ends_at,sort_order,created_by_user_id) VALUES (?,'NOTICE','Preview testing catalogue','MangaDex-based series metadata with fictional community activity and original placeholder chapters. No real purchases or manga scans are included.','Explore sample series','/browse',1,datetime('now'),datetime('now','+30 days'),0,?)", `${prefix}-announcement`, manager);
  const settings = { ...defaultCommercialSettings, economy: { ...defaultCommercialSettings.economy, premiumEconomyPublic: true } };
  add("INSERT OR IGNORE INTO commercial_settings (id,schema_version,settings_json,revision) VALUES ('active',3,?,1)", JSON.stringify(settings));
  add("UPDATE commercial_settings SET settings_json=json_set(settings_json,'$.economy.premiumEconomyPublic',json('true')),revision=MAX(1,revision+1) WHERE id='active' AND json_valid(settings_json) AND COALESCE(json_extract(settings_json,'$.economy.premiumEconomyPublic'),0)<>1");
  add("UPDATE feature_flags SET enabled=1 WHERE key IN ('payments','premium_unlocks','public_comments')");
  return statements;
}

type PreviewEnv = { DB?: D1Database; BUCKET?: R2Bucket; NYASCANS_PREVIEW_FIXTURES?: string; NYASCANS_ADMIN_EMAILS?: string };
let initialization: Promise<void> | null = null;
export async function ensurePreviewFixtures(env: PreviewEnv) {
  if (env.NYASCANS_PREVIEW_FIXTURES !== PREVIEW_FIXTURE_VERSION || !env.DB || !env.BUCKET) return;
  if (initialization) return initialization;
  const db = env.DB; const bucket = env.BUCKET;
  initialization = (async () => {
    if (await db.prepare("SELECT id FROM preview_fixture_runs WHERE id=?").bind(PREVIEW_FIXTURE_VERSION).first()) return;
    const hashes: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const content = previewPageSvg(page);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
      hashes.push(Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2,"0")).join(""));
      await bucket.put(`preview/49.22.25/page-${page}.svg`, content, { httpMetadata: { contentType: "image/svg+xml" } });
    }
    const emails = (env.NYASCANS_ADMIN_EMAILS ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
    const statements = previewFixtureStatements(db, emails, hashes);
    for (let offset = 0; offset < statements.length; offset += 40) await db.batch(statements.slice(offset, offset + 40));
    await db.prepare("INSERT OR IGNORE INTO preview_fixture_runs (id) VALUES (?)").bind(PREVIEW_FIXTURE_VERSION).run();
  })().catch((error) => { initialization = null; throw error; });
  return initialization;
}
