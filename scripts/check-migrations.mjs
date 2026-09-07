import { readdir, readFile } from "node:fs/promises";
import process from "node:process";

const migrationDirectory = new URL("../drizzle/", import.meta.url);
const metadataDirectory = new URL("../drizzle/meta/", import.meta.url);
const migrationFiles = (await readdir(migrationDirectory))
  .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
  .sort();
const journal = JSON.parse(
  await readFile(new URL("_journal.json", metadataDirectory), "utf8"),
);
const latestMigration = migrationFiles.at(-1)?.slice(0, 4);
const latestEntry = journal.entries?.at(-1);
const latestJournal = latestEntry?.tag?.slice(0, 4);

if (!latestMigration || latestMigration !== latestJournal) {
  console.error(
    `Migration metadata drift: latest SQL is ${latestMigration ?? "missing"}, ` +
      `latest journal entry is ${latestJournal ?? "missing"}.`,
  );
  process.exitCode = 1;
} else {
  const snapshotFiles = await readdir(metadataDirectory);
  if (!snapshotFiles.includes(`${latestMigration}_snapshot.json`)) {
    console.error(`Migration metadata drift: ${latestMigration}_snapshot.json is missing.`);
    process.exitCode = 1;
  } else {
    console.log(`Migration metadata is aligned through ${latestMigration}.`);
  }
}
