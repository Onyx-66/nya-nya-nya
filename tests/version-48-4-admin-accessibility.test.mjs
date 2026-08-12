import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFile(path.join(root, file), "utf8");

test("admin overlays trap and restore focus while mobile tables label row headers", async () => {
  const [app, css] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/admin.css"),
  ]);

  assert.match(app, /function adminFocusableElements/u);
  assert.match(app, /function restoreAdminFocus/u);
  assert.match(app, /document\.addEventListener\("keydown", keepFocusInside, true\)/u);
  assert.match(app, /mobileNavTriggerRef/u);
  assert.match(app, /role=\{admin && drawerViewport && mobileNavOpen \? "dialog" : undefined\}/u);
  assert.match(app, /:scope > th, :scope > td/u);
  assert.match(css, /tbody th\[scope="row"\][\s\S]+content: attr\(data-label\)/u);
});

test("users expose named teams and a collapsible X/Y permission matrix", async () => {
  const [panel, api, css] = await Promise.all([
    read("components/nyascans/OperationsControlPanel.tsx"),
    read("app/api/v1/[...resource]/route.ts"),
    read("app/admin.css"),
  ]);

  assert.match(api, /GROUP_CONCAT\(t\.name, '\|\|\|'\)[\s\S]+AS teamNamesCsv/u);
  assert.match(api, /teamNames: String\(row\.teamNamesCsv/u);
  assert.match(panel, /user\.teamNames\.map\(\(teamName\)/u);
  assert.match(panel, /ADMIN_PERMISSION_REGISTRY\.filter/u);
  assert.match(panel, /\{group\.activeCount\}\/\{group\.totalCount\} enabled/u);
  assert.match(panel, /<code>\{permission\.capability\}<\/code>/u);
  assert.match(panel, /admin-sticky-actions chapter-access-actions/u);
  assert.match(css, /\.user-permission-category/u);
});
