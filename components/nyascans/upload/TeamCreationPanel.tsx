/* eslint-disable @next/next/no-img-element -- cropped media use blob URLs and member avatars use protected endpoints */
import { Camera, ChatCircle, CheckCircle, Clock, CloudArrowUp, DotsThree, ImageSquare, Info, LinkSimple, PaperPlaneTilt, Play, Plus, Pulse, ShieldCheck, Smiley, UsersThree, WarningCircle, X } from "@/components/nyascans/heroicons";
import { UnifiedSingleSelect } from "@/components/nyascans/UnifiedSingleSelect";
import { teamCreationFieldLabels, teamCreationServerErrors, validateTeamCreation, type TeamCreationErrors } from "@/lib/team-creation-validation";
import styles from "./TeamCreationPanel.module.css";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";

type ExternalLink = { platform: string; url: string };
type MemberPreview = { email: string; displayName: string; username: string; avatarUrl?: string | null };
type TeamCreationRequest = { id: string; name: string; slug: string; description: string; externalLinks?: ExternalLink[]; memberEmails?: string[]; logoUrl?: string | null; bannerUrl?: string | null; reason: string; status: "PENDING" | "APPROVED" | "REJECTED"; reviewReason?: string | null; revision: number; createdAt: string; reviewedAt?: string | null };
type FormValues = { name: string; description: string; reason: string; logo: File | null; banner: File | null; externalLinks: ExternalLink[]; memberEmails: string[] };
type CropSource = { kind: "logo" | "banner"; file: File; url: string };

const emptyForm: FormValues = { name: "", description: "", reason: "", logo: null, banner: null, externalLinks: [{ platform: "Website", url: "" }], memberEmails: [] };
const platforms = [
  { id: "Website", icon: LinkSimple, placeholder: "https://website.com" },
  { id: "Discord", icon: ChatCircle, placeholder: "https://discord.gg" },
  { id: "YouTube", icon: Play, placeholder: "https://youtube.com" },
  { id: "Telegram", icon: PaperPlaneTilt, placeholder: "https://t.me" },
  { id: "Instagram", icon: Camera, placeholder: "https://instagram.com" },
  { id: "Facebook", icon: UsersThree, placeholder: "https://facebook.com" },
  { id: "TikTok", icon: Pulse, placeholder: "https://tiktok.com" },
  { id: "Reddit", icon: Smiley, placeholder: "https://reddit.com/r" },
  { id: "Other", icon: LinkSimple, placeholder: "https://" },
];

function statusLabel(status: TeamCreationRequest["status"]) { return status === "PENDING" ? "Awaiting review" : status === "APPROVED" ? "Approved" : "Needs changes"; }
function imagePreview(file: File | null) { return file ? URL.createObjectURL(file) : null; }
function fileStem(name: string) { return name.replace(/\.[^.]+$/, ""); }

