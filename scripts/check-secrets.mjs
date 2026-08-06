#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const maxTextBytes = 5_000_000;
const allowedEnvironmentFiles = new Set([".env.example", ".dev.vars.example"]);
const providerVariableNames = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_TOKEN",
  "CF_API_TOKEN",
  "DATABASE_URL",
  "DATABASE_TOKEN",
  "DATABASE_PASSWORD",
  "D1_API_TOKEN",
  "D1_TOKEN",
  "TURSO_AUTH_TOKEN",
  "NEON_DATABASE_URL",
  "EMAIL_API_KEY",
  "RESEND_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "MEILISEARCH_API_KEY",
  "GITHUB_TOKEN",
  "NYASCANS_GIFT_CODE_SECRET",
];

const detectorDefinitions = [
  {
    id: "cloudflare-token",
    pattern: new RegExp(
      ["\\b", "cf", "(?:k|ut|at)_[A-Za-z0-9_-]{20,}\\b"].join(""),
      "u",
    ),
  },
  {
    id: "resend-token",
    pattern: new RegExp(
      ["\\b", "re", "_[A-Za-z0-9_-]{20,}\\b"].join(""),
      "u",
    ),
  },
  {
    id: "private-key",
    pattern: new RegExp(
      ["-----BEGIN ", "(?:[A-Z ]+ )?", "PRIVATE KEY-----"].join(""),
      "u",
    ),
  },
  {
    id: "github-token",
    pattern: new RegExp(
      ["\\b(?:", "gh", "[pousr]_[A-Za-z0-9]{20,}|", "github", "_pat_[A-Za-z0-9_]{20,})\\b"].join(""),
      "u",
    ),
  },
  {
    id: "stripe-secret",
    pattern: new RegExp(
      ["\\b(?:", "sk", "|rk)_(?:live|test)_[A-Za-z0-9]{16,}\\b"].join(""),
      "u",
    ),
  },
  {
    id: "aws-access-key",
    pattern: new RegExp(["\\b", "AK", "IA[0-9A-Z]{16}\\b"].join(""), "u"),
  },
  {
    id: "slack-token",
    pattern: new RegExp(["\\b", "xox", "[baprs]-[A-Za-z0-9-]{20,}\\b"].join(""), "u"),
  },
  {
    id: "database-url-with-credentials",
    pattern: new RegExp(
      [
        "\\b(?:mongo",
        "db(?:\\+srv)?|post",
        "gres(?:ql)?|my",
        "sql):\\/\\/[^\\s\"'<>:]+:[^\\s\"'<>@]+@",
      ].join(""),
      "u",
    ),
  },
  {
    id: "literal-bearer-token",
    pattern: new RegExp(
      ["\\b", "Bear", "er[ \\t]+[A-Za-z0-9._~+\\/-]{24,}={0,2}\\b"].join(""),
      "u",
    ),
  },
  {
    id: "named-secret-assignment",
    pattern: new RegExp(
      [
        "\\b(?:",
        providerVariableNames.join("|"),
        ")[ \\t]*[:=][ \\t]*",
        "[\"']?",
        "([^\\s\"'`]{12,})",
      ].join(""),
      "u",
    ),
    allow(match) {
      return /^(?:process\.env\.|env\.|import\.meta\.env\.|\$\{|<|example|replace|change-?me|your[_-])/iu.test(
        match[1] ?? "",
      );
    },
  },
];

function git(args, options = {}) {
  const encoding = Object.prototype.hasOwnProperty.call(options, "encoding")
    ? options.encoding
    : "utf8";
  return execFileSync("git", args, {
    encoding,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function isDisallowedEnvironmentFile(file) {
  const base = file.split("/").at(-1) ?? file;
  return (
    (base.startsWith(".env") || base.startsWith(".dev.vars")) &&
    !allowedEnvironmentFiles.has(base)
  );
}

function isText(buffer) {
  return buffer.length <= maxTextBytes && !buffer.includes(0);
}

export function scanContent(file, buffer) {
  const findings = [];
  if (isDisallowedEnvironmentFile(file)) {
    findings.push("tracked-environment-file");
  }
  if (!isText(buffer)) return findings;
  const content = buffer.toString("utf8");
  for (const detector of detectorDefinitions) {
    const flags = detector.pattern.flags.includes("g")
      ? detector.pattern.flags
      : `${detector.pattern.flags}g`;
    const pattern = new RegExp(detector.pattern.source, flags);
    for (const match of content.matchAll(pattern)) {
      if (detector.allow?.(match)) continue;
      findings.push(detector.id);
      break;
    }
  }
  return findings;
}

export function readGitObject(objectId) {
  return git(["cat-file", "-p", objectId], { encoding: null });
}

function workingFiles(stagedOnly) {
  const args = stagedOnly
    ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]
    : ["ls-files", "-z", "--cached", "--others", "--exclude-standard"];
  return git(args).split("\0").filter(Boolean).map((file) => ({
    file,
    read() {
      if (stagedOnly) return git(["show", `:${file}`], { encoding: null });
      return readFileSync(file);
    },
  }));
}

function historicalFiles() {
  const entries = git(["rev-list", "--objects", "--all"])
    .split("\n")
    .filter(Boolean);
  const seen = new Set();
  const files = [];
  for (const entry of entries) {
    const separator = entry.indexOf(" ");
    if (separator < 0) continue;
    const objectId = entry.slice(0, separator);
    const file = entry.slice(separator + 1);
    if (!file || seen.has(objectId)) continue;
    seen.add(objectId);
    let type;
    let size;
    try {
      type = git(["cat-file", "-t", objectId]).trim();
      size = Number(git(["cat-file", "-s", objectId]).trim());
    } catch {
      continue;
    }
    if (type !== "blob" || !Number.isFinite(size) || size > maxTextBytes) continue;
    files.push({
      file,
      objectId,
      read: () => readGitObject(objectId),
    });
  }
  return files;
}

export function runSecretScan({ history = false, stagedOnly = false } = {}) {
  const targets = history ? historicalFiles() : workingFiles(stagedOnly);
  const findings = [];
  for (const target of targets) {
    let buffer;
    try {
      buffer = target.read();
    } catch {
      continue;
    }
    for (const detector of scanContent(target.file, buffer)) {
      findings.push({
        detector,
        file: target.file,
        ...(target.objectId ? { objectId: target.objectId.slice(0, 12) } : {}),
      });
    }
  }
  return { findings, scanned: targets.length };
}

function main() {
  const flags = new Set(process.argv.slice(2));
  const unknown = [...flags].filter((flag) => !["--history", "--staged"].includes(flag));
  if (unknown.length || (flags.has("--history") && flags.has("--staged"))) {
    console.error("Usage: node scripts/check-secrets.mjs [--history | --staged]");
    process.exitCode = 64;
    return;
  }
  const result = runSecretScan({
    history: flags.has("--history"),
    stagedOnly: flags.has("--staged"),
  });
  if (result.findings.length) {
    console.error("Potential plaintext secrets detected; values are intentionally hidden:");
    for (const finding of result.findings) {
      const object = finding.objectId ? ` @ ${finding.objectId}` : "";
      console.error(`- ${finding.file}${object} [${finding.detector}]`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`Secret scan passed (${result.scanned} files/blobs checked).`);
}

if (process.argv[1]?.endsWith("check-secrets.mjs")) main();
