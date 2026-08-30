import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { assertSameOrigin, requestIdFor } from "@/lib/server/admin-utils";
import { requireActor, requireAdminCapability } from "@/lib/server/policy";
import { listSeriesPaidPolicies, saveSeriesPaidPolicy, syncLastPaidForSeries } from "@/lib/server/series-paid-policies";
import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";
const mutationSchema = z.object({
  seriesId: z.string().trim().min(2).max(160),
  paidChapterCount: z.number().int().min(0).max(1000),
  priceOnyx: z.number().int().min(1).max(1_000_000),
  autoFreeAfterDays: z.number().int().min(1).max(3650).nullable(),
  expectedRevision: z.number().int().min(0).optional(),
});
function db() { if (!env.DB) throw new ApiError(503, "DATABASE_UNAVAILABLE", "Paid policies are unavailable."); return env.DB; }
export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor(); requireAdminCapability(actor, "content.chapters.manage");
    const query = new URL(request.url).searchParams.get("q") ?? "";
    return json(requestId, { data: { policies: await listSeriesPaidPolicies(db(), query) } }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(requestId, error); }
}
export async function PUT(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor(); requireAdminCapability(actor, "content.chapters.manage");
    const payload = mutationSchema.parse(await request.json());
    const database = db();
    const result = await saveSeriesPaidPolicy(database, actor, requestId, payload);
    const global = await database.prepare("SELECT mode, auto_free_after_days AS autoFreeAfterDays FROM content_visibility_settings WHERE id = 'active'").first<{ mode: string; autoFreeAfterDays: number | null }>();
    if (global?.mode === "LAST_PAID") await syncLastPaidForSeries(database, payload.seriesId, global.autoFreeAfterDays ?? 7);
    return json(requestId, { data: { ...result, policies: await listSeriesPaidPolicies(db()) } }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(requestId, error); }
}
