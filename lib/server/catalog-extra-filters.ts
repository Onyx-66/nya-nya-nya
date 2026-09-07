import { PAID_CONTENT_PUBLIC_SQL, effectiveChapterAccessSql } from "./public-content-visibility";

/** Public browse filters share one predicate for result rows and pagination. */
export function extraCatalogFilters(params: URLSearchParams) {
  const clauses: string[] = [];
  const bindings: string[] = [];
  const origins = [...new Set((params.get("origin") ?? "").toUpperCase().split(",").filter((value) => ["JP", "KR", "CN", "OTHER"].includes(value)))];
  if (origins.length) {
    const countries = origins.filter((value) => value !== "OTHER");
    const parts: string[] = [];
    if (countries.length) { parts.push(`s.origin_country IN (${countries.map(() => "?").join(",")})`); bindings.push(...countries); }
    if (origins.includes("OTHER")) parts.push("COALESCE(s.origin_country, '') NOT IN ('JP','KR','CN')");
    clauses.push(`(${parts.join(" OR ")})`);
  }
  const tags = [...new Set((params.get("tag") ?? "").split(",").map((value) => value.trim()).filter(Boolean))].slice(0, 20);
  if (tags.length) {
    clauses.push(`EXISTS (SELECT 1 FROM series_tags st_filter JOIN tags t_filter ON t_filter.id = st_filter.tag_id
      WHERE st_filter.series_id = s.id AND t_filter.archived_at IS NULL
        AND t_filter.slug IN (${tags.map(() => "?").join(",")}))`);
    bindings.push(...tags);
  }
  if (params.get("onSale") === "1") {
    clauses.push(`(${PAID_CONTENT_PUBLIC_SQL}) AND EXISTS (
      SELECT 1 FROM content_discounts sale
      JOIN chapters sale_chapter ON sale_chapter.series_id = sale.series_id
      LEFT JOIN content_visibility_overrides sale_visibility ON sale_visibility.chapter_id = sale_chapter.id
      WHERE sale.series_id = s.id AND sale.is_active = 1
        AND datetime(sale.starts_at) <= datetime('now') AND datetime(sale.ends_at) > datetime('now')
        AND sale_chapter.state = 'PUBLISHED' AND sale_chapter.visibility = 'PUBLIC'
        AND datetime(sale_chapter.published_at) <= datetime('now')
        AND (${effectiveChapterAccessSql("sale_chapter", "sale_visibility")}) = 'PAID'
        AND sale_chapter.price_onyx > 0
        AND (sale.target_type = 'SERIES' OR (sale.target_type = 'CHAPTER'
          AND sale.chapter_id = sale_chapter.id AND sale.original_price = sale_chapter.price_onyx))
        AND (sale.discount_type = 'PERCENT' OR sale.discount_value < sale_chapter.price_onyx)
    )`);
  }
  return { clauses, bindings };
}
