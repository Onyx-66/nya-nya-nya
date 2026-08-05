import {
  compareChapterNumbers,
  normalizeChapterNumber,
} from "@/lib/chapter-number";
import { ApiError } from "@/lib/server/api";

export type ChapterAccessPolicyRow = {
  id: string;
  chapterNumber: string;
  accessType: "FREE" | "PAID";
  priceOnyx: number;
  language: string;
  teamId: string | null;
  version: number;
};

export type PaidChapterReference = ChapterAccessPolicyRow & {
  reason: "SAME_CHAPTER_VERSION" | "PREVIOUS_CHAPTER";
};

function paidReferenceFromGroup(
  rows: ChapterAccessPolicyRow[],
  reason: PaidChapterReference["reason"],
) {
  const paid = rows.filter(
    (row) => row.accessType === "PAID" && Number(row.priceOnyx) > 0,
  );
  if (!paid.length) return null;
  const prices = [...new Set(paid.map((row) => Number(row.priceOnyx)))];
  if (prices.length > 1) {
    throw new ApiError(
      409,
      "CHAPTER_PRICE_POLICY_CONFLICT",
      `Paid versions of chapter ${normalizeChapterNumber(rows[0]!.chapterNumber)} use different prices. A manager must align them before another release is published.`,
      undefined,
      {
        chapterNumber: normalizeChapterNumber(rows[0]!.chapterNumber),
        prices,
      },
    );
  }
  return { ...paid[0]!, priceOnyx: prices[0]!, reason };
}

export function selectPaidChapterReference(
  rows: ChapterAccessPolicyRow[],
  requestedChapterNumber: string,
): PaidChapterReference | null {
  const requested = normalizeChapterNumber(requestedChapterNumber);
  const groups = new Map<string, ChapterAccessPolicyRow[]>();
  for (const row of rows) {
    const key = normalizeChapterNumber(row.chapterNumber);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const same = paidReferenceFromGroup(
    groups.get(requested) ?? [],
    "SAME_CHAPTER_VERSION",
  );
  const predecessorKey = [...groups.keys()]
    .filter((chapterNumber) => compareChapterNumbers(chapterNumber, requested) < 0)
    .sort(compareChapterNumbers)
    .at(-1);
  const predecessor = predecessorKey
    ? paidReferenceFromGroup(
        groups.get(predecessorKey) ?? [],
        "PREVIOUS_CHAPTER",
      )
    : null;

  if (same && predecessor && same.priceOnyx !== predecessor.priceOnyx) {
    throw new ApiError(
      409,
      "CHAPTER_PRICE_POLICY_CONFLICT",
      `Chapter ${requested} and its paid predecessor use different prices. A manager must align them before this free request can continue.`,
      undefined,
      {
        chapterNumber: requested,
        sameChapterPrice: same.priceOnyx,
        predecessorChapterNumber: normalizeChapterNumber(
          predecessor.chapterNumber,
        ),
        predecessorPrice: predecessor.priceOnyx,
      },
    );
  }
  return same ?? predecessor;
}

export async function findPaidChapterReference(
  db: D1Database,
  seriesId: string,
  requestedChapterNumber: string,
) {
  const rows = await db
    .prepare(
      `SELECT id, chapter_number AS chapterNumber,
              access_type AS accessType, price_onyx AS priceOnyx,
              language, team_id AS teamId, version
         FROM chapters
        WHERE series_id = ?
          AND state IN ('READY_FOR_REVIEW', 'PUBLISHED')`,
    )
    .bind(seriesId)
    .all<ChapterAccessPolicyRow>();
  return selectPaidChapterReference(rows.results, requestedChapterNumber);
}
