export type LatestPageItem = number | "ellipsis";

export function latestPageItems(
  page: number,
  pageCount: number,
): LatestPageItem[] {
  if (pageCount <= 4) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }
  if (page <= 2) return [1, 2, "ellipsis", pageCount];
  if (page >= pageCount - 2) {
    return [1, "ellipsis", pageCount - 2, pageCount - 1, pageCount];
  }
  return [1, "ellipsis", page - 1, page, page + 1, "ellipsis", pageCount];
}
