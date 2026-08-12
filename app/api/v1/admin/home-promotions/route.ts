import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { assertSameOrigin, auditStatement, requestIdFor } from "@/lib/server/admin-utils";
import { requireActor, requireAdminCapability } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";

export const dynamic = "force-dynamic";

const linkSchema = z.string().trim().max(600).refine(
  (value) => !value || (value.startsWith("/") && !value.startsWith("//")) || /^https:\/\//i.test(value),
  "Use a secure link or a site-relative path.",
);

const timestampSchema = z.string().trim().max(40).nullable().default(null)
  .refine((value) => !value || !Number.isNaN(Date.parse(value)), "Use a valid date and time.")
  .transform((value) => value ? new Date(value).toISOString() : null);

const campaignColorSchema = z.string().trim().regex(
  /^#[0-9a-f]{6}$/i,
  "Use a six-digit hexadecimal color.",
);

const announcementSchema = z.object({
  type: z.enum(["UPDATE", "ISSUE", "SUPPORT", "NOTICE"]),
  title: z.string().trim().min(2).max(120),
  body: z.string().trim().min(2).max(1_000),
  linkLabel: z.string().trim().max(60).default(""),
  linkUrl: linkSchema.default(""),
  isActive: z.boolean().default(true),
  startsAt: timestampSchema,
  endsAt: timestampSchema,
}).superRefine((value, context) => {
  if (value.startsAt && value.endsAt && Date.parse(value.endsAt) <= Date.parse(value.startsAt)) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "End time must be later than start time." });
  }
});

const adSchema = z.object({
  id: z.string().trim().min(3).max(160).optional(),
  revision: z.coerce.number().int().min(1).optional(),
  eyebrow: z.string().trim().max(80).default("Support NyaScans"),
  title: z.string().trim().min(2).max(140),
  body: z.string().trim().max(500).default(""),
  actionLabel: z.string().trim().min(1).max(60).default("Explore event"),
  infoBlocks: z.array(z.object({
    icon: z.string().trim().min(1).max(16),
    title: z.string().trim().min(1).max(60),
    body: z.string().trim().max(140).default(""),
  })).max(4).default([]),
  destinationUrl: linkSchema.default(""),
  fallbackImageUrl: linkSchema.default(""),
  effect: z.enum(["WAVE", "PULSE", "GLOW"]).default("WAVE"),
  displaySlot: z.coerce.number().int().min(1).max(2).default(1),
  primaryColor: campaignColorSchema.default("#65B5FF"),
  secondaryColor: campaignColorSchema.default("#8B5CF6"),
  backgroundColor: campaignColorSchema.default("#07111C"),
  isActive: z.boolean().default(false),
  startsAt: timestampSchema,
  endsAt: timestampSchema,
  resetAudience: z.boolean().default(false),
}).superRefine((value, context) => {
  if (value.startsAt && Number.isNaN(Date.parse(value.startsAt))) {
    context.addIssue({ code: "custom", path: ["startsAt"], message: "Use a valid start date." });
  }
  if (value.endsAt && Number.isNaN(Date.parse(value.endsAt))) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "Use a valid end date." });
  }
  if (value.startsAt && value.endsAt && Date.parse(value.endsAt) <= Date.parse(value.startsAt)) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "End time must be later than start time." });
  }
});

function database() {
  if (!env.DB) throw new ApiError(503, "DATABASE_UNAVAILABLE", "Promotion controls are unavailable.");
  return env.DB;
}

