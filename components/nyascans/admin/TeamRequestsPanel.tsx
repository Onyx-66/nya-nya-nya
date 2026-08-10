"use client";

import { Check, LinkSimple, ShieldCheck, SpinnerGap, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { AdminPageScaffold } from "@/components/nyascans/admin/AdminPageScaffold";

type RequestData = {
  ownershipClaims: Array<{ id: string; teamId: string; teamName: string; claimantName: string; claimantEmail: string; proofValue: string; statement: string; status: string; reviewReason?: string | null; revision: number; createdAt: string; links: Array<{ label: string; url: string; linkType: string }> }>;
  titleRequests: Array<{ id: string; teamId: string; currentTitle: string; requestedTitle: string; requestedBy: string; requesterEmail: string; reason: string; status: string; reviewReason?: string | null; revision: number; createdAt: string }>;
};

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

  async function decide(kind: "OWNERSHIP" | "TITLE", item: { id: string; revision: number }, decision: "APPROVE" | "REJECT") {
    const reason = reasons[item.id]?.trim() ?? "";
    if (reason.length < 10) { setMessage({ kind: "error", text: "Write a precise review reason of at least 10 characters." }); return; }
    setBusy(item.id); setMessage(null);
    try {
      const response = await fetch("/api/v1/admin/team-requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, id: item.id, revision: item.revision, decision, reason }) });
      const payload = await response.json() as { data?: RequestData; error?: { message?: string } };
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "The review decision could not be saved.");
      setData(payload.data); setMessage({ kind: "success", text: `${kind === "OWNERSHIP" ? "Ownership" : "Title"} request ${decision === "APPROVE" ? "approved" : "rejected"}.` });
    } catch (error) { setMessage({ kind: "error", text: error instanceof Error ? error.message : "The review decision could not be saved." }); }
    finally { setBusy(""); }
  }

  const pendingClaims = data?.ownershipClaims.filter((claim) => claim.status === "PENDING") ?? [];
  const pendingTitles = data?.titleRequests.filter((request) => request.status === "PENDING") ?? [];
  return <AdminPageScaffold breadcrumbs={["Administration", "Publishing & content"]} kicker="Verified ownership" title="Team requests" description="Validate link-control evidence before ownership becomes active, and process the only permitted route for a permanent team-title change." message={message} state={loading ? { kind: "loading", message: "Loading team review queues…" } : { kind: "ready" }}>
    <div className="team-request-queues">
      <section><header><ShieldCheck /><div><h3>Ownership verification</h3><span>{pendingClaims.length} pending</span></div></header>{pendingClaims.length ? pendingClaims.map((claim) => <article key={claim.id}><div className="team-request-title"><strong>{claim.teamName}</strong><span>{claim.claimantName} · {claim.claimantEmail}</span></div><p>{claim.statement}</p><a href={claim.proofValue} target="_blank" rel="noreferrer"><LinkSimple /> Open proof link</a><ul>{claim.links.map((link) => <li key={link.url}><a href={link.url} target="_blank" rel="noreferrer">{link.label}</a><small>{link.linkType}</small></li>)}</ul><label><span>Decision reason</span><textarea value={reasons[claim.id] ?? ""} onChange={(event) => setReasons((current) => ({ ...current, [claim.id]: event.target.value }))} /></label><div><button type="button" disabled={busy === claim.id} onClick={() => void decide("OWNERSHIP", claim, "REJECT")}><X /> Reject</button><button className="button button-primary" type="button" disabled={busy === claim.id} onClick={() => void decide("OWNERSHIP", claim, "APPROVE")}>{busy === claim.id ? <SpinnerGap className="spin" /> : <Check />} Approve ownership</button></div></article>) : <p className="admin-empty-copy">No ownership claim is waiting for review.</p>}</section>
      <section><header><ShieldCheck /><div><h3>Permanent title changes</h3><span>{pendingTitles.length} pending</span></div></header>{pendingTitles.length ? pendingTitles.map((request) => <article key={request.id}><div className="team-request-title"><strong>{request.currentTitle} → {request.requestedTitle}</strong><span>{request.requestedBy} · {request.requesterEmail}</span></div><p>{request.reason}</p><label><span>Decision reason</span><textarea value={reasons[request.id] ?? ""} onChange={(event) => setReasons((current) => ({ ...current, [request.id]: event.target.value }))} /></label><div><button type="button" disabled={busy === request.id} onClick={() => void decide("TITLE", request, "REJECT")}><X /> Reject</button><button className="button button-primary" type="button" disabled={busy === request.id} onClick={() => void decide("TITLE", request, "APPROVE")}>{busy === request.id ? <SpinnerGap className="spin" /> : <Check />} Approve title</button></div></article>) : <p className="admin-empty-copy">No title change is waiting for review.</p>}</section>
    </div>
  </AdminPageScaffold>;
}
