import { z } from "zod";
import { errorResponse, json, ApiError } from "@/lib/server/api";
import { assertSameOrigin, requestIdFor } from "@/lib/server/admin-utils";
import {
  adminMfaCookie,
  beginAdminMfaEnrollment,
  clearAdminMfaCookie,
  getAdminMfaState,
  revokeAdminMfaSession,
  verifyAdminMfa,
} from "@/lib/server/admin-mfa";
import { actorHasCapability, requireActor, type Actor } from "@/lib/server/policy";

export const dynamic = "force-dynamic";

function assertAdminIdentity(actor: Actor) {
  if (!actorHasCapability(actor, "admin.console.access")) {
    throw new ApiError(403, "ADMIN_REQUIRED", "Staff authorization is required.");
  }
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    assertAdminIdentity(actor);
    return json(requestId, { data: await getAdminMfaState(actor.id, request.headers) }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    assertAdminIdentity(actor);
    const payload = z.discriminatedUnion("action", [
      z.object({ action: z.literal("BEGIN") }),
      z.object({ action: z.literal("VERIFY"), code: z.string().trim() }),
    ]).parse(await request.json());
    if (payload.action === "BEGIN") {
      return json(requestId, { data: await beginAdminMfaEnrollment(actor.id, actor.email) }, { headers: { "cache-control": "private, no-store" } });
    }
    const verified = await verifyAdminMfa(actor.id, payload.code, request.headers);
    return json(requestId, { data: { verified: true, enrolledNow: verified.enrolledNow, suspicious: verified.suspicious, expiresAt: verified.expiresAt } }, {
      headers: { "set-cookie": adminMfaCookie(verified.token, verified.expiresAt), "cache-control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function DELETE(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    assertAdminIdentity(actor);
    await revokeAdminMfaSession(actor.id, request.headers);
    return json(requestId, { data: { verified: false } }, { headers: { "set-cookie": clearAdminMfaCookie() } });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
