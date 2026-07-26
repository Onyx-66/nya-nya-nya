import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFile(path.join(root, file), "utf8");

test("commercial settings stay fail closed until a valid public contract loads", async () => {
  const [settings, hook] = await Promise.all([
    read("lib/commercial-settings.ts"),
    read("components/nyascans/useCommercialSettings.ts"),
  ]);

  assert.match(
    settings,
    /export const failClosedCommercialSettings:[\s\S]+premiumEconomyPublic:\s*false/u,
  );
  assert.match(
    settings,
    /failClosedCommercialSettings[\s\S]+coinIconKey:\s*null[\s\S]+defaultChapterPrice:\s*0[\s\S]+defaultSeriesPrice:\s*0[\s\S]+packages:\s*\[\][\s\S]+memberships:\s*\[\]/u,
  );
  assert.match(
    settings,
    /function sanitizeCommercialSettingsForPublic[\s\S]+if \(!settings\.economy\.premiumEconomyPublic\)[\s\S]+return failClosedCommercialSettings/u,
  );
  assert.match(
    settings,
    /coinIconKey:\s*settings\.economy\.coinIconKey \? "configured" : null/u,
  );

  assert.match(
    hook,
    /useState<CommercialSettings>\(\s*failClosedCommercialSettings/u,
  );
  assert.match(
    hook,
    /commercialSettingsSchema\.safeParse\(payload\.settings\)/u,
  );
  assert.match(hook, /if \(!parsed\.success\) return;/u);
  assert.doesNotMatch(
    hook,
    /useState<CommercialSettings>\(\s*defaultCommercialSettings/u,
  );
});

test("public commercial settings and icon routes redact hidden premium configuration", async () => {
  const [catchAll, coinIcon] = await Promise.all([
    read("app/api/v1/[...resource]/route.ts"),
    read("app/api/v1/coin-icon/route.ts"),
  ]);

  const publicSettingsBranch = catchAll.slice(
    catchAll.indexOf('if (path === "site-commercial-settings")'),
    catchAll.indexOf('if (path === "site-theme")'),
  );
  assert.match(
    publicSettingsBranch,
    /settings:\s*sanitizeCommercialSettingsForPublic\(document\.settings\)/u,
  );
  assert.doesNotMatch(publicSettingsBranch, /\.\.\.document\.settings\.economy/u);

  const visibilityCheck = coinIcon.indexOf(
    "if (!document.settings.economy.premiumEconomyPublic)",
  );
  const objectRead = coinIcon.indexOf("env.BUCKET.get(key)");
  assert.ok(visibilityCheck >= 0, "coin icon GET must check public visibility");
  assert.ok(
    objectRead > visibilityCheck,
    "coin icon visibility must be checked before object storage is read",
  );
  assert.match(
    coinIcon.slice(visibilityCheck, objectRead),
    /404[\s\S]+COIN_ICON_NOT_FOUND/u,
  );
});

test("hidden economy account endpoints return only Shards-safe data", async () => {
  const [catchAll, notifications] = await Promise.all([
    read("app/api/v1/[...resource]/route.ts"),
    read("app/api/v1/notifications/route.ts"),
  ]);
  const walletBranch = catchAll.slice(
    catchAll.indexOf('if (path === "wallet")'),
    catchAll.indexOf('if (path === "orders")'),
  );
  const ordersBranch = catchAll.slice(
    catchAll.indexOf('if (path === "orders")'),
    catchAll.indexOf('if (path === "notifications")'),
  );
  const notificationsBranch = catchAll.slice(
    catchAll.indexOf('if (path === "notifications")'),
    catchAll.indexOf('if (path === "uploads")'),
  );

  assert.match(
    walletBranch,
    /if \(!commercial\.settings\.economy\.premiumEconomyPublic\)[\s\S]+currencyWalletSnapshot\(env\.DB, actor\.id, "SHARDS"\)[\s\S]+premiumEconomyPublic:\s*false/u,
  );
  assert.match(
    ordersBranch,
    /if \(!commercial\.settings\.economy\.premiumEconomyPublic\)[\s\S]+\{\s*data:\s*\[\],\s*premiumEconomyPublic:\s*false\s*\}/u,
  );
  assert.match(
    notificationsBranch,
    /AND \(\? = 1 OR kind <> 'TEAM_SUPPORT'\)/u,
  );
  assert.match(
    notificationsBranch,
    /commercial\.settings\.economy\.premiumEconomyPublic \? 1 : 0/u,
  );
  assert.match(
    notifications,
    /AND \(\? = 1 OR kind <> 'TEAM_SUPPORT'\)/u,
  );
  assert.match(
    notifications,
    /premiumEconomyPublic \? 1 : 0/u,
  );
});

test("Rewards omits the ONYX wallet when premium economy is hidden", async () => {
  const rewards = await read("app/api/v1/rewards/route.ts");

  assert.match(rewards, /getCommercialSettingsDocument\(\)/u);
  assert.match(
    rewards,
    /premiumEconomyPublic\s*\?\s*economySnapshot\(database\(\), actor\.id\)\s*:\s*walletSnapshot\(database\(\), actor\.id, "SHARDS"\)/u,
  );
  assert.match(rewards, /balances,[\s\S]+premiumEconomyPublic,/u);
});
