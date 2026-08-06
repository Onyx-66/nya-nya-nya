import { z } from "zod";
import { safeAuthReturnPath } from "@/app/chatgpt-auth";
import { errorResponse, json } from "@/lib/server/api";
import { assertSameOrigin, requestIdFor } from "@/lib/server/admin-utils";
import { authenticatePassword } from "@/lib/server/local-auth";

export const dynamic = "force-dynamic";

const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128),
  returnTo: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const input = loginSchema.parse(await request.json());
    const result = await authenticatePassword({
      email: input.email,
      password: input.password,
      returnTo: safeAuthReturnPath(input.returnTo ?? "/account"),
    });
    return json(
      requestId,
      {
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
