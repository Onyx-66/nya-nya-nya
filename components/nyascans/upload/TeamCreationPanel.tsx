"use client";

import { CheckCircle, Clock, CloudArrowUp, DotsThree, Info, ShieldCheck, WarningCircle } from "@/components/nyascans/heroicons";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";

type ExternalLink = { platform: string; url: string };
type MemberPreview = { email: string; displayName: string; username: string; avatarUrl?: string | null };
type TeamCreationRequest = {
  id: string; name: string; slug: string; description: string; websiteUrl?: string | null; discordUrl?: string | null;
  externalLinks?: ExternalLink[]; memberEmails?: string[]; logoUrl?: string | null; bannerUrl?: string | null;
  reason: string; status: "PENDING" | "APPROVED" | "REJECTED"; reviewReason?: string | null; revision: number; createdAt: string; reviewedAt?: string | null;
};
type FormValues = {
  name: string; description: string; reason: string; logo: File | null; banner: File | null;
  externalLinks: ExternalLink[]; memberEmails: string[];
};

const emptyForm: FormValues = { name: "", description: "", reason: "", logo: null, banner: null, externalLinks: [], memberEmails: [] };
const platforms = ["Website", "Discord", "YouTube", "TikTok", "Instagram", "Facebook", "Other"];

function statusLabel(status: TeamCreationRequest["status"]) { return status === "PENDING" ? "Awaiting review" : status === "APPROVED" ? "Approved" : "Needs changes"; }
function imagePreview(file: File | null) { return file ? URL.createObjectURL(file) : null; }

