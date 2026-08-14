import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { assertSameOrigin, requestIdFor } from "@/lib/server/admin-utils";
import {
  assertPaidEconomyRevisionFresh,
  getCommercialSettingsDocument,
  paidEconomyRevisionGuardSql,
  requirePaidEconomyPublicDocument,
} from "@/lib/server/commercial-settings";
import { walletSnapshot } from "@/lib/server/economy";
import { requireFeature } from "@/lib/server/feature-flags";
import { requireActor } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";
import { resolveChapterAccess } from "@/lib/server/chapter-access";
import {
  activeChapterDiscountGuardSql,
  noActiveChapterDiscountGuardSql,
} from "@/lib/server/content-discounts";

export const dynamic = "force-dynamic";

const payloadSchema = z.object({
  seriesSlug: z.string().trim().min(2).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  idempotencyKey: z.string().min(12).max(160),
});

type ChapterRow = { id: string; slug: string };
type UnlockCandidate = Awaited<ReturnType<typeof resolveChapterAccess>>;

function creditAccountFor(access: UnlockCandidate) {
  return access.teamId
    ? `la_team_${access.teamId}_earned_onyx`
    : "la_platform_earned_onyx";
}

function candidateGuard(access: UnlockCandidate) {
  const discountGuard = access.discountId
    ? `AND ${activeChapterDiscountGuardSql()}`
    : `AND ${noActiveChapterDiscountGuardSql()}`;
  const bindings = access.discountId
    ? [
        access.discountId,
        access.discountRevision,
        access.priceOnyx,
        access.priceOnyx,
      ]
    : [];
  return {
    sql: `EXISTS (
      SELECT 1
        FROM chapters current_chapter
        JOIN series current_series ON current_series.id = current_chapter.series_id
       WHERE current_chapter.id = ?
         AND current_chapter.access_type = 'PAID'
         AND current_chapter.price_onyx = ?
         AND current_chapter.state = 'PUBLISHED'
         AND current_chapter.visibility <> 'HIDDEN'
         AND current_chapter.published_at IS NOT NULL
         AND datetime(current_chapter.published_at) <= datetime('now')
         AND (current_chapter.free_at IS NULL OR datetime(current_chapter.free_at) > datetime('now') OR EXISTS (
              SELECT 1 FROM content_visibility_overrides live_visibility
               WHERE live_visibility.chapter_id = current_chapter.id
                 AND live_visibility.auto_free_exempt = 1
         ))
         AND NOT EXISTS (
              SELECT 1 FROM content_visibility_overrides live_visibility
               WHERE live_visibility.chapter_id = current_chapter.id
                 AND live_visibility.access_type = 'PREMIUM'
         )
         AND (current_chapter.team_id = ? OR (? IS NULL AND current_chapter.team_id IS NULL))
         ${discountGuard}
         AND current_series.is_published = 1
         AND current_series.archived_at IS NULL
         AND current_series.rights_status IN ('LICENSED','AUTHORIZED','DEMO_ORIGINAL','TEST_ORIGINAL')
         AND NOT EXISTS (
              SELECT 1 FROM entitlements existing_entitlement
               WHERE existing_entitlement.user_id = ?
                 AND existing_entitlement.chapter_id = current_chapter.id
                 AND existing_entitlement.revoked_at IS NULL
                 AND existing_entitlement.starts_at <= CURRENT_TIMESTAMP
                 AND (existing_entitlement.expires_at IS NULL OR existing_entitlement.expires_at > CURRENT_TIMESTAMP)
         )
    )`,
    bindings: [
      access.chapterId,
      access.basePriceOnyx,
      access.teamId,
      access.teamId,
      ...bindings,
    ],
  };
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor("chapter.unlock.own");
    const payload = payloadSchema.parse(await request.json());
    if (!env.DB) {
      throw new ApiError(503, "DATABASE_UNAVAILABLE", "Wallet storage is unavailable.");
    }
    await requireFeature("premium_unlocks", env.DB);
    const commercial = await requirePaidEconomyPublicDocument();
    const paidEconomyRevision = commercial.revision;
    const series = await env.DB
      .prepare(
        `SELECT id FROM series
          WHERE slug = ? AND is_published = 1 AND archived_at IS NULL
            AND rights_status IN ('LICENSED','AUTHORIZED','DEMO_ORIGINAL','TEST_ORIGINAL')
          LIMIT 1`,
      )
      .bind(payload.seriesSlug)
      .first<{ id: string }>();
    if (!series) {
      throw new ApiError(404, "SERIES_NOT_AVAILABLE", "This series is not available for bulk unlock.");
    }

    const chapters = await env.DB
      .prepare(
        `SELECT id, slug FROM chapters
          WHERE series_id = ? AND access_type = 'PAID'
            AND state = 'PUBLISHED' AND visibility <> 'HIDDEN'
            AND published_at IS NOT NULL AND datetime(published_at) <= datetime('now')
          ORDER BY CAST(chapter_number AS REAL), id`,
      )
      .bind(series.id)
      .all<ChapterRow>();
    const decisions = await Promise.all(
      chapters.results.map((chapter) =>
        resolveChapterAccess(actor, payload.seriesSlug, chapter.slug),
      ),
    );
    const candidates = decisions.filter(
      (access) =>
        !access.canRead &&
        access.accessType === "PAID" &&
        access.accessLevel !== "PREMIUM" &&
        access.priceOnyx > 0 &&
        access.discountTargetType === "SERIES",
    );
    if (!candidates.length) {
      return json(
        requestId,
        { ok: true, alreadyUnlocked: true, unlockedChapterIds: [], totalPriceOnyx: 0 },
        { headers: { "cache-control": "private, no-store", vary: "Cookie" } },
      );
    }

    const totalPriceOnyx = candidates.reduce((sum, access) => sum + access.priceOnyx, 0);
    const wallet = await walletSnapshot(env.DB, actor.id, "ONYX");
    if (wallet.balance < totalPriceOnyx) {
      throw new ApiError(
        409,
        "INSUFFICIENT_ONYX",
        `Your ${commercial.settings.economy.coinPlural} balance is too low to unlock all discounted chapters.`,
      );
    }

    const idempotencyKey = `${actor.id}:series-unlock:${payload.idempotencyKey}`;
    const transactionId = randomId();
    const entitlementExpiresAt = commercial.settings.economy.permanentChapterUnlocks
      ? null
      : new Date(
          Date.now() + commercial.settings.economy.temporaryChapterUnlockHours * 60 * 60 * 1000,
        ).toISOString();
    const credits = new Map<string, { ownerType: "TEAM" | "PLATFORM"; ownerId: string; amount: number }>();
    for (const access of candidates) {
      const accountId = creditAccountFor(access);
      const existing = credits.get(accountId);
      credits.set(accountId, {
        ownerType: access.teamId ? "TEAM" : "PLATFORM",
        ownerId: access.teamId ?? "NYASCANS",
        amount: (existing?.amount ?? 0) + access.priceOnyx,
      });
    }
    const creditedTotal = [...credits.values()].reduce((sum, credit) => sum + credit.amount, 0);
    if (creditedTotal !== totalPriceOnyx) {
      throw new ApiError(500, "LEDGER_UNBALANCED", "The bulk unlock ledger transaction is not balanced.");
    }
    const guards = candidates.map(candidateGuard);
    const statements: D1PreparedStatement[] = [
      ...[...credits.entries()].map(([accountId, credit]) =>
        env.DB!.prepare(
          `INSERT OR IGNORE INTO ledger_accounts (id, owner_type, owner_id, currency, account_type)
           SELECT ?, ?, ?, 'ONYX', 'EARNED'
            WHERE ${paidEconomyRevisionGuardSql(paidEconomyRevision)}`,
        ).bind(accountId, credit.ownerType, credit.ownerId),
      ),
      env.DB.prepare(
        `INSERT OR IGNORE INTO ledger_transactions
         (id, kind, reference_type, reference_id, idempotency_key, memo)
         SELECT ?, 'SERIES_BULK_UNLOCK', 'SERIES', ?, ?, ?
          WHERE COALESCE((SELECT SUM(amount) FROM ledger_entries WHERE account_id = ?), 0) >= ?
            AND ${paidEconomyRevisionGuardSql(paidEconomyRevision)}
            AND ${guards.map((guard) => guard.sql).join("\n            AND ")}`,
      ).bind(
        transactionId,
        series.id,
        idempotencyKey,
        `Bulk unlock of ${candidates.length} discounted chapter${candidates.length === 1 ? "" : "s"}`,
        wallet.accountId,
        totalPriceOnyx,
        ...guards.flatMap((guard) => [...guard.bindings, actor.id]),
      ),
      env.DB.prepare(
        `INSERT INTO ledger_entries (id, transaction_id, account_id, amount)
         SELECT ?, id, ?, ? FROM ledger_transactions WHERE id = ?`,
      ).bind(randomId(), wallet.accountId, -totalPriceOnyx, transactionId),
      ...[...credits.entries()].map(([accountId, credit]) =>
        env.DB!.prepare(
          `INSERT INTO ledger_entries (id, transaction_id, account_id, amount)
           SELECT ?, id, ?, ? FROM ledger_transactions WHERE id = ?`,
        ).bind(randomId(), accountId, credit.amount, transactionId),
      ),
      ...candidates.flatMap((access) => {
        const entitlementId = randomId();
        return [
          env.DB!.prepare(
            `INSERT INTO entitlements (id, user_id, chapter_id, source_type, source_id, expires_at)
             SELECT ?, ?, ?, 'ONYX_UNLOCK', id, ? FROM ledger_transactions WHERE id = ?
             ON CONFLICT(user_id, chapter_id) DO UPDATE SET source_type=excluded.source_type, source_id=excluded.source_id, starts_at=CURRENT_TIMESTAMP, expires_at=excluded.expires_at, revoked_at=NULL`,
          ).bind(entitlementId, actor.id, access.chapterId, entitlementExpiresAt, transactionId),
          env.DB!.prepare(
            `INSERT INTO chapter_unlock_receipts (id, transaction_id, entitlement_id, buyer_user_id, chapter_id, team_id, amount, currency)
             SELECT ?, lt.id, e.id, ?, ?, ?, ?, 'ONYX'
               FROM ledger_transactions lt JOIN entitlements e ON e.user_id = ? AND e.chapter_id = ?
              WHERE lt.id = ?`,
          ).bind(randomId(), actor.id, access.chapterId, access.teamId, access.priceOnyx, actor.id, access.chapterId, transactionId),
        ];
      }),
      env.DB.prepare(
        `INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, request_id, new_value_json)
         SELECT ?, ?, 'series.bulk_unlock', 'SERIES', ?, ?, ? FROM ledger_transactions WHERE id = ?`,
      ).bind(
        randomId(), actor.id, series.id, requestId,
        JSON.stringify({ chapterIds: candidates.map((access) => access.chapterId), totalPriceOnyx, entitlementExpiresAt }),
        transactionId,
      ),
    ];
    const results = await env.DB.batch(statements);
    const transactionIndex = credits.size;
    const created = Number(results[transactionIndex]?.meta.changes ?? 0) > 0;
    if (!created) {
      const prior = await env.DB.prepare(
        `SELECT reference_id AS referenceId FROM ledger_transactions WHERE idempotency_key = ? LIMIT 1`,
      ).bind(idempotencyKey).first<{ referenceId: string }>();
      if (prior?.referenceId === series.id) {
        return json(requestId, { ok: true, alreadyUnlocked: true, unlockedChapterIds: candidates.map((access) => access.chapterId), totalPriceOnyx }, { headers: { "cache-control": "private, no-store", vary: "Cookie" } });
      }
      await assertPaidEconomyRevisionFresh(paidEconomyRevision);
      throw new ApiError(409, "BULK_UNLOCK_CONFLICT", "The discounted chapter list changed. Refresh and try again.");
    }
    const updatedWallet = await walletSnapshot(env.DB, actor.id, "ONYX");
    return json(requestId, {
      ok: true,
      unlockedChapterIds: candidates.map((access) => access.chapterId),
      totalPriceOnyx,
      balance: updatedWallet.balance,
      entitlementExpiresAt,
    }, { status: 201, headers: { "cache-control": "private, no-store", vary: "Cookie" } });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
