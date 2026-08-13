import { env } from "cloudflare:workers";
import { ApiError } from "@/lib/server/api";
import { hashOpaqueToken, newOpaqueToken } from "@/lib/server/auth-crypto";
import { randomId } from "@/lib/server/random-id";
import { verifyCurrentPassword } from "@/lib/server/local-auth";

export const ADMIN_MFA_COOKIE = "__Host-nyascans_admin_mfa";
const ADMIN_SESSION_SECONDS = 60 * 60;
const MAX_FAILURES = 5;
const TOTP_COUNTER_WINDOW = 2;

function database() {
  if (!env.DB) throw new ApiError(503, "DATABASE_UNAVAILABLE", "Administrative security storage is unavailable.");
  return env.DB;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32(bytes: Uint8Array) {
  let bits = 0;
  let value = 0;
  let output = "";
  bytes.forEach((byte) => {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += base32Alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  });
  if (bits > 0) output += base32Alphabet[(value << (5 - bits)) & 31];
  return output;
}

function encryptionKeyMaterial() {
  const configured = (env as unknown as { ADMIN_TOTP_ENCRYPTION_KEY?: string }).ADMIN_TOTP_ENCRYPTION_KEY?.trim();
  if (!configured) throw new ApiError(503, "ADMIN_MFA_NOT_CONFIGURED", "Administrator two-factor authentication is not configured.");
  const bytes = fromBase64Url(configured);
  if (bytes.byteLength !== 32) throw new ApiError(503, "ADMIN_MFA_KEY_INVALID", "Administrator two-factor authentication is unavailable.");
  return bytes;
}

async function encryptionKey() {
  return crypto.subtle.importKey("raw", arrayBuffer(encryptionKeyMaterial()), "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptSecret(secret: Uint8Array) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: arrayBuffer(iv) }, await encryptionKey(), arrayBuffer(secret));
  return { encryptedSecret: base64Url(new Uint8Array(ciphertext)), encryptionIv: base64Url(iv) };
}

async function decryptSecret(encryptedSecret: string, encryptionIv: string) {
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: arrayBuffer(fromBase64Url(encryptionIv)) },
      await encryptionKey(),
      arrayBuffer(fromBase64Url(encryptedSecret)),
    );
    return new Uint8Array(plaintext);
  } catch {
    throw new ApiError(503, "ADMIN_MFA_DECRYPTION_FAILED", "The administrator authenticator could not be verified safely.");
  }
}

async function totp(secret: Uint8Array, counter: number) {
  const message = new Uint8Array(8);
  let remaining = counter;
  for (let index = 7; index >= 0; index -= 1) {
    message[index] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  const key = await crypto.subtle.importKey("raw", arrayBuffer(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, arrayBuffer(message)));
  const offset = digest[digest.length - 1]! & 0x0f;
  const number = (((digest[offset]! & 0x7f) << 24) | (digest[offset + 1]! << 16) | (digest[offset + 2]! << 8) | digest[offset + 3]!) % 1_000_000;
  return number.toString().padStart(6, "0");
}

function cookieValue(headers: Headers) {
  const cookie = headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [name, value] = part.trim().split("=", 2);
    if (name === ADMIN_MFA_COOKIE && value && /^[A-Za-z0-9_-]{40,100}$/u.test(value)) return value;
  }
  return null;
}

async function fingerprint(headers: Headers) {
  const material = [
    headers.get("cf-connecting-ip") ?? headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown",
    headers.get("user-agent") ?? "unknown",
    headers.get("cf-ipcountry") ?? "unknown",
  ].join("\n");
  return hashOpaqueToken(material);
}

export async function getAdminMfaState(userId: string, requestHeaders: Headers) {
  const db = database();
  const factor = await db.prepare("SELECT confirmed_at AS confirmedAt FROM admin_mfa_factors WHERE user_id = ? LIMIT 1").bind(userId).first<{ confirmedAt: string | null }>();
  const token = cookieValue(requestHeaders);
  if (!token || !factor?.confirmedAt) return { enrolled: Boolean(factor?.confirmedAt), verified: false, expiresAt: null };
  const session = await db.prepare(
    `SELECT id, expires_at AS expiresAt
       FROM admin_mfa_sessions
      WHERE user_id = ? AND token_hash = ? AND fingerprint_hash = ?
        AND revoked_at IS NULL AND datetime(expires_at) > CURRENT_TIMESTAMP
      LIMIT 1`,
  ).bind(userId, await hashOpaqueToken(token), await fingerprint(requestHeaders)).first<{ id: string; expiresAt: string }>();
  if (!session) return { enrolled: true, verified: false, expiresAt: null };
  await db.prepare("UPDATE admin_mfa_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?").bind(session.id).run();
  return { enrolled: true, verified: true, expiresAt: session.expiresAt };
}