export function TeamCreationPanel() {
  const [form, setForm] = useState<FormValues>(emptyForm);
  const [requests, setRequests] = useState<TeamCreationRequest[]>([]);
  const [memberPreviews, setMemberPreviews] = useState<Record<number, MemberPreview | null>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const logoPreview = useMemo(() => imagePreview(form.logo), [form.logo]);
  const bannerPreview = useMemo(() => imagePreview(form.banner), [form.banner]);

  useEffect(() => () => { if (logoPreview) URL.revokeObjectURL(logoPreview); if (bannerPreview) URL.revokeObjectURL(bannerPreview); }, [logoPreview, bannerPreview]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/v1/team-creation-requests", { cache: "no-store" });
      const payload = await response.json() as { data?: { requests?: TeamCreationRequest[] }; error?: { message?: string } };
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "Team requests could not be loaded.");
      setRequests(payload.data.requests ?? []);
    } catch (error) { setMessage({ kind: "error", text: error instanceof Error ? error.message : "Team requests could not be loaded." }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      form.memberEmails.forEach((email, index) => {
        const normalized = email.trim().toLowerCase();
        if (!normalized.includes("@")) { setMemberPreviews((current) => ({ ...current, [index]: null })); return; }
        void fetch(`/api/v1/team-creation-requests?lookupEmail=${encodeURIComponent(normalized)}`, { cache: "no-store" })
          .then(async (response) => (await response.json()) as { data?: { member?: MemberPreview | null } })
          .then((payload) => setMemberPreviews((current) => ({ ...current, [index]: payload.data?.member ?? null })))
          .catch(() => setMemberPreviews((current) => ({ ...current, [index]: null })));
      });
    }, 260);
    return () => window.clearTimeout(timer);
  }, [form.memberEmails]);

  function update(field: keyof FormValues, value: string | File | null) { setForm((current) => ({ ...current, [field]: value })); setMessage(null); }
  function updateLink(index: number, field: keyof ExternalLink, value: string) { setForm((current) => ({ ...current, externalLinks: current.externalLinks.map((link, item) => item === index ? { ...link, [field]: value } : link) })); setMessage(null); }
  function updateMember(index: number, value: string) { setForm((current) => ({ ...current, memberEmails: current.memberEmails.map((email, item) => item === index ? value : email) })); setMessage(null); }
  function chooseFile(field: "logo" | "banner", event: ChangeEvent<HTMLInputElement>) { update(field, event.target.files?.[0] ?? null); }
  function addLink() { setForm((current) => ({ ...current, externalLinks: [...current.externalLinks, { platform: "Website", url: "" }] })); }
  function addMember() { setForm((current) => ({ ...current, memberEmails: [...current.memberEmails, ""] })); }
  function removeLink(index: number) { setForm((current) => ({ ...current, externalLinks: current.externalLinks.filter((_, item) => item !== index) })); }
  function removeMember(index: number) { setForm((current) => ({ ...current, memberEmails: current.memberEmails.filter((_, item) => item !== index) })); setMemberPreviews((current) => { const next = { ...current }; delete next[index]; return next; }); }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(null);
    try {
      const body = new FormData();
      body.set("name", form.name); body.set("description", form.description); body.set("reason", form.reason);
      body.set("externalLinks", JSON.stringify(form.externalLinks.filter((link) => link.url.trim())));
      body.set("memberEmails", JSON.stringify(form.memberEmails.filter((email) => email.trim())));
      if (form.logo) body.set("logo", form.logo); if (form.banner) body.set("banner", form.banner);
      const response = await fetch("/api/v1/team-creation-requests", { method: "POST", body });
      const payload = await response.json() as { data?: { requests?: TeamCreationRequest[] }; error?: { message?: string } };
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "The team request could not be submitted.");
      setRequests(payload.data.requests ?? []); setForm(emptyForm); setMemberPreviews({}); setMessage({ kind: "success", text: "Team request sent. An administrator will review the details." });
    } catch (error) { setMessage({ kind: "error", text: error instanceof Error ? error.message : "The team request could not be submitted." }); }
    finally { setBusy(false); }
  }

  return <section className="upload-team-creation">
    <header className="upload-section-heading"><div><span><CloudArrowUp size={18} /> Upload Center</span><h2>Create a publishing team</h2><p>Submit your team details for administrator review. Approved teams are activated with you as team leader and uploader.</p></div></header>
    {message ? <div className={`upload-alert is-${message.kind}`} role="status">{message.kind === "success" ? <CheckCircle size={18} /> : <WarningCircle size={18} />} {message.text}</div> : null}
    <div className="upload-team-creation-grid">
      <form className="upload-composer-card upload-team-creation-form" onSubmit={submit}>
        <div className="upload-team-creation-form-heading"><ShieldCheck size={19} /><div><strong>Team application</strong><small>Use the name readers will recognize.</small></div></div>
        <label>Team name<input required minLength={2} maxLength={100} value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="Example Scans" /></label>
        <label>Description<textarea required minLength={20} maxLength={2_000} rows={5} value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="Tell reviewers what your team publishes and how it operates." /></label>
        <div className="upload-team-media-grid">
          <label className="upload-team-media-field">Team logo <span>(required, square)</span><input required type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => chooseFile("logo", event)} />{logoPreview ? <img className="upload-team-logo-preview" src={logoPreview} alt="Team logo preview" /> : <small>Upload a circular logo.</small>}</label>
          <label className="upload-team-media-field">Team banner <span>(required, minimum 16:9)</span><input required type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => chooseFile("banner", event)} />{bannerPreview ? <img className="upload-team-banner-preview" src={bannerPreview} alt="Team banner preview" /> : <small>Upload a wide team banner.</small>}</label>
        </div>
        <div className="upload-team-dynamic-block"><div className="upload-team-dynamic-heading"><div><strong>External links</strong><small>Select a platform, then add its link.</small></div><button type="button" className="button button-secondary" onClick={addLink}>+ Add link</button></div>{form.externalLinks.map((link, index) => <div className="upload-team-dynamic-row" key={`link-${index}`}><select value={link.platform} onChange={(event) => updateLink(index, "platform", event.target.value)}>{platforms.map((platform) => <option key={platform}>{platform}</option>)}</select><input type="url" value={link.url} onChange={(event) => updateLink(index, "url", event.target.value)} placeholder="https://…" /><button type="button" className="upload-team-remove-button" aria-label="Remove external link" onClick={() => removeLink(index)}>×</button></div>)}</div>
        <label>Talk about yourself<textarea required minLength={20} maxLength={1_000} rows={4} value={form.reason} onChange={(event) => update("reason", event.target.value)} placeholder="Introduce yourself, your experience, and what you hope to bring to the community." /></label>
        <div className="upload-team-dynamic-block"><div className="upload-team-dynamic-heading"><div><strong>Add team members <span>(optional)</span></strong><small>Enter one registered platform email per field.</small></div><button type="button" className="button button-secondary" onClick={addMember}>+ Add member</button></div>{form.memberEmails.map((email, index) => <div className="upload-team-member-row" key={`member-${index}`}><input type="email" value={email} onChange={(event) => updateMember(index, event.target.value)} placeholder="teammate@example.com" />{memberPreviews[index] ? <span className="upload-team-member-preview"><img src={memberPreviews[index]?.avatarUrl ?? "/art/mangadex-preview/cover-066.jpg"} alt="" /><span>{memberPreviews[index]?.displayName}</span></span> : null}<button type="button" className="upload-team-remove-button" aria-label="Remove team member" onClick={() => removeMember(index)}>×</button></div>)}</div>
        <div className="upload-team-creation-note"><Info size={17} /><span>Approval creates a verified team, grants you the global uploader and team-leader roles, and sends listed registered members an invitation to join.</span></div>
        <button className="button button-primary" type="submit" disabled={busy}>{busy ? <DotsThree size={18} /> : <CheckCircle size={18} />} {busy ? "Sending request…" : "Send for admin review"}</button>
      </form>
      <section className="upload-composer-card upload-team-creation-history" aria-labelledby="team-request-history-title"><div className="upload-team-creation-form-heading"><Clock size={19} /><div><strong id="team-request-history-title">Your team requests</strong><small>Track review status and administrator notes.</small></div></div>{loading ? <p className="upload-muted-copy">Loading requests…</p> : requests.length ? <div className="upload-team-request-list">{requests.map((request) => <article key={request.id}><header><strong>{request.name}</strong><span className={`upload-team-request-status is-${request.status.toLowerCase()}`}>{statusLabel(request.status)}</span></header><small>Submitted {new Date(request.createdAt).toLocaleString()}</small>{request.reviewReason ? <p>{request.reviewReason}</p> : request.status === "PENDING" ? <p>Waiting for an administrator to review the team details.</p> : null}</article>)}</div> : <p className="upload-muted-copy">No team requests yet. Submit your first application to begin.</p>}</section>
    </div>
  </section>;
}
