export type TaxonomyEntityTable = "creators" | "publishers" | "genres";
export type TaxonomyArchiveMode = "ACTIVE" | "ARCHIVED" | "ANY";

export type EquivalentTaxonomyEntity = {
  id: string;
  name: string;
  revision: number;
  archivedAt: string | null;
  normalizedValue: string;
};

type TaxonomyDatabase = Pick<D1Database, "prepare">;

const normalizedColumn: Record<TaxonomyEntityTable, string> = {
  creators: "normalized_name",
  publishers: "normalized_name",
  genres: "normalized_key",
};

export async function findNormalizedEquivalent(
  db: TaxonomyDatabase,
  table: TaxonomyEntityTable,
  normalized: string,
  normalize: (value: string) => string,
  archiveMode: TaxonomyArchiveMode = "ACTIVE",
  excludeId?: string,
) {
  const archiveClause =
    archiveMode === "ACTIVE"
      ? "archived_at IS NULL"
      : archiveMode === "ARCHIVED"
        ? "archived_at IS NOT NULL"
        : "1 = 1";
  let cursor = "";
  for (;;) {
    const rows = await db
      .prepare(
        `SELECT id, name, revision, archived_at AS archivedAt,
                ${normalizedColumn[table]} AS normalizedValue
           FROM ${table}
         WHERE ${archiveClause}
            AND id > ?
            ${excludeId ? "AND id <> ?" : ""}
          ORDER BY id
          LIMIT 500`,
      )
      .bind(cursor, ...(excludeId ? [excludeId] : []))
      .all<EquivalentTaxonomyEntity>();
    const equivalent = rows.results.find(
      (candidate) => normalize(candidate.name) === normalized,
    );
    if (equivalent) return equivalent;
    if (rows.results.length < 500) return null;
    cursor = rows.results.at(-1)!.id;
  }
}
