import { z } from "zod";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { errorResponse, json } from "@/lib/server/api";
import { assertSameOrigin, requestIdFor } from "@/lib/server/admin-utils";
import { verifyEmailToken } from "@/lib/server/local-auth";

export const dynamic = "force-dynamic";

const verificationSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
});

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const input = verificationSchema.parse(await request.json());
    const providerIdentity = await getChatGPTUser();
    const result = await verifyEmailToken({
      ...input,
      providerEmail: providerIdentity?.email ?? null,
    });
    return json(
      requestId,
      {
        verified: true,
        authenticated: true,
        returnTo: result.returnTo,
        user: {
          displayName: result.identity.displayName,
          email: result.identity.email,
        },
      },
      {
        headers: {
          "cache-control": "no-store",
          "set-cookie": result.cookie,
        },
      },
    );
  } catch (error) {
    const response = errorResponse(requestId, error);
    response.headers.set("cache-control", "no-store");
    return response;
  }
}
