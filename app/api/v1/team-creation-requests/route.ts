import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { assertSameOrigin, auditStatement, requestIdFor, sha256Hex, validateImageFile } from "@/lib/server/admin-utils";
import { requireActor } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";
import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

const linkSchema = z.object({
  platform: z.string().trim().min(1).max(40),
  url: z.string().trim().url().max(600).refine((value) => value.startsWith("https://"), "External links must use HTTPS."),
});
const createSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().min(20).max(2_000),
  websiteUrl: z.string().trim().url().max(600).refine((value) => value.startsWith("https://"), "Website links must use HTTPS.").nullable().optional(),
  discordUrl: z.string().trim().url().max(600).refine((value) => value.startsWith("https://"), "Discord links must use HTTPS.").nullable().optional(),
  externalLinks: z.array(linkSchema).max(12).default([]),
  memberEmails: z.array(z.string().trim().email().max(320)).max(25).default([]),
  reason: z.string().trim().min(20).max(1_000),
});

function database() {
  if (!env.DB) throw new ApiError(503, "DATABASE_UNAVAILABLE", "Team creation requests are unavailable.");
  return env.DB;
}

function parseJsonArray<T>(value: unknown, fallback: T[] = []) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch { return fallback; }
}

function extensionFor(contentType: string) {
  return { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[contentType] ?? "bin";
}

async function storeRequestImage(file: File, kind: "logo" | "banner", actorId: string, requestId: string) {
  if (!env.BUCKET) throw new ApiError(503, "MEDIA_UNAVAILABLE", "Team media uploads are temporarily unavailable.");
  const rules = kind === "logo"
    ? { label: "team logo", maxBytes: 8_000_000, minWidth: 128, minHeight: 128, maxWidth: 4096, maxHeight: 4096, maxPixels: 16_000_000, allowAnimation: false, allowedTypes: new Set(["image/jpeg", "image/png", "image/webp"]) }
    : { label: "team banner", maxBytes: 16_000_000, minWidth: 640, minHeight: 360, maxWidth: 8192, maxHeight: 8192, maxPixels: 40_000_000, allowAnimation: false, allowedTypes: new Set(["image/jpeg", "image/png", "image/webp"]) };
  const image = await validateImageFile(file, rules);
  if (kind === "logo" && image.dimensions.width !== image.dimensions.height) {
    throw new ApiError(422, "TEAM_LOGO_SQUARE_REQUIRED", "Team logos must be square.");
  }
  if (kind === "banner" && image.dimensions.width / image.dimensions.height < 16 / 9) {
    throw new ApiError(422, "TEAM_BANNER_ASPECT_REQUIRED", "Team banners must be at least 16:9.");
  }
  const digest = await sha256Hex(image.bytes);
  const objectKey = `private/team-creation-requests/${actorId}/${requestId}/${kind}-${digest.slice(0, 32)}.${extensionFor(image.contentType)}`;
  await env.BUCKET.put(objectKey, image.bytes, {
    httpMetadata: { contentType: image.contentType },
    customMetadata: { actorId, requestId, kind, sha256: digest, width: String(image.dimensions.width), height: String(image.dimensions.height) },
  });
  return objectKey;
}

async function snapshot(actorId: string) {
  const result = await database().prepare(
    `SELECT id, name, slug, description, website_url AS websiteUrl,
            discord_url AS discordUrl, logo_key AS logoKey, banner_key AS bannerKey,
            external_links_json AS externalLinksJson, member_emails_json AS memberEmailsJson,
            reason, status, review_reason AS reviewReason, revision,
            created_at AS createdAt, reviewed_at AS reviewedAt
       FROM team_creation_requests
      WHERE requested_by_user_id = ?
      ORDER BY CASE status WHEN 'PENDING' THEN 0 ELSE 1 END,
               datetime(created_at) DESC`,
  ).bind(actorId).all<Record<string, unknown>>();
  return {
    requests: (result.results ?? []).map((row) => ({
      ...row,
      externalLinks: parseJsonArray(row.externalLinksJson),
      memberEmails: parseJsonArray(row.memberEmailsJson),
      logoUrl: row.logoKey ? `/api/v1/team-creation-request-media?id=${encodeURIComponent(String(row.id))}&slot=logo` : null,
      bannerUrl: row.bannerKey ? `/api/v1/team-creation-request-media?id=${encodeURIComponent(String(row.id))}&slot=banner` : null,
    })),
  };
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    if (!actor.canUseUploadCenter) throw new ApiError(403, "UPLOAD_CENTER_REQUIRED", "Upload Center access is required to request a team.");
    const url = new URL(request.url);
    const lookupEmail = url.searchParams.get("lookupEmail")?.trim().toLowerCase();
    if (lookupEmail) {
      const profile = await database().prepare(
        `SELECT u.id, u.email, u.display_name AS displayName,
                up.username, up.revision,
                CASE WHEN up.avatar_key IS NULL THEN NULL ELSE '/api/v1/profile-media?username=' || up.username || '&slot=avatar&v=' || up.revision END AS avatarUrl
           FROM users u JOIN user_profiles up ON up.user_id = u.id
          WHERE lower(u.email) = ? AND u.status = 'ACTIVE' LIMIT 1`,
      ).bind(lookupEmail).first<Record<string, unknown>>();
      return json(requestId, { data: { member: profile ?? null } }, { headers: { "cache-control": "private, no-store" } });
    }
    return json(requestId, { data: await snapshot(actor.id) }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(requestId, error); }
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  let logoKey: string | null = null;
  let bannerKey: string | null = null;
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    if (!actor.canUseUploadCenter) throw new ApiError(403, "UPLOAD_CENTER_REQUIRED", "Upload Center access is required to request a team.");
    const form = await request.formData();
    const payload = createSchema.parse({
      name: form.get("name"),
      description: form.get("description"),
      websiteUrl: String(form.get("websiteUrl") ?? "").trim() || null,
      discordUrl: String(form.get("discordUrl") ?? "").trim() || null,
      externalLinks: parseJsonArray(form.get("externalLinks")),
      memberEmails: [...new Set(parseJsonArray<string>(form.get("memberEmails")).map((email) => email.trim().toLowerCase()))],
      reason: form.get("reason"),
    });
    const logo = form.get("logo");
    const banner = form.get("banner");
    if (!(logo instanceof File)) throw new ApiError(422, "TEAM_LOGO_REQUIRED", "Upload a square team logo before sending the request.");
    if (!(banner instanceof File)) throw new ApiError(422, "TEAM_BANNER_REQUIRED", "Upload a 16:9-or-wider team banner before sending the request.");
    const db = database();
    const duplicate = await db.prepare(
      `SELECT id FROM team_creation_requests
        WHERE requested_by_user_id = ? AND status = 'PENDING'
          AND lower(name) = lower(?) LIMIT 1`,
    ).bind(actor.id, payload.name).first<{ id: string }>();
    if (duplicate) throw new ApiError(409, "TEAM_CREATION_REQUEST_EXISTS", "You already have a pending request for a team with this name.");
    const id = `team_create_${randomId()}`;
    const slug = payload.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72) || `team-${randomId().slice(0, 8)}`;
    logoKey = await storeRequestImage(logo, "logo", actor.id, id);
    bannerKey = await storeRequestImage(banner, "banner", actor.id, id);
    await db.batch([
      db.prepare(
        `INSERT INTO team_creation_requests
         (id, requested_by_user_id, name, slug, description, website_url, discord_url,
          logo_key, banner_key, external_links_json, member_emails_json, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, actor.id, payload.name, slug, payload.description, payload.websiteUrl ?? null, payload.discordUrl ?? null, logoKey, bannerKey, JSON.stringify(payload.externalLinks), JSON.stringify(payload.memberEmails), payload.reason),
      auditStatement(db, actor, requestId, {
        action: "team.creation.request",
        category: "TEAMS_PERMISSIONS",
        sourceArea: "UPLOAD_CENTER",
        targetType: "TEAM_CREATION_REQUEST",
        targetId: id,
        targetLabel: payload.name,
        reason: "New team submitted for administrator review",
        metadata: { externalLinkCount: payload.externalLinks.length, memberCount: payload.memberEmails.length, hasLogo: true, hasBanner: true },
      }),
    ]);
    return json(requestId, { data: await snapshot(actor.id) }, { status: 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(requestId, error); }
}
