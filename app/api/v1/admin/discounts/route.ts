import { z } from "zod";
import { errorResponse, json } from "@/lib/server/api";
import { assertSameOrigin, requestIdFor } from "@/lib/server/admin-utils";
import {
  deleteDiscount,
  listAdminDiscounts,
  saveDiscount,
} from "@/lib/server/content-discounts";
import { requireActor, requireAdmin } from "@/lib/server/policy";

export const dynamic = "force-dynamic";

const discountSchema = z
  .object({
    id: z.string().trim().min(3).max(160).optional(),
    revision: z.coerce.number().int().min(1).optional(),
    targetType: z.enum(["SERIES", "CHAPTER"]),
    seriesId: z.string().trim().min(3).max(160),
    chapterId: z.string().trim().min(3).max(160).nullable(),
    discountType: z.enum(["PERCENT", "FIXED"]),
    discountValue: z.coerce.number().int().min(1).max(10_000_000),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    active: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.targetType === "CHAPTER" && !value.chapterId) {
      context.addIssue({
        code: "custom",
        path: ["chapterId"],
        message: "Select a paid chapter.",
      });
    }
    if (value.targetType === "SERIES" && value.chapterId) {
      context.addIssue({
        code: "custom",
        path: ["chapterId"],
        message: "A series discount cannot reference a chapter.",
      });
    }
    if (
      value.discountType === "PERCENT" &&
      value.discountValue > 99
    ) {
      context.addIssue({
        code: "custom",
        path: ["discountValue"],
        message: "Percentage discounts must be between 1 and 99.",
      });
    }
    if (Date.parse(value.endsAt) <= Date.parse(value.startsAt)) {
      context.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "The end date must be after the start date.",
      });
    }
    if (value.id && !value.revision) {
      context.addIssue({
        code: "custom",
        path: ["revision"],
        message: "Reload this discount before updating it.",
      });
    }
  });

const deleteSchema = z.object({
  id: z.string().trim().min(3).max(160),
  revision: z.coerce.number().int().min(1),
});

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    requireAdmin(actor);
    const query = new URL(request.url).searchParams.get("q") ?? "";
    return json(requestId, await listAdminDiscounts(query), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireAdmin(actor);
    const payload = discountSchema.parse(await request.json());
    return json(
      requestId,
      await saveDiscount(payload, actor, requestId),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function PATCH(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireAdmin(actor);
    const payload = discountSchema.parse(await request.json());
    return json(requestId, await saveDiscount(payload, actor, requestId));
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function DELETE(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireAdmin(actor);
    const payload = deleteSchema.parse(await request.json());
    return json(
      requestId,
      await deleteDiscount(payload.id, payload.revision, actor, requestId),
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
