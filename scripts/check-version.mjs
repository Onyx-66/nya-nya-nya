import { readFile } from "node:fs/promises";
import process from "node:process";

const [packageText, lockText, appVersionText] = await Promise.all([
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
  readFile(new URL("../lib/app-version.ts", import.meta.url), "utf8"),
]);
const packageVersion = JSON.parse(packageText).version;
const lock = JSON.parse(lockText);
const lockVersion = lock.packages?.[""]?.version ?? lock.version;
const appVersion = appVersionText.match(/APP_VERSION\s*=\s*["']([^"']+)/u)?.[1];

const versions = new Set([packageVersion, lockVersion, appVersion]);
if (versions.size !== 1 || versions.has(undefined)) {
  console.error(
    `Version metadata drift: package=${packageVersion}, lock=${lockVersion}, app=${appVersion ?? "missing"}.`,
  );
  process.exitCode = 1;
} else {
  console.log(`Version metadata is aligned at ${packageVersion}.`);
}
