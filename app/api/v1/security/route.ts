import { z } from "zod";
import { errorResponse, json } from "@/lib/server/api";
import { assertSameOrigin, requestIdFor } from "@/lib/server/admin-utils";
import {
  beginPasskeyRegistration,
  finishPasskeyRegistration,
  getSecurityStatus,
  listPasskeys,
  removePasskey,
} from "@/lib/server/account-security";
import { requireActor } from "@/lib/server/policy";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";

export const dynamic = "force-dynamic";

const registrationResponseSchema = z.record(z.string(), z.unknown());

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    return json(requestId, {
      data: {
        ...(await getSecurityStatus(actor.id)),
        passkeys: await listPasskeys(actor.id),
      },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("PASSKEY_REGISTER_BEGIN") }),
  z.object({
    action: z.literal("PASSKEY_REGISTER_FINISH"),
    challengeId: z.string().min(1).max(120),
    response: registrationResponseSchema,
    deviceName: z.string().trim().max(80).optional(),
  }),
  z.object({ action: z.literal("PASSKEY_REMOVE"), passkeyId: z.string().min(1).max(120) }),
]);

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    const payload = actionSchema.parse(await request.json());

    if (payload.action === "PASSKEY_REGISTER_BEGIN") {
      return json(requestId, {
        data: await beginPasskeyRegistration({
          userId: actor.id,
          email: actor.email,
          displayName: actor.displayName,
          request,
        }),
      }, { headers: { "cache-control": "private, no-store" } });
    }

    if (payload.action === "PASSKEY_REGISTER_FINISH") {
      await finishPasskeyRegistration({
        userId: actor.id,
        challengeId: payload.challengeId,
        response: payload.response as unknown as RegistrationResponseJSON,
        deviceName: payload.deviceName,
        request,
      });
      return json(requestId, { data: { registered: true, passkeys: await listPasskeys(actor.id) } }, { headers: { "cache-control": "private, no-store" } });
    }

    await removePasskey(actor.id, payload.passkeyId);
    return json(requestId, { data: { removed: true, passkeys: await listPasskeys(actor.id) } }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
