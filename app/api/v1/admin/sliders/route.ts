import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  assertSameOrigin,
  auditStatement,
  requestIdFor,
} from "@/lib/server/admin-utils";
import { requireActor, requireAdminCapability } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";
import { preferredSeriesArtworkUrl } from "@/lib/server/series-media-url";

export const dynamic = "force-dynamic";

const sliderFields = z.object({
  title: z.string().trim().min(2).max(140),
  seriesId: z.string().trim().min(3).max(160).nullable().default(null),
  categoryLabel: z.string().trim().max(60).default("Featured"),
  shortDescription: z.string().trim().max(320).default(""),
  destinationUrl: z
    .string()
    .trim()
    .max(600)
    .refine((value) => !value || value.startsWith("/"), "Use a site-relative URL."),
});

const createSchema = sliderFields.extend({
  isActive: z.boolean().default(false),
  replaceActiveId: z.string().trim().min(3).max(160).nullable().default(null),
});

const updateSchema = sliderFields.partial().extend({
  id: z.string().trim().min(3).max(160),
  revision: z.coerce.number().int().min(1),
  isActive: z.boolean().optional(),
  replaceActiveId: z.string().trim().min(3).max(160).nullable().optional(),
});

function database() {
  if (!env.DB) {
    throw new ApiError(503, "DATABASE_UNAVAILABLE", "Slider controls are unavailable.");
  }
  return env.DB;
}

