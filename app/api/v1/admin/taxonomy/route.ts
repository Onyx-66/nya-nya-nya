import { env } from "cloudflare:workers";
import { z } from "zod";
import {
  collapseSpaces,
  normalizedLookupKey,
  preferredGenreLabel,
} from "@/lib/admin-metadata";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  assertSameOrigin,
  auditStatement,
  requestIdFor,
  sha256Hex,
} from "@/lib/server/admin-utils";
import { requireActor, requireAdminCapability } from "@/lib/server/policy";
import { findNormalizedEquivalent } from "@/lib/server/taxonomy-equivalence";

export const dynamic = "force-dynamic";

const entityTypeSchema = z.enum(["GENRE", "CREATOR", "PUBLISHER"]);
const createSchema = z.object({
  type: entityTypeSchema,
  name: z.string().trim().min(1).max(180),
});
const updateSchema = z.object({
  type: entityTypeSchema,
  id: z.string().trim().min(3).max(160),
  revision: z.coerce.number().int().min(1),
  action: z.enum(["RENAME", "ARCHIVE", "RESTORE", "MERGE"]),
  name: z.string().trim().min(1).max(180).optional(),
  replacementId: z.string().trim().min(3).max(160).optional(),
});

function database() {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Taxonomy management is temporarily unavailable.",
    );
  }
  return env.DB;
}

async function entityId(type: z.infer<typeof entityTypeSchema>, key: string) {
  const digest = await sha256Hex(new TextEncoder().encode(`${type}:${key}`));
  return `${type.toLowerCase()}_${digest.slice(0, 24)}`;
}

function entityConfig(type: z.infer<typeof entityTypeSchema>) {
  if (type === "GENRE") {
    return {
      table: "genres",
      normalized: "normalized_key",
      usage: `SELECT COUNT(*) AS count FROM series_genres WHERE genre_id = ?`,
    } as const;
  }
  if (type === "CREATOR") {
    return {
      table: "creators",
      normalized: "normalized_name",
      usage: `SELECT COUNT(DISTINCT series_id) AS count
              FROM series_creators WHERE creator_id = ?`,
    } as const;
  }
  return {
    table: "publishers",
    normalized: "normalized_name",
    usage: `SELECT COUNT(*) AS count FROM series WHERE publisher_id = ?`,
  } as const;
}

