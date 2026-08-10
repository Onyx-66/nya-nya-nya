import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFile(path.join(root, file), "utf8");

test("system notifications are global, stacked, colored, and shared by public, admin, and upload surfaces", async () => {
  const [
    layout,
    notifications,
    app,
    scaffold,
    operations,
    upload,
    requests,
    css,
  ] = await Promise.all([
    read("app/layout.tsx"),
    read("components/nyascans/SystemNotifications.tsx"),
    read("components/nyascans/NyaScansApp.tsx"),
    read("components/nyascans/admin/AdminPageScaffold.tsx"),
    read("components/nyascans/OperationsControlPanel.tsx"),
    read("components/nyascans/upload/UploadCenterWorkspace.tsx"),
    read("components/nyascans/upload/SeriesRequestWorkspace.tsx"),
    read("app/globals.css"),
  ]);

  assert.match(
    layout,
    /<SystemNotificationProvider>\{children\}<\/SystemNotificationProvider>/u,
  );
  for (const kind of ["success", "info", "warning", "error"]) {
    assert.ok(notifications.includes(`"${kind}"`));
    assert.match(css, new RegExp(`\\.system-notification-${kind}`));
  }
  assert.match(notifications, /\[next, \.\.\.current\]\.slice\(0, 4\)/u);
  assert.match(notifications, /role=\{liveRole\}/u);
  assert.match(notifications, /onClick=\{\(\) => onDismiss\(notification\.id\)\}/u);
  assert.doesNotMatch(app, /const \[toast, setToast\]/u);
  assert.doesNotMatch(app, /className="toast"/u);
  assert.match(app, /useSystemNotifications/u);
  assert.match(scaffold, /<SystemNoticeBridge/u);
  assert.match(operations, /<SystemNoticeBridge/u);
  assert.match(upload, /<SystemNoticeBridge message=\{error\} kind="error"/u);
  assert.match(requests, /<SystemNoticeBridge message=\{message\} kind="success"/u);

  const finalCss = css.slice(
    css.lastIndexOf("Version 37: unified system feedback"),
  );
  assert.match(finalCss, /\.system-notification-region[\s\S]+position:\s*fixed/u);
  assert.match(finalCss, /top:\s*max\(18px, env\(safe-area-inset-top\)\)/u);
  assert.match(finalCss, /right:\s*max\(18px, env\(safe-area-inset-right\)\)/u);
  assert.match(finalCss, /#39c98a/u);
  assert.match(finalCss, /#55a7ff/u);
  assert.match(finalCss, /#f1b94b/u);
  assert.match(finalCss, /#f06a78/u);
  assert.match(finalCss, /@media \(max-width: 520px\)/u);
  assert.match(finalCss, /@media \(prefers-reduced-motion: reduce\)/u);
});

test("branding and fixed reader media save without hidden validation failures", async () => {
  const [schema, server, panel, api] = await Promise.all([
    read("lib/site-configuration.ts"),
    read("lib/server/site-configuration.ts"),
    read("components/nyascans/SiteConfigurationPanel.tsx"),
    read("app/api/v1/[...resource]/route.ts"),
  ]);

  const validation = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      "import('./lib/site-configuration.ts').then(({siteConfigurationSchema,defaultSiteConfiguration})=>siteConfigurationSchema.parse(defaultSiteConfiguration))",
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(validation.status, 0, validation.stderr);
  assert.match(schema, /id:\s*"x"[\s\S]+label:\s*"X"/u);
  assert.match(server, /parseSiteConfiguration\(raw\)/u);
  assert.match(server, /recoveredFromInvalid:\s*true/u);

  const saveStart = panel.indexOf("async function save");
  const saveEnd = panel.indexOf("function upload", saveStart);
  const saveSource = panel.slice(saveStart, saveEnd);
  const mediaLoop = saveSource.indexOf(
    "for (const slot of Object.keys(emptyPendingMedia)",
  );
  const settingsPut = saveSource.indexOf(
    'fetch("/api/v1/admin/site-configuration"',
  );
  assert.ok(mediaLoop >= 0 && settingsPut > mediaLoop);
  assert.match(saveSource, /desiredSettings = withMediaSlot/u);
  assert.match(saveSource, /expectedRevision:\s*currentRevision/u);
  assert.match(panel, /setMediaEnabled\(slot, true\)/u);
  assert.match(panel, /maxHeight:[\s\S]+2_400/u);
  assert.match(panel, /payload\.error\?\.fields/u);
  assert.match(panel, /aria-invalid=\{Boolean\(fieldErrors\["brand\.siteName"\]\)\}/u);

  const siteMediaStart = api.indexOf('if (path === "admin/site-media")');
  const siteMediaEnd = api.indexOf('if (path === "store/purchases")', siteMediaStart);
  const siteMedia = api.slice(siteMediaStart, siteMediaEnd);
  assert.match(siteMedia, /new Uint8Array\(await candidate\.arrayBuffer\(\)\)/u);
  assert.match(siteMedia, /detectedImageType\(bytes\)/u);
  assert.doesNotMatch(siteMedia, /candidate\.type !==/u);
});

test("balance adjustment has independent Paw Coins and Shards disclosure panels on the audited API", async () => {
  const [panel, api, css] = await Promise.all([
    read("components/nyascans/OperationsControlPanel.tsx"),
    read("app/api/v1/[...resource]/route.ts"),
    read("app/globals.css"),
  ]);

  const editorStart = panel.indexOf('className="balance-adjustment-editor"');
  const editorEnd = panel.indexOf("{loading ?", editorStart);
  const editor = panel.slice(editorStart, editorEnd);
  assert.match(editor, /currency:\s*"SHARDS"/u);
  assert.match(editor, /currency:\s*"ONYX"/u);
  assert.match(editor, /aria-expanded=\{open\}/u);
  assert.match(editor, /\{open \? \(/u);
  assert.match(editor, /Post \$\{option\.label\} adjustment/u);
  assert.doesNotMatch(editor, /<select/u);
  assert.match(panel, /scrollIntoView\(/u);
  assert.match(panel, /currency,\s*delta,\s*reason:/u);
  assert.match(api, /path === "admin\/balance-adjustments"/u);
  assert.match(api, /requireOwner\(actor\)/u);
  assert.match(api, /buyer_entry\.amount < 0/u);
  assert.match(api, /wallet\.balance\.adjust/u);

  const finalCss = css.slice(
    css.lastIndexOf("Version 37: unified system feedback"),
  );
  assert.match(finalCss, /\.balance-adjustment-panels/u);
  assert.match(finalCss, /\.balance-currency-panel\[data-currency="shards"\]/u);
  assert.match(finalCss, /\.balance-currency-panel\[data-currency="onyx"\]/u);
  assert.match(finalCss, /\.balance-currency-form/u);
});

test("roles, discussion settings, Series Management, and footer shortcuts use the final polished UI", async () => {
  const [operations, discussion, series, app, configuration, css] =
    await Promise.all([
      read("components/nyascans/OperationsControlPanel.tsx"),
      read("components/nyascans/DiscussionSettingsPanel.tsx"),
      read("components/nyascans/admin/SeriesManagementPanel.tsx"),
      read("components/nyascans/NyaScansApp.tsx"),
      read("lib/site-configuration.ts"),
      read("app/globals.css"),
    ]);

  assert.match(operations, /data-role=\{role\.value\}/u);
  assert.match(operations, /type="checkbox"[\s\S]+checked=\{checked\}/u);
  for (const role of [
    "OWNER",
    "ADMINISTRATOR",
    "MANAGER",
    "MODERATOR",
    "TEAM_LEADER",
    "UPLOADER",
    "USER",
  ]) {
    assert.ok(css.includes(`label[data-role="${role}"]`));
  }

  assert.match(discussion, /className="discussion-feature-card"/u);
  assert.match(discussion, /className="discussion-policy-toggle"/u);
  assert.match(discussion, /className="discussion-limit-card"/u);
  assert.doesNotMatch(discussion, /className="theme-switch"/u);
  assert.ok((discussion.match(/\|\| !dirty/gu) ?? []).length >= 2);

  for (const className of [
    "admin-entity-input-row",
    "admin-icon-action",
    "series-record-cover",
    "admin-team-row",
    "admin-team-primary",
    "admin-save-state",
  ]) {
    assert.ok(series.includes(className));
  }
  assert.match(css, /\.admin-review-grid > :is\(article, div\)/u);
  assert.match(css, /\.admin-record-browser > form > \.admin-icon-action/u);

  assert.match(app, /const groups = settings\.footer\.groups/u);
  assert.match(app, /link\.url === "#keyboard-shortcuts"/u);
  assert.match(app, /onClick=\{onOpenShortcuts\}/u);
  const support = configuration.indexOf('label: "Support"');
  const footerShortcut = configuration.indexOf('label: "Keyboard shortcuts"');
  assert.ok(support >= 0 && footerShortcut > support);
  assert.match(configuration, /prefix: "G", key: "M"[\s\S]+href: "\/onyx\/admin\/access"/u);
  assert.match(configuration, /prefix: "G", key: "P"[\s\S]+href: "\/upload-chapter"/u);
});
