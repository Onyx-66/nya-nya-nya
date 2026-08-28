"use client";

import { CheckCircle, Clock, CloudArrowUp, DotsThree, Info, ShieldCheck, WarningCircle } from "@/components/nyascans/heroicons";
import { useCallback, useEffect, useState, type FormEvent } from "react";

type TeamCreationRequest = {
  id: string;
  name: string;
  slug: string;
  description: string;
  websiteUrl?: string | null;
  discordUrl?: string | null;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reviewReason?: string | null;
  revision: number;
  createdAt: string;
  reviewedAt?: string | null;
};

type FormValues = {
  name: string;
  description: string;
  websiteUrl: string;
  discordUrl: string;
  reason: string;
};

const emptyForm: FormValues = { name: "", description: "", websiteUrl: "", discordUrl: "", reason: "" };

function statusLabel(status: TeamCreationRequest["status"]) {
  return status === "PENDING" ? "Awaiting review" : status === "APPROVED" ? "Approved" : "Needs changes";
}

export function TeamCreationPanel() {
  const [form, setForm] = useState<FormValues>(emptyForm);
  const [requests, setRequests] = useState<TeamCreationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/v1/team-creation-requests", { cache: "no-store" });
      const payload = await response.json() as { data?: { requests?: TeamCreationRequest[] }; error?: { message?: string } };
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "Team requests could not be loaded.");
      setRequests(payload.data.requests ?? []);
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Team requests could not be loaded." });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function update(field: keyof FormValues, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setMessage(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/team-creation-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, websiteUrl: form.websiteUrl || null, discordUrl: form.discordUrl || null }),
      });
      const payload = await response.json() as { data?: { requests?: TeamCreationRequest[] }; error?: { message?: string } };
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "The team request could not be submitted.");
      setRequests(payload.data.requests ?? []);
      setForm(emptyForm);
      setMessage({ kind: "success", text: "Team request sent. An administrator will review the details." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "The team request could not be submitted." });
    } finally { setBusy(false); }
  }

  return (
    <section className="upload-team-creation">
      <header className="upload-section-heading">
        <div>
          <span><CloudArrowUp size={18} /> Upload Center</span>
          <h2>Create a publishing team</h2>
          <p>Submit your team details for administrator review. Approved teams are activated with you as team leader and uploader.</p>
        </div>
      </header>
      {message ? <div className={`upload-alert is-${message.kind}`} role="status">{message.kind === "success" ? <CheckCircle size={18} /> : <WarningCircle size={18} />} {message.text}</div> : null}
      <div className="upload-team-creation-grid">
        <form className="upload-composer-card upload-team-creation-form" onSubmit={submit}>
          <div className="upload-team-creation-form-heading"><ShieldCheck size={19} /><div><strong>Team application</strong><small>Use the name readers will recognize.</small></div></div>
          <label>Team name<input required minLength={2} maxLength={100} value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="Example Scans" /></label>
          <label>Description<textarea required minLength={20} maxLength={2_000} rows={5} value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="Tell reviewers what your team publishes and how it operates." /></label>
          <div className="upload-team-creation-two-col">
            <label>Website URL <span>(optional)</span><input type="url" value={form.websiteUrl} onChange={(event) => update("websiteUrl", event.target.value)} placeholder="https://example.com" /></label>
            <label>Discord URL <span>(optional)</span><input type="url" value={form.discordUrl} onChange={(event) => update("discordUrl", event.target.value)} placeholder="https://discord.gg/example" /></label>
          </div>
          <label>Why should this team be approved?<textarea required minLength={20} maxLength={1_000} rows={4} value={form.reason} onChange={(event) => update("reason", event.target.value)} placeholder="Share your publishing plan and the languages or series you intend to support." /></label>
          <div className="upload-team-creation-note"><Info size={17} /><span>Approval creates a verified team and grants the requester both the global uploader role and team-leader membership.</span></div>
          <button className="button button-primary" type="submit" disabled={busy}>{busy ? <DotsThree size={18} /> : <CheckCircle size={18} />} {busy ? "Sending request…" : "Send for admin review"}</button>
        </form>
        <section className="upload-composer-card upload-team-creation-history" aria-labelledby="team-request-history-title">
          <div className="upload-team-creation-form-heading"><Clock size={19} /><div><strong id="team-request-history-title">Your team requests</strong><small>Track review status and administrator notes.</small></div></div>
          {loading ? <p className="upload-muted-copy">Loading requests…</p> : requests.length ? <div className="upload-team-request-list">{requests.map((request) => <article key={request.id}><header><strong>{request.name}</strong><span className={`upload-team-request-status is-${request.status.toLowerCase()}`}>{statusLabel(request.status)}</span></header><small>Submitted {new Date(request.createdAt).toLocaleString()}</small>{request.reviewReason ? <p>{request.reviewReason}</p> : request.status === "PENDING" ? <p>Waiting for an administrator to review the team details.</p> : null}</article>)}</div> : <p className="upload-muted-copy">No team requests yet. Submit your first application to begin.</p>}
        </section>
      </div>
    </section>
  );
}
