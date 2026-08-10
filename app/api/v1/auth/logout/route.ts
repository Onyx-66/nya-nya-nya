import { z } from "zod";
import {
  chatGPTSignOutPath,
  getChatGPTUser,
  safeAuthReturnPath,
} from "@/app/chatgpt-auth";
import { errorResponse, json } from "@/lib/server/api";
import { assertSameOrigin, requestIdFor } from "@/lib/server/admin-utils";
import {
  clearPasswordSessionCookie,
  revokePasswordSession,
} from "@/lib/server/local-auth";
import { clearAdminMfaCookie, revokeAdminMfaSessionFromHeaders } from "@/lib/server/admin-mfa";

export const dynamic = "force-dynamic";

const logoutSchema = z.object({
  returnTo: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const input = logoutSchema.parse(await request.json().catch(() => ({})));
    const returnTo = safeAuthReturnPath(input.returnTo ?? "/");
    const providerIdentity = await getChatGPTUser();
    await revokeAdminMfaSessionFromHeaders(request.headers).catch(() => undefined);
    await revokePasswordSession(new Headers(request.headers));
    const response = json(
      requestId,
      {
        signedOut: true,
        returnTo,
        providerSignOutPath: providerIdentity
          ? chatGPTSignOutPath(returnTo)
          : null,
      },
      {
        headers: {
          "cache-control": "no-store",
          "set-cookie": clearPasswordSessionCookie(),
        },
      },
    );
    response.headers.append("set-cookie", clearAdminMfaCookie());
    return response;
  } catch (error) {
    const response = errorResponse(requestId, error);
    response.headers.set("cache-control", "no-store");
    return response;
  }
}
