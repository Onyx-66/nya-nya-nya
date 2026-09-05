"use client";

import { DotsRing } from "@/components/nyascans/DotsRing";
import { CheckCircle, Clock, Fingerprint, ShieldCheck, Trash, WarningCircle } from "@/components/nyascans/heroicons";
import { startRegistration } from "@simplewebauthn/browser";
import { useEffect, useState } from "react";

type SecurityStatus = {
  passkeyCount: number;
  passkeys: Array<{
    id: string;
    deviceName: string;
    deviceType: string;
    backedUp: boolean;
    createdAt: string;
    lastUsedAt: string | null;
  }>;
};

type ApiPayload<T> = { data?: T; error?: { message?: string } };

function formatDate(value: string | null) {
  if (!value) return "Never used";
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
  } catch {
    return value;
  }
}

async function readJson<T>(response: Response) {
  const payload = (await response.json()) as ApiPayload<T>;
  if (!response.ok) throw new Error(payload.error?.message ?? "Security settings could not be updated.");
  return payload.data as T;
}

export function AccountSecurityWorkspace() {
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    const response = await fetch("/api/v1/security", { cache: "no-store" });
    const data = await readJson<SecurityStatus>(response);
    setStatus(data);
  }

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/security", { cache: "no-store", signal: controller.signal })
      .then((response) => readJson<SecurityStatus>(response))
      .then((data) => setStatus(data))
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Security settings could not be loaded.");
      });
    return () => controller.abort();
  }, []);

  async function post<T>(payload: Record<string, unknown>) {
    const response = await fetch("/api/v1/security", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return readJson<T>(response);
  }

  function beginBusy(key: string) {
    setBusy(key);
    setError("");
    setMessage("");
  }

  async function addPasskey() {
    beginBusy("passkey-add");
    try {
      const begin = await post<{ challengeId: string; options: Parameters<typeof startRegistration>[0]["optionsJSON"] }>({ action: "PASSKEY_REGISTER_BEGIN" });
      const response = await startRegistration({ optionsJSON: begin.options });
      await post({ action: "PASSKEY_REGISTER_FINISH", challengeId: begin.challengeId, response, deviceName: deviceName || undefined });
      setDeviceName("");
      await refresh();
      setMessage("Passkey added. It can now be used for passwordless sign-in and satisfies the admin console enrollment requirement.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Passkey registration was cancelled or failed.");
    } finally {
      setBusy("");
    }
  }

  async function removePasskey(id: string) {
    if (!window.confirm("Remove this passkey from your NyaScans account? Admin-console access will require registering another passkey.")) return;
    beginBusy(`passkey-remove-${id}`);
    try {
      await post({ action: "PASSKEY_REMOVE", passkeyId: id });
      await refresh();
      setMessage("Passkey removed.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Passkey could not be removed.");
    } finally {
      setBusy("");
    }
  }

  const loading = !status;
  return (
    <div className="account-security-workspace">
      <div className="account-security-intro">
        <div>
          <p className="eyebrow">Account protection</p>
          <h2>Secure your account with a passkey.</h2>
        </div>
        <span className="account-security-intro-icon"><ShieldCheck size={32} weight="fill" /></span>
      </div>

      {error ? <p className="account-security-feedback is-error" role="alert"><WarningCircle size={18} /> {error}</p> : null}
      {message ? <p className="account-security-feedback is-success" role="status"><CheckCircle size={18} /> {message}</p> : null}

      <section className="security-method-card" aria-labelledby="security-passkeys-title">
        <div className="security-method-header">
          <div className="security-method-heading"><span className="security-method-icon is-purple"><Fingerprint size={23} weight="fill" /></span><div><p className="eyebrow">Passwordless protection</p><h3 id="security-passkeys-title">Passkeys</h3></div></div>
          <span className={`security-status-badge ${status?.passkeyCount ? "is-enabled" : "is-disabled"}`}>{loading ? "Checking…" : status?.passkeyCount ? `${status.passkeyCount} registered` : "Not registered"}</span>
        </div>
        <p className="security-method-copy">Secure your account with a passkey.</p>
        <div className="passkey-add-row"><input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} maxLength={80} placeholder="Device name (optional)" /><button className="button button-primary" type="button" onClick={() => void addPasskey()} disabled={Boolean(busy)}>{busy === "passkey-add" ? <DotsRing size={18} /> : <Fingerprint size={18} />} Add passkey</button></div>
        <div className="passkey-list">{status?.passkeys.length ? status.passkeys.map((passkey) => <article className="passkey-row" key={passkey.id}><span className="passkey-row-icon"><Fingerprint size={22} /></span><div className="passkey-row-copy"><strong>{passkey.deviceName}</strong><small>Added {formatDate(passkey.createdAt)} · Last used {formatDate(passkey.lastUsedAt)}{passkey.backedUp ? " · Synced" : ""}</small></div><button className="icon-button danger" type="button" aria-label={`Remove ${passkey.deviceName}`} title="Remove passkey" onClick={() => void removePasskey(passkey.id)} disabled={busy === `passkey-remove-${passkey.id}`}><Trash size={18} /></button></article>) : <div className="security-empty-state"><Fingerprint size={24} /><span>No passkeys registered yet.</span></div>}</div>
      </section>

    </div>
  );
}