export async function beginAdminMfaEnrollment(userId: string, email: string) {
  const db = database();
  const existing = await db.prepare("SELECT confirmed_at AS confirmedAt FROM admin_mfa_factors WHERE user_id = ?").bind(userId).first<{ confirmedAt: string | null }>();
  if (existing?.confirmedAt) throw new ApiError(409, "ADMIN_MFA_ALREADY_ENROLLED", "An authenticator is already enrolled for this account.");
  const secret = crypto.getRandomValues(new Uint8Array(20));
  const encrypted = await encryptSecret(secret);
  await db.prepare(
    `INSERT INTO admin_mfa_factors (user_id, encrypted_secret, encryption_iv)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET encrypted_secret = excluded.encrypted_secret,
       encryption_iv = excluded.encryption_iv, confirmed_at = NULL,
       last_accepted_counter = -1, revision = revision + 1,
       updated_at = CURRENT_TIMESTAMP`,
  ).bind(userId, encrypted.encryptedSecret, encrypted.encryptionIv).run();
  const encodedSecret = base32(secret);
  const label = encodeURIComponent(`NyaScans:${email}`);
  const issuer = encodeURIComponent("NyaScans");
  return {
    secret: encodedSecret,
    otpauthUri: `otpauth://totp/${label}?secret=${encodedSecret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`,
  };
}

export async function verifyAdminMfa(userId: string, code: string, requestHeaders: Headers) {
  const normalizedCode = code.replace(/\D/gu, "").slice(0, 6);
  if (!/^\d{6}$/u.test(normalizedCode)) throw new ApiError(400, "ADMIN_MFA_CODE_INVALID", "Enter the six-digit authenticator code.");
  const db = database();
  const fingerprintHash = await fingerprint(requestHeaders);
  const failures = await db.prepare(
    `SELECT COUNT(*) AS count FROM admin_login_events
      WHERE result = 'FAILURE'
        AND (user_id = ? OR fingerprint_hash = ?)
        AND datetime(created_at) > datetime('now', '-15 minutes')`,
  ).bind(userId, fingerprintHash).first<{ count: number }>();
  if (Number(failures?.count ?? 0) >= MAX_FAILURES) throw new ApiError(429, "ADMIN_MFA_RATE_LIMITED", "Too many administrator verification attempts. Try again in 15 minutes.");
  const factor = await db.prepare(
    `SELECT encrypted_secret AS encryptedSecret, encryption_iv AS encryptionIv,
            confirmed_at AS confirmedAt, last_accepted_counter AS lastCounter
       FROM admin_mfa_factors WHERE user_id = ? LIMIT 1`,
  ).bind(userId).first<{ encryptedSecret: string; encryptionIv: string; confirmedAt: string | null; lastCounter: number }>();
  if (!factor) throw new ApiError(409, "ADMIN_MFA_ENROLLMENT_REQUIRED", "Enroll an authenticator before continuing.");
  const secret = await decryptSecret(factor.encryptedSecret, factor.encryptionIv);
  const currentCounter = Math.floor(Date.now() / 30_000);
  let acceptedCounter = -1;
  for (let offset = -TOTP_COUNTER_WINDOW; offset <= TOTP_COUNTER_WINDOW; offset += 1) {
    const counter = currentCounter + offset;
    if (counter > Number(factor.lastCounter) && await totp(secret, counter) === normalizedCode) {
      acceptedCounter = counter;
      break;
    }
  }
  if (acceptedCounter < 0) {
    await db.prepare("INSERT INTO admin_login_events (id, user_id, fingerprint_hash, result, reason) VALUES (?, ?, ?, 'FAILURE', 'Invalid or replayed TOTP code')").bind(`admin_login_${randomId()}`, userId, fingerprintHash).run();
    throw new ApiError(401, "ADMIN_MFA_CODE_REJECTED", "That authenticator code is invalid, expired, or already used.");
  }
  const suspicious = Boolean(await db.prepare("SELECT 1 FROM admin_login_events WHERE user_id = ? AND result = 'SUCCESS' AND fingerprint_hash <> ? LIMIT 1").bind(userId, fingerprintHash).first());
  const token = newOpaqueToken();
  const tokenHash = await hashOpaqueToken(token);
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_SECONDS * 1_000).toISOString();
  const sessionId = `admin_mfa_session_${randomId()}`;
  const acceptedEventId = `admin_login_${randomId()}`;
  const statements = [
    db.prepare(
      `UPDATE admin_mfa_factors SET confirmed_at = COALESCE(confirmed_at, CURRENT_TIMESTAMP),
         last_accepted_counter = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND last_accepted_counter < ?`,
    ).bind(acceptedCounter, userId, acceptedCounter),
    db.prepare(
      `INSERT INTO admin_mfa_sessions (id, user_id, token_hash, fingerprint_hash, expires_at)
       SELECT ?, ?, ?, ?, ? WHERE changes() = 1`,
    ).bind(sessionId, userId, tokenHash, fingerprintHash, expiresAt),
    db.prepare(
      `INSERT INTO admin_login_events (id, user_id, fingerprint_hash, result, reason)
       SELECT ?, ?, ?, 'SUCCESS', ? WHERE changes() = 1`,
    ).bind(acceptedEventId, userId, fingerprintHash, suspicious ? "New administrator device or network" : "TOTP verified"),
  ];
  if (suspicious) {
    statements.push(db.prepare(
      `INSERT INTO notifications (id, user_id, kind, title, body, dedupe_key, action_url, metadata_json)
       SELECT ?, ?, 'SECURITY_ALERT', 'New administrator sign-in',
       'A new device or network completed administrator two-factor authentication. Review access immediately if this was not you.', ?, '/account?section=security', '{}'
       WHERE changes() = 1`,
    ).bind(`ntf_${randomId()}`, userId, `admin-new-device:${sessionId}`));
  }
  const results = await db.batch(statements);
  if (!Number(results[0]?.meta.changes ?? 0)) {
    throw new ApiError(409, "ADMIN_MFA_CODE_REPLAYED", "That authenticator code was already used.");
  }
  return { token, expiresAt, enrolledNow: !factor.confirmedAt, suspicious };
}

