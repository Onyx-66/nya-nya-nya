"use client";
import { DotsRing } from "@/components/nyascans/DotsRing";

import { CaretDown, Check, Clock, LinkSimple, ShieldCheck, X } from "@/components/nyascans/heroicons";
import { useCallback, useEffect, useState } from "react";
import { AdminEmptyState, AdminPageScaffold } from "@/components/nyascans/admin/AdminPageScaffold";

type RequestData = {
  ownershipClaims: Array<{ id: string; teamId: string; teamName: string; teamSlug: string; claimantName: string; claimantEmail: string; proofType: string; proofValue: string; statement: string; status: string; reviewReason?: string | null; revision: number; createdAt: string; reviewedAt?: string | null; links: Array<{ label: string; url: string; linkType: string }> }>;
  titleRequests: Array<{ id: string; teamId: string; currentTitle: string; requestedTitle: string; requestedSlug: string; requestedBy: string; requesterEmail: string; reason: string; status: string; reviewReason?: string | null; revision: number; createdAt: string; reviewedAt?: string | null }>;
  creationRequests: Array<{ id: string; name: string; slug: string; description: string; websiteUrl?: string | null; discordUrl?: string | null; logoUrl?: string | null; bannerUrl?: string | null; externalLinks?: Array<{ platform: string; url: string }>; memberEmails?: string[]; requestedBy: string; requesterEmail: string; reason: string; status: string; reviewReason?: string | null; revision: number; createdAt: string; reviewedAt?: string | null }>;
};

function requestDate(value: string) {
  return new Date(value).toLocaleString();
}

