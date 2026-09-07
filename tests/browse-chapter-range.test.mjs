import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import { z } from "zod";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const route = read("app/api/v1/[...resource]/route.ts");
const visibility = ts.transpileModule(read("lib/server/public-content-visibility.ts"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { publicPaidChapterPredicate } = await import(`data:text/javascript;base64,${Buffer.from(visibility).toString("base64")}`);
const start = route.indexOf("      if (minimumChapters !== undefined || maximumChapters !== undefined)");
const filter = new Function("minimumChapters", "maximumChapters", "publicPaidChapterPredicate", `
  const clauses = [], bindings = [];
  ${route.slice(start, route.indexOf("      if (hideFollowed)", start))}
  return { clauses, bindings };
`);

test("catalog chapter bounds are inclusive, optional, and support a maximum of zero", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE series(id TEXT);
    CREATE TABLE chapters(id, series_id, chapter_number, state, visibility, published_at, access_type, free_at);
    CREATE TABLE content_visibility_overrides(chapter_id, access_type, auto_free_exempt);
    CREATE TABLE commercial_settings(id, revision, settings_json);
    CREATE TABLE feature_flags(key, enabled);
    INSERT INTO series VALUES ('zero'), ('one'), ('two');
    INSERT INTO chapters VALUES
      ('1','one','1','PUBLISHED','PUBLIC','2020-01-01','FREE',NULL),
      ('duplicate','one','01','PUBLISHED','PUBLIC','2020-01-01','FREE',NULL),
      ('draft','one','2','DRAFT','PUBLIC','2020-01-01','FREE',NULL),
      ('private','one','3','PUBLISHED','PRIVATE','2020-01-01','FREE',NULL),
      ('scheduled','one','4','PUBLISHED','PUBLIC','2999-01-01','FREE',NULL),
      ('paid','one','5','PUBLISHED','PUBLIC','2020-01-01','PAID',NULL),
      ('2a','two','1','PUBLISHED','PUBLIC','2020-01-01','FREE',NULL),
      ('2b','two','2','PUBLISHED','PUBLIC','2020-01-01','FREE',NULL);
  `);
  const query = (min, max) => {
    const { clauses, bindings } = filter(min, max, publicPaidChapterPredicate);
    return db.prepare(`SELECT s.id FROM series s WHERE ${clauses.join(" AND ") || "1 = 1"} ORDER BY s.id`).all(...bindings).map((row) => row.id);
  };
  try {
    assert.deepEqual(query(undefined, undefined), ['one', 'two', 'zero']);
    assert.deepEqual(query(undefined, 0), ['zero']);
    assert.deepEqual(query(undefined, 1), ['one', 'zero']);
    assert.deepEqual(query(1, undefined), ['one', 'two']);
    assert.deepEqual(query(1, 1), ['one']);
    assert.deepEqual(query(1, 2), ['one', 'two']);
    assert.deepEqual(query(2, 1), []);
  } finally { db.close(); }
});

test("maximum query parameter accepts bounded whole counts and rejects invalid input", () => {
  const start = route.indexOf("      const maximumChapters = z");
  const parse = new Function("z", "url", `${route.slice(start, route.indexOf("      const hideFollowed", start))}; return maximumChapters;`);
  for (const [input, expected] of [[null, undefined], ['0', 0], ['50', 50], ['10000', 10000], ['-1', undefined], ['1.5', undefined], ['10001', undefined], ['invalid', undefined]]) {
    const url = new URL('https://example.test/api/v1/catalog');
    if (input !== null) url.searchParams.set('maxChapters', input);
    assert.equal(parse(z, url), expected);
  }
});
