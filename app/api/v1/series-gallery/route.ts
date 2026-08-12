import { env } from "cloudflare:workers";
import { z } from "zod";
import {
  assertSameOrigin,
  auditStatement,
  deleteMediaObject,
  requestIdFor,
  sha256Hex,
  validateImageFile,
} from "@/lib/server/admin-utils";
import { languageCodeSchema } from "@/lib/admin-metadata";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { getActor, requireActor, type Actor } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";
import { publicPaidSeriesPredicate } from "@/lib/server/public-content-visibility";

export const dynamic = "force-dynamic";

const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const submissionSchema = z.object({
  seriesSlug: slugSchema,
  kind: z.enum(["ART", "COVER"]),
  orientation: z.enum(["LANDSCAPE", "PORTRAIT"]),
  caption: z.string().trim().max(180).default(""),
  altText: z.string().trim().max(240).default(""),
  language: z.union([z.literal(""), languageCodeSchema]).default(""),
  coverType: z
    .union([z.literal(""), z.enum(["OFFICIAL", "FAN_MADE"])])
    .default(""),
  volume: z.string().trim().max(32).default(""),
  teamId: z.string().trim().max(120).default(""),
}).superRefine((payload, context) => {
  if (payload.kind !== "COVER") return;
  if (!payload.language) {
    context.addIssue({
      code: "custom",
      path: ["language"],
      message: "Choose the cover language.",
    });
  }
  if (!payload.coverType) {
    context.addIssue({
      code: "custom",
      path: ["coverType"],
      message: "Choose whether this is an official or fan-made cover.",
    });
  }
});

function actorRoles(actor: Actor | null) {
  return new Set(actor ? [actor.primaryRole, ...(actor.roles ?? [])] : []);
}

function canSubmitCover(actor: Actor | null) {
  if (!actor) return false;
  const roles = actorRoles(actor);
  return (
    roles.has("OWNER") ||
    roles.has("ADMINISTRATOR") ||
    roles.has("MANAGER") ||
    roles.has("TEAM_LEADER") ||
    roles.has("UPLOADER")
  );
}

function canPublishGalleryDirectly(actor: Actor) {
  const roles = actorRoles(actor);
  return (
    roles.has("OWNER") ||
    roles.has("ADMINISTRATOR") ||
    roles.has("MANAGER") ||
    roles.has("TEAM_LEADER")
  );
}

function extension(contentType: string) {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/png") return "png";
  return "webp";
}