async function listSliders() {
  const db = database();
  const [sliders, series] = await Promise.all([
    db.prepare(
      `SELECT hs.id, hs.series_id AS seriesId, hs.title,
              hs.category_label AS categoryLabel,
              hs.short_description AS shortDescription,
              hs.destination_url AS destinationUrl,
              hs.image_key AS imageKey, hs.is_active AS isActive,
              hs.sort_order AS sortOrder, hs.revision,
              hs.created_at AS createdAt, hs.updated_at AS updatedAt,
              s.slug AS seriesSlug, s.cover_key AS coverKey,
              s.banner_key AS bannerKey, s.slider_key AS seriesSliderKey
         FROM homepage_sliders hs
         LEFT JOIN series s ON s.id = hs.series_id
        ORDER BY datetime(hs.created_at) DESC, hs.id DESC`,
    ).all(),
    db.prepare(
      `SELECT id, slug, title, cover_key AS coverKey,
              banner_key AS bannerKey, slider_key AS sliderKey
         FROM series
        WHERE archived_at IS NULL
        ORDER BY title COLLATE NOCASE`,
    ).all(),
  ]);
  return {
    sliders: sliders.results.map((record) => {
      const row = record as Record<string, unknown>;
      const revision = Number(row.revision ?? 1);
      const imageUrl = row.imageKey
        ? `/api/v1/homepage-slider-media?id=${encodeURIComponent(String(row.id))}&v=${revision}`
        : row.seriesId
          ? preferredSeriesArtworkUrl(String(row.seriesId), revision, [
              ["slider", row.seriesSliderKey],
              ["cover", row.coverKey],
              ["banner", row.bannerKey],
            ])
          : null;
      return { ...row, isActive: Boolean(row.isActive), imageUrl };
    }),
    series: series.results.map((record) => {
      const row = record as Record<string, unknown>;
      return {
        ...row,
        imageUrl: preferredSeriesArtworkUrl(String(row.id), undefined, [
          ["slider", row.sliderKey],
          ["cover", row.coverKey],
          ["banner", row.bannerKey],
        ]),
      };
    }),
  };
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    requireAdminCapability(actor, "content.sliders.manage");
    return json(requestId, await listSliders(), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireAdminCapability(actor, "content.sliders.manage");
    const db = database();
    const payload = createSchema.parse(await request.json());
    if (payload.seriesId) {
      const exists = await db.prepare(
        "SELECT id FROM series WHERE id = ? AND archived_at IS NULL LIMIT 1",
      ).bind(payload.seriesId).first();
      if (!exists) throw new ApiError(404, "SERIES_NOT_FOUND", "Select an available series.");
    }
    const active = await db.prepare(
      "SELECT COUNT(*) AS count FROM homepage_sliders WHERE is_active = 1",
    ).first<{ count: number }>();
    const needsReplacement = payload.isActive && Number(active?.count ?? 0) >= 9;
    if (needsReplacement && !payload.replaceActiveId) {
      throw new ApiError(409, "SLIDER_LIMIT_REACHED", "Nine public sliders are already active.", [], {
        activeLimit: 9,
      });
    }
    if (payload.replaceActiveId) {
      const replacement = await db.prepare(
        "SELECT id FROM homepage_sliders WHERE id = ? AND is_active = 1 LIMIT 1",
      ).bind(payload.replaceActiveId).first();
      if (!replacement) throw new ApiError(409, "REPLACEMENT_REQUIRED", "Choose one active slider to replace.");
    }
    const id = `slider_${randomId()}`;
    const order = await db.prepare(
      "SELECT COALESCE(MAX(sort_order), 0) + 1 AS nextOrder FROM homepage_sliders",
    ).first<{ nextOrder: number }>();
    const statements = [];
    if (payload.replaceActiveId) {
      statements.push(db.prepare(
        "UPDATE homepage_sliders SET is_active = 0, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND is_active = 1",
      ).bind(payload.replaceActiveId));
    }
    statements.push(
      db.prepare(
        `INSERT INTO homepage_sliders
         (id, series_id, title, category_label, short_description,
          destination_url, is_active, sort_order, created_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        payload.seriesId,
        payload.title,
        payload.categoryLabel,
        payload.shortDescription,
        payload.destinationUrl || "",
        payload.isActive ? 1 : 0,
        Number(order?.nextOrder ?? 1),
        actor.id,
      ),
      auditStatement(db, actor, requestId, {
        action: "homepage.slider.create",
        category: "APPEARANCE_SETTINGS",
        sourceArea: "SLIDERS",
        targetType: "HOMEPAGE_SLIDER",
        targetId: id,
        targetLabel: payload.title,
        metadata: { active: payload.isActive, replaced: payload.replaceActiveId },
      }),
    );
    await db.batch(statements);
    return json(requestId, { ...(await listSliders()), createdId: id }, { status: 201 });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function PATCH(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireAdminCapability(actor, "content.sliders.manage");
    const db = database();
    const payload = updateSchema.parse(await request.json());
    const current = await db.prepare(
      "SELECT * FROM homepage_sliders WHERE id = ? LIMIT 1",
    ).bind(payload.id).first<Record<string, unknown>>();
    if (!current) throw new ApiError(404, "SLIDER_NOT_FOUND", "This slider no longer exists.");
    if (Number(current.revision) !== payload.revision) throw new ApiError(409, "STALE_VERSION", "Another administrator changed this slider. Reload and try again.");
    const activating = payload.isActive === true && !Boolean(current.is_active);
    if (activating) {
      const active = await db.prepare(
        "SELECT COUNT(*) AS count FROM homepage_sliders WHERE is_active = 1",
      ).first<{ count: number }>();
      if (Number(active?.count ?? 0) >= 9 && !payload.replaceActiveId) {
        throw new ApiError(409, "SLIDER_LIMIT_REACHED", "Nine public sliders are already active.", [], { activeLimit: 9 });
      }
    }
    if (payload.replaceActiveId === payload.id) {
      throw new ApiError(422, "REPLACEMENT_INVALID", "Choose another active slider to replace.");
    }
    const statements = [];
    if (payload.replaceActiveId) {
      const replacement = await db.prepare(
        "SELECT id FROM homepage_sliders WHERE id = ? AND is_active = 1 LIMIT 1",
      ).bind(payload.replaceActiveId).first();
      if (!replacement) throw new ApiError(409, "REPLACEMENT_REQUIRED", "Choose one active slider to replace.");
      statements.push(db.prepare(
        "UPDATE homepage_sliders SET is_active = 0, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND is_active = 1",
      ).bind(payload.replaceActiveId));
    }
    statements.push(
      db.prepare(
        `UPDATE homepage_sliders
            SET title = ?, series_id = ?, category_label = ?,
                short_description = ?, destination_url = ?, is_active = ?,
                revision = revision + 1, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND revision = ?`,
      ).bind(
        payload.title ?? current.title,
        payload.seriesId === undefined ? current.series_id : payload.seriesId,
        payload.categoryLabel ?? current.category_label,
        payload.shortDescription ?? current.short_description,
        payload.destinationUrl ?? current.destination_url,
        payload.isActive === undefined ? current.is_active : payload.isActive ? 1 : 0,
        payload.id,
        payload.revision,
      ),
      auditStatement(db, actor, requestId, {
        action: "homepage.slider.update",
        category: "APPEARANCE_SETTINGS",
        sourceArea: "SLIDERS",
        targetType: "HOMEPAGE_SLIDER",
        targetId: payload.id,
        targetLabel: String(payload.title ?? current.title),
        metadata: { active: payload.isActive, replaced: payload.replaceActiveId },
      }, "changes() = 1"),
    );
    const results = await db.batch(statements);
    const updateResult = results[payload.replaceActiveId ? 1 : 0];
    if (!updateResult?.meta.changes) throw new ApiError(409, "STALE_VERSION", "Another administrator changed this slider. Reload and try again.");
    return json(requestId, await listSliders());
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function DELETE(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireAdminCapability(actor, "content.sliders.manage");
    const db = database();
    const payload = z.object({
      id: z.string().trim().min(3).max(160),
      revision: z.coerce.number().int().min(1),
    }).parse(await request.json());
    const result = await db.prepare(
      "DELETE FROM homepage_sliders WHERE id = ? AND revision = ?",
    ).bind(payload.id, payload.revision).run();
    if (!result.meta.changes) throw new ApiError(409, "STALE_VERSION", "This slider changed or was already removed.");
    await auditStatement(db, actor, requestId, {
      action: "homepage.slider.delete",
      category: "APPEARANCE_SETTINGS",
      sourceArea: "SLIDERS",
      targetType: "HOMEPAGE_SLIDER",
      targetId: payload.id,
    }).run();
    return json(requestId, { ok: true });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