function displayName(type: z.infer<typeof entityTypeSchema>, value: string) {
  return type === "GENRE"
    ? preferredGenreLabel(value)
    : collapseSpaces(value);
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    requireAdminCapability(actor, "content.taxonomy.manage");
    const db = database();
    const url = new URL(request.url);
    const type = entityTypeSchema.parse(url.searchParams.get("type"));
    const query = normalizedLookupKey(url.searchParams.get("query") ?? "");
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10_000)
      .catch(1)
      .parse(url.searchParams.get("page"));
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .catch(30)
      .parse(url.searchParams.get("limit"));
    const config = entityConfig(type);
    const term = `%${query}%`;
    const rows = await db
      .prepare(
        `SELECT entity.id, entity.name, entity.archived_at AS archivedAt,
                entity.revision,
                (${config.usage.replace("?", "entity.id")}) AS usageCount
         FROM ${config.table} entity
         WHERE (? = '%%' OR entity.${config.normalized} LIKE ?)
         ORDER BY entity.archived_at IS NOT NULL, entity.name COLLATE NOCASE
         LIMIT ? OFFSET ?`,
      )
      .bind(term, term, limit, (page - 1) * limit)
      .all<{
        id: string;
        name: string;
        archivedAt: string | null;
        revision: number;
        usageCount: number;
      }>();
    const count = await db
      .prepare(
        `SELECT COUNT(*) AS count FROM ${config.table}
         WHERE (? = '%%' OR ${config.normalized} LIKE ?)`,
      )
      .bind(term, term)
      .first<{ count: number }>();
    return json(
      requestId,
      {
        data: rows.results.map((row) => ({
          ...row,
          revision: Number(row.revision),
          usageCount: Number(row.usageCount),
        })),
        pagination: {
          page,
          limit,
          total: Number(count?.count ?? 0),
        },
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireAdminCapability(actor, "content.taxonomy.manage");
    const db = database();
    const payload = createSchema.parse(await request.json());
    const name = displayName(payload.type, payload.name);
    const normalized = normalizedLookupKey(name);
    const config = entityConfig(payload.type);
    const exact = await db
      .prepare(
        `SELECT id, name, revision, archived_at AS archivedAt
         FROM ${config.table}
         WHERE ${config.normalized} = ?
           AND archived_at IS NULL
         LIMIT 1`,
      )
      .bind(normalized)
      .first<{
        id: string;
        name: string;
        revision: number;
        archivedAt: string | null;
      }>();
    const existing =
      exact ??
      (await findNormalizedEquivalent(
        db,
        config.table,
        normalized,
        normalizedLookupKey,
        "ACTIVE",
      ));
    if (existing) {
      return json(requestId, {
        data: existing,
        reused: true,
        message: `${existing.name} already exists and was selected.`,
      });
    }
    const id = await entityId(payload.type, normalized);
    const exactArchived = await db
      .prepare(
        `SELECT id, name, revision, archived_at AS archivedAt,
                ${config.normalized} AS normalizedValue
          FROM ${config.table}
          WHERE archived_at IS NOT NULL
            AND id = ?
          LIMIT 1`,
      )
      .bind(id)
      .first<{
        id: string;
        name: string;
        revision: number;
        archivedAt: string | null;
        normalizedValue: string;
      }>();
    const archived =
      exactArchived ??
      (await findNormalizedEquivalent(
        db,
        config.table,
        normalized,
        normalizedLookupKey,
        "ARCHIVED",
      ));
    if (archived && !archived.normalizedValue.includes("#merged:")) {
      const restoreResults = await db.batch([
        db.prepare(
          `UPDATE OR IGNORE ${config.table}
              SET ${config.normalized} = ?, archived_at = NULL,
                  revision = revision + 1, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND revision = ? AND archived_at IS NOT NULL`,
        ).bind(normalized, archived.id, archived.revision),
        auditStatement(
          db,
          actor,
          requestId,
          {
            action: `${payload.type.toLowerCase()}.restore`,
            category: "SERIES_CHAPTERS",
            sourceArea: "TAXONOMY",
            targetType: payload.type,
            targetId: archived.id,
            targetLabel: archived.name,
            oldValue: { archivedAt: archived.archivedAt },
            newValue: {
              archivedAt: null,
              revision: archived.revision + 1,
            },
          },
          "changes() = 1",
        ),
      ]);
      if (!restoreResults[0]?.meta.changes) {
        const racedExisting = await findNormalizedEquivalent(
          db,
          config.table,
          normalized,
          normalizedLookupKey,
          "ACTIVE",
        );
        if (racedExisting) {
          return json(requestId, {
            data: racedExisting,
            reused: true,
            message: `${racedExisting.name} already exists and was selected.`,
          });
        }
        throw new ApiError(
          409,
          "STALE_VERSION",
          "This archived entry changed. Search again before restoring it.",
        );
      }
      return json(requestId, {
        data: {
          id: archived.id,
          name: archived.name,
          revision: archived.revision + 1,
          archivedAt: null,
        },
        reused: true,
        restored: true,
        message: `${archived.name} was restored and selected.`,
      });
    }
    if (archived) {
      throw new ApiError(
        409,
        "ENTITY_PREVIOUSLY_MERGED",
        "An entry with this identity was previously merged. Select the active replacement or use a distinct name.",
      );
    }
    const createMutation = payload.type === "GENRE"
      ? db
        .prepare(
          `INSERT OR IGNORE INTO genres
           (id, slug, name, normalized_key, revision, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        )
        .bind(
          id,
          `${normalized
            .normalize("NFKD")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 70) || "genre"}-${id.slice(-7)}`,
          name,
          normalized,
        )
      : payload.type === "CREATOR"
        ? db
          .prepare(
            `INSERT OR IGNORE INTO creators
             (id, name, normalized_name, biography, revision)
             VALUES (?, ?, ?, '', 1)`,
          )
          .bind(id, name, normalized)
        : db
          .prepare(
            `INSERT OR IGNORE INTO publishers
             (id, name, normalized_name, description, revision)
             VALUES (?, ?, ?, '', 1)`,
          )
          .bind(id, name, normalized);
    const createResults = await db.batch([
      createMutation,
      auditStatement(
        db,
        actor,
        requestId,
        {
          action: `${payload.type.toLowerCase()}.create`,
          category: "SERIES_CHAPTERS",
          sourceArea: "TAXONOMY",
          targetType: payload.type,
          targetId: id,
          targetLabel: name,
        },
        "changes() = 1",
      ),
    ]);
    if (!createResults[0]?.meta.changes) {
      const racedExisting = await findNormalizedEquivalent(
        db,
        config.table,
        normalized,
        normalizedLookupKey,
        "ACTIVE",
      );
      if (racedExisting) {
        return json(requestId, {
          data: racedExisting,
          reused: true,
          message: `${racedExisting.name} already exists and was selected.`,
        });
      }
      throw new ApiError(
        409,
        "ENTITY_DUPLICATE",
        "An equivalent entry was created by another administrator. Search again to select it.",
      );
    }
    return json(
      requestId,
      { data: { id, name, revision: 1, archivedAt: null }, reused: false },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function PUT(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireAdminCapability(actor, "content.taxonomy.manage");
    const db = database();
    const payload = updateSchema.parse(await request.json());
    const config = entityConfig(payload.type);
    const current = await db
      .prepare(
        `SELECT id, name, ${config.normalized} AS normalizedValue,
                archived_at AS archivedAt, revision
         FROM ${config.table} WHERE id = ? LIMIT 1`,
      )
      .bind(payload.id)
      .first<{
        id: string;
        name: string;
        normalizedValue: string;
        archivedAt: string | null;
        revision: number;
      }>();
    if (!current) {
      throw new ApiError(
        404,
        "ENTITY_NOT_FOUND",
        "This entry no longer exists.",
      );
    }
    if (Number(current.revision) !== payload.revision) {
      throw new ApiError(
        409,
        "STALE_VERSION",
        "Another administrator changed this entry. Reload it before saving.",
      );
    }
    const mutationAudit = () =>
      auditStatement(
        db,
        actor,
        requestId,
        {
          action: `${payload.type.toLowerCase()}.${payload.action.toLowerCase()}`,
          category: "SERIES_CHAPTERS",
          sourceArea: "TAXONOMY",
          targetType: payload.type,
          targetId: payload.id,
          targetLabel: current.name,
          oldValue: {
            name: current.name,
            archivedAt: current.archivedAt,
            revision: current.revision,
          },
          newValue: {
            name: payload.name,
            replacementId: payload.replacementId,
            action: payload.action,
          },
        },
        "changes() = 1",
      );
    if (payload.action === "RENAME") {
      if (current.archivedAt) {
        throw new ApiError(
          409,
          "ARCHIVED_ENTITY_READ_ONLY",
          "Restore this entry before renaming it.",
        );
      }
      if (!payload.name) {
        throw new ApiError(
          422,
          "NAME_REQUIRED",
          "Enter the new display name.",
        );
      }
      const name = displayName(payload.type, payload.name);
      const normalized = normalizedLookupKey(name);
      const exactConflict = await db
        .prepare(
          `SELECT id, name FROM ${config.table}
           WHERE ${config.normalized} = ?
             AND id <> ?
             AND archived_at IS NULL
           LIMIT 1`,
        )
        .bind(normalized, payload.id)
        .first<{ id: string; name: string }>();
      const conflict =
        exactConflict ??
        (await findNormalizedEquivalent(
          db,
          config.table,
          normalized,
          normalizedLookupKey,
          "ACTIVE",
          payload.id,
        ));
      if (conflict) {
        throw new ApiError(
          409,
          "ENTITY_DUPLICATE",
          `${conflict.name} already exists. Use Merge instead.`,
        );
      }
      const results = await db.batch([
        db.prepare(
          `UPDATE OR IGNORE ${config.table}
           SET name = ?, ${config.normalized} = ?, revision = revision + 1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND revision = ?`,
        ).bind(name, normalized, payload.id, payload.revision),
        mutationAudit(),
      ]);
      if (!results[0]?.meta.changes) {
        const racedConflict = await findNormalizedEquivalent(
          db,
          config.table,
          normalized,
          normalizedLookupKey,
          "ACTIVE",
          payload.id,
        );
        if (racedConflict) {
          throw new ApiError(
            409,
            "ENTITY_DUPLICATE",
            `${racedConflict.name} already exists. Use Merge instead.`,
          );
        }
        throw new ApiError(
          409,
          "STALE_VERSION",
          "Another administrator changed this entry. Reload it before saving.",
        );
      }
    } else if (payload.action === "ARCHIVE") {
      if (current.archivedAt) {
        throw new ApiError(
          409,
          "ENTITY_ALREADY_ARCHIVED",
          "This entry is already archived.",
        );
      }
      const archivedKey = `${current.normalizedValue}#archived:${current.id}`;
      const results = await db.batch([
        db.prepare(
          `UPDATE ${config.table}
           SET ${config.normalized} = ?, archived_at = CURRENT_TIMESTAMP,
               revision = revision + 1, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND revision = ?`,
        ).bind(archivedKey, payload.id, payload.revision),
        mutationAudit(),
      ]);
      if (!results[0]?.meta.changes) {
        throw new ApiError(
          409,
          "STALE_VERSION",
          "Another administrator changed this entry. Reload it before saving.",
        );
      }
    } else if (payload.action === "RESTORE") {
      if (!current.archivedAt) {
        throw new ApiError(
          409,
          "ENTITY_ALREADY_ACTIVE",
          "This entry is already active.",
        );
      }
      if (current.normalizedValue.includes("#merged:")) {
        throw new ApiError(
          409,
          "MERGED_ENTITY_CANNOT_RESTORE",
          "Merged entries cannot be restored. Use the active replacement.",
        );
      }
      const restoredKey = normalizedLookupKey(current.name);
      const exactConflict = await db
        .prepare(
          `SELECT id, name FROM ${config.table}
           WHERE ${config.normalized} = ?
             AND id <> ?
             AND archived_at IS NULL
           LIMIT 1`,
        )
        .bind(restoredKey, payload.id)
        .first<{ id: string; name: string }>();
      const conflict =
        exactConflict ??
        (await findNormalizedEquivalent(
          db,
          config.table,
          restoredKey,
          normalizedLookupKey,
          "ACTIVE",
          payload.id,
        ));
      if (conflict) {
        throw new ApiError(
          409,
          "ENTITY_DUPLICATE",
          `${conflict.name} already uses this identity. Merge instead of restoring.`,
        );
      }
      const results = await db.batch([
        db.prepare(
          `UPDATE OR IGNORE ${config.table}
           SET ${config.normalized} = ?, archived_at = NULL,
               revision = revision + 1, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND revision = ? AND archived_at IS NOT NULL`,
        ).bind(restoredKey, payload.id, payload.revision),
        mutationAudit(),
      ]);
      if (!results[0]?.meta.changes) {
        const racedConflict = await findNormalizedEquivalent(
          db,
          config.table,
          restoredKey,
          normalizedLookupKey,
          "ACTIVE",
          payload.id,
        );
        if (racedConflict) {
          throw new ApiError(
            409,
            "ENTITY_DUPLICATE",
            `${racedConflict.name} already uses this identity. Merge instead of restoring.`,
          );
        }
        throw new ApiError(
          409,
          "STALE_VERSION",
          "Another administrator changed this entry. Reload it before saving.",
        );
      }
    } else {
      if (current.archivedAt) {
        throw new ApiError(
          409,
          "ARCHIVED_ENTITY_READ_ONLY",
          "Archived or merged entries cannot be merged again.",
        );
      }
      if (!payload.replacementId || payload.replacementId === payload.id) {
        throw new ApiError(
          422,
          "REPLACEMENT_REQUIRED",
          "Choose a different active replacement.",
        );
      }
      const replacement = await db
        .prepare(
          `SELECT id, name FROM ${config.table}
           WHERE id = ? AND archived_at IS NULL LIMIT 1`,
        )
        .bind(payload.replacementId)
        .first<{ id: string; name: string }>();
      if (!replacement) {
        throw new ApiError(
          422,
          "REPLACEMENT_NOT_AVAILABLE",
          "The replacement entry is no longer active.",
        );
      }
      const archivedKey = `${current.normalizedValue}#merged:${current.id}`;
      const nextRevision = payload.revision + 1;
      let mergeResults: Array<D1Result<unknown>>;
      if (payload.type === "GENRE") {
        mergeResults = await db.batch([
          db
            .prepare(
              `UPDATE genres
               SET normalized_key = ?, archived_at = CURRENT_TIMESTAMP,
                   revision = revision + 1, updated_at = CURRENT_TIMESTAMP
               WHERE id = ? AND revision = ?
                 AND EXISTS (
                   SELECT 1 FROM genres replacement
                   WHERE replacement.id = ? AND replacement.archived_at IS NULL
                 )`,
            )
            .bind(
              archivedKey,
              current.id,
              payload.revision,
              replacement.id,
            ),
          mutationAudit(),
          db
            .prepare(
              `INSERT OR IGNORE INTO series_genres (series_id, genre_id)
               SELECT series_id, ? FROM series_genres
               WHERE genre_id = ?
                 AND EXISTS (
                   SELECT 1 FROM genres source
                   WHERE source.id = ? AND source.revision = ?
                     AND source.archived_at IS NOT NULL
                     AND source.normalized_key = ?
                 )`,
            )
            .bind(
              replacement.id,
              current.id,
              current.id,
              nextRevision,
              archivedKey,
            ),
          db
            .prepare(
              `UPDATE series
               SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP
               WHERE id IN (
                 SELECT series_id FROM series_genres WHERE genre_id = ?
               )
                 AND EXISTS (
                   SELECT 1 FROM genres source
                   WHERE source.id = ? AND source.revision = ?
                     AND source.archived_at IS NOT NULL
                     AND source.normalized_key = ?
                 )`,
            )
            .bind(current.id, current.id, nextRevision, archivedKey),
          db
            .prepare(
              `DELETE FROM series_genres
               WHERE genre_id = ?
                 AND EXISTS (
                   SELECT 1 FROM genres source
                   WHERE source.id = ? AND source.revision = ?
                     AND source.archived_at IS NOT NULL
                     AND source.normalized_key = ?
                 )`,
            )
            .bind(current.id, current.id, nextRevision, archivedKey),
        ]);
      } else if (payload.type === "CREATOR") {
        mergeResults = await db.batch([
          db
            .prepare(
              `UPDATE creators
               SET normalized_name = ?, archived_at = CURRENT_TIMESTAMP,
                   revision = revision + 1, updated_at = CURRENT_TIMESTAMP
               WHERE id = ? AND revision = ?
                 AND EXISTS (
                   SELECT 1 FROM creators replacement
                   WHERE replacement.id = ? AND replacement.archived_at IS NULL
                 )`,
            )
            .bind(
              archivedKey,
              current.id,
              payload.revision,
              replacement.id,
            ),
          mutationAudit(),
          db
            .prepare(
              `INSERT OR IGNORE INTO series_creators
               (series_id, creator_id, role, sort_order)
               SELECT series_id, ?, role, sort_order
               FROM series_creators
               WHERE creator_id = ?
                 AND EXISTS (
                   SELECT 1 FROM creators source
                   WHERE source.id = ? AND source.revision = ?
                     AND source.archived_at IS NOT NULL
                     AND source.normalized_name = ?
                 )`,
            )
            .bind(
              replacement.id,
              current.id,
              current.id,
              nextRevision,
              archivedKey,
            ),
          db
            .prepare(
              `UPDATE series
               SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP
               WHERE id IN (
                 SELECT series_id FROM series_creators WHERE creator_id = ?
               )
                 AND EXISTS (
                   SELECT 1 FROM creators source
                   WHERE source.id = ? AND source.revision = ?
                     AND source.archived_at IS NOT NULL
                     AND source.normalized_name = ?
                 )`,
            )
            .bind(current.id, current.id, nextRevision, archivedKey),
          db
            .prepare(
              `DELETE FROM series_creators
               WHERE creator_id = ?
                 AND EXISTS (
                   SELECT 1 FROM creators source
                   WHERE source.id = ? AND source.revision = ?
                     AND source.archived_at IS NOT NULL
                     AND source.normalized_name = ?
                 )`,
            )
            .bind(current.id, current.id, nextRevision, archivedKey),
        ]);
      } else {
        mergeResults = await db.batch([
          db
            .prepare(
              `UPDATE publishers
               SET normalized_name = ?, archived_at = CURRENT_TIMESTAMP,
                   revision = revision + 1, updated_at = CURRENT_TIMESTAMP
               WHERE id = ? AND revision = ?
                 AND EXISTS (
                   SELECT 1 FROM publishers replacement
                   WHERE replacement.id = ? AND replacement.archived_at IS NULL
                 )`,
            )
            .bind(
              archivedKey,
              current.id,
              payload.revision,
              replacement.id,
            ),
          mutationAudit(),
          db
            .prepare(
              `UPDATE series
               SET publisher_id = ?,
                   revision = revision + 1,
                   updated_at = CURRENT_TIMESTAMP
               WHERE publisher_id = ?
                 AND EXISTS (
                   SELECT 1 FROM publishers source
                   WHERE source.id = ? AND source.revision = ?
                     AND source.archived_at IS NOT NULL
                     AND source.normalized_name = ?
                 )`,
            )
            .bind(
              replacement.id,
              current.id,
              current.id,
              nextRevision,
              archivedKey,
            ),
        ]);
      }
      if (!mergeResults[0]?.meta.changes) {
        throw new ApiError(
          409,
          "STALE_VERSION",
          "The source or replacement changed. Reload before merging.",
        );
      }
    }
    return json(requestId, { data: { id: payload.id, action: payload.action } });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