async function requireVerifiedTeamMembership(
  db: D1Database,
  actor: Actor,
  teamId: string,
) {
  const membership = await db
    .prepare(
      `SELECT t.id, t.name
         FROM teams t
         JOIN team_memberships tm
           ON tm.team_id = t.id
          AND tm.user_id = ?
        WHERE t.id = ?
          AND t.is_archived = 0
          AND t.verification_status = 'VERIFIED'
          AND tm.status = 'ACTIVE'
          AND UPPER(tm.membership_role) IN
            ('OWNER', 'LEADER', 'TEAM_LEADER', 'MANAGER', 'UPLOADER')
        LIMIT 1`,
    )
    .bind(actor.id, teamId)
    .first<{ id: string; name: string }>();
  if (!membership) {
    throw new ApiError(
      403,
      "VERIFIED_TEAM_MEMBERSHIP_REQUIRED",
      "Choose a verified team where you are an active publishing member.",
    );
  }
  return membership;
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    if (!env.DB) {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "Series galleries are temporarily unavailable.",
      );
    }
    const url = new URL(request.url);
    const slug = slugSchema.parse(url.searchParams.get("series") ?? "");
    const actor = await getActor();
    const series = await env.DB.prepare(
      `SELECT id, slug, title, original_language AS originalLanguage,
              cover_key AS coverKey, revision
         FROM series s
        WHERE s.slug = ?
          AND s.is_published = 1
          AND s.archived_at IS NULL
          AND s.status NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
          AND s.rights_status IN
            ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
          AND ${publicPaidSeriesPredicate("s")}
        LIMIT 1`,
    )
      .bind(slug)
      .first<{
        id: string;
        slug: string;
        title: string;
        originalLanguage: string;
        coverKey: string | null;
        revision: number;
      }>();
    if (!series) {
      throw new ApiError(
        404,
        "SERIES_NOT_FOUND",
        "This series is not available.",
      );
    }
    const approved = await env.DB.prepare(
      `SELECT sga.id, sga.kind, sga.orientation, sga.caption,
              sga.alt_text AS altText, sga.language, sga.cover_type AS coverType,
              sga.volume,
              sga.width, sga.height, sga.revision,
              sga.created_at AS createdAt,
              u.display_name AS submittedBy,
              t.name AS teamName
         FROM series_gallery_assets sga
         JOIN users u ON u.id = sga.submitted_by_user_id
         LEFT JOIN teams t ON t.id = sga.submitter_team_id
        WHERE sga.series_id = ?
          AND sga.moderation_status = 'APPROVED'
        ORDER BY sga.kind, sga.display_order, sga.created_at DESC, sga.id
        LIMIT 300`,
    )
      .bind(series.id)
      .all<Record<string, unknown>>();
    const eligibleTeams = actor
      ? await env.DB.prepare(
          `SELECT t.id, t.name
             FROM teams t
             JOIN team_memberships tm
               ON tm.team_id = t.id
              AND tm.user_id = ?
            WHERE t.is_archived = 0
              AND t.verification_status = 'VERIFIED'
              AND tm.status = 'ACTIVE'
              AND UPPER(tm.membership_role) IN
                ('OWNER', 'LEADER', 'TEAM_LEADER', 'MANAGER', 'UPLOADER')
            ORDER BY t.name COLLATE NOCASE, t.id`,
        )
          .bind(actor.id)
          .all<{ id: string; name: string }>()
      : { results: [] as Array<{ id: string; name: string }> };
    const mine = actor
      ? await env.DB.prepare(
          `SELECT id, kind, orientation, caption, alt_text AS altText,
                  language, cover_type AS coverType, volume, width, height,
                  moderation_status AS status,
                  rejection_reason AS rejectionReason, revision,
                  created_at AS createdAt
             FROM series_gallery_assets
            WHERE series_id = ?
              AND submitted_by_user_id = ?
              AND moderation_status IN ('PENDING', 'REJECTED')
            ORDER BY created_at DESC, id DESC
            LIMIT 40`,
        )
          .bind(series.id, actor.id)
          .all<Record<string, unknown>>()
      : { results: [] as Array<Record<string, unknown>> };
    const mediaUrl = (id: string, revision: number) =>
      `/api/v1/series-gallery-media?id=${encodeURIComponent(id)}&v=${revision}`;
    const covers = [
      ...(series.coverKey
        ? [
            {
              id: `canonical:${series.id}`,
              kind: "COVER",
              orientation: "PORTRAIT",
              caption: `${series.title} cover`,
              altText: `${series.title} cover`,
              width: 1000,
              height: 1500,
              language: series.originalLanguage,
              coverType: "OFFICIAL",
              status: "APPROVED",
              assetUrl: `/api/v1/series-media?id=${encodeURIComponent(series.id)}&slot=cover&v=${series.revision}`,
              canonical: true,
            },
          ]
        : []),
      ...approved.results
        .filter((entry) => entry.kind === "COVER")
        .map((entry) => ({
          ...entry,
          status: "APPROVED",
          assetUrl: mediaUrl(String(entry.id), Number(entry.revision)),
          canonical: false,
        })),
    ];
    const art = approved.results
      .filter((entry) => entry.kind === "ART")
      .map((entry) => ({
        ...entry,
        status: "APPROVED",
        assetUrl: mediaUrl(String(entry.id), Number(entry.revision)),
      }));
    const directPublishing = actor
      ? canPublishGalleryDirectly(actor)
      : false;
    const coverRequiresTeam = Boolean(
      actor &&
        !actorRoles(actor).has("OWNER") &&
        !actorRoles(actor).has("ADMINISTRATOR") &&
        !actorRoles(actor).has("MANAGER"),
    );
    const coverSubmissionAllowed =
      canSubmitCover(actor) &&
      (!coverRequiresTeam || eligibleTeams.results.length > 0);
    return json(
      requestId,
      {
        data: {
          seriesId: series.id,
          art,
          covers,
          defaultCoverLanguage: series.originalLanguage,
          submissions: mine.results.map((entry) => ({
            ...entry,
            assetUrl: mediaUrl(String(entry.id), Number(entry.revision)),
          })),
          permissions: {
            canSubmitArt: Boolean(actor),
            canSubmitCover: coverSubmissionAllowed,
            teamRequiredForCover: coverRequiresTeam,
            eligibleTeams: eligibleTeams.results,
            submissionModes: {
              art: actor
                ? directPublishing
                  ? "DIRECT"
                  : "MODERATED"
                : "UNAVAILABLE",
              cover: coverSubmissionAllowed
                ? directPublishing
                  ? "DIRECT"
                  : "MODERATED"
                : "UNAVAILABLE",
            },
          },
        },
      },
      {
        headers: {
          "cache-control": actor
            ? "private, no-store"
            : "public, max-age=30, stale-while-revalidate=120",
          vary: "cookie",
        },
      },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  let uploadedKey = "";
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    if (!env.DB || !env.BUCKET) {
      throw new ApiError(
        503,
        "GALLERY_MEDIA_UNAVAILABLE",
        "Gallery uploads are temporarily unavailable.",
      );
    }
    const form = await request.formData();
    const payload = submissionSchema.parse({
      seriesSlug: form.get("seriesSlug"),
      kind: form.get("kind"),
      orientation: form.get("orientation"),
      caption: form.get("caption") ?? "",
      altText: form.get("altText") ?? "",
      language: form.get("language") ?? "",
      coverType: form.get("coverType") ?? "",
      volume: form.get("volume") ?? "",
      teamId: form.get("teamId") ?? "",
    });
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ApiError(422, "IMAGE_REQUIRED", "Choose an image to submit.");
    }
    if (payload.kind === "COVER" && payload.orientation !== "PORTRAIT") {
      throw new ApiError(
        422,
        "COVER_ORIENTATION_INVALID",
        "Series covers must use the 2:3 portrait format.",
      );
    }
    if (payload.kind === "COVER" && !canSubmitCover(actor)) {
      throw new ApiError(
        403,
        "COVER_SUBMISSION_FORBIDDEN",
        "Only uploaders, team leaders, managers, and administrators can submit covers.",
      );
    }
    const series = await env.DB.prepare(
      `SELECT id, title
         FROM series s
        WHERE s.slug = ?
          AND s.is_published = 1
          AND s.archived_at IS NULL
          AND s.status NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
          AND s.rights_status IN
            ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
          AND ${publicPaidSeriesPredicate("s")}
        LIMIT 1`,
    )
      .bind(payload.seriesSlug)
      .first<{ id: string; title: string }>();
    if (!series) {
      throw new ApiError(
        404,
        "SERIES_NOT_FOUND",
        "This series is not available.",
      );
    }
    const roles = actorRoles(actor);
    const platformManagement =
      roles.has("OWNER") ||
      roles.has("ADMINISTRATOR") ||
      roles.has("MANAGER");
    const directPublishing = canPublishGalleryDirectly(actor);
    const moderationStatus = directPublishing ? "APPROVED" : "PENDING";
    let submitterTeamId: string | null = null;
    if (payload.teamId) {
      const membership = await requireVerifiedTeamMembership(
        env.DB,
        actor,
        payload.teamId,
      );
      submitterTeamId = membership.id;
    } else if (payload.kind === "COVER" && !platformManagement) {
      throw new ApiError(
        422,
        "TEAM_REQUIRED",
        "Choose the verified team represented by this cover submission.",
      );
    }
    const image = await validateImageFile(file, {
      label: payload.kind === "ART" ? "series artwork" : "series cover",
      maxBytes: 4_000_000,
      minWidth: 640,
      minHeight: 640,
      maxWidth: 2000,
      maxHeight: 2000,
      maxPixels: 3_000_000,
      allowAnimation: false,
      allowedTypes: new Set(["image/jpeg", "image/png", "image/webp"]),
    });
    const required =
      payload.orientation === "LANDSCAPE"
        ? { width: 1600, height: 900 }
        : { width: 1000, height: 1500 };
    if (
      image.dimensions.width !== required.width ||
      image.dimensions.height !== required.height
    ) {
      throw new ApiError(
        422,
        "GALLERY_DIMENSIONS_INVALID",
        `Crop this image to exactly ${required.width} × ${required.height} pixels before submitting.`,
      );
    }
    const assetId = randomId();
    const digest = await sha256Hex(image.bytes);
    uploadedKey = `series-gallery/${series.id}/${assetId}-${digest.slice(0, 12)}.${extension(image.contentType)}`;
    await env.BUCKET.put(uploadedKey, image.bytes, {
      httpMetadata: {
        contentType: image.contentType,
        cacheControl: "private, no-store",
      },
      customMetadata: {
        seriesId: series.id,
        kind: payload.kind,
        orientation: payload.orientation,
        width: String(image.dimensions.width),
        height: String(image.dimensions.height),
        sha256: digest,
        language: payload.kind === "COVER" ? payload.language : "",
        coverType: payload.kind === "COVER" ? payload.coverType : "",
        moderationStatus,
      },
    });
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO series_gallery_assets
         (id, series_id, kind, object_key, content_type, width, height,
          byte_size, orientation, caption, alt_text, language, cover_type,
          volume, submitted_by_user_id, submitter_team_id, moderation_status,
          reviewed_by_user_id, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 CASE WHEN ? = 'APPROVED' THEN CURRENT_TIMESTAMP ELSE NULL END)`,
      ).bind(
        assetId,
        series.id,
        payload.kind,
        uploadedKey,
        image.contentType,
        image.dimensions.width,
        image.dimensions.height,
        image.bytes.byteLength,
        payload.orientation,
        payload.caption,
        payload.altText || `${series.title} ${payload.kind === "ART" ? "art" : "cover"}`,
        payload.kind === "COVER" ? payload.language : null,
        payload.kind === "COVER" ? payload.coverType : null,
        payload.volume || null,
        actor.id,
        submitterTeamId,
        moderationStatus,
        directPublishing ? actor.id : null,
        moderationStatus,
      ),
      auditStatement(
        env.DB,
        actor,
        requestId,
        {
          action: directPublishing
            ? "series.gallery.publish"
            : "series.gallery.submit",
          category: "SERIES_CHAPTERS",
          sourceArea: "SERIES_GALLERY",
          targetType: "SERIES_GALLERY_ASSET",
          targetId: assetId,
          targetLabel: series.title,
          metadata: {
            seriesId: series.id,
            kind: payload.kind,
            orientation: payload.orientation,
            language:
              payload.kind === "COVER" ? payload.language : null,
            coverType:
              payload.kind === "COVER" ? payload.coverType : null,
            moderationStatus,
            submitterTeamId,
          },
        },
        "changes() = 1",
      ),
    ]);
    if (!Number(results[0]?.meta.changes ?? 0)) {
      throw new ApiError(
        409,
        "GALLERY_SUBMISSION_CONFLICT",
        "This gallery submission could not be saved.",
      );
    }
    uploadedKey = "";
    return json(
      requestId,
      {
        data: {
          id: assetId,
          status: moderationStatus,
          message: directPublishing
            ? "Added to the public gallery."
            : "Submitted for administrator review.",
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (uploadedKey && env.DB && env.BUCKET) {
      await deleteMediaObject(env.DB, env.BUCKET, uploadedKey, {
        mediaKind: "SERIES_GALLERY",
        targetType: "SERIES_GALLERY_ASSET",
        targetId: "uncommitted",
        reason: "Failed gallery submission",
      });
    }
    return errorResponse(requestId, error);
  }
}
