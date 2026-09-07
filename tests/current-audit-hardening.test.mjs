import assert from "node:assert/strict";
import test from "node:test";
import { zipSync } from "fflate";
import { extractBoundedImageArchive } from "../lib/server/bounded-image-archive.ts";

test("bounded image archive extracts supported pages in natural order", () => {
  const archive = zipSync({
    "chapter/page-10.png": new Uint8Array([10]),
    "chapter/page-2.jpg": new Uint8Array([2]),
    "chapter/notes.txt": new TextEncoder().encode("ignored"),
  });
  const pages = extractBoundedImageArchive(archive);
  assert.deepEqual(pages.map((page) => page.filename), ["page-2.jpg", "page-10.png"]);
  assert.deepEqual(pages.map((page) => page.bytes[0]), [2, 10]);
});

test("bounded image archive rejects traversal paths before page use", () => {
  const archive = zipSync({ "../escape.png": new Uint8Array([1, 2, 3]) });
  assert.throws(
    () => extractBoundedImageArchive(archive),
    (error) => error?.code === "SOURCE_ARCHIVE_PATH_INVALID",
  );
});

test("bounded image archive stops highly compressed output at the live byte limit", () => {
  const archive = zipSync({ "page.png": new Uint8Array(11 * 1024 * 1024) }, { level: 9 });
  assert.ok(archive.byteLength < 1024 * 1024, "fixture should be strongly compressed");
  assert.throws(
    () => extractBoundedImageArchive(archive),
    (error) => error?.code === "SOURCE_ARCHIVE_RATIO_LIMIT" && error?.status === 413,
  );
});
