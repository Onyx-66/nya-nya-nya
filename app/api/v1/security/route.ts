import { z } from "zod";
import { errorResponse, json } from "@/lib/server/api";
import { assertSameOrigin, requestIdFor } from "@/lib/server/admin-utils";
import {
  beginPasskeyRegistration,
  beginTotpEnrollment,
  disableTotp,
  finishPasskeyRegistration,
  finishTotpEnrollment,
  generateRecoveryCodes,
  getSecurityStatus,
  listPasskeys,
  regenerateRecoveryCodes,
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
  z.object({ action: z.literal("TOTP_BEGIN") }),
  z.object({ action: z.literal("TOTP_VERIFY"), code: z.string().trim().min(1).max(32) }),
  z.object({
    action: z.literal("TOTP_DISABLE"),
    password: z.string().max(512).optional(),
    code: z.string().trim().max(32).optional(),
  }).refine((value) => Boolean(value.password || value.code), "Re-authentication is required."),
  z.object({ action: z.literal("RECOVERY_CODES_REGENERATE"), password: z.string().min(1).max(512) }),
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

    if (payload.action === "TOTP_BEGIN") {
      return json(requestId, { data: await beginTotpEnrollment(actor.id, actor.email) }, { headers: { "cache-control": "private, no-store" } });
    }

    if (payload.action === "TOTP_VERIFY") {
      const result = await finishTotpEnrollment(actor.id, payload.code, request.headers);
      return json(requestId, {
        data: {
          enrolled: true,
          recoveryCodes: result.recoveryCodes,
        },
      }, { headers: { "cache-control": "private, no-store" } });
    }

    if (payload.action === "TOTP_DISABLE") {
      await disableTotp({
        userId: actor.id,
        password: payload.password,
        code: payload.code,
        requestHeaders: request.headers,
      });
      return json(requestId, { data: { disabled: true } }, { headers: { "cache-control": "private, no-store" } });
    }

    if (payload.action === "RECOVERY_CODES_REGENERATE") {
      return json(requestId, {
        data: { recoveryCodes: await regenerateRecoveryCodes(actor.id, payload.password) },
      }, { headers: { "cache-control": "private, no-store" } });
    }

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
