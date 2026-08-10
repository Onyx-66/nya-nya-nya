import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  readGitObject,
  scanContent,
} from "../scripts/check-secrets.mjs";

test("secret scanner ignores concurrency markers and empty environment templates", () => {
  const source = Buffer.from(
    [
      'mutationMarker: text("mutation_marker").default("initial")',
      "EMAIL_API_KEY=",
      "STRIPE_SECRET_KEY=",
    ].join("\n"),
  );
  assert.deepEqual(scanContent(".env.example", source), []);
  assert.deepEqual(
    scanContent(
      "config.ts",
      Buffer.from("const DATABASE_URL = process.env.DATABASE_URL;"),
    ),
    [],
  );
  const mixed = Buffer.from(
    [
      "const DATABASE_URL = process.env.DATABASE_URL;",
      "const EMAIL_API_KEY = \"abcdefghijklmnopqrstuvwx\";",
    ].join("\n"),
  );
  assert.deepEqual(scanContent("config.ts", mixed), [
    "named-secret-assignment",
  ]);
});

test("historical blob reads stay binary-safe", () => {
  const objectId = execFileSync(
    "git",
    ["rev-parse", "HEAD:package.json"],
    { encoding: "utf8" },
  ).trim();
  const blob = readGitObject(objectId);
  assert.ok(Buffer.isBuffer(blob));
  assert.match(blob.toString("utf8"), /"name": "nyascans"/u);
});

test("secret scanner reports provider credentials without returning their values", () => {
  const token = ["github", "_pat_", "examplevalue12345678901234567890"].join("");
  const findings = scanContent("config.ts", Buffer.from(`const value = "${token}";`));
  assert.deepEqual(findings, ["github-token"]);
  assert.ok(!JSON.stringify(findings).includes(token));
});

test("secret scanner blocks committed environment files", () => {
  assert.deepEqual(
    scanContent(".env.production", Buffer.from("PUBLIC_VALUE=example")),
    ["tracked-environment-file"],
  );
  assert.deepEqual(
    scanContent(".dev.vars", Buffer.from("PUBLIC_VALUE=example")),
    ["tracked-environment-file"],
  );
});

test("Version 48.3.0 is shared by package metadata, the public footer, and admin", async () => {
  const [packageSource, versionSource, appSource] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../lib/app-version.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../components/nyascans/NyaScansApp.tsx", import.meta.url),
      "utf8",
    ),
  ]);
  assert.equal(JSON.parse(packageSource).version, "48.3.0");
  assert.match(versionSource, /APP_VERSION = "48\.3\.0"/u);
  assert.match(appSource, /footer-release-version/u);
  assert.match(appSource, /ops-release-version/u);
});
