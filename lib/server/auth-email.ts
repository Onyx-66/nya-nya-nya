import { env } from "cloudflare:workers";
import { ApiError } from "@/lib/server/api";

type EmailEnvironment = {
  EMAIL_PROVIDER?: string;
  EMAIL_FROM?: string;
  EMAIL_API_KEY?: string;
  NEXT_PUBLIC_SITE_URL?: string;
};

type VerificationEmailInput = {
  email: string;
  displayName: string;
  token: string;
  verificationId: string;
};

function emailEnvironment() {
  return env as unknown as EmailEnvironment;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function assertVerificationEmailConfigured() {
  const configured = emailEnvironment();
  let siteOrigin: URL;
  try {
    siteOrigin = new URL(configured.NEXT_PUBLIC_SITE_URL ?? "");
  } catch {
    throw new ApiError(
      503,
      "EMAIL_CONFIGURATION_REQUIRED",
      "Email verification is not configured yet.",
    );
  }
  if (
    configured.EMAIL_PROVIDER?.toLowerCase() !== "resend" ||
    !configured.EMAIL_FROM?.trim() ||
    !configured.EMAIL_API_KEY?.trim() ||
    !["http:", "https:"].includes(siteOrigin.protocol)
  ) {
    throw new ApiError(
      503,
      "EMAIL_CONFIGURATION_REQUIRED",
      "Email verification is not configured yet.",
    );
  }
  return {
    apiKey: configured.EMAIL_API_KEY.trim(),
    from: configured.EMAIL_FROM.trim(),
    siteOrigin,
  };
}

export async function sendVerificationEmail(input: VerificationEmailInput) {
  const configured = assertVerificationEmailConfigured();
  const verificationUrl = new URL("/signup", configured.siteOrigin);
  verificationUrl.hash = `verify=${encodeURIComponent(input.token)}`;
  const safeName = escapeHtml(input.displayName);
  const safeUrl = escapeHtml(verificationUrl.toString());
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${configured.apiKey}`,
        "content-type": "application/json",
        "idempotency-key": `nyascans-verification-${input.verificationId}`,
      },
      body: JSON.stringify({
        from: configured.from,
        to: [input.email],
        subject: "Verify your NyaScans email",
        text:
          `Hello ${input.displayName},\n\n` +
          `Verify your NyaScans account using this one-time link:\n` +
          `${verificationUrl.toString()}\n\n` +
          "This link expires in 24 hours. If you did not request it, ignore this email.",
        html:
          `<p>Hello ${safeName},</p>` +
          "<p>Verify your NyaScans account using this one-time link:</p>" +
          `<p><a href="${safeUrl}">Verify email</a></p>` +
          "<p>This link expires in 24 hours. If you did not request it, ignore this email.</p>",
      }),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(
      503,
      "EMAIL_DELIVERY_UNAVAILABLE",
      "The verification email could not be sent. Try again shortly.",
    );
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new ApiError(
      503,
      "EMAIL_DELIVERY_UNAVAILABLE",
      "The verification email could not be sent. Try again shortly.",
    );
  }
}
