import { env } from "cloudflare:workers";
import { ApiError } from "@/lib/server/api";
import {
  hashOpaqueToken,
  hashPassword,
  newOpaqueToken,
  PASSWORD_ITERATIONS,
  type PasswordDigest,
  verifyPassword,
} from "@/lib/server/auth-crypto";
import {
  assertVerificationEmailConfigured,
  sendVerificationEmail,
} from "@/lib/server/auth-email";
import { randomId } from "@/lib/server/random-id";

export const PASSWORD_SESSION_COOKIE = "__Host-nyascans_session";
export type SessionAuthMethod = "PASSWORD" | "PASSKEY";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const VERIFICATION_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const MAX_FAILED_ATTEMPTS = 5;

const DUMMY_PASSWORD_DIGEST: PasswordDigest = {
  algorithm: "PBKDF2-SHA256",
  iterations: PASSWORD_ITERATIONS,
  salt: "AAAAAAAAAAAAAAAAAAAAAA",
  passwordHash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
};

type AuthDatabase = D1Database;

type PasswordAccountRow = {
  id: string;
  email: string;
  display_name: string;
  status: string;
  email_verified_at: string | null;
  algorithm: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  password_hash: string;
  failed_attempts: number;
  is_locked: number;
};

export type PasswordSessionIdentity = {
  userId: string;
  displayName: string;
  email: string;
  fullName: null;
  authMethod: SessionAuthMethod;
};

export type PasswordSessionResult = {
  identity: PasswordSessionIdentity;
  cookie: string;
  returnTo: string;
};

function authDatabase() {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Identity storage is unavailable.",
    );
  }
  return env.DB;
}

function displayNameForEmail(email: string) {
  const localPart = email.split("@", 1)[0]?.trim();
  return localPart?.slice(0, 80) || "NyaScans reader";
}

function expiryAfter(milliseconds: number) {
  return new Date(Date.now() + milliseconds).toISOString();
}