function CropDialog({ source, onCancel, onSave }: { source: CropSource; onCancel: () => void; onSave: (file: File) => Promise<void> }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [horizontal, setHorizontal] = useState(0);
  const [vertical, setVertical] = useState(0);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isLogo = source.kind === "logo";
  const width = isLogo ? 512 : 1280;
  const height = isLogo ? 512 : 720;
  useEffect(() => {
    const image = new Image(); image.onload = () => { imageRef.current = image; setReady(true); }; image.onerror = () => setError("This image could not be prepared."); image.src = source.url;
    return () => { image.onload = null; image.onerror = null; };
  }, [source.url]);
  useEffect(() => {
    const canvas = canvasRef.current; const image = imageRef.current;
    if (!canvas || !image || !ready) return;
    const context = canvas.getContext("2d"); if (!context) return;
    const coverScale = Math.max(width / image.naturalWidth, height / image.naturalHeight) * zoom;
    const drawWidth = image.naturalWidth * coverScale; const drawHeight = image.naturalHeight * coverScale;
    const maxX = Math.max(0, (drawWidth - width) / 2); const maxY = Math.max(0, (drawHeight - height) / 2);
    const x = (width - drawWidth) / 2 + (horizontal / 100) * maxX; const y = (height - drawHeight) / 2 + (vertical / 100) * maxY;
    context.clearRect(0, 0, width, height); context.drawImage(image, x, y, drawWidth, drawHeight);
  }, [height, horizontal, ready, vertical, width, zoom]);
  async function save() {
    const canvas = canvasRef.current; if (!canvas || !ready || busy) return; setBusy(true); setError("");
    try { const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92)); if (!blob) throw new Error("The crop could not be prepared."); await onSave(new File([blob], `${fileStem(source.file.name)}-${source.kind}-cropped.jpg`, { type: "image/jpeg" })); }
    catch (cropError) { setError(cropError instanceof Error ? cropError.message : "The crop could not be prepared."); }
    finally { setBusy(false); }
  }
  return <div className="avatar-crop-overlay" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    <div className="avatar-crop-dialog" role="dialog" aria-modal="true" aria-labelledby="team-crop-title">
      <header><div><p className="eyebrow">Team media</p><h3 id="team-crop-title">Crop your {isLogo ? "logo" : "banner"}</h3></div><button type="button" onClick={onCancel} disabled={busy} aria-label="Close crop"><X size={19} /></button></header>
      <div className={`avatar-crop-preview ${isLogo ? "is-square" : "is-banner"}`}><canvas ref={canvasRef} width={width} height={height} aria-label={`${source.kind} crop preview`} />{!ready && !error ? <span role="status">Preparing preview…</span> : null}</div>
      <p id="team-crop-description">Position the image inside the required {isLogo ? "square logo" : "16:9 banner"} frame, then confirm the crop.</p>
      <div className="avatar-crop-controls"><label><span>Zoom</span><input type="range" min="1" max="3" step="0.05" value={zoom} disabled={!ready || busy} onChange={(event) => setZoom(Number(event.target.value))} /></label><label><span>Horizontal position</span><input type="range" min="-100" max="100" value={horizontal} disabled={!ready || busy} onChange={(event) => setHorizontal(Number(event.target.value))} /></label><label><span>Vertical position</span><input type="range" min="-100" max="100" value={vertical} disabled={!ready || busy} onChange={(event) => setVertical(Number(event.target.value))} /></label></div>
      {error ? <div className="avatar-crop-error" role="alert"><WarningCircle size={17} /> {error}</div> : null}
      <footer><button className="button button-secondary" type="button" disabled={!ready || busy} onClick={() => { setZoom(1); setHorizontal(0); setVertical(0); }}>Reset</button><button className="button button-primary" type="button" disabled={!ready || busy} onClick={() => void save()}><Camera size={17} /> {busy ? "Saving crop…" : "Crop & use media"}</button></footer>
    </div>
  </div>;
}

