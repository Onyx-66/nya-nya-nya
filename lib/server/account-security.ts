import { env } from "cloudflare:workers";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { ApiError } from "@/lib/server/api";
import { hashOpaqueToken } from "@/lib/server/auth-crypto";
import {
  beginAdminMfaEnrollment,
  resetAdminMfaEnrollment,
  verifyAdminMfa,
} from "@/lib/server/admin-mfa";
import {
  createUserSession,
  verifyCurrentPassword,
} from "@/lib/server/local-auth";
import { randomId } from "@/lib/server/random-id";

const RECOVERY_CODE_COUNT = 10;
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60 * 1_000;

type Database = D1Database;

type PasskeyRow = {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transportsJson: string;
  deviceType: string;
  backedUp: number;
  deviceName: string;
  lastUsedAt: string | null;
  createdAt: string;
};

function database(): Database {
  if (!env.DB) {
    throw new ApiError(503, "DATABASE_UNAVAILABLE", "Security storage is unavailable.");
  }
  return env.DB;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function isoAfter(milliseconds: number) {
  return new Date(Date.now() + milliseconds).toISOString();
}

function parseTransports(value: string | null | undefined) {
  if (!value) return [] as string[];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string").slice(0, 8)
      : [];
  } catch {
    return [] as string[];
  }
}

function normalizeRecoveryCode(value: string) {
  return value.replace(/[\s-]/gu, "").toUpperCase().slice(0, 32);
}

async function recoveryHash(userId: string, code: string) {
  return hashOpaqueToken(`nyascans-recovery:${userId}:${normalizeRecoveryCode(code)}`);
}

function randomRecoveryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let value = "";
  for (const byte of bytes) value += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length];
  return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}`;
}

function webAuthnConfig(request: Request) {
  const configuredRpId = (env as unknown as { WEBAUTHN_RP_ID?: string }).WEBAUTHN_RP_ID?.trim();
  const configuredOrigin = (env as unknown as { WEBAUTHN_ORIGIN?: string }).WEBAUTHN_ORIGIN?.trim();
  const url = new URL(request.url);
  return {
    rpID: configuredRpId || url.hostname,
    origin: configuredOrigin || url.origin,
  };
}

async function userForPasskey(userId: string) {
  return database()
    .prepare(
      `SELECT id, email, display_name AS displayName, status, email_verified_at AS emailVerifiedAt
         FROM users WHERE id = ? LIMIT 1`,
    )
    .bind(userId)
    .first<{
      id: string;
      email: string;
      displayName: string;
      status: string;
      emailVerifiedAt: string | null;
    }>();
}

export async function getSecurityStatus(userId: string) {
  const db = database();
  const [factor, passkeyCount, recoveryCount] = await Promise.all([
    db.prepare("SELECT confirmed_at AS confirmedAt FROM admin_mfa_factors WHERE user_id = ? LIMIT 1").bind(userId).first<{ confirmedAt: string | null }>(),
    db.prepare("SELECT COUNT(*) AS count FROM account_passkeys WHERE user_id = ?").bind(userId).first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM account_recovery_codes WHERE user_id = ? AND used_at IS NULL").bind(userId).first<{ count: number }>(),
  ]);
  return {
    totpEnrolled: Boolean(factor?.confirmedAt),
    totpPending: Boolean(factor && !factor.confirmedAt),
    passkeyCount: Number(passkeyCount?.count ?? 0),
    recoveryCodesRemaining: Number(recoveryCount?.count ?? 0),
  };
}

export async function listPasskeys(userId: string) {
  const rows = await database()
    .prepare(
      `SELECT id, user_id AS userId, credential_id AS credentialId,
              public_key AS publicKey, counter, transports_json AS transportsJson,
              device_type AS deviceType, backed_up AS backedUp, device_name AS deviceName,
              last_used_at AS lastUsedAt, created_at AS createdAt
         FROM account_passkeys
        WHERE user_id = ?
        ORDER BY created_at DESC`,
    )
    .bind(userId)
    .all<PasskeyRow>();
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    deviceName: row.deviceName,
    deviceType: row.deviceType,
    backedUp: Boolean(row.backedUp),
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  }));
}

export async function generateRecoveryCodes(userId: string) {
  const db = database();
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, randomRecoveryCode);
  await db.batch([
    db.prepare("DELETE FROM account_recovery_codes WHERE user_id = ?").bind(userId),
    ...await Promise.all(
      codes.map(async (code) => db.prepare(
        `INSERT INTO account_recovery_codes (id, user_id, code_hash)
         VALUES (?, ?, ?)`,
      ).bind(`recovery_${randomId()}`, userId, await recoveryHash(userId, code))),
    ),
  ]);
  return codes;
}

export async function verifyRecoveryCode(userId: string, code: string) {
  const normalized = normalizeRecoveryCode(code);
  if (normalized.length < 8) return false;
  const hash = await recoveryHash(userId, normalized);
  const row = await database()
    .prepare(
      `SELECT id FROM account_recovery_codes
        WHERE user_id = ? AND code_hash = ? AND used_at IS NULL
        LIMIT 1`,
    )
    .bind(userId, hash)
    .first<{ id: string }>();
  if (!row) return false;
  const result = await database()
    .prepare(
      `UPDATE account_recovery_codes SET used_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ? AND used_at IS NULL`,
    )
    .bind(row.id, userId)
    .run();
  return Number(result.meta.changes ?? 0) === 1;
}

export async function disableTotp(input: {
  userId: string;
  password?: string;
  code?: string;
  requestHeaders: Headers;
}) {
  let reauthenticated = false;
  if (input.password) {
    reauthenticated = await verifyCurrentPassword(input.userId, input.password);
  }
  if (!reauthenticated && input.code) {
    await verifyAdminMfa(input.userId, input.code, input.requestHeaders);
    reauthenticated = true;
  }
  if (!reauthenticated) {
    throw new ApiError(401, "SECURITY_REAUTH_REQUIRED", "Re-enter your password or authenticator code to disable two-factor authentication.");
  }
  await database().batch([
    database().prepare("DELETE FROM admin_mfa_factors WHERE user_id = ?").bind(input.userId),
    database().prepare("DELETE FROM account_recovery_codes WHERE user_id = ?").bind(input.userId),
    database().prepare("UPDATE admin_mfa_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL").bind(input.userId),
  ]);
}

export async function beginTotpEnrollment(userId: string, email: string) {
  return beginAdminMfaEnrollment(userId, email);
}

export async function finishTotpEnrollment(userId: string, code: string, requestHeaders: Headers) {
  const verified = await verifyAdminMfa(userId, code, requestHeaders);
  return {
    enrolledNow: verified.enrolledNow,
    recoveryCodes: await generateRecoveryCodes(userId),
  };
}

export async function regenerateRecoveryCodes(userId: string, password: string) {
  if (!(await verifyCurrentPassword(userId, password))) {
    throw new ApiError(401, "SECURITY_REAUTH_REJECTED", "The account password could not be verified.");
  }
  const status = await getSecurityStatus(userId);
  if (!status.totpEnrolled) {
    throw new ApiError(409, "TOTP_ENROLLMENT_REQUIRED", "Enable two-factor authentication before generating recovery codes.");
  }
  return generateRecoveryCodes(userId);
}

export async function beginPasskeyRegistration(input: {
  userId: string;
  email: string;
  displayName: string;
  request: Request;
}) {
  const db = database();
  const { rpID } = webAuthnConfig(input.request);
  const existing = await db
    .prepare("SELECT credential_id AS credentialId, transports_json AS transportsJson FROM account_passkeys WHERE user_id = ?")
    .bind(input.userId)
    .all<{ credentialId: string; transportsJson: string }>();
  const options = await generateRegistrationOptions({
    rpName: "NyaScans",
    rpID,
    userID: new TextEncoder().encode(input.userId),
    userName: input.email,
    userDisplayName: input.displayName,
    attestationType: "none",
    timeout: 60_000,
    excludeCredentials: (existing.results ?? []).map((row) => ({
      id: row.credentialId,
      transports: parseTransports(row.transportsJson) as never,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });
  const challengeId = `webauthn_${randomId()}`;
  await db.batch([
    db.prepare("DELETE FROM webauthn_challenges WHERE user_id = ? AND ceremony = 'REGISTRATION'").bind(input.userId),
    db.prepare(
      `INSERT INTO webauthn_challenges (id, user_id, challenge, ceremony, expires_at)
       VALUES (?, ?, ?, 'REGISTRATION', ?)`,
    ).bind(challengeId, input.userId, options.challenge, isoAfter(WEBAUTHN_CHALLENGE_TTL_MS)),
  ]);
  return { challengeId, options };
}

export async function finishPasskeyRegistration(input: {
  userId: string;
  challengeId: string;
  response: RegistrationResponseJSON;
  deviceName?: string;
  request: Request;
}) {
  const db = database();
  const challenge = await db
    .prepare(
      `SELECT challenge FROM webauthn_challenges
        WHERE id = ? AND user_id = ? AND ceremony = 'REGISTRATION'
          AND datetime(expires_at) > CURRENT_TIMESTAMP LIMIT 1`,
    )
    .bind(input.challengeId, input.userId)
    .first<{ challenge: string }>();
  if (!challenge) throw new ApiError(400, "PASSKEY_CHALLENGE_INVALID", "This passkey registration has expired. Start again.");
  await db.prepare("DELETE FROM webauthn_challenges WHERE id = ?").bind(input.challengeId).run();
  const { rpID, origin } = webAuthnConfig(input.request);
  const verification = await verifyRegistrationResponse({
    response: input.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw new ApiError(400, "PASSKEY_REGISTRATION_REJECTED", "The passkey could not be verified.");
  }
  const credential = verification.registrationInfo.credential;
  await db.prepare(
    `INSERT INTO account_passkeys
      (id, user_id, credential_id, public_key, counter, transports_json,
       device_type, backed_up, device_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    `passkey_${randomId()}`,
    input.userId,
    credential.id,
    base64Url(credential.publicKey),
    credential.counter,
    JSON.stringify(credential.transports ?? []),
    verification.registrationInfo.credentialDeviceType,
    verification.registrationInfo.credentialBackedUp ? 1 : 0,
    input.deviceName?.trim().slice(0, 80) || "Passkey",
  ).run();
  return { registered: true };
}

