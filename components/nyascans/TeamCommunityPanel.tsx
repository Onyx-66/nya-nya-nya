"use client";
import { DotsRing } from "@/components/nyascans/DotsRing";

import { UnifiedSingleSelect } from "@/components/nyascans/UnifiedSingleSelect";
/* eslint-disable @next/next/no-img-element */

import { Check, ImageSquare, LinkSimple, Plus, ShieldCheck, UploadSimple, UserPlus, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUnsavedChanges } from "@/components/nyascans/admin/AdminPageScaffold";

type TeamLink = { id?: string; label: string; url: string; linkType: "WEBSITE" | "DISCORD" | "SOCIAL" | "PORTFOLIO" | "OTHER" };
type TeamRecord = {
  id: string; slug: string; name: string; description: string; verificationStatus: string;
  revision: number; membershipRole: string | null; membershipStatus: string | null;
  logoUrl: string | null; bannerUrl: string | null; links: TeamLink[];
  members: Array<{ userId: string; displayName: string; email: string; membershipRole: string; status: string }>;
  ownershipClaim: { status: string; proofValue?: string; statement?: string; reviewReason?: string | null } | null;
  titleRequests: Array<{ id: string; requestedTitle: string; reason: string; status: string; reviewReason?: string | null }>;
};
type TeamPayload = { teams: TeamRecord[]; invitations: TeamRecord[] };

type TeamCreateDraft = { name: string; description: string; links: TeamLink[]; proofUrl: string; statement: string };
const emptyCreate: TeamCreateDraft = { name: "", description: "", links: [{ label: "Website", url: "", linkType: "WEBSITE" }], proofUrl: "", statement: "" };

