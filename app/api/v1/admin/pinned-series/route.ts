import { z } from "zod";
import { errorResponse, json } from "@/lib/server/api";
import { assertSameOrigin, requestIdFor } from "@/lib/server/admin-utils";
import {
  listAdminPinnedSeries,
  replacePinnedSeries,
} from "@/lib/server/pinned-series";
import { requireActor, requireAdmin } from "@/lib/server/policy";

export const dynamic = "force-dynamic";

const optionalDate = z.string().datetime({ offset: true }).nullable();
const replaceSchema = z.object({
  revision: z.coerce.number().int().min(1),
  items: z
    .array(
      z
        .object({
          id: z.string().trim().max(160).optional(),
          seriesId: z.string().trim().min(3).max(160),
          featured: z.boolean(),
          startsAt: optionalDate,
          endsAt: optionalDate,
        })
        .superRefine((item, context) => {
          if (
            item.startsAt &&
            item.endsAt &&
            Date.parse(item.endsAt) <= Date.parse(item.startsAt)
          ) {
            context.addIssue({
              code: "custom",
              path: ["endsAt"],
              message: "The end date must be after the start date.",
            });
          }
        }),
    )
    .max(12),
});

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    requireAdmin(actor);
    const query = new URL(request.url).searchParams.get("q") ?? "";
    return json(requestId, await listAdminPinnedSeries(query), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function PUT(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireAdmin(actor);
    const payload = replaceSchema.parse(await request.json());
    return json(
      requestId,
      await replacePinnedSeries(
        payload.items,
        payload.revision,
        actor,
        requestId,
      ),
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
