import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { assertSameOrigin, requestIdFor } from "@/lib/server/admin-utils";
import {
  claimAdUnlockChallenge,
  createAdUnlockChallenge,
  getAdUnlockAvailability,
  getAdUnlockChallengeStatus,
} from "@/lib/server/ad-unlocks";
import { getFeatureStates, requireFeature } from "@/lib/server/feature-flags";
import { requireActor } from "@/lib/server/policy";

export const dynamic = "force-dynamic";

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);

const challengeIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(160)
  .regex(/^[A-Za-z0-9._:-]+$/);

const mutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("CREATE"),
    seriesSlug: slugSchema,
    chapterSlug: slugSchema,
  }),
  z.object({
    action: z.literal("CLAIM"),
    challengeId: challengeIdSchema,
  }),
]);

const availabilityQuerySchema = z.object({
  seriesSlug: slugSchema,
  chapterSlug: slugSchema,
});

const statusQuerySchema = z.object({
  challengeId: challengeIdSchema,
});

function database() {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Ad-supported chapter access is temporarily unavailable.",
    );
  }
  return env.DB;
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    const url = new URL(request.url);
    const challengeId = url.searchParams.get("challengeId");
    if (challengeId) {
      await requireFeature("ad_supported_unlocks", database());
      const query = statusQuerySchema.parse({ challengeId });
      return json(
        requestId,
        {
          data: await getAdUnlockChallengeStatus(
            database(),
            actor,
            query.challengeId,
          ),
        },
        { headers: { "cache-control": "private, no-store" } },
      );
    }

    const query = availabilityQuerySchema.parse({
      seriesSlug: url.searchParams.get("seriesSlug") ?? undefined,
      chapterSlug: url.searchParams.get("chapterSlug") ?? undefined,
    });
    const state = (await getFeatureStates(database())).ad_supported_unlocks;
    if (!state.effective) {
      return json(
        requestId,
        { data: { available: false } },
        { headers: { "cache-control": "private, no-store" } },
      );
    }
    return json(
      requestId,
      {
        data: await getAdUnlockAvailability(
          actor,
          query.seriesSlug,
          query.chapterSlug,
        ),
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    const payload = mutationSchema.parse(await request.json());
    const db = database();
    await requireFeature("ad_supported_unlocks", db);
    const data =
      payload.action === "CREATE"
        ? await createAdUnlockChallenge(db, actor, {
            seriesSlug: payload.seriesSlug,
            chapterSlug: payload.chapterSlug,
            requestUrl: request.url,
          })
        : await claimAdUnlockChallenge(db, actor, payload.challengeId);
    return json(requestId, { data }, {
      status: payload.action === "CREATE" ? 201 : 200,
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