export function TeamRequestsPanel() {
  const [data, setData] = useState<RequestData | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/v1/admin/team-requests", { cache: "no-store" });
      const payload = await response.json() as { data?: RequestData; error?: { message?: string } };
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "Team requests could not be loaded.");
      setData(payload.data);
    } catch (error) { setMessage({ kind: "error", text: error instanceof Error ? error.message : "Team requests could not be loaded." }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function decide(kind: "OWNERSHIP" | "TITLE" | "CREATION", item: { id: string; revision: number }, decision: "APPROVE" | "REJECT") {
    const reason = reasons[item.id]?.trim() ?? "";
    if (reason.length < 10) { setMessage({ kind: "error", text: "Write a precise review reason of at least 10 characters." }); return; }
    setBusy(item.id); setMessage(null);
    try {
      const response = await fetch("/api/v1/admin/team-requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, id: item.id, revision: item.revision, decision, reason }) });
      const payload = await response.json() as { data?: RequestData; error?: { message?: string } };
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "The review decision could not be saved.");
      setData(payload.data); setMessage({ kind: "success", text: `${kind === "OWNERSHIP" ? "Ownership" : kind === "CREATION" ? "Team creation" : "Title"} request ${decision === "APPROVE" ? "approved" : "rejected"}.` });
    } catch (error) { setMessage({ kind: "error", text: error instanceof Error ? error.message : "The review decision could not be saved." }); }
    finally { setBusy(""); }
  }

  const pendingClaims = data?.ownershipClaims.filter((claim) => claim.status === "PENDING") ?? [];
  const pendingTitles = data?.titleRequests.filter((request) => request.status === "PENDING") ?? [];
  const pendingCreations = data?.creationRequests.filter((request) => request.status === "PENDING") ?? [];
  const reviewedClaims = data?.ownershipClaims.filter((claim) => claim.status !== "PENDING") ?? [];
  const reviewedTitles = data?.titleRequests.filter((request) => request.status !== "PENDING") ?? [];
  const reviewedCreations = data?.creationRequests.filter((request) => request.status !== "PENDING") ?? [];
  return (
    <AdminPageScaffold
      breadcrumbs={["Teams", "Requests"]}
      kicker="Team administration"
      title="Requests"
      description="Review Create Team requests, team socials, media, and member invitations before activation."
      message={message}
      state={loading ? { kind: "loading", message: "Loading team review queues…" } : { kind: "ready" }}
    >
      <div className="team-request-queues">
        <section>
          <header><ShieldCheck /><div><h3>New team creation</h3><span>{pendingCreations.length} pending</span></div></header>
          {pendingCreations.length ? pendingCreations.map((request) => (
            <details className="team-request-card" key={request.id}>
              <summary>
                <div><strong>{request.name}</strong><span>{request.requestedBy} · {request.requesterEmail}</span></div>
                <span className="team-request-status is-pending">Pending</span>
                <CaretDown aria-hidden="true" />
              </summary>
              <div className="team-request-body">
                <dl>
                  <div><dt>Requested slug</dt><dd>/{request.slug}</dd></div>
                  <div><dt>Submitted</dt><dd><Clock /> {requestDate(request.createdAt)}</dd></div>
                  {request.websiteUrl ? <div><dt>Website</dt><dd><a href={request.websiteUrl} target="_blank" rel="noreferrer">Open website</a></dd></div> : null}
                  {request.discordUrl ? <div><dt>Discord</dt><dd><a href={request.discordUrl} target="_blank" rel="noreferrer">Open Discord</a></dd></div> : null}
                </dl>
                {(request.logoUrl || request.bannerUrl) ? <div className="team-request-media-previews">{request.logoUrl ? <figure><img className="team-request-logo-preview" src={request.logoUrl} alt={`${request.name} logo`} /><figcaption>Team logo</figcaption></figure> : null}{request.bannerUrl ? <figure><img className="team-request-banner-preview" src={request.bannerUrl} alt={`${request.name} banner`} /><figcaption>Team banner</figcaption></figure> : null}</div> : null}
                <p><strong>Description</strong><br />{request.description}</p>
                <p><strong>Talk about yourself</strong><br />{request.reason}</p>
                {request.externalLinks?.length ? <div className="team-request-extra-details"><strong>External links</strong><ul>{request.externalLinks.map((link) => <li key={`${link.platform}-${link.url}`}><a href={link.url} target="_blank" rel="noreferrer">{link.platform}</a></li>)}</ul></div> : null}
                {request.memberEmails?.length ? <div className="team-request-extra-details"><strong>Proposed team members</strong><ul>{request.memberEmails.map((email) => <li key={email}>{email}</li>)}</ul></div> : null}
                <label><span>Decision reason</span><textarea rows={4} value={reasons[request.id] ?? ""} onChange={(event) => setReasons((current) => ({ ...current, [request.id]: event.target.value }))} /></label>
                <footer><button type="button" disabled={busy === request.id} onClick={() => void decide("CREATION", request, "REJECT")}><X /> Reject</button><button className="button button-primary" type="button" disabled={busy === request.id} onClick={() => void decide("CREATION", request, "APPROVE")}>{busy === request.id ? <DotsRing /> : <Check />} Approve & activate team</button></footer>
              </div>
            </details>
          )) : <AdminEmptyState icon={<ShieldCheck />} title="Team-creation queue is clear" description="No new team is waiting for administrator review." />}
          {reviewedCreations.length ? <details className="team-request-history"><summary>Reviewed team-creation requests <span>{reviewedCreations.length}</span><CaretDown /></summary><div>{reviewedCreations.map((request) => <article key={request.id}><strong>{request.name}</strong><span className={`team-request-status is-${request.status.toLowerCase()}`}>{request.status}</span><small>{request.reviewReason || "No review note"}</small></article>)}</div></details> : null}
        </section>
        <section>
          <header><ShieldCheck /><div><h3>Team ownership verification</h3><span>{pendingClaims.length} pending</span></div></header>
          {pendingClaims.length ? pendingClaims.map((claim) => (
            <details className="team-request-card" key={claim.id}>
              <summary>
                <div><strong>{claim.teamName}</strong><span>{claim.claimantName} · {claim.claimantEmail}</span></div>
                <span className="team-request-status is-pending">Pending</span>
                <CaretDown aria-hidden="true" />
              </summary>
              <div className="team-request-body">
                <dl>
                  <div><dt>Team</dt><dd><a href={`/team/${claim.teamSlug}`} target="_blank" rel="noreferrer">/{claim.teamSlug}</a></dd></div>
                  <div><dt>Verification method</dt><dd>{claim.proofType.replaceAll("_", " ")}</dd></div>
                  <div><dt>Submitted</dt><dd><Clock /> {requestDate(claim.createdAt)}</dd></div>
                </dl>
                <p><strong>Talk about yourself and your team</strong><br />{claim.statement}</p>
                <a className="team-request-proof" href={claim.proofValue} target="_blank" rel="noreferrer"><LinkSimple /> Open submitted proof</a>
                {claim.links.length ? <ul>{claim.links.map((link) => <li key={link.url}><a href={link.url} target="_blank" rel="noreferrer">{link.label}</a><small>{link.linkType}</small></li>)}</ul> : null}
                <label><span>Decision reason</span><textarea rows={4} value={reasons[claim.id] ?? ""} onChange={(event) => setReasons((current) => ({ ...current, [claim.id]: event.target.value }))} /></label>
                <footer><button type="button" disabled={busy === claim.id} onClick={() => void decide("OWNERSHIP", claim, "REJECT")}><X /> Reject</button><button className="button button-primary" type="button" disabled={busy === claim.id} onClick={() => void decide("OWNERSHIP", claim, "APPROVE")}>{busy === claim.id ? <DotsRing /> : <Check />} Approve ownership</button></footer>
              </div>
            </details>
          )) : <AdminEmptyState icon={<ShieldCheck />} title="Ownership queue is clear" description="No ownership claim is waiting for review." />}
          {reviewedClaims.length ? <details className="team-request-history"><summary>Reviewed ownership claims <span>{reviewedClaims.length}</span><CaretDown /></summary><div>{reviewedClaims.map((claim) => <article key={claim.id}><strong>{claim.teamName}</strong><span className={`team-request-status is-${claim.status.toLowerCase()}`}>{claim.status}</span><small>{claim.reviewReason || "No review note"}</small></article>)}</div></details> : null}
        </section>
        <section>
          <header><ShieldCheck /><div><h3>Team Name changes</h3><span>{pendingTitles.length} pending</span></div></header>
          {pendingTitles.length ? pendingTitles.map((request) => (
            <details className="team-request-card" key={request.id}>
              <summary>
                <div><strong>{request.currentTitle} → {request.requestedTitle}</strong><span>{request.requestedBy} · {request.requesterEmail}</span></div>
                <span className="team-request-status is-pending">Pending</span>
                <CaretDown aria-hidden="true" />
              </summary>
              <div className="team-request-body">
                <dl>
                  <div><dt>Team Name</dt><dd>{request.requestedTitle}</dd></div><div><dt>Requested slug</dt><dd>/{request.requestedSlug}</dd></div>
                  <div><dt>Submitted</dt><dd><Clock /> {requestDate(request.createdAt)}</dd></div>
                </dl>
                <p>{request.reason}</p>
                <label><span>Decision reason</span><textarea rows={4} value={reasons[request.id] ?? ""} onChange={(event) => setReasons((current) => ({ ...current, [request.id]: event.target.value }))} /></label>
                <footer><button type="button" disabled={busy === request.id} onClick={() => void decide("TITLE", request, "REJECT")}><X /> Reject</button><button className="button button-primary" type="button" disabled={busy === request.id} onClick={() => void decide("TITLE", request, "APPROVE")}>{busy === request.id ? <DotsRing /> : <Check />} Approve title</button></footer>
              </div>
            </details>
          )) : <AdminEmptyState icon={<ShieldCheck />} title="Title-change queue is clear" description="No permanent title change is waiting for review." />}
          {reviewedTitles.length ? <details className="team-request-history"><summary>Reviewed title requests <span>{reviewedTitles.length}</span><CaretDown /></summary><div>{reviewedTitles.map((request) => <article key={request.id}><strong>{request.currentTitle} → {request.requestedTitle}</strong><span className={`team-request-status is-${request.status.toLowerCase()}`}>{request.status}</span><small>{request.reviewReason || "No review note"}</small></article>)}</div></details> : null}
        </section>
      </div>
    </AdminPageScaffold>
  );
}
