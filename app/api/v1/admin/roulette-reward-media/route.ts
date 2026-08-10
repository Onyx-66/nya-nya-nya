import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  assertSameOrigin,
  requestIdFor,
  sha256Hex,
  validateImageFile,
} from "@/lib/server/admin-utils";
import { requireActor, requireAdminCapability } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";

export const dynamic = "force-dynamic";

const rewardIdSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const deleteSchema = z.object({
  key: z.string().trim().min(20).max(320),
});

function extension(contentType: string) {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/png") return "png";
  return "webp";
}

function assertRewardKey(key: string) {
  if (!key.startsWith("roulette/rewards/") || key.includes("..")) {
    throw new ApiError(422, "REWARD_MEDIA_KEY_INVALID", "Invalid reward image.");
  }
}

export async function PUT(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireAdminCapability(actor, "roulette.manage");
    if (!env.BUCKET) {
      throw new ApiError(
        503,
        "MEDIA_UNAVAILABLE",
        "Reward image storage is temporarily unavailable.",
      );
    }
    const form = await request.formData();
    const rewardId = rewardIdSchema.parse(form.get("rewardId"));
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ApiError(422, "IMAGE_REQUIRED", "Choose a reward image.");
    }
    const image = await validateImageFile(file, {
      label: "Roulette reward",
      maxBytes: 1_500_000,
      minWidth: 48,
      minHeight: 48,
      maxWidth: 1_024,
      maxHeight: 1_024,
      allowAnimation: false,
    });
    const digest = await sha256Hex(image.bytes);
    const key = `roulette/rewards/${rewardId}/${randomId()}-${digest.slice(0, 12)}.${extension(image.contentType)}`;
    await env.BUCKET.put(key, image.bytes, {
      httpMetadata: {
        contentType: image.contentType,
        cacheControl: "public, max-age=31536000, immutable",
      },
      customMetadata: {
        rewardId,
        width: String(image.dimensions.width),
        height: String(image.dimensions.height),
        sha256: digest,
      },
    });
    return json(
      requestId,
      {
        key,
        url: `/api/v1/roulette-reward-media?key=${encodeURIComponent(key)}`,
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function DELETE(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireAdminCapability(actor, "roulette.manage");
    if (!env.BUCKET) {
      throw new ApiError(
        503,
        "MEDIA_UNAVAILABLE",
        "Reward image storage is temporarily unavailable.",
      );
    }
    const payload = deleteSchema.parse(await request.json());
    assertRewardKey(payload.key);
    await env.BUCKET.delete(payload.key);
    return json(requestId, { deleted: true });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
