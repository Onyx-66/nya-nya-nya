const PASSWORD_ALGORITHM = "PBKDF2-SHA256" as const;
export const PASSWORD_ITERATIONS = 600_000;

const PASSWORD_SALT_BYTES = 16;
const PASSWORD_HASH_BYTES = 32;
const OPAQUE_TOKEN_BYTES = 32;

export type PasswordDigest = {
  algorithm: typeof PASSWORD_ALGORITHM;
  iterations: number;
  salt: string;
  passwordHash: string;
};

function runtimeCrypto() {
  if (!globalThis.crypto?.subtle) {
    throw new Error("WEB_CRYPTO_UNAVAILABLE");
  }
  return globalThis.crypto;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64UrlToBytes(value: string) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error("INVALID_BASE64URL");
  }
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function derivePasswordBytes(
  password: string,
  salt: Uint8Array,
  iterations: number,
) {
  const crypto = runtimeCrypto();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: Uint8Array.from(salt).buffer,
      iterations,
    },
    key,
    PASSWORD_HASH_BYTES * 8,
  );
  return new Uint8Array(derived);
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

export async function hashPassword(password: string): Promise<PasswordDigest> {
  const salt = runtimeCrypto().getRandomValues(
    new Uint8Array(PASSWORD_SALT_BYTES),
  );
  const passwordHash = await derivePasswordBytes(
    password,
    salt,
    PASSWORD_ITERATIONS,
  );
  return {
    algorithm: PASSWORD_ALGORITHM,
    iterations: PASSWORD_ITERATIONS,
    salt: bytesToBase64Url(salt),
    passwordHash: bytesToBase64Url(passwordHash),
  };
}

export async function verifyPassword(
  password: string,
  digest: PasswordDigest,
) {
  if (
    digest.algorithm !== PASSWORD_ALGORITHM ||
    !Number.isInteger(digest.iterations) ||
    digest.iterations < 100_000 ||
    digest.iterations > PASSWORD_ITERATIONS * 2
  ) {
    return false;
  }
  try {
    const salt = base64UrlToBytes(digest.salt);
    const expected = base64UrlToBytes(digest.passwordHash);
    if (
      salt.byteLength < PASSWORD_SALT_BYTES ||
      expected.byteLength !== PASSWORD_HASH_BYTES
    ) {
      return false;
    }
    const actual = await derivePasswordBytes(
      password,
      salt,
      digest.iterations,
    );
    return constantTimeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function newOpaqueToken() {
  const bytes = runtimeCrypto().getRandomValues(
    new Uint8Array(OPAQUE_TOKEN_BYTES),
  );
  return bytesToBase64Url(bytes);
}

export async function hashOpaqueToken(token: string) {
  const digest = await runtimeCrypto().subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}