export function sessionCookie(token: string, expiresAt: string) {
  return [
    `${PASSWORD_SESSION_COOKIE}=${token}`,
    "Path=/",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    `Expires=${new Date(expiresAt).toUTCString()}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

export function clearPasswordSessionCookie() {
  return [
    `${PASSWORD_SESSION_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

function cookieValue(requestHeaders: Headers, name: string) {
  const cookieHeader = requestHeaders.get("cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return /^[A-Za-z0-9_-]{40,100}$/u.test(value) ? value : null;
  }
  return null;
}

async function newSessionMaterial() {
  const token = newOpaqueToken();
  const expiresAt = expiryAfter(SESSION_MAX_AGE_SECONDS * 1_000);
  return {
    id: `ses_${randomId()}`,
    token,
    tokenHash: await hashOpaqueToken(token),
    expiresAt,
  };
}

export async function createUserSession(input: {
  userId: string;
  authMethod: SessionAuthMethod;
}) {
  const db = authDatabase();
  const session = await newSessionMaterial();
  await db.batch([
    db.prepare(
      `INSERT INTO user_sessions
       (id, user_id, token_hash, auth_method, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(
      session.id,
      input.userId,
      session.tokenHash,
      input.authMethod,
      session.expiresAt,
    ),
    db.prepare(
      `UPDATE user_sessions
          SET revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND revoked_at IS NULL AND id NOT IN (
          SELECT id FROM user_sessions
           WHERE user_id = ? AND revoked_at IS NULL
           ORDER BY created_at DESC LIMIT 10
        )`,
    ).bind(input.userId, input.userId),
  ]);
  return {
    cookie: sessionCookie(session.token, session.expiresAt),
    expiresAt: session.expiresAt,
  };
}

function invalidCredentials() {
  return new ApiError(
    401,
    "INVALID_CREDENTIALS",
    "The email or password is incorrect.",
  );
}

export async function registerPasswordAccount(input: {
  email: string;
  password: string;
  returnTo: string;
}) {
  assertVerificationEmailConfigured();
  const db = authDatabase();
  const password = await hashPassword(input.password);
  const existing = await db
    .prepare(
      `SELECT u.id
         FROM users u
        WHERE u.email = ?
        LIMIT 1`,
    )
    .bind(input.email)
    .first<{ id: string }>();

  if (existing) {
    return { accepted: true as const };
  }

  const userId = `usr_${randomId()}`;
  const displayName = displayNameForEmail(input.email);
  const verificationId = `verify_${randomId()}`;
  const verificationToken = newOpaqueToken();
  const verificationTokenHash = await hashOpaqueToken(verificationToken);
  const verificationExpiresAt = expiryAfter(VERIFICATION_MAX_AGE_MS);

  try {
    await db.batch([
      db.prepare(
        `INSERT INTO users
         (id, email, display_name, primary_role, status, email_verified_at)
         VALUES (?, ?, ?, 'USER', 'ACTIVE', NULL)`,
      ).bind(userId, input.email, displayName),
      db.prepare(
        `INSERT INTO user_roles
         (user_id, role, assigned_by_user_id)
         VALUES (?, 'USER', NULL)`,
      ).bind(userId),
      db.prepare(
        `INSERT INTO user_password_credentials
         (user_id, algorithm, iterations, salt, password_hash)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(
        userId,
        password.algorithm,
        password.iterations,
        password.salt,
        password.passwordHash,
      ),
      db.prepare(
        `INSERT INTO email_verification_tokens
         (id, user_id, token_hash, expires_at, return_to)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(
        verificationId,
        userId,
        verificationTokenHash,
        verificationExpiresAt,
        input.returnTo,
      ),
    ]);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes("unique constraint failed")
    ) {
      return { accepted: true as const };
    }
    throw error;
  }

  await sendVerificationEmail({
    email: input.email,
    displayName,
    token: verificationToken,
    verificationId,
  });
  return { accepted: true as const };
}

export async function resendPasswordVerification(input: {
  email: string;
  returnTo: string;
}) {
  assertVerificationEmailConfigured();
  const db = authDatabase();
  const account = await db
    .prepare(
      `SELECT u.id, u.display_name AS displayName,
              u.email_verified_at AS emailVerifiedAt, u.status,
              CASE WHEN c.user_id IS NULL THEN 0 ELSE 1 END AS hasCredential,
              CASE WHEN EXISTS (
                SELECT 1
                  FROM email_verification_tokens recent
                 WHERE recent.user_id = u.id
                   AND datetime(recent.created_at) > datetime('now', '-60 seconds')
              ) THEN 1 ELSE 0 END AS resendBlocked
         FROM users u
         LEFT JOIN user_password_credentials c ON c.user_id = u.id
        WHERE u.email = ?
        LIMIT 1`,
    )
    .bind(input.email)
    .first<{
      id: string;
      displayName: string;
      emailVerifiedAt: string | null;
      status: string;
      hasCredential: number;
      resendBlocked: number;
    }>();
  if (
    !account ||
    account.emailVerifiedAt ||
    !account.hasCredential ||
    account.status !== "ACTIVE" ||
    account.resendBlocked
  ) {
    return { accepted: true as const };
  }

  const verificationId = `verify_${randomId()}`;
  const verificationToken = newOpaqueToken();
  const verificationTokenHash = await hashOpaqueToken(verificationToken);
  await db.batch([
    db.prepare(
      `UPDATE email_verification_tokens
          SET used_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND used_at IS NULL`,
    ).bind(account.id),
    db.prepare(
      `INSERT INTO email_verification_tokens
       (id, user_id, token_hash, expires_at, return_to)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(
      verificationId,
      account.id,
      verificationTokenHash,
      expiryAfter(VERIFICATION_MAX_AGE_MS),
      input.returnTo,
    ),
  ]);
  await sendVerificationEmail({
    email: input.email,
    displayName: account.displayName,
    token: verificationToken,
    verificationId,
  });
  return { accepted: true as const };
}

async function passwordAccount(db: AuthDatabase, email: string) {
  return db
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.status, u.email_verified_at,
              c.algorithm, c.iterations, c.salt, c.password_hash,
              c.failed_attempts,
              CASE WHEN c.locked_until IS NOT NULL
                     AND datetime(c.locked_until) > CURRENT_TIMESTAMP
                   THEN 1 ELSE 0 END AS is_locked
         FROM users u
         JOIN user_password_credentials c ON c.user_id = u.id
        WHERE u.email = ?
        LIMIT 1`,
    )
    .bind(email)
    .first<PasswordAccountRow>();
}

async function recordFailedPassword(db: AuthDatabase, userId: string) {
  await db
    .prepare(
      `UPDATE user_password_credentials
          SET failed_attempts = CASE
                WHEN locked_until IS NOT NULL
                 AND datetime(locked_until) <= CURRENT_TIMESTAMP THEN 1
                ELSE failed_attempts + 1
              END,
              locked_until = CASE
                WHEN (CASE
                  WHEN locked_until IS NOT NULL
                   AND datetime(locked_until) <= CURRENT_TIMESTAMP THEN 1
                  ELSE failed_attempts + 1
                END) >= ?
                THEN datetime('now', '+15 minutes')
                ELSE NULL
              END,
              updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?`,
    )
    .bind(MAX_FAILED_ATTEMPTS, userId)
    .run();
}

export async function verifyCurrentPassword(userId: string, password: string) {
  if (!password || password.length > 512) return false;
  const account = await authDatabase()
    .prepare(
      `SELECT algorithm, iterations, salt, password_hash
         FROM user_password_credentials
        WHERE user_id = ?
        LIMIT 1`,
    )
    .bind(userId)
    .first<Pick<PasswordAccountRow, "algorithm" | "iterations" | "salt" | "password_hash">>();
  return verifyPassword(password, account
    ? {
        algorithm: account.algorithm,
        iterations: Number(account.iterations),
        salt: account.salt,
        passwordHash: account.password_hash,
      }
    : DUMMY_PASSWORD_DIGEST);
}

export async function authenticatePassword(input: {
  email: string;
  password: string;
  returnTo: string;
}): Promise<PasswordSessionResult> {
  const db = authDatabase();
  const account = await passwordAccount(db, input.email);
  const matches = await verifyPassword(
    input.password,
    account
      ? {
          algorithm: account.algorithm,
          iterations: Number(account.iterations),
          salt: account.salt,
          passwordHash: account.password_hash,
        }
      : DUMMY_PASSWORD_DIGEST,
  );

  if (!account || !matches) {
    if (account) await recordFailedPassword(db, account.id);
    throw invalidCredentials();
  }
  if (account.is_locked) {
    throw new ApiError(
      429,
      "AUTHENTICATION_THROTTLED",
      "Too many attempts. Try again in 15 minutes.",
    );
  }
  if (account.status !== "ACTIVE") {
    throw new ApiError(
      403,
      "ACCOUNT_SUSPENDED",
      "This account cannot access NyaScans.",
    );
  }
  if (!account.email_verified_at) {
    throw new ApiError(
      403,
      "EMAIL_VERIFICATION_REQUIRED",
      "Verify your email before signing in.",
    );
  }

  const session = await newSessionMaterial();
  await db.batch([
    db.prepare(
      `UPDATE user_password_credentials
          SET failed_attempts = 0, locked_until = NULL,
              updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?`,
    ).bind(account.id),
    db.prepare(
      `INSERT INTO user_sessions
       (id, user_id, token_hash, auth_method, expires_at)
       VALUES (?, ?, ?, 'PASSWORD', ?)`,
    ).bind(session.id, account.id, session.tokenHash, session.expiresAt),
    db.prepare(
      `UPDATE user_sessions
          SET revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND revoked_at IS NULL AND id NOT IN (
          SELECT id FROM user_sessions
           WHERE user_id = ? AND revoked_at IS NULL
           ORDER BY created_at DESC LIMIT 10
        )`,
    ).bind(account.id, account.id),
  ]);

  return {
    identity: {
      userId: account.id,
      displayName: account.display_name,
      email: account.email,
      fullName: null,
      authMethod: "PASSWORD",
    },
    cookie: sessionCookie(session.token, session.expiresAt),
    returnTo: input.returnTo,
  };
}

export async function verifyEmailToken(input: {
  token: string;
  providerEmail?: string | null;
}): Promise<PasswordSessionResult> {
  const db = authDatabase();
  const tokenHash = await hashOpaqueToken(input.token);
  const verification = await db
    .prepare(
      `SELECT t.id, t.user_id AS userId, t.return_to AS returnTo,
              u.email, u.display_name AS displayName, u.status,
              CASE WHEN c.user_id IS NULL THEN 0 ELSE 1 END AS hasCredential
         FROM email_verification_tokens t
         JOIN users u ON u.id = t.user_id
         LEFT JOIN user_password_credentials c ON c.user_id = u.id
        WHERE t.token_hash = ?
          AND t.used_at IS NULL
          AND datetime(t.expires_at) > CURRENT_TIMESTAMP
          AND u.email_verified_at IS NULL
        LIMIT 1`,
    )
    .bind(tokenHash)
    .first<{
      id: string;
      userId: string;
      returnTo: string;
      email: string;
      displayName: string;
      status: string;
      hasCredential: number;
    }>();
  if (!verification || !verification.hasCredential) {
    throw new ApiError(
      400,
      "VERIFICATION_TOKEN_INVALID",
      "This verification link is invalid or has expired.",
    );
  }
  if (verification.status !== "ACTIVE") {
    throw new ApiError(
      403,
      "ACCOUNT_SUSPENDED",
      "This account cannot access NyaScans.",
    );
  }
  if (
    input.providerEmail &&
    input.providerEmail.trim().toLowerCase() !==
      verification.email.trim().toLowerCase()
  ) {
    throw new ApiError(
      409,
      "AUTH_IDENTITY_CONFLICT",
      "Sign out of the current ChatGPT account before verifying a different email address.",
    );
  }

  const session = await newSessionMaterial();
  const results = await db.batch([
    db.prepare(
      `UPDATE email_verification_tokens
          SET used_at = CURRENT_TIMESTAMP
        WHERE id = ? AND token_hash = ? AND used_at IS NULL
          AND datetime(expires_at) > CURRENT_TIMESTAMP`,
    ).bind(verification.id, tokenHash),
    db.prepare(
      `INSERT INTO user_sessions
       (id, user_id, token_hash, auth_method, expires_at)
       SELECT ?, ?, ?, 'PASSWORD', ?
        WHERE changes() = 1`,
    ).bind(
      session.id,
      verification.userId,
      session.tokenHash,
      session.expiresAt,
    ),
    db.prepare(
      `UPDATE users
          SET email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND EXISTS (
            SELECT 1 FROM user_sessions
             WHERE id = ? AND user_id = ?
          )`,
    ).bind(verification.userId, session.id, verification.userId),
    db.prepare(
      `UPDATE user_password_credentials
          SET failed_attempts = 0, locked_until = NULL,
              updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
          AND EXISTS (
            SELECT 1 FROM user_sessions
             WHERE id = ? AND user_id = ?
          )`,
    ).bind(verification.userId, session.id, verification.userId),
  ]);
  if (
    !results[0]?.meta.changes ||
    !results[1]?.meta.changes ||
    !results[2]?.meta.changes ||
    !results[3]?.meta.changes
  ) {
    throw new ApiError(
      400,
      "VERIFICATION_TOKEN_INVALID",
      "This verification link is invalid or has expired.",
    );
  }

  return {
    identity: {
      userId: verification.userId,
      displayName: verification.displayName,
      email: verification.email,
      fullName: null,
      authMethod: "PASSWORD",
    },
    cookie: sessionCookie(session.token, session.expiresAt),
    returnTo: verification.returnTo,
  };
}

export async function getPasswordSessionIdentity(
  requestHeaders: Headers,
): Promise<PasswordSessionIdentity | null> {
  const token = cookieValue(
    requestHeaders,
    PASSWORD_SESSION_COOKIE,
  );
  if (!token || !env.DB) return null;
  const tokenHash = await hashOpaqueToken(token);
  const session = await env.DB.prepare(
    `       SELECT s.id AS sessionId, s.auth_method AS authMethod,
              u.id AS userId, u.email, u.display_name AS displayName
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
        AND s.auth_method IN ('PASSWORD', 'PASSKEY')
        AND s.revoked_at IS NULL
        AND datetime(s.expires_at) > CURRENT_TIMESTAMP
        AND u.status = 'ACTIVE'
        AND u.email_verified_at IS NOT NULL
      LIMIT 1`,
  )
    .bind(tokenHash)
    .first<{
      sessionId: string;
      authMethod: SessionAuthMethod;
      userId: string;
      email: string;
      displayName: string;
    }>();
  if (!session) return null;
  await env.DB.prepare(
    `UPDATE user_sessions
        SET last_seen_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND datetime(last_seen_at) < datetime('now', '-15 minutes')`,
  )
    .bind(session.sessionId)
    .run();
  return {
    userId: session.userId,
    displayName: session.displayName,
    email: session.email,
    fullName: null,
    authMethod: session.authMethod,
  };
}

export async function revokePasswordSession(requestHeaders: Headers) {
  const token = cookieValue(requestHeaders, PASSWORD_SESSION_COOKIE);
  if (!token || !env.DB) return;
  const tokenHash = await hashOpaqueToken(token);
  await env.DB.prepare(
    `UPDATE user_sessions
        SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
      WHERE token_hash = ?`,
  )
    .bind(tokenHash)
    .run();
}
