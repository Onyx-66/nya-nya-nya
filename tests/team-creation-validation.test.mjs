import test from "node:test";
import assert from "node:assert/strict";
import { validateTeamCreation, teamCreationServerErrors } from "../lib/team-creation-validation.ts";

const complete = () => ({
  name: "Example Scans", description: "We publish original fantasy stories.",
  reason: "We are an experienced team of artists.", logo: {}, banner: {},
  externalLinks: [{ platform: "Website", url: "https://example.com" }], memberEmails: [],
});

test("a missing social row has a named actionable error even with every other field filled", () => {
  const result = validateTeamCreation({ ...complete(), externalLinks: [] });
  assert.deepEqual(Object.keys(result), ["externalLinks"]);
  assert.match(result.externalLinks, /at least one.*HTTPS/);
});
test("all missing requirements are reported together", () => {
  const result = validateTeamCreation({ name: " ", description: "short", reason: "short", logo: null, banner: null, externalLinks: [], memberEmails: [] });
  assert.deepEqual(Object.keys(result), ["name", "description", "logo", "banner", "externalLinks", "reason"]);
});
test("valid team details pass; blank optional members do not block submission", () => {
  assert.deepEqual(validateTeamCreation({ ...complete(), memberEmails: [""] }), {});
});
test("validation uses trimmed lengths and identifies bad social URLs and member emails", () => {
  const result = validateTeamCreation({ ...complete(), name: " a ", description: "   short   ", externalLinks: [{ platform: "Website", url: "http://example.com" }], memberEmails: ["bad email"] });
  assert.deepEqual(Object.keys(result), ["name", "description", "externalLinks", "memberEmails"]);
  assert.match(result.externalLinks, /Social link 1/);
});
test("an added blank social row is actionable instead of silently discarded", () => {
  const draft = complete(); draft.externalLinks.push({ platform: "Discord", url: "" });
  assert.match(validateTeamCreation(draft).externalLinks, /Social link 2/);
});
test("nested server validation paths resolve to visible form sections", () => {
  assert.deepEqual(teamCreationServerErrors({ fields: [
    { path: "externalLinks.1.url", message: "Use HTTPS." },
    { path: "memberEmails.0", message: "Invalid email." },
  ] }), { externalLinks: "Use HTTPS.", memberEmails: "Invalid email." });
  assert.deepEqual(teamCreationServerErrors({ code: "TEAM_NAME_EXISTS", message: "Name taken." }), { name: "Name taken." });
  assert.deepEqual(teamCreationServerErrors({ code: "TEAM_LOGO_SQUARE_REQUIRED", message: "Use a square logo." }), { logo: "Use a square logo." });
});
