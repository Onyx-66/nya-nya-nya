import { z } from "zod";
import { ApiError } from "@/lib/server/api";
import { randomId } from "@/lib/server/random-id";

export const PUBLIC_ENTITY_TYPES = ["SERIES", "TEAM", "CHAPTER"] as const;
export type PublicEntityType = (typeof PUBLIC_ENTITY_TYPES)[number];

const PREFIX_BY_TYPE: Record<PublicEntityType, string> = {
  SERIES: "SR",
  TEAM: "TM",
  CHAPTER: "CH",
};

export const publicReferenceSchema = z.string().trim().toUpperCase().regex(
  /^(?:SR|TM|CH)-[0-9A-F]{10}$/u,
  "Use a valid permanent public reference.",
);

export function publicReferencePrefix(type: PublicEntityType) {
  return PREFIX_BY_TYPE[type];
}

export function newPublicReference(type: PublicEntityType) {
  const suffix = randomId().replaceAll("-", "").slice(0, 10).toUpperCase();
  return `${PREFIX_BY_TYPE[type]}-${suffix}`;
}

export function entityTypeForReference(reference: string): PublicEntityType | null {
  const prefix = reference.trim().toUpperCase().slice(0, 2);
  return (PUBLIC_ENTITY_TYPES.find((type) => PREFIX_BY_TYPE[type] === prefix) ?? null);
}

export function publicReferenceReservationStatement(
  db: D1Database,
  type: PublicEntityType,
  reference: string,
  entityId: string,
) {
  return db.prepare(
    `INSERT INTO public_identifier_reservations
       (public_ref, entity_type, entity_id)
     VALUES (?, ?, ?)`,
  ).bind(reference, type, entityId);
}

export async function resolvePublicReference(
  db: D1Database,
  type: PublicEntityType,
  reference: string,
) {
  const parsed = publicReferenceSchema.safeParse(reference);
  if (!parsed.success || entityTypeForReference(parsed.data) !== type) {
    throw new ApiError(
      422,
      "PUBLIC_REFERENCE_INVALID",
      `Use a valid ${type.toLowerCase()} public reference.`,
    );
  }
  const row = await db.prepare(
    `SELECT entity_id AS entityId
       FROM public_identifier_reservations
      WHERE public_ref = ? AND entity_type = ?
      LIMIT 1`,
  ).bind(parsed.data, type).first<{ entityId: string }>();
  if (!row) {
    throw new ApiError(
      404,
      "PUBLIC_REFERENCE_NOT_FOUND",
      `The selected ${type.toLowerCase()} reference does not exist.`,
    );
  }
  return { publicRef: parsed.data, entityId: row.entityId };
}

export async function resolvePublicReferenceOrNull(
  db: D1Database,
  type: PublicEntityType,
  reference: string,
) {
  const parsed = publicReferenceSchema.safeParse(reference);
  if (!parsed.success || entityTypeForReference(parsed.data) !== type) return null;
  const row = await db.prepare(
    `SELECT entity_id AS entityId
       FROM public_identifier_reservations
      WHERE public_ref = ? AND entity_type = ?
      LIMIT 1`,
  ).bind(parsed.data, type).first<{ entityId: string }>();
  return row ? { publicRef: parsed.data, entityId: row.entityId } : null;
}

export function publicReferenceForPrefix(type: PublicEntityType, reference: string) {
  const parsed = publicReferenceSchema.parse(reference);
  if (entityTypeForReference(parsed) !== type) {
    throw new ApiError(422, "PUBLIC_REFERENCE_INVALID", `Use a valid ${type.toLowerCase()} public reference.`);
  }
  return parsed;
}
