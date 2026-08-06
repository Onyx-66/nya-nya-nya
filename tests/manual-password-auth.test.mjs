import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  hashOpaqueToken,
  hashPassword,
  PASSWORD_ITERATIONS,
  verifyPassword,
} from "../lib/server/auth-crypto.ts";

const root = process.cwd();
const read = (relativePath) =>
  fs.readFile(path.join(root, relativePath), "utf8");

async function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const migrations = (await fs.readdir(path.join(root, "drizzle")))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  for (const migration of migrations) {
    database.exec(
      (await read(`drizzle/${migration}`)).replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
  }
  return database;
}

test("password credentials use salted PBKDF2-SHA256 without retaining plaintext", async () => {
  const password = "correct horse battery staple";
  const [first, second] = await Promise.all([
    hashPassword(password),
    hashPassword(password),
  ]);

  assert.equal(first.algorithm, "PBKDF2-SHA256");
  assert.equal(first.iterations, PASSWORD_ITERATIONS);
  assert.equal(PASSWORD_ITERATIONS, 600_000);
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.passwordHash, second.passwordHash);
  assert.doesNotMatch(JSON.stringify(first), new RegExp(password, "u"));
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword("incorrect password value", first), false);
  assert.equal(
    await hashOpaqueToken("opaque-token-a"),
    await hashOpaqueToken("opaque-token-a"),
  );
  assert.notEqual(
    await hashOpaqueToken("opaque-token-a"),
    await hashOpaqueToken("opaque-token-b"),
  );
});

test("fresh D1 migrations enforce credential, one-time token, and hashed session storage", async () => {
  const database = await migratedDatabase();
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);

  for (const table of [
    "user_password_credentials",
    "email_verification_tokens",
    "user_sessions",
  ]) {
    assert.ok(
      database
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .get(table),
    );
  }

  database.exec(`
    INSERT INTO users
      (id, email, display_name, primary_role, status, email_verified_at)
    VALUES
      ('usr_manual_auth', 'manual@example.com', 'Manual Reader', 'USER',
       'ACTIVE', NULL);
    INSERT INTO user_password_credentials
      (user_id, algorithm, iterations, salt, password_hash)
    VALUES
      ('usr_manual_auth', 'PBKDF2-SHA256', 600000,
       'AAAAAAAAAAAAAAAAAAAAAA',
       'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    INSERT INTO email_verification_tokens
      (id, user_id, token_hash, expires_at)
    VALUES
      ('verify_manual_1', 'usr_manual_auth', 'verification-hash',
       '2027-01-01T00:00:00.000Z');
    INSERT INTO user_sessions
      (id, user_id, token_hash, auth_method, expires_at)
    VALUES
      ('session_manual_1', 'usr_manual_auth', 'session-hash', 'PASSWORD',
       '2027-01-01T00:00:00.000Z');
  `);
  assert.throws(
    () =>
      database
        .prepare(
          `INSERT INTO email_verification_tokens
           (id, user_id, token_hash, expires_at)
           VALUES ('verify_manual_2', 'usr_manual_auth',
                   'verification-hash', '2027-01-01T00:00:00.000Z')`,
        )
        .run(),
    /UNIQUE constraint failed/u,
  );
  assert.throws(
    () =>
      database
        .prepare(
          `INSERT INTO user_sessions
           (id, user_id, token_hash, auth_method, expires_at)
           VALUES ('session_manual_2', 'usr_manual_auth',
                   'session-hash', 'PASSWORD',
                   '2027-01-01T00:00:00.000Z')`,
        )
        .run(),
    /UNIQUE constraint failed/u,
  );
  assert.throws(
    () =>
      database
        .prepare(
          `UPDATE user_password_credentials
              SET iterations = 99999
            WHERE user_id = 'usr_manual_auth'`,
        )
        .run(),
    /user_password_credentials_iterations_check/u,
  );
  database
    .prepare("DELETE FROM users WHERE id = 'usr_manual_auth'")
    .run();
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM user_sessions").get()
      .count,
    0,
  );
  assert.equal(
    database
      .prepare("SELECT COUNT(*) AS count FROM email_verification_tokens")
      .get().count,
    0,
  );
  database.close();
});

test("manual auth routes keep secrets server-side and preserve ChatGPT identity", async () => {
  const [
    crypto,
    localAuth,
    email,
    signup,
    login,
    verify,
    resend,
    logout,
    identity,
    policy,
    home,
    catchAll,
  ] = await Promise.all([
    read("lib/server/auth-crypto.ts"),
    read("lib/server/local-auth.ts"),
    read("lib/server/auth-email.ts"),
    read("app/api/v1/auth/signup/route.ts"),
    read("app/api/v1/auth/login/route.ts"),
    read("app/api/v1/auth/verify-email/route.ts"),
    read("app/api/v1/auth/resend-verification/route.ts"),
    read("app/api/v1/auth/logout/route.ts"),
    read("app/chatgpt-auth.ts"),
    read("lib/server/policy.ts"),
    read("app/page.tsx"),
    read("app/[...slug]/page.tsx"),
  ]);

  assert.match(crypto, /name: "PBKDF2"/u);
  assert.match(crypto, /hash: "SHA-256"/u);
  assert.match(localAuth, /__Host-nyascans_session/u);
  assert.match(localAuth, /"HttpOnly"/u);
  assert.match(localAuth, /"Secure"/u);
  assert.match(localAuth, /"SameSite=Lax"/u);
  assert.match(localAuth, /token_hash/u);
  assert.match(localAuth, /used_at IS NULL/u);
  assert.match(localAuth, /email_verified_at IS NOT NULL/u);
  assert.match(localAuth, /SELECT 1 FROM user_sessions\s+WHERE id = \? AND user_id = \?/u);
  assert.match(localAuth, /!results\[2\]\?\.meta\.changes/u);
  assert.doesNotMatch(localAuth, /password\s*=\s*input\.password/u);

  assert.match(email, /https:\/\/api\.resend\.com\/emails/u);
  assert.match(email, /idempotency-key/u);
  assert.match(email, /verificationUrl\.hash/u);
  assert.match(email, /EMAIL_API_KEY/u);

  for (const route of [signup, login, verify, resend, logout]) {
    assert.match(route, /assertSameOrigin\(request\)/u);
    assert.match(route, /cache-control": "no-store"/u);
    assert.doesNotMatch(route, /console\.(?:log|error)/u);
  }
  assert.match(signup, /\.min\(15\)\.max\(128\)/u);
  assert.match(signup, /status: 202/u);
  assert.match(signup, /If this address can be registered/u);
  assert.match(login, /"set-cookie": result\.cookie/u);
  assert.match(verify, /verifyEmailToken/u);
  assert.match(verify, /getChatGPTUser/u);
  assert.match(localAuth, /AUTH_IDENTITY_CONFLICT/u);
  assert.match(resend, /resendPasswordVerification/u);
  assert.match(logout, /chatGPTSignOutPath/u);

  assert.match(identity, /export async function getChatGPTUser/u);
  assert.match(identity, /const providerUser = await getChatGPTUser\(\)/u);
  assert.match(identity, /getPasswordSessionIdentity/u);
  assert.match(policy, /authMethod: "CHATGPT" \| "PASSWORD"/u);
  assert.match(policy, /getAuthenticatedUser/u);
  assert.match(policy, /email_verified_at = CURRENT_TIMESTAMP/u);
  assert.match(home, /getAuthenticatedUser/u);
  assert.match(catchAll, /getAuthenticatedUser/u);
});
