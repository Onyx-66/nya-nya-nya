import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const read = (file) => fs.readFile(path.join(root, file), "utf8");

async function migrationNames() {
  return (await fs.readdir(path.join(root, "drizzle")))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
}

async function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const migration of await migrationNames()) {
    database.exec(
      (await read(`drizzle/${migration}`)).replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
  }
  return database;
}

function addUser(database, id) {
  database
    .prepare("INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)")
    .run(id, `${id}@example.test`, id.toUpperCase());
}

function addTeam(database, id, creatorId, status = "VERIFIED") {
  database
    .prepare(
      `INSERT INTO teams
         (id, slug, name, verification_status, created_by_user_id)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, `${id}-slug`, `${id} name`, status, creatorId);
}

function addMembership(database, teamId, userId, role, status) {
  database
    .prepare(
      `INSERT INTO team_memberships
         (team_id, user_id, membership_role, status)
       VALUES (?, ?, ?, ?)`,
    )
    .run(teamId, userId, role, status);
}

test("fresh migrations 0000 through 0051 install the community team model without foreign-key damage", async () => {
  const names = await migrationNames();
  assert.deepEqual(
    names.map((name) => name.slice(0, 4)),
    Array.from({ length: 52 }, (_, index) => String(index).padStart(4, "0")),
  );
  assert.deepEqual(names.slice(-5), [
    "0047_slow_tigra.sql",
    "0048_strong_leo.sql",
    "0049_cold_union_jack.sql",
    "0050_remove_revised_release_labels.sql",
    "0051_nasty_morg.sql",
  ]);

  const database = await migratedDatabase();
  try {
    const tables = new Set(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => row.name),
    );
    for (const table of [
      "team_links",
      "team_ownership_claims",
      "team_title_change_requests",
    ]) {
      assert.ok(tables.has(table), `${table} should exist after a fresh migration`);
    }

    const teamColumns = new Set(
      database.prepare("PRAGMA table_info(teams)").all().map((row) => row.name),
    );
    assert.ok(teamColumns.has("created_by_user_id"));
    assert.ok(teamColumns.has("mutation_marker"));

    const membershipColumns = new Set(
      database
        .prepare("PRAGMA table_info(team_memberships)")
        .all()
        .map((row) => row.name),
    );
    for (const column of ["invited_by_user_id", "invited_at", "responded_at"]) {
      assert.ok(membershipColumns.has(column));
    }
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("database triggers atomically protect every mutation of the final active Owner", async () => {
  const database = await migratedDatabase();
  try {
    for (const userId of ["owner-one", "owner-two", "replacement"]) {
      addUser(database, userId);
    }
    addTeam(database, "team-one", "owner-one");
    addTeam(database, "team-two", "owner-one");
    addMembership(database, "team-one", "owner-one", "OWNER", "ACTIVE");

    const forbiddenMutations = [
      "UPDATE team_memberships SET team_id = 'team-two' WHERE team_id = 'team-one' AND user_id = 'owner-one'",
      "UPDATE team_memberships SET user_id = 'replacement' WHERE team_id = 'team-one' AND user_id = 'owner-one'",
      "UPDATE team_memberships SET membership_role = 'LEADER' WHERE team_id = 'team-one' AND user_id = 'owner-one'",
      "UPDATE team_memberships SET status = 'INACTIVE' WHERE team_id = 'team-one' AND user_id = 'owner-one'",
      "DELETE FROM team_memberships WHERE team_id = 'team-one' AND user_id = 'owner-one'",
    ];
    for (const statement of forbiddenMutations) {
      assert.throws(
        () => database.exec(statement),
        /FINAL_TEAM_OWNER_PROTECTED/u,
      );
      assert.deepEqual(
        { ...database.prepare("SELECT team_id, user_id, membership_role, status FROM team_memberships WHERE team_id = 'team-one'").get() },
        {
          team_id: "team-one",
          user_id: "owner-one",
          membership_role: "OWNER",
          status: "ACTIVE",
        },
        "a rejected mutation must leave the ownership row unchanged",
      );
    }

    addMembership(database, "team-one", "owner-two", "OWNER", "ACTIVE");
    database
      .prepare(
        "UPDATE team_memberships SET membership_role = 'LEADER' WHERE team_id = ? AND user_id = ?",
      )
      .run("team-one", "owner-one");
    assert.throws(
      () =>
        database
          .prepare("DELETE FROM team_memberships WHERE team_id = ? AND user_id = ?")
          .run("team-one", "owner-two"),
      /FINAL_TEAM_OWNER_PROTECTED/u,
      "after the first Owner is demoted, the remaining Owner becomes protected",
    );

    database.prepare("DELETE FROM teams WHERE id = ?").run("team-one");
    assert.equal(
      database
        .prepare("SELECT COUNT(*) AS count FROM team_memberships WHERE team_id = ?")
        .get("team-one").count,
      0,
      "deleting the parent team must still cascade all memberships",
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("an approved even-revision title request authorizes one exact rename and its odd revision consumes it", async () => {
  const database = await migratedDatabase();
  try {
    addUser(database, "owner");
    addUser(database, "reviewer");
    addTeam(database, "title-team", "owner");
    addMembership(database, "title-team", "owner", "OWNER", "ACTIVE");
    database
      .prepare(
        `INSERT INTO team_title_change_requests
           (id, team_id, requested_by_user_id, requested_title, requested_slug,
            reason, status, reviewed_by_user_id, review_reason, revision)
         VALUES (?, ?, ?, ?, ?, ?, 'APPROVED', ?, ?, 2)`,
      )
      .run(
        "title-request",
        "title-team",
        "owner",
        "Approved title",
        "approved-title",
        "A formal community naming request.",
        "reviewer",
        "Identity and links verified.",
      );

    assert.throws(
      () =>
        database
          .prepare("UPDATE teams SET name = ?, slug = ? WHERE id = ?")
          .run("Different title", "different-title", "title-team"),
      /TEAM_TITLE_CHANGE_REQUEST_REQUIRED/u,
      "the approval must authorize only the exact requested identity",
    );

    database.exec("BEGIN");
    try {
      database
        .prepare("UPDATE teams SET name = ?, slug = ? WHERE id = ?")
        .run("Approved title", "approved-title", "title-team");
      database
        .prepare(
          "UPDATE team_title_change_requests SET revision = revision + 1 WHERE id = ? AND status = 'APPROVED' AND revision = 2",
        )
        .run("title-request");
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }

    assert.equal(
      database
        .prepare("SELECT revision FROM team_title_change_requests WHERE id = ?")
        .get("title-request").revision,
      3,
    );
    for (const [name, slug] of [
      ["Approved title again", "approved-title-again"],
      ["title-team name", "title-team-slug"],
    ]) {
      assert.throws(
        () =>
          database
            .prepare("UPDATE teams SET name = ?, slug = ? WHERE id = ?")
            .run(name, slug, "title-team"),
        /TEAM_TITLE_CHANGE_REQUEST_REQUIRED/u,
        "an odd request revision must not be reusable or permit a revert",
      );
    }
    assert.deepEqual(
      { ...database.prepare("SELECT name, slug FROM teams WHERE id = ?").get("title-team") },
      { name: "Approved title", slug: "approved-title" },
    );
  } finally {
    database.close();
  }
});

test("community creation requires HTTPS links and persists proof, pending ownership, and the creator together", async () => {
  const route = await read("app/api/v1/teams/community/route.ts");

  assert.match(route, /links: z\.array\(linkSchema\)\.min\(1\)\.max\(10\)/u);
  assert.ok(
    (route.match(/value\.startsWith\("https:\/\/"\)/gu) ?? []).length >= 2,
    "both public links and the ownership proof must use HTTPS",
  );
  assert.match(
    route,
    /payload\.links\.some\(\(link\) => link\.url === payload\.proofUrl\)/u,
  );
  assert.match(route, /TEAM_PROOF_LINK_REQUIRED/u);
  assert.match(
    route,
    /INSERT INTO teams[\s\S]*verification_status\) VALUES \(\?, \?, \?, \?, \?, 'PENDING'\)[\s\S]*\.\.\.payload\.links\.map[\s\S]*INSERT INTO team_links[\s\S]*INSERT INTO team_memberships[\s\S]*'OWNER', 'PENDING'[\s\S]*INSERT INTO team_ownership_claims/u,
  );
  assert.match(route, /await db\.batch\(\[/u);
});

test("member invitations are authorization-coupled, cannot overwrite an Owner, and accept only into a live verified team", async () => {
  const route = await read("app/api/v1/teams/community/route.ts");
  const invitation = route.slice(
    route.indexOf('payload.action === "INVITE"'),
    route.indexOf('payload.action === "ACCEPT"'),
  );
  assert.match(invitation, /INSERT INTO team_memberships[\s\S]*SELECT \?, target\.id/u);
  assert.match(
    invitation,
    /EXISTS \([\s\S]*current_team\.verification_status = 'VERIFIED'[\s\S]*caller\.status = 'ACTIVE'/u,
  );
  assert.match(invitation, /ON CONFLICT\(team_id, user_id\) DO UPDATE/u);
  assert.match(
    invitation,
    /team_memberships\.status IN \('DECLINED', 'INACTIVE'\) AND team_memberships\.membership_role <> 'OWNER'/u,
  );

  const response = route.slice(
    route.indexOf('payload.action === "ACCEPT"'),
    route.indexOf('payload.action === "RESUBMIT_CLAIM"'),
  );
  assert.match(response, /team\.verificationStatus !== "VERIFIED"/u);
  assert.match(
    response,
    /active_team\.verification_status = 'VERIFIED' AND active_team\.is_archived = 0/u,
  );
  assert.match(response, /status = 'INVITED'/u);
});

test("invited readers receive a minimal snapshot without members, claims, title requests, or links", async () => {
  const route = await read("app/api/v1/teams/community/route.ts");
  const invitations = route.slice(
    route.indexOf("invitations: teamRows.filter"),
    route.indexOf("export async function GET"),
  );
  assert.match(invitations, /team\.membershipStatus === "INVITED"/u);
  assert.match(invitations, /links: \[\]/u);
  assert.match(invitations, /members: \[\]/u);
  assert.match(invitations, /ownershipClaim: null/u);
  assert.match(invitations, /titleRequests: \[\]/u);
  assert.doesNotMatch(invitations, /proofValue|reviewReason|statement/u);
});

test("legacy admin routes reject team creation and cannot promote Pending ownership directly", async () => {
  const [legacyRoute, managementRoute] = await Promise.all([
    read("app/api/v1/[...resource]/route.ts"),
    read("app/api/v1/admin/team-management/route.ts"),
  ]);

  assert.match(legacyRoute, /TEAM_COMMUNITY_WORKFLOW_REQUIRED/u);
  assert.match(
    legacyRoute,
    /Create teams through the community form so links and ownership proof can be reviewed/u,
  );
  assert.match(
    legacyRoute,
    /current\.verificationStatus === "PENDING"[\s\S]*TEAM_OWNERSHIP_REVIEW_REQUIRED/u,
  );
  assert.match(managementRoute, /TEAM_COMMUNITY_CREATION_REQUIRED/u);
  assert.match(
    managementRoute,
    /current\?\.verificationStatus === "PENDING" && payload\.verificationStatus === "VERIFIED"/u,
  );
  assert.match(managementRoute, /TEAM_OWNERSHIP_REVIEW_REQUIRED/u);
});

test("ownership and title reviews use revision CAS gates and revalidate proof and active leadership", async () => {
  const route = await read("app/api/v1/admin/team-requests/route.ts");

  assert.match(
    route,
    /team_ownership_claims WHERE id = \? AND status = 'PENDING' AND revision = \?/u,
  );
  assert.match(
    route,
    /EXISTS \(SELECT 1 FROM team_links l WHERE l\.team_id = team_ownership_claims\.team_id AND l\.url = team_ownership_claims\.proof_value\)/u,
  );
  assert.match(
    route,
    /membership_role = 'OWNER' AND tm\.status = 'PENDING'/u,
  );
  assert.match(route, /if \(!results\[0\]\?\.meta\.changes\)/u);
  assert.match(
    route,
    /team_title_change_requests WHERE id = \? AND status = 'PENDING' AND revision = \?/u,
  );
  assert.match(
    route,
    /requester\.membership_role IN \('OWNER', 'LEADER'\)[\s\S]*requester\.status = 'ACTIVE'/u,
  );
  assert.match(
    route,
    /UPDATE teams SET name = \?, slug = \?[\s\S]*AND \$\{requestGate\}/u,
  );
  assert.match(
    route,
    /UPDATE team_title_change_requests[\s\S]*status = 'APPROVED' AND revision = \?[\s\S]*reviewed_by_user_id = \?/u,
  );
});

test("verified public teams expose ordered links safely and grid cards keep banner, logo, then identity", async () => {
  const [publicRoute, view, cards, css] = await Promise.all([
    read("app/api/v1/public-team/route.ts"),
    read("components/nyascans/PublicTeamView.tsx"),
    read("components/nyascans/PublicDiscoverySections.tsx"),
    read("app/globals.css"),
  ]);

  assert.match(
    publicRoute,
    /SELECT label, url, link_type AS linkType[\s\S]*FROM team_links[\s\S]*ORDER BY sort_order, created_at, id/u,
  );
  assert.match(publicRoute, /links: linkRows\.results/u);
  assert.match(
    view,
    /href=\{link\.url\} target="_blank" rel="noreferrer noopener"/u,
  );

  const bannerIndex = cards.indexOf('className="team-carousel-banner"');
  const logoIndex = cards.indexOf('className="team-carousel-logo"');
  const identityIndex = cards.indexOf("<h3>{record.name}</h3>");
  assert.ok(
    bannerIndex >= 0 && bannerIndex < logoIndex && logoIndex < identityIndex,
    "the card DOM should render banner, then logo, then the named identity",
  );

  const gridAuthority = css.slice(
    css.lastIndexOf(
      '.teams-directory-results.is-grid .team-directory-card {\n  grid-template-areas: "banner" "logo" "identity"',
    ),
  );
  assert.match(
    gridAuthority,
    /grid-template-areas: "banner" "logo" "identity"/u,
  );
  assert.match(
    gridAuthority,
    /\.team-carousel-logo \{[\s\S]*grid-area: logo[\s\S]*justify-self: center/u,
  );
  assert.match(
    gridAuthority,
    /> div \{[\s\S]*grid-area: identity/u,
  );
});