export function TeamCreationPanel() {
  const [form, setForm] = useState<FormValues>(emptyForm);
  const [requests, setRequests] = useState<TeamCreationRequest[]>([]);
  const [memberPreviews, setMemberPreviews] = useState<Record<string, MemberPreview | null>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [cropSource, setCropSource] = useState<CropSource | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<TeamCreationErrors>({});
  const errors = { ...(submitted ? validateTeamCreation(form) : {}), ...serverErrors };
  const logoPreview = useMemo(() => imagePreview(form.logo), [form.logo]);
  const bannerPreview = useMemo(() => imagePreview(form.banner), [form.banner]);
  useEffect(() => () => { if (logoPreview) URL.revokeObjectURL(logoPreview); }, [logoPreview]);
  useEffect(() => () => { if (bannerPreview) URL.revokeObjectURL(bannerPreview); }, [bannerPreview]);
  useEffect(() => () => { if (cropSource) URL.revokeObjectURL(cropSource.url); }, [cropSource]);

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
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const emails = [...new Set(form.memberEmails.map((email) => email.trim().toLowerCase()).filter((email) => email.includes("@")))];
      for (const email of emails) {
        void fetch(`/api/v1/team-creation-requests?lookupEmail=${encodeURIComponent(email)}`, { cache: "no-store", signal: controller.signal })
          .then(async (response) => response.ok ? await response.json() as { data?: { member?: MemberPreview | null } } : null)
          .then((payload) => { if (!controller.signal.aborted) setMemberPreviews((current) => ({ ...current, [email]: payload?.data?.member ?? null })); })
          .catch(() => {});
      }
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [form.memberEmails]);

  function update<K extends keyof FormValues>(field: K, value: FormValues[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setServerErrors((current) => { const next = { ...current }; delete next[field]; return next; });
    setMessage(null);
  }
  function chooseFile(kind: "logo" | "banner", event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 16_000_000) {
      setServerErrors((current) => ({ ...current, [kind]: "Choose a JPG, PNG, or WebP image under 16 MB." }));
      return;
    }
    setCropSource({ kind, file, url: URL.createObjectURL(file) });
  }
  async function saveCrop(file: File) { if (cropSource) update(cropSource.kind, file); setCropSource(null); }
  function focusField(field: string) {
    const target = document.getElementById(`team-${field}`);
    target?.scrollIntoView({ block: "center", behavior: "auto" });
    target?.focus({ preventScroll: true });
  }
  function showErrors(next: TeamCreationErrors) {
    const first = Object.keys(next)[0];
    if (first) window.requestAnimationFrame(() => focusField(first));
  }
  function fieldError(field: string) {
    return errors[field] ? <small className={styles.error} id={`team-${field}-error`}>{errors[field]}</small> : null;
  }
  function fieldProps(field: string) {
    return { id: `team-${field}`, "aria-invalid": Boolean(errors[field]), "aria-describedby": errors[field] ? `team-${field}-error` : undefined };
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    setSubmitted(true);
    const nextErrors = validateTeamCreation(form);
    setServerErrors({}); setMessage(null);
    if (Object.keys(nextErrors).length) { showErrors(nextErrors); return; }
    if (!form.logo || !form.banner) return;
    sending.current = true; setBusy(true);
    try {
      const body = new FormData();
      body.set("name", form.name.trim()); body.set("description", form.description.trim()); body.set("reason", form.reason.trim());
      body.set("externalLinks", JSON.stringify(form.externalLinks.map((link) => ({ ...link, url: link.url.trim() }))));
      body.set("memberEmails", JSON.stringify(form.memberEmails.map((email) => email.trim()).filter(Boolean)));
      body.set("logo", form.logo); body.set("banner", form.banner);
      const response = await fetch("/api/v1/team-creation-requests", { method: "POST", body });
      const payload = await response.json() as { data?: { requests?: TeamCreationRequest[] }; error?: { code?: string; message?: string; fields?: { path?: string; message?: string }[] } };
      if (!response.ok || !payload.data) {
        const next = teamCreationServerErrors(payload.error);
        setServerErrors(next); showErrors(next);
        if (!Object.keys(next).length) setMessage({ kind: "error", text: payload.error?.message ?? "The team request could not be submitted. Please try again." });
        return;
      }
      setRequests(payload.data.requests ?? []); setForm(emptyForm); setMemberPreviews({}); setSubmitted(false);
      setMessage({ kind: "success", text: "Create Team request sent. An administrator will review it." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "The team request could not be submitted. Please try again." });
    } finally { sending.current = false; setBusy(false); }
  }

  return (
    <section className={`upload-team-creation ${styles.creation}`}>
      <header className="upload-section-heading"><div><span><CloudArrowUp size={18} /> Upload Center</span><h2>Create Team</h2><p>Add your team&apos;s public details, then send your request for review. Fields are required unless marked optional.</p></div></header>
      {message ? <div className={`upload-alert is-${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>{message.kind === "success" ? <CheckCircle size={18} /> : <WarningCircle size={18} />}{message.text}</div> : null}
      {Object.keys(errors).length ? <div className={styles.errorSummary} role="alert"><strong>Please check these fields:</strong><ul>{Object.entries(errors).map(([field, text]) => <li key={field}><button type="button" onClick={() => focusField(field)}>{teamCreationFieldLabels[field]}: {text}</button></li>)}</ul></div> : null}
      <div className={styles.layout}>
        <form className={`upload-composer-card upload-team-creation-form ${styles.form}`} noValidate onSubmit={submit} aria-busy={busy}>
          <fieldset disabled={busy}>
            <legend><ShieldCheck size={20} /> Public team details</legend>
            <label htmlFor="team-name">Team name<input {...fieldProps("name")} required minLength={2} maxLength={100} value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="Example Scans" />{fieldError("name")}</label>
            <label htmlFor="team-description">Description<textarea {...fieldProps("description")} required minLength={20} maxLength={2000} rows={4} value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="What do you publish? Tell readers about your team." /><small>{form.description.trim().length.toLocaleString()} / 2,000 characters · minimum 20</small>{fieldError("description")}</label>
            <div className={styles.mediaGrid}>{(["logo", "banner"] as const).map((kind) => <div className={styles.mediaField} key={kind}>
              <label htmlFor={`team-${kind}`}>{kind === "logo" ? "Team logo" : "Team banner"}</label>
              <input {...fieldProps(kind)} className={styles.fileInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => chooseFile(kind, event)} />
              <label className={styles.mediaButton} htmlFor={`team-${kind}`}><ImageSquare size={20} /><span>{form[kind] ? `Change ${kind}` : `Choose ${kind}`}</span></label>
              <small>{form[kind] ? "Crop saved" : kind === "logo" ? "Square · JPG, PNG or WebP" : "16:9 · JPG, PNG or WebP"}</small>{fieldError(kind)}
            </div>)}</div>
            <div className={styles.socials} {...fieldProps("externalLinks")} tabIndex={-1}>
              <div className={styles.groupHeading}><div><strong>Team socials</strong><small>Add at least one official HTTPS link.</small></div><button className="button button-secondary" type="button" disabled={form.externalLinks.length >= 12} onClick={() => update("externalLinks", [...form.externalLinks, { platform: "Website", url: "" }])}><Plus size={16} /> Add social</button></div>
              {form.externalLinks.map((link, index) => <div className={styles.socialRow} key={index}>
                <UnifiedSingleSelect aria-label={`Social ${index + 1} platform`} value={link.platform} onChange={(event) => update("externalLinks", form.externalLinks.map((entry, i) => i === index ? { ...entry, platform: event.target.value } : entry))}>{platforms.map((platform) => <option key={platform.id} value={platform.id}>{platform.id}</option>)}</UnifiedSingleSelect>
                <input type="url" required aria-label={`Social ${index + 1} HTTPS URL`} aria-invalid={Boolean(errors.externalLinks)} aria-describedby={errors.externalLinks ? "team-externalLinks-error" : undefined} value={link.url} onChange={(event) => update("externalLinks", form.externalLinks.map((entry, i) => i === index ? { ...entry, url: event.target.value } : entry))} placeholder={platforms.find((platform) => platform.id === link.platform)?.placeholder ?? "https://example.com"} maxLength={600} />
                <button type="button" className="upload-team-remove-button" aria-label={`Remove social link ${index + 1}`} onClick={() => update("externalLinks", form.externalLinks.filter((_, i) => i !== index))}><X size={16} /></button>
              </div>)}{fieldError("externalLinks")}
            </div>
          </fieldset>
          <fieldset disabled={busy}>
            <legend><UsersThree size={20} /> About your team</legend>
            <label htmlFor="team-reason">Talk about yourself and your team<textarea {...fieldProps("reason")} required minLength={20} maxLength={1000} rows={4} value={form.reason} onChange={(event) => update("reason", event.target.value)} placeholder="Introduce yourself, your experience, and what you hope to publish." /><small>Only reviewers see this introduction. {form.reason.trim().length} / 1,000 characters · minimum 20</small>{fieldError("reason")}</label>
            <div {...fieldProps("memberEmails")} tabIndex={-1} className={styles.members}>
              <div className={styles.groupHeading}><div><strong>Members (optional)</strong><small>Registered members receive an invitation after approval.</small></div><button type="button" className="button button-secondary" disabled={form.memberEmails.length >= 25} onClick={() => update("memberEmails", [...form.memberEmails, ""])}><Plus size={16} /> Add member</button></div>
              {form.memberEmails.map((email, index) => {
                const member = memberPreviews[email.trim().toLowerCase()];
                return <div className={styles.memberRow} key={index}><input type="email" aria-label={`Member ${index + 1} email`} aria-invalid={Boolean(errors.memberEmails)} aria-describedby={errors.memberEmails ? "team-memberEmails-error" : undefined} value={email} maxLength={320} onChange={(event) => update("memberEmails", form.memberEmails.map((entry, i) => i === index ? event.target.value : entry))} placeholder="teammate@example.com" /><button type="button" className="upload-team-remove-button" aria-label={`Remove member ${index + 1}`} onClick={() => update("memberEmails", form.memberEmails.filter((_, i) => i !== index))}><X size={16} /></button>{member ? <small className={styles.memberMatch}>{member.avatarUrl ? <img src={member.avatarUrl} alt="" /> : null}{member.displayName}</small> : null}</div>;
              })}{fieldError("memberEmails")}
            </div>
          </fieldset>
          <div className="upload-team-creation-note"><Info size={17} /><span>Once approved, the team creator receives team-leader and global uploader access.</span></div>
          <button className="button button-primary" type="submit" disabled={busy}>{busy ? <DotsThree size={18} /> : <CheckCircle size={18} />}{busy ? "Sending request…" : "Send team request"}</button>
        </form>
        <aside className={styles.previewColumn}>
          <section className={`upload-composer-card ${styles.preview}`} aria-label="Live team card preview">
            <header><strong>Team card preview</strong><small>Updates as you fill in the public details.</small></header>
            <article className={styles.teamCard}>
              <div className={styles.banner}>{bannerPreview ? <img src={bannerPreview} alt="Team banner preview" /> : <ImageSquare size={36} aria-hidden="true" />}</div>
              <div className={styles.cardBody}><div className={styles.logo}>{logoPreview ? <img src={logoPreview} alt="Team logo preview" /> : <UsersThree size={28} aria-hidden="true" />}</div><h3>{form.name.trim() || "Your team name"}</h3><p>{form.description.trim() || "Your team's description will appear here."}</p><div className={styles.previewSocials}>{form.externalLinks.filter((link) => link.url.trim()).map((link, index) => { const Icon = platforms.find((platform) => platform.id === link.platform)?.icon ?? LinkSimple; return <span key={index} title={link.url}><Icon size={18} />{link.platform}</span>; })}</div></div>
            </article>
            <small>This preview is private. Your team is published after approval.</small>
          </section>
          <section className="upload-composer-card upload-team-creation-history" aria-labelledby="team-request-history-title"><div className="upload-team-creation-form-heading"><Clock size={19} /><div><strong id="team-request-history-title">Your team requests</strong><small>Review status and administrator notes.</small></div></div>{loading ? <p>Loading requests…</p> : requests.length ? <div className="upload-team-request-list">{requests.map((request) => <article key={request.id}><header><strong>{request.name}</strong><span className={`upload-team-request-status is-${request.status.toLowerCase()}`}>{statusLabel(request.status)}</span></header><small>Submitted {new Date(request.createdAt).toLocaleString()}</small>{request.reviewReason ? <p>{request.reviewReason}</p> : request.status === "PENDING" ? <p>Waiting for administrator review.</p> : null}</article>)}</div> : <p>No team requests yet.</p>}</section>
        </aside>
      </div>
      {cropSource ? <CropDialog source={cropSource} onCancel={() => setCropSource(null)} onSave={saveCrop} /> : null}
    </section>
  );
}
