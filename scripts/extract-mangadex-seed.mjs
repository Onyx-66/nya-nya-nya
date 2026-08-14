import { readFile, writeFile } from "node:fs/promises";

const sourcePath = "/home/ubuntu/upload/api.mangadex.org_manga_limit_12_26includes_5B_5D_cover_art_26includes_5B_5D_author_26includes_5B_5D__1786667845937.md";
const raw = await readFile(sourcePath, "utf8");
const jsonText = raw
  .slice(raw.indexOf("{"))
  .replace(/\\([\[\]{}_*])/gu, "$1")
  .replace(/\\(?!["\\\\/bfnrtu])/gu, "");
const payload = JSON.parse(jsonText);
const firstText = (record) => record?.en ?? Object.values(record ?? {}).find((value) => typeof value === "string" && value.trim()) ?? "Untitled";
const cleanDescription = (record) => String(firstText(record)).replace(/\s+/g, " ").slice(0, 820);
const items = (payload.data ?? []).slice(0, 10).map((entry, index) => {
  const attrs = entry.attributes ?? {};
  const relationships = entry.relationships ?? [];
  const cover = relationships.find((item) => item.type === "cover_art" && item.attributes?.fileName);
  const author = relationships.find((item) => item.type === "author")?.attributes?.name ?? "MangaDex contributor";
  const title = firstText(attrs.title);
  const alternateTitles = (attrs.altTitles ?? []).flatMap(Object.values).filter((value) => typeof value === "string").slice(0, 4);
  return {
    id: entry.id,
    slug: title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72) || `mangadex-${index + 1}`,
    title,
    nativeTitle: alternateTitles.find((value) => value !== title) ?? "",
    synopsis: cleanDescription(attrs.description),
    year: attrs.year ?? null,
    language: attrs.originalLanguage ?? "ja",
    status: String(attrs.status ?? "ongoing").toUpperCase(),
    tags: (attrs.tags ?? []).map((tag) => firstText(tag.attributes?.name)).filter(Boolean).slice(0, 5),
    author,
    coverUrl: cover?.attributes?.fileName
      ? `https://uploads.mangadex.org/covers/${entry.id}/${cover.attributes.fileName}.512.jpg`
      : null,
  };
});
await writeFile("/tmp/mangadex-preview-seed.json", `${JSON.stringify(items, null, 2)}\n`);
console.log(JSON.stringify(items.map(({ id, title, coverUrl, tags }) => ({ id, title, coverUrl, tags })), null, 2));
