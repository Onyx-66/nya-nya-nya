import { env } from "cloudflare:workers";
import { ApiError } from "@/lib/server/api";

const GIFT_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const GIFT_CODE_LENGTH = 18;

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function normalizedGiftCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/gu, "");
}

function giftCodeSecret() {
  const secret = (
    env as unknown as { NYASCANS_GIFT_CODE_SECRET?: string }
  ).NYASCANS_GIFT_CODE_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new ApiError(
      503,
      "GIFT_CODES_UNAVAILABLE",
      "Gift cards are temporarily unavailable.",
    );
  }
  return secret;
}

async function derivedBytes(purpose: "encrypt" | "lookup") {
  const material = new TextEncoder().encode(
    `nyascans:gift-code:${purpose}:${giftCodeSecret()}`,
  );
  return crypto.subtle.digest("SHA-256", material);
}

async function encryptionKey() {
  return crypto.subtle.importKey(
    "raw",
    await derivedBytes("encrypt"),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}

async function lookupKey() {
  return crypto.subtle.importKey(
    "raw",
    await derivedBytes("lookup"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

export function generateGiftCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(GIFT_CODE_LENGTH - 2));
  let code = "NY";
  bytes.forEach((byte) => {
    code += GIFT_CODE_ALPHABET[byte % GIFT_CODE_ALPHABET.length];
  });
  return code;
}

export function formatGiftCode(value: string) {
  const code = normalizedGiftCode(value);
  return code.match(/.{1,6}/gu)?.join(" ") ?? code;
}

export async function hashGiftCode(value: string) {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await lookupKey(),
    new TextEncoder().encode(normalizedGiftCode(value)),
  );
  return toBase64Url(new Uint8Array(signature));
}

export async function encryptGiftCode(value: string) {
  const code = normalizedGiftCode(value);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    await encryptionKey(),
    new TextEncoder().encode(code),
  );
  return {
    code,
    codeHash: await hashGiftCode(code),
    codeCiphertext: toBase64Url(new Uint8Array(ciphertext)),
    codeNonce: toBase64Url(nonce),
    codeSuffix: code.slice(-4),
  };
}

export async function decryptGiftCode(input: {
  codeCiphertext: string;
  codeNonce: string;
}) {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(input.codeNonce) },
    await encryptionKey(),
    fromBase64Url(input.codeCiphertext),
  );
  return new TextDecoder().decode(plaintext);
}

export function isGiftCodeShape(value: string) {
  return normalizedGiftCode(value).length === GIFT_CODE_LENGTH;
}
