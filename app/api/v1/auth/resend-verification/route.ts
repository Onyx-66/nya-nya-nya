import { z } from "zod";
import { safeAuthReturnPath } from "@/app/chatgpt-auth";
import { errorResponse, json } from "@/lib/server/api";
import { assertSameOrigin, requestIdFor } from "@/lib/server/admin-utils";
import { resendPasswordVerification } from "@/lib/server/local-auth";

export const dynamic = "force-dynamic";

const resendSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  returnTo: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const input = resendSchema.parse(await request.json());
    await resendPasswordVerification({
      email: input.email,
      returnTo: safeAuthReturnPath(input.returnTo ?? "/"),
    });
    return json(
      requestId,
      {
        accepted: true,
        message:
          "If this address is awaiting verification, a new email is on its way.",
      },
      { status: 202, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const response = errorResponse(requestId, error);
    response.headers.set("cache-control", "no-store");
    return response;
  }
}
