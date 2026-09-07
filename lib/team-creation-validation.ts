import { z } from "zod";

export const teamCreationFieldLabels: Record<string, string> = {
  name: "Team name", description: "Description", logo: "Team logo",
  banner: "Team banner", externalLinks: "Team socials", reason: "Team introduction",
  memberEmails: "Member emails",
};

export type TeamCreationErrors = Record<string, string>;
type TeamDraft = {
  name: string; description: string; reason: string;
  logo: unknown; banner: unknown;
  externalLinks: { platform: string; url: string }[];
  memberEmails: string[];
};

export function validateTeamCreation(form: TeamDraft): TeamCreationErrors {
  const errors: TeamCreationErrors = {};
  if (form.name.trim().length < 2 || form.name.trim().length > 100) errors.name = "Enter a team name between 2 and 100 characters.";
  if (form.description.trim().length < 20 || form.description.trim().length > 2000) errors.description = "Describe your team in 20–2,000 characters.";
  if (!form.logo) errors.logo = "Choose a team logo and confirm its crop.";
  if (!form.banner) errors.banner = "Choose a team banner and confirm its crop.";
  if (!form.externalLinks.length) errors.externalLinks = "Add at least one public HTTPS link for your team.";
  for (const [index, link] of form.externalLinks.entries()) {
    if (!link.url.trim().startsWith("https://") || !z.string().url().max(600).safeParse(link.url.trim()).success) {
      errors.externalLinks ??= `Social link ${index + 1}: enter a complete HTTPS URL, such as https://example.com.`;
    }
  }
  if (form.externalLinks.length > 12) errors.externalLinks = "Use no more than 12 social links.";
  if (form.reason.trim().length < 20 || form.reason.trim().length > 1000) errors.reason = "Introduce yourself and your team in 20–1,000 characters.";
  for (const [index, email] of form.memberEmails.entries()) {
    if (email.trim() && !z.string().email().max(320).safeParse(email.trim()).success) {
      errors.memberEmails ??= `Member ${index + 1}: enter a valid email address or remove this row.`;
    }
  }
  if (form.memberEmails.filter((email) => email.trim()).length > 25) errors.memberEmails = "Add no more than 25 members.";
  return errors;
}

export function teamCreationServerErrors(error?: {
  code?: string; message?: string; fields?: { path?: string; message?: string }[];
}): TeamCreationErrors {
  const errors: TeamCreationErrors = {};
  for (const field of error?.fields ?? []) {
    const key = field.path?.split(/[.\[]/)[0];
    if (key && key in teamCreationFieldLabels) errors[key] ??= field.message ?? "Check this value.";
  }
  const code = error?.code ?? "";
  const key = code.startsWith("TEAM_LOGO") ? "logo" : code.startsWith("TEAM_BANNER") ? "banner"
    : ["TEAM_NAME_EXISTS", "TEAM_CREATION_REQUEST_EXISTS"].includes(code) ? "name" : null;
  if (key) errors[key] = error?.message ?? "Check this value.";
  return errors;
}