async function readAll() {
  const db = database();
  const [announcements, ads] = await Promise.all([
    db.prepare(
      `SELECT id, type, title, body, link_label AS linkLabel,
              link_url AS linkUrl, is_active AS isActive,
              starts_at AS startsAt, ends_at AS endsAt,
              sort_order AS sortOrder, revision,
              created_at AS createdAt, updated_at AS updatedAt
         FROM site_announcements
        ORDER BY datetime(created_at) DESC`,
    ).all<Record<string, unknown>>(),
    db.prepare(
      `SELECT id, eyebrow, title, body, action_label AS actionLabel,
              info_blocks_json AS infoBlocksJson, destination_url AS destinationUrl,
              image_key AS imageKey, fallback_image_url AS fallbackImageUrl,
              effect, display_slot AS displaySlot,
              primary_color AS primaryColor,
              secondary_color AS secondaryColor,
              background_color AS backgroundColor,
              is_active AS isActive, reset_key AS resetKey,
              starts_at AS startsAt, ends_at AS endsAt,
              revision, created_at AS createdAt, updated_at AS updatedAt
         FROM floating_ads
        ORDER BY display_slot, datetime(updated_at) DESC`,
    ).all<Record<string, unknown>>(),
  ]);
  return {
    announcements: announcements.results.map((row) => ({ ...row, isActive: Boolean(row.isActive) })),
    ads: ads.results.map((row) => ({
      ...row,
      isActive: Boolean(row.isActive),
      infoBlocks: (() => {
        try { return JSON.parse(String(row.infoBlocksJson ?? "[]")); }
        catch { return []; }
      })(),
      imageUrl: row.imageKey ? `/api/v1/floating-ad-media?id=${encodeURIComponent(String(row.id))}&v=${Number(row.revision)}` : row.fallbackImageUrl || null,
    })),
  };
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    requireAdminCapability(actor, "announcements.manage");
    return json(requestId, await readAll(), { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireAdminCapability(actor, "announcements.manage");
    const db = database();
    const raw = await request.json() as Record<string, unknown>;
    const action = z.enum(["CREATE_ANNOUNCEMENT", "SAVE_ANNOUNCEMENT", "DELETE_ANNOUNCEMENT", "SAVE_AD", "DELETE_AD"]).parse(raw.action);
    let savedAdId: string | null = null;
    if (action === "CREATE_ANNOUNCEMENT") {
      const data = announcementSchema.parse(raw.data);
      const id = `announcement_${randomId()}`;
      const order = await db.prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS nextOrder FROM site_announcements").first<{ nextOrder: number }>();
      await db.batch([
        db.prepare(
          `INSERT INTO site_announcements
           (id, type, title, body, link_label, link_url, is_active,
            starts_at, ends_at, sort_order, created_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(id, data.type, data.title, data.body, data.linkLabel, data.linkUrl, data.isActive ? 1 : 0, data.startsAt || null, data.endsAt || null, Number(order?.nextOrder ?? 1), actor.id),
        auditStatement(db, actor, requestId, { action: "announcement.create", category: "APPEARANCE_SETTINGS", sourceArea: "HOME_PROMOTIONS", targetType: "ANNOUNCEMENT", targetId: id, targetLabel: data.title }),
      ]);
    } else if (action === "SAVE_ANNOUNCEMENT") {
      const id = z.string().trim().min(3).max(160).parse(raw.id);
      const revision = z.coerce.number().int().min(1).parse(raw.revision);
      const data = announcementSchema.parse(raw.data);
      const result = await db.prepare(
        `UPDATE site_announcements
            SET type = ?, title = ?, body = ?, link_label = ?, link_url = ?,
                is_active = ?, starts_at = ?, ends_at = ?,
                revision = revision + 1, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND revision = ?`,
      ).bind(data.type, data.title, data.body, data.linkLabel, data.linkUrl, data.isActive ? 1 : 0, data.startsAt || null, data.endsAt || null, id, revision).run();
      if (!result.meta.changes) throw new ApiError(409, "STALE_VERSION", "This announcement changed. Reload and try again.");
    } else if (action === "DELETE_ANNOUNCEMENT") {
      const id = z.string().trim().min(3).max(160).parse(raw.id);
      const revision = z.coerce.number().int().min(1).parse(raw.revision);
      const result = await db.prepare("DELETE FROM site_announcements WHERE id = ? AND revision = ?").bind(id, revision).run();
      if (!result.meta.changes) throw new ApiError(409, "STALE_VERSION", "This announcement changed or was removed.");
    } else if (action === "SAVE_AD") {
      const data = adSchema.parse(raw.data);
      const id = data.id ?? `floating_ad_${randomId()}`;
      savedAdId = id;
      const operationTimestamp = new Date().toISOString();
      if (data.id) {
        const update = db.prepare(
          `UPDATE floating_ads SET eyebrow = ?, title = ?, body = ?,
                  action_label = ?, info_blocks_json = ?,
                  destination_url = ?, fallback_image_url = ?, effect = ?,
                  display_slot = ?, primary_color = ?, secondary_color = ?,
                  background_color = ?, is_active = 0,
                  reset_key = CASE WHEN ? THEN ? ELSE reset_key END,
                  starts_at = ?, ends_at = ?,
                  revision = revision + 1, updated_at = ?
            WHERE id = ? AND revision = ?`,
        ).bind(data.eyebrow, data.title, data.body, data.actionLabel,
          JSON.stringify(data.infoBlocks), data.destinationUrl,
          data.fallbackImageUrl, data.effect, data.displaySlot,
          data.primaryColor, data.secondaryColor, data.backgroundColor,
          data.resetAudience ? 1 : 0, randomId(), data.startsAt || null,
          data.endsAt || null, operationTimestamp, id, data.revision);
        const results = await db.batch([
          update,
          ...(data.isActive ? [
            db.prepare(
              `UPDATE floating_ads
                  SET is_active = 0, revision = revision + 1,
                      updated_at = CURRENT_TIMESTAMP
                WHERE id <> ? AND display_slot = ? AND is_active = 1
                  AND EXISTS (
                    SELECT 1 FROM floating_ads target
                     WHERE target.id = ? AND target.revision = ?
                       AND target.updated_at = ?
                  )`,
            ).bind(id, data.displaySlot, id, Number(data.revision) + 1, operationTimestamp),
            db.prepare(
              `UPDATE floating_ads
                  SET is_active = 1
                WHERE id = ? AND revision = ? AND updated_at = ?`,
            ).bind(id, Number(data.revision) + 1, operationTimestamp),
          ] : []),
          auditStatement(db, actor, requestId, {
            action: "campaign.update",
            category: "APPEARANCE_SETTINGS",
            sourceArea: "HOME_PROMOTIONS",
            targetType: "FLOATING_AD",
            targetId: id,
            targetLabel: data.title,
          }, "changes() = 1"),
        ]);
        if (!results[0]?.meta.changes) throw new ApiError(409, "STALE_VERSION", "This floating ad changed. Reload and try again.");
      } else {
        await db.batch([db.prepare(
          `INSERT INTO floating_ads
           (id, eyebrow, title, body, action_label, info_blocks_json,
            destination_url, fallback_image_url, effect, display_slot,
            primary_color, secondary_color, background_color,
            is_active, reset_key,
            starts_at, ends_at, created_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        ).bind(id, data.eyebrow, data.title, data.body, data.actionLabel,
          JSON.stringify(data.infoBlocks), data.destinationUrl,
          data.fallbackImageUrl, data.effect, data.displaySlot,
          data.primaryColor, data.secondaryColor, data.backgroundColor,
          randomId(), data.startsAt || null, data.endsAt || null, actor.id),
          ...(data.isActive ? [
            db.prepare(
              `UPDATE floating_ads
                  SET is_active = 0, revision = revision + 1,
                      updated_at = CURRENT_TIMESTAMP
                WHERE id <> ? AND display_slot = ? AND is_active = 1
                  AND EXISTS (SELECT 1 FROM floating_ads target WHERE target.id = ?)`,
            ).bind(id, data.displaySlot, id),
            db.prepare("UPDATE floating_ads SET is_active = 1 WHERE id = ?").bind(id),
          ] : []),
          auditStatement(db, actor, requestId, {
            action: "campaign.create",
            category: "APPEARANCE_SETTINGS",
            sourceArea: "HOME_PROMOTIONS",
            targetType: "FLOATING_AD",
            targetId: id,
            targetLabel: data.title,
          }, "changes() = 1"),
        ]);
      }
    } else {
      const id = z.string().trim().min(3).max(160).parse(raw.id);
      const revision = z.coerce.number().int().min(1).parse(raw.revision);
      const result = await db.prepare("DELETE FROM floating_ads WHERE id = ? AND revision = ?").bind(id, revision).run();
      if (!result.meta.changes) throw new ApiError(409, "STALE_VERSION", "This floating ad changed or was removed.");
    }
    return json(requestId, { ...(await readAll()), savedAdId });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
