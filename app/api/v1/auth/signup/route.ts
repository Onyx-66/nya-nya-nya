import { z } from "zod";
import { safeAuthReturnPath } from "@/app/chatgpt-auth";
import { errorResponse, json } from "@/lib/server/api";
import { assertSameOrigin, requestIdFor } from "@/lib/server/admin-utils";
import { registerPasswordAccount } from "@/lib/server/local-auth";

export const dynamic = "force-dynamic";

const signupSchema = z
  .object({
    email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
    password: z.string().min(15).max(128),
    confirmPassword: z.string().min(15).max(128),
    returnTo: z.string().max(500).optional(),
  })
  .superRefine((input, context) => {
    if (input.password !== input.confirmPassword) {
      context.addIssue({
        code: "custom",
        path: ["confirmPassword"],
        message: "Passwords do not match.",
      });
    }
  });

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 16_384) {
      return json(
        requestId,
        {
          error: {
            code: "REQUEST_TOO_LARGE",
            message: "The authentication request is too large.",
            fields: [],
            requestId,
          },
        },
        { status: 413, headers: { "cache-control": "no-store" } },
      );
    }
    const input = signupSchema.parse(await request.json());
    await registerPasswordAccount({
      email: input.email,
      password: input.password,
      returnTo: safeAuthReturnPath(input.returnTo ?? "/account"),
    });
    return json(
      requestId,
      {
        accepted: true,
        message:
          "If this address can be registered, a verification email is on its way.",
      },
      { status: 202, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const response = errorResponse(requestId, error);
    response.headers.set("cache-control", "no-store");
    return response;
  }
}