export async function removePasskey(userId: string, passkeyId: string) {
  const result = await database()
    .prepare("DELETE FROM account_passkeys WHERE id = ? AND user_id = ?")
    .bind(passkeyId, userId)
    .run();
  if (!Number(result.meta.changes ?? 0)) {
    throw new ApiError(404, "PASSKEY_NOT_FOUND", "That passkey is no longer registered.");
  }
}

export async function beginPasskeyAuthentication(input: { email?: string; request: Request }) {
  const db = database();
  const { rpID } = webAuthnConfig(input.request);
  let userId: string | null = null;
  let allowCredentials: { id: string; transports: string[] }[] | undefined;
  if (input.email?.trim()) {
    const user = await db.prepare("SELECT id FROM users WHERE email = ? AND status = 'ACTIVE' LIMIT 1").bind(input.email.trim().toLowerCase()).first<{ id: string }>();
    if (user) {
      userId = user.id;
      const keys = await db.prepare("SELECT credential_id AS credentialId, transports_json AS transportsJson FROM account_passkeys WHERE user_id = ?").bind(user.id).all<{ credentialId: string; transportsJson: string }>();
      allowCredentials = (keys.results ?? []).map((key) => ({ id: key.credentialId, transports: parseTransports(key.transportsJson) }));
    }
  }
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: allowCredentials?.length ? (allowCredentials as never) : undefined,
    userVerification: "preferred",
    timeout: 60_000,
  });
  const challengeId = `webauthn_${randomId()}`;
  await db.batch([
    db.prepare("DELETE FROM webauthn_challenges WHERE (user_id = ? OR user_id IS NULL) AND ceremony = 'AUTHENTICATION'").bind(userId),
    db.prepare(
      `INSERT INTO webauthn_challenges (id, user_id, challenge, ceremony, expires_at)
       VALUES (?, ?, ?, 'AUTHENTICATION', ?)`,
    ).bind(challengeId, userId, options.challenge, isoAfter(WEBAUTHN_CHALLENGE_TTL_MS)),
  ]);
  return { challengeId, options };
}

export async function finishPasskeyAuthentication(input: {
  challengeId: string;
  response: AuthenticationResponseJSON;
  request: Request;
}) {
  const db = database();
  const challenge = await db
    .prepare(
      `SELECT challenge, user_id AS userId FROM webauthn_challenges
        WHERE id = ? AND ceremony = 'AUTHENTICATION'
          AND datetime(expires_at) > CURRENT_TIMESTAMP LIMIT 1`,
    )
    .bind(input.challengeId)
    .first<{ challenge: string; userId: string | null }>();
  if (!challenge) throw new ApiError(400, "PASSKEY_CHALLENGE_INVALID", "This passkey sign-in has expired. Start again.");
  await db.prepare("DELETE FROM webauthn_challenges WHERE id = ?").bind(input.challengeId).run();
  const credentialRow = await db
    .prepare(
      `SELECT id, user_id AS userId, credential_id AS credentialId,
              public_key AS publicKey, counter, transports_json AS transportsJson
         FROM account_passkeys WHERE credential_id = ? LIMIT 1`,
    )
    .bind(input.response.id)
    .first<Pick<PasskeyRow, "id" | "userId" | "credentialId" | "publicKey" | "counter" | "transportsJson">>();
  if (!credentialRow || (challenge.userId && challenge.userId !== credentialRow.userId)) {
    throw new ApiError(401, "PASSKEY_NOT_RECOGNIZED", "That passkey is not registered to an active NyaScans account.");
  }
  const { rpID, origin } = webAuthnConfig(input.request);
  const verification = await verifyAuthenticationResponse({
    response: input.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: credentialRow.credentialId,
      publicKey: fromBase64Url(credentialRow.publicKey),
      counter: Number(credentialRow.counter),
      transports: parseTransports(credentialRow.transportsJson) as never,
    },
    requireUserVerification: false,
  });
  if (!verification.verified) {
    throw new ApiError(401, "PASSKEY_VERIFICATION_REJECTED", "The passkey response could not be verified.");
  }
  const account = await userForPasskey(credentialRow.userId);
  if (!account || account.status !== "ACTIVE" || !account.emailVerifiedAt) {
    throw new ApiError(403, "ACCOUNT_UNAVAILABLE", "This account cannot access NyaScans.");
  }
  await db.prepare(
    `UPDATE account_passkeys SET counter = ?, last_used_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?`,
  ).bind(verification.authenticationInfo.newCounter, credentialRow.id, credentialRow.userId).run();
  const session = await createUserSession({ userId: account.id, authMethod: "PASSKEY" });
  return {
    cookie: session.cookie,
    identity: {
      userId: account.id,
      displayName: account.displayName,
      email: account.email,
      authMethod: "PASSKEY" as const,
    },
  };
}

export { resetAdminMfaEnrollment };