export function TeamCommunityPanel() {
  const [data, setData] = useState<TeamPayload>({ teams: [], invitations: [] });
  const [create, setCreate] = useState(emptyCreate);
  const [drafts, setDrafts] = useState<Record<string, { description: string; links: TeamLink[] }>>({});
  const [invite, setInvite] = useState<Record<string, string>>({});
  const [claimStatement, setClaimStatement] = useState<Record<string, string>>({});
  const [titleRequest, setTitleRequest] = useState<Record<string, { title: string; reason: string }>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const mutationLock = useRef(false);
  const loadSequence = useRef(0);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const dirty = useMemo(() => {
    const creating = Boolean(create.name || create.description || create.proofUrl || create.statement || create.links.some((link) => link.url));
    const editing = data.teams.some((team) => {
      const draft = drafts[team.id];
      return Boolean(draft && (draft.description !== team.description || JSON.stringify(draft.links) !== JSON.stringify(team.links.map(({ label, url, linkType }) => ({ label, url, linkType })))));
    });
    return creating || editing || Object.values(invite).some(Boolean) || Object.values(claimStatement).some(Boolean) || Object.values(titleRequest).some((entry) => Boolean(entry.title || entry.reason));
  }, [claimStatement, create, data.teams, drafts, invite, titleRequest]);
  useUnsavedChanges(dirty, "community team drafts");

  const applyData = useCallback((next: TeamPayload) => {
    setData(next);
    setDrafts(Object.fromEntries(next.teams.map((team) => [team.id, { description: team.description, links: team.links.map((link) => ({ label: link.label, url: link.url, linkType: link.linkType })) }])));
  }, []);
  const load = useCallback(async () => {
    const sequence = loadSequence.current + 1;
    loadSequence.current = sequence;
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/teams/community", { cache: "no-store" });
      const payload = await response.json() as { data?: TeamPayload; error?: { message?: string } };
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "Your teams could not be loaded.");
      if (sequence !== loadSequence.current) return false;
      applyData(payload.data);
      return true;
    } catch (error) {
      if (sequence === loadSequence.current) setMessage({ kind: "error", text: error instanceof Error ? error.message : "Your teams could not be loaded." });
      return false;
    }
    finally { if (sequence === loadSequence.current) setLoading(false); }
  }, [applyData]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function mutate(body: Record<string, unknown>, success: string) {
    if (mutationLock.current) return false;
    mutationLock.current = true;
    setBusy(String(body.action)); setMessage(null);
    try {
      const response = await fetch("/api/v1/teams/community", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as { data?: TeamPayload; error?: { message?: string } };
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "The team action could not be completed.");
      applyData(payload.data); setMessage({ kind: "success", text: success }); return true;
    } catch (error) { setMessage({ kind: "error", text: error instanceof Error ? error.message : "The team action could not be completed." }); return false; }
    finally { mutationLock.current = false; setBusy(""); }
  }

  async function uploadTeamMedia(team: TeamRecord, slot: "logo" | "banner", file?: File) {
    if (!file || mutationLock.current) return;
    mutationLock.current = true;
    setBusy(`media:${team.id}:${slot}`); setMessage(null);
    try {
      const form = new FormData(); form.set("teamId", team.id); form.set("slot", slot); form.set("revision", String(team.revision)); form.set("file", file);
      const response = await fetch("/api/v1/admin/team-media", { method: "PUT", body: form });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "Team media could not be uploaded.");
      await load(); setMessage({ kind: "success", text: `${slot === "logo" ? "Logo" : "Banner"} uploaded.` });
    } catch (error) { setMessage({ kind: "error", text: error instanceof Error ? error.message : "Team media could not be uploaded." }); }
    finally { mutationLock.current = false; setBusy(""); }
  }

  return (
    <section className="team-community-workspace">
      <header className="team-community-heading"><div><p className="eyebrow">Community publishing</p><h1>My teams</h1><p>Create a team, prove ownership of a public link, invite collaborators, and manage approved details. Team titles are permanent unless an administrator approves a formal request.</p></div><ShieldCheck size={42} weight="duotone" /></header>
      {message ? <div className={`admin-notice ${message.kind === "error" ? "is-warning" : "is-success"}`} role={message.kind === "error" ? "alert" : "status"}>{message.text}</div> : null}
      {data.invitations.length ? <section className="team-invitation-list"><h2>Pending invitations</h2>{data.invitations.map((team) => <article key={team.id}><div><strong>{team.name}</strong><span>Invited as {team.membershipRole?.toLowerCase()}</span></div><button type="button" onClick={() => void mutate({ action: "DECLINE", teamId: team.id }, "Invitation declined.")}><X /> Decline</button><button className="button button-primary" type="button" onClick={() => void mutate({ action: "ACCEPT", teamId: team.id }, "Invitation accepted.")}><Check /> Accept</button></article>)}</section> : null}
      <details className="team-create-forum" open={!data.teams.length}>
        <summary><Plus /> Create a community team</summary>
        <div><p>Verification method: an administrator opens the public proof link and validates your statement before ownership and publishing rights become active.</p>
          <label><span>Permanent team title</span><input value={create.name} maxLength={100} onChange={(event) => setCreate((current) => ({ ...current, name: event.target.value }))} /><small>This title cannot be edited after creation without a formal request.</small></label>
          <label><span>Description</span><textarea rows={5} minLength={20} maxLength={2000} value={create.description} onChange={(event) => setCreate((current) => ({ ...current, description: event.target.value }))} /></label>
          <div className="team-link-editor"><strong>Public links (at least one)</strong>{create.links.map((link, index) => <div key={`create-link:${index}`}><input aria-label="Link label" value={link.label} onChange={(event) => setCreate((current) => ({ ...current, links: current.links.map((entry, entryIndex) => entryIndex === index ? { ...entry, label: event.target.value } : entry) }))} /><input aria-label="HTTPS link" type="url" placeholder="https://…" value={link.url} onChange={(event) => setCreate((current) => ({ ...current, links: current.links.map((entry, entryIndex) => entryIndex === index ? { ...entry, url: event.target.value } : entry), proofUrl: current.proofUrl || event.target.value }))} />{create.links.length > 1 ? <button type="button" onClick={() => setCreate((current) => ({ ...current, links: current.links.filter((_, entryIndex) => entryIndex !== index) }))}><X /></button> : null}</div>)}<button className="button button-secondary" type="button" disabled={create.links.length >= 10} onClick={() => setCreate((current) => ({ ...current, links: [...current.links, { label: "Social", url: "", linkType: "SOCIAL" }] }))}><Plus /> Add link</button></div>
          <label><span>Ownership proof link</span><UnifiedSingleSelect value={create.proofUrl} onChange={(event) => setCreate((current) => ({ ...current, proofUrl: event.target.value }))}><option value="">Select a completed link</option>{create.links.filter((link) => link.url).map((link) => <option key={link.url} value={link.url}>{link.label} · {link.url}</option>)}</UnifiedSingleSelect></label>
          <label><span>Verification statement</span><textarea rows={4} minLength={20} maxLength={1000} placeholder="Explain where the administrator can confirm your ownership or control of this link." value={create.statement} onChange={(event) => setCreate((current) => ({ ...current, statement: event.target.value }))} /></label>
          <button className="button button-primary" type="button" disabled={Boolean(busy) || create.name.trim().length < 2 || create.description.trim().length < 20 || !create.proofUrl || create.statement.trim().length < 20} onClick={() => void mutate({ action: "CREATE", ...create }, "Team submitted for ownership verification.").then((saved) => { if (saved) setCreate(emptyCreate); })}>{busy === "CREATE" ? <DotsRing /> : <ShieldCheck />} Submit team for verification</button>
        </div>
      </details>
      {loading ? <div className="settings-loading"><DotsRing /> Loading your teams…</div> : null}
      <div className="team-management-list">{data.teams.map((team) => {
        const draft = drafts[team.id] ?? { description: team.description, links: team.links };
        const authorized = team.membershipStatus === "ACTIVE" && ["OWNER", "LEADER"].includes(team.membershipRole ?? "");
        const activeMember = team.membershipStatus === "ACTIVE";
        const pendingCreator = team.membershipStatus === "PENDING";
        const request = titleRequest[team.id] ?? { title: "", reason: "" };
        return <article className="team-management-card" key={team.id}>
          <div className="team-management-visual">{team.bannerUrl ? <img src={team.bannerUrl} alt="" /> : <span><ImageSquare /></span>}{team.logoUrl ? <img src={team.logoUrl} alt={`${team.name} logo`} /> : <span><ShieldCheck /></span>}</div>
          <header><div><span className={`team-status team-status-${team.verificationStatus.toLowerCase()}`}>{team.verificationStatus}</span><h2>{team.name}</h2><small>{team.membershipRole} · {team.membershipStatus}</small></div><a href={`/team/${team.slug}`}>View public team</a></header>
          {team.ownershipClaim?.reviewReason ? <p className="team-review-note"><strong>Administrator review:</strong> {team.ownershipClaim.reviewReason}</p> : null}
          {(authorized || pendingCreator) ? <>
            <div className="team-media-actions"><label className="button button-secondary"><UploadSimple /> Logo<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void uploadTeamMedia(team, "logo", event.target.files?.[0])} /></label><label className="button button-secondary"><UploadSimple /> Banner<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void uploadTeamMedia(team, "banner", event.target.files?.[0])} /></label></div>
            <label><span>Description</span><textarea rows={4} value={draft.description} onChange={(event) => setDrafts((current) => ({ ...current, [team.id]: { ...draft, description: event.target.value } }))} /></label>
            <div className="team-link-editor"><strong><LinkSimple /> Team links</strong>{draft.links.map((link, index) => <div key={`${team.id}:link:${index}`}><input value={link.label} aria-label="Link label" onChange={(event) => setDrafts((current) => ({ ...current, [team.id]: { ...draft, links: draft.links.map((entry, entryIndex) => entryIndex === index ? { ...entry, label: event.target.value } : entry) } }))} /><input type="url" value={link.url} aria-label="Link URL" onChange={(event) => setDrafts((current) => ({ ...current, [team.id]: { ...draft, links: draft.links.map((entry, entryIndex) => entryIndex === index ? { ...entry, url: event.target.value } : entry) } }))} /><button type="button" disabled={draft.links.length === 1} onClick={() => setDrafts((current) => ({ ...current, [team.id]: { ...draft, links: draft.links.filter((_, entryIndex) => entryIndex !== index) } }))}><X /></button></div>)}<button className="button button-secondary" type="button" onClick={() => setDrafts((current) => ({ ...current, [team.id]: { ...draft, links: [...draft.links, { label: "Social", url: "", linkType: "SOCIAL" }] } }))}><Plus /> Add link</button></div>
            <button className="button button-primary" type="button" disabled={Boolean(busy)} onClick={() => void mutate({ action: "UPDATE", teamId: team.id, revision: team.revision, description: draft.description, links: draft.links }, "Team details saved.")}>Save details</button>
            {pendingCreator && team.ownershipClaim?.status === "REJECTED" ? <details className="team-title-request"><summary>Resubmit ownership evidence</summary><label><span>Proof link</span><UnifiedSingleSelect defaultValue={draft.links.some((link) => link.url === team.ownershipClaim?.proofValue) ? team.ownershipClaim?.proofValue : draft.links[0]?.url}>{draft.links.filter((link) => link.url).map((link) => <option key={link.url} value={link.url}>{link.label} · {link.url}</option>)}</UnifiedSingleSelect></label><label><span>Updated verification statement</span><textarea rows={3} minLength={20} value={claimStatement[team.id] ?? ""} onChange={(event) => setClaimStatement((current) => ({ ...current, [team.id]: event.target.value }))} /></label><button type="button" disabled={(claimStatement[team.id] ?? "").trim().length < 20} onClick={(event) => { const field = event.currentTarget.closest("details")?.querySelector("select"); void mutate({ action: "RESUBMIT_CLAIM", teamId: team.id, proofUrl: field?.value ?? draft.links[0]?.url, statement: claimStatement[team.id] ?? "" }, "Ownership evidence resubmitted."); }}>Resubmit for administrator review</button></details> : null}
          </> : null}
          {activeMember ? <section className="team-member-admin"><h3>Members</h3>{team.members.map((member) => <div key={member.userId}><span>{member.displayName}<small>{member.email}</small></span><em>{member.membershipRole} · {member.status}</em></div>)}<div><input type="email" value={invite[team.id] ?? ""} placeholder="reader@example.com" onChange={(event) => setInvite((current) => ({ ...current, [team.id]: event.target.value }))} /><button type="button" onClick={() => void mutate({ action: "INVITE", teamId: team.id, email: invite[team.id], membershipRole: "UPLOADER" }, "Invitation sent.")}><UserPlus /> Invite</button><button type="button" onClick={() => void mutate({ action: "ADD_MEMBER", teamId: team.id, email: invite[team.id], membershipRole: "UPLOADER" }, "Member added.")}><Plus /> Add now</button></div></section> : null}
          {authorized ? <details className="team-title-request"><summary>Request a permanent title change</summary><label><span>Requested title</span><input value={request.title} onChange={(event) => setTitleRequest((current) => ({ ...current, [team.id]: { ...request, title: event.target.value } }))} /></label><label><span>Reason and evidence</span><textarea rows={3} value={request.reason} onChange={(event) => setTitleRequest((current) => ({ ...current, [team.id]: { ...request, reason: event.target.value } }))} /></label><button type="button" disabled={request.title.trim().length < 2 || request.reason.trim().length < 20} onClick={() => void mutate({ action: "REQUEST_TITLE", teamId: team.id, requestedTitle: request.title, reason: request.reason }, "Title-change request submitted.")}>Submit formal request</button>{team.titleRequests.map((entry) => <p key={entry.id}>{entry.requestedTitle} · {entry.status}{entry.reviewReason ? ` · ${entry.reviewReason}` : ""}</p>)}</details> : null}
        </article>;
      })}</div>
    </section>
  );
}
