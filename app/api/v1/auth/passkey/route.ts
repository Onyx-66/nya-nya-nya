import { z } from "zod";
import { errorResponse, json } from "@/lib/server/api";
import { assertSameOrigin, requestIdFor } from "@/lib/server/admin-utils";
import {
  beginPasskeyAuthentication,
  finishPasskeyAuthentication,
} from "@/lib/server/account-security";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const email = new URL(request.url).searchParams.get("email")?.trim().toLowerCase() || undefined;
    return json(requestId, {
      data: await beginPasskeyAuthentication({ email, request }),
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const payload = z.object({
      challengeId: z.string().min(1).max(120),
      response: z.record(z.string(), z.unknown()),
    }).parse(await request.json());
    const result = await finishPasskeyAuthentication({
      challengeId: payload.challengeId,
      response: payload.response as unknown as AuthenticationResponseJSON,
      request,
    });
    return json(requestId, {
      data: {
        signedIn: true,
        identity: result.identity,
      },
    }, {
      headers: {
        "set-cookie": result.cookie,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
