import { env } from "cloudflare:workers";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  assertSameOrigin,
  requestIdFor,
} from "@/lib/server/admin-utils";
import {
  economySnapshot,
  platformAccountId,
  walletSnapshot,
} from "@/lib/server/economy";
import {
  assertPaidEconomyRevisionFresh,
  getCommercialSettingsDocument,
  paidEconomyRevisionGuardSql,
  requirePaidEconomyPublicDocument,
} from "@/lib/server/commercial-settings";
import { requireActor } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";
import { storePurchaseSchema } from "@/lib/storefront";

export const dynamic = "force-dynamic";

type StoreItemRow = {
  id: string;
  name: string;
  priceAmount: number;
  priceCurrency: "ONYX" | "SHARDS";
  category: string;
  isPublished: number;
  isHidden: number;
  collectionEnabled: number;
  startsAt: string | null;
  endsAt: string | null;
  revision: number;
};

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    const payload = storePurchaseSchema.parse(await request.json());
    const commercial = await getCommercialSettingsDocument();
    const premiumEconomyPublic =
      !commercial.recoveredFromInvalid &&
      commercial.settings.economy.premiumEconomyPublic;
    const ownerPreview = actor.roles.includes("OWNER");
    if (!premiumEconomyPublic && !ownerPreview) {
      throw new ApiError(
        403,
        "LOCK_AND_PAY_PRIVATE",
        "Purchases are currently private.",
      );
    }
    if (!env.DB) {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "Store purchases are temporarily unavailable.",
      );
    }
    const item = await env.DB.prepare(
      `SELECT si.id, si.name, si.price_onyx AS priceAmount,
              si.price_currency AS priceCurrency, si.category,
              si.is_published AS isPublished,
              si.is_hidden AS isHidden,
              sc.enabled AS collectionEnabled,
              sc.starts_at AS startsAt, sc.ends_at AS endsAt,
              si.revision
         FROM store_items si
         JOIN store_collections sc ON sc.id = si.collection_id
        WHERE si.id = ?
          AND si.archived_at IS NULL
        LIMIT 1`,
    )
      .bind(payload.itemId)
      .first<StoreItemRow>();
    const now = Date.now();
    if (
      !item ||
      !item.isPublished ||
      item.isHidden ||
      !item.collectionEnabled ||
      (item.startsAt && Date.parse(item.startsAt) > now) ||
      (item.endsAt && Date.parse(item.endsAt) <= now)
    ) {
      throw new ApiError(
        404,
        "STORE_ITEM_NOT_AVAILABLE",
        "This cosmetic is not currently available.",
      );
    }
    const existingOwnership = await env.DB.prepare(
      `SELECT created_at AS purchasedAt
         FROM user_store_items
        WHERE user_id = ? AND item_id = ?
        LIMIT 1`,
    )
      .bind(actor.id, item.id)
      .first<{ purchasedAt: string }>();
    if (existingOwnership) {
      return json(
        requestId,
        {
          ok: true,
          alreadyOwned: true,
          itemId: item.id,
          purchasedAt: existingOwnership.purchasedAt,
          balances: premiumEconomyPublic
            ? await economySnapshot(env.DB, actor.id)
            : { shards: await walletSnapshot(env.DB, actor.id, "SHARDS") },
        },
        { headers: { "cache-control": "private, no-store", vary: "Cookie" } },
      );
    }
    if (item.priceCurrency === "ONYX" && !premiumEconomyPublic && !ownerPreview) {
      throw new ApiError(
        403,
        "PAID_ECONOMY_HIDDEN",
        "Premium coin purchases are currently private.",
      );
    }
    const paidCommercial =
      item.priceCurrency === "ONYX"
        ? ownerPreview
          ? commercial
          : await requirePaidEconomyPublicDocument()
        : null;
    const paidEconomyRevision = paidCommercial?.revision ?? null;
    const amount = Number(item.priceAmount);
    const wallet = await walletSnapshot(
      env.DB,
      actor.id,
      item.priceCurrency,
    );
    if (wallet.balance < amount) {
      throw new ApiError(
        409,
        item.priceCurrency === "SHARDS"
          ? "INSUFFICIENT_SHARDS"
          : "INSUFFICIENT_ONYX",
        `Your ${
          item.priceCurrency === "SHARDS"
            ? "Shard"
            : paidCommercial!.settings.economy.coinName
        } balance is too low for this cosmetic.`,
      );
    }
    const platformId = platformAccountId("store", item.priceCurrency);
    const transactionId = randomId();
    const idempotencyKey = `${actor.id}:store:${payload.idempotencyKey}`;
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO ledger_accounts
         (id, owner_type, owner_id, currency, account_type)
         SELECT ?, 'PLATFORM', 'NYASCANS_STORE', ?, 'EARNED'
          WHERE ${
            paidEconomyRevision === null
              ? "1 = 1"
              : paidEconomyRevisionGuardSql(paidEconomyRevision)
          }`,
      ).bind(platformId, item.priceCurrency),
      env.DB.prepare(
        `INSERT OR IGNORE INTO ledger_transactions
         (id, kind, reference_type, reference_id, idempotency_key, memo)
         SELECT ?, 'STORE_PURCHASE', 'STORE_ITEM', ?, ?, ?
          WHERE COALESCE((
                  SELECT SUM(amount) FROM ledger_entries WHERE account_id = ?
                ), 0) >= ?
            AND EXISTS (
                  SELECT 1
                    FROM store_items current_item
                    JOIN store_collections current_collection
                      ON current_collection.id = current_item.collection_id
                   WHERE current_item.id = ?
                     AND current_item.revision = ?
                     AND current_item.price_onyx = ?
                     AND current_item.price_currency = ?
                     AND current_item.is_published = 1
                     AND current_item.is_hidden = 0
                     AND current_item.archived_at IS NULL
                     AND current_collection.enabled = 1
                     AND (
                       current_collection.starts_at IS NULL
                       OR datetime(current_collection.starts_at) <= datetime('now')
                     )
                     AND (
                       current_collection.ends_at IS NULL
                       OR datetime(current_collection.ends_at) > datetime('now')
                     )
                )
            AND ${
              paidEconomyRevision === null
                ? "1 = 1"
                : paidEconomyRevisionGuardSql(paidEconomyRevision)
            }
            AND NOT EXISTS (
                  SELECT 1 FROM user_store_items
                   WHERE user_id = ? AND item_id = ?
                )`,
      ).bind(
        transactionId,
        item.id,
        idempotencyKey,
        `Store purchase: ${item.name} · ${amount} ${
          item.priceCurrency === "SHARDS"
            ? "Shards"
            : paidCommercial!.settings.economy.coinPlural
        }`,
        wallet.accountId,
        amount,
        item.id,
        item.revision,
        amount,
        item.priceCurrency,
        actor.id,
        item.id,
      ),
      env.DB.prepare(
        `INSERT INTO ledger_entries
         (id, transaction_id, account_id, amount)
         SELECT ?, id, ?, ? FROM ledger_transactions WHERE id = ?`,
      ).bind(randomId(), wallet.accountId, -amount, transactionId),
      env.DB.prepare(
        `INSERT INTO ledger_entries
         (id, transaction_id, account_id, amount)
         SELECT ?, id, ?, ? FROM ledger_transactions WHERE id = ?`,
      ).bind(randomId(), platformId, amount, transactionId),
      env.DB.prepare(
        `INSERT INTO user_store_items
         (user_id, item_id, transaction_id)
         SELECT ?, ?, id FROM ledger_transactions WHERE id = ?`,
      ).bind(actor.id, item.id, transactionId),
      env.DB.prepare(
        `INSERT INTO audit_logs
         (id, actor_user_id, action, target_type, target_id, request_id,
          new_value_json)
         SELECT ?, ?, 'store.item.purchase', 'STORE_ITEM', ?, ?, ?
           FROM ledger_transactions WHERE id = ?`,
      ).bind(
        randomId(),
        actor.id,
        item.id,
        requestId,
        JSON.stringify({
          priceAmount: amount,
          priceCurrency: item.priceCurrency,
          category: item.category,
        }),
        transactionId,
      ),
    ]);
    const created = Number(results[1]?.meta.changes ?? 0) === 1;
    if (!created) {
      const priorTransaction = await env.DB.prepare(
        `SELECT reference_id AS referenceId
           FROM ledger_transactions
          WHERE idempotency_key = ?
          LIMIT 1`,
      )
        .bind(idempotencyKey)
        .first<{ referenceId: string }>();
      if (priorTransaction && priorTransaction.referenceId !== item.id) {
        throw new ApiError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "Use a new purchase identifier for a different cosmetic.",
        );
      }
      const ownership = await env.DB.prepare(
        `SELECT created_at AS purchasedAt
           FROM user_store_items
          WHERE user_id = ? AND item_id = ?
          LIMIT 1`,
      )
        .bind(actor.id, item.id)
        .first<{ purchasedAt: string }>();
      if (!ownership) {
        if (paidEconomyRevision !== null) {
          await assertPaidEconomyRevisionFresh(paidEconomyRevision);
        }
        throw new ApiError(
          409,
          "STORE_PURCHASE_CONFLICT",
          "Your balance or this cosmetic changed. Refresh and try again.",
        );
      }
    }
    return json(
      requestId,
      {
        ok: true,
        alreadyOwned: !created,
        itemId: item.id,
        currency: item.priceCurrency,
        balances: premiumEconomyPublic
          ? await economySnapshot(env.DB, actor.id)
          : { shards: await walletSnapshot(env.DB, actor.id, "SHARDS") },
      },
      {
        status: created ? 201 : 200,
        headers: { "cache-control": "private, no-store", vary: "Cookie" },
      },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
