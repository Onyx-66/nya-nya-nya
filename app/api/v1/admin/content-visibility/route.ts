import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { assertSameOrigin, requestIdFor } from "@/lib/server/admin-utils";
import {
  clearContentVisibilityOverride,
  listContentVisibility,
  saveContentVisibilityDefaults,
  setContentVisibilityOverride,
} from "@/lib/server/content-visibility";
import { requireActor, requireAdminCapability } from "@/lib/server/policy";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().trim().max(160).default(""),
  access: z.enum(["ALL", "FREE", "PAID", "PREMIUM"]).default("ALL"),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(10).max(100).default(25),
});

const defaultsSchema = z
  .object({
    action: z.literal("SAVE_DEFAULTS"),
    expectedRevision: z.number().int().min(1),
    defaultAccessType: z.enum(["FREE", "PAID"]),
    defaultPriceOnyx: z.number().int().min(0).max(1_000_000),
    autoFreeAfterDays: z.number().int().min(1).max(3650).nullable(),
  })
  .superRefine((value, context) => {
    if (value.defaultAccessType === "FREE" && value.defaultPriceOnyx !== 0) {
      context.addIssue({ code: "custom", path: ["defaultPriceOnyx"], message: "Free chapters cannot have a coin price." });
    }
    if (value.defaultAccessType === "PAID" && value.defaultPriceOnyx < 1) {
      context.addIssue({ code: "custom", path: ["defaultPriceOnyx"], message: "Paid chapters need a coin price." });
    }
  });

const setOverrideSchema = z
  .object({
    action: z.literal("SET_OVERRIDE"),
    chapterId: z.string().trim().min(3).max(160),
    expectedChapterRevision: z.number().int().min(1),
    accessType: z.enum(["FREE", "PAID", "PREMIUM"]),
    priceOnyx: z.number().int().min(0).max(1_000_000),
    autoFreeExempt: z.boolean(),
    reason: z.string().trim().min(6).max(500),
  })
  .superRefine((value, context) => {
    if (value.accessType === "FREE" && value.priceOnyx !== 0) {
      context.addIssue({ code: "custom", path: ["priceOnyx"], message: "Free chapters cannot have a coin price." });
    }
    if (value.accessType === "PAID" && value.priceOnyx < 1) {
      context.addIssue({ code: "custom", path: ["priceOnyx"], message: "Paid chapters need a coin price." });
    }
    if (value.accessType === "PREMIUM" && value.priceOnyx !== 0) {
      context.addIssue({ code: "custom", path: ["priceOnyx"], message: "Premium membership access cannot have a coin price." });
    }
  });

const clearOverrideSchema = z.object({
  action: z.literal("CLEAR_OVERRIDE"),
  chapterId: z.string().trim().min(3).max(160),
  expectedChapterRevision: z.number().int().min(1),
  expectedOverrideRevision: z.number().int().min(1),
  reason: z.string().trim().min(6).max(500),
});

const mutationSchema = z.discriminatedUnion("action", [
  defaultsSchema,
  setOverrideSchema,
  clearOverrideSchema,
]);

function database() {
  if (!env.DB) {
    throw new ApiError(503, "DATABASE_UNAVAILABLE", "Content Visibility is unavailable.");
  }
  return env.DB;
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    requireAdminCapability(actor, "content.chapters.manage");
    const url = new URL(request.url);
    const query = querySchema.parse({
      q: url.searchParams.get("q") ?? "",
      access: url.searchParams.get("access") ?? "ALL",
      page: url.searchParams.get("page") ?? 1,
      limit: url.searchParams.get("limit") ?? 25,
    });
    return json(requestId, await listContentVisibility(database(), query), {
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
    requireAdminCapability(actor, "content.chapters.manage");
    const payload = mutationSchema.parse(await request.json());
    const db = database();
    await (payload.action === "SAVE_DEFAULTS"
      ? saveContentVisibilityDefaults(db, actor, requestId, payload)
      : payload.action === "SET_OVERRIDE"
        ? setContentVisibilityOverride(db, actor, requestId, payload)
        : clearContentVisibilityOverride(db, actor, requestId, payload));
    return json(
      requestId,
      await listContentVisibility(db, {
        q: "",
        access: "ALL",
        page: 1,
        limit: 25,
      }),
      {
        headers: { "cache-control": "private, no-store" },
      },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