export async function resetAdminMfaEnrollment(
  userId: string,
  password: string,
  requestHeaders: Headers,
) {
  const db = database();
  const fingerprintHash = await fingerprint(requestHeaders);
  const matches = await verifyCurrentPassword(userId, password);
  if (!matches) {
    await db.prepare(
      `INSERT INTO admin_login_events (id, user_id, fingerprint_hash, result, reason)
       VALUES (?, ?, ?, 'FAILURE', 'Administrator MFA recovery password rejected')`,
    ).bind(`admin_login_${randomId()}`, userId, fingerprintHash).run();
    throw new ApiError(401, "ADMIN_MFA_RECOVERY_REJECTED", "The account password could not be verified.");
  }
  await db.batch([
    db.prepare(
      `UPDATE admin_mfa_sessions
          SET revoked_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND revoked_at IS NULL`,
    ).bind(userId),
    db.prepare("DELETE FROM admin_mfa_factors WHERE user_id = ?").bind(userId),
    db.prepare(
      `INSERT INTO admin_login_events (id, user_id, fingerprint_hash, result, reason)
       VALUES (?, ?, ?, 'SUCCESS', 'Administrator MFA factor reset after password reauthentication')`,
    ).bind(`admin_login_${randomId()}`, userId, fingerprintHash),
  ]);
}

export async function revokeAdminMfaSession(userId: string, requestHeaders: Headers) {
  const token = cookieValue(requestHeaders);
  if (token) await database().prepare("UPDATE admin_mfa_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND token_hash = ? AND revoked_at IS NULL").bind(userId, await hashOpaqueToken(token)).run();
}

export async function revokeAdminMfaSessionFromHeaders(requestHeaders: Headers) {
  const token = cookieValue(requestHeaders);
  if (token) await database().prepare("UPDATE admin_mfa_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND revoked_at IS NULL").bind(await hashOpaqueToken(token)).run();
}

export function adminMfaCookie(token: string, expiresAt: string) {
  return [`${ADMIN_MFA_COOKIE}=${token}`, "Path=/", `Max-Age=${ADMIN_SESSION_SECONDS}`, `Expires=${new Date(expiresAt).toUTCString()}`, "HttpOnly", "Secure", "SameSite=Strict"].join("; ");
}

export function clearAdminMfaCookie() {
  return [`${ADMIN_MFA_COOKIE}=`, "Path=/", "Max-Age=0", "Expires=Thu, 01 Jan 1970 00:00:00 GMT", "HttpOnly", "Secure", "SameSite=Strict"].join("; ");
}
