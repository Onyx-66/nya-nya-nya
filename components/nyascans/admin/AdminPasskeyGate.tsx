"use client";

import { DotsRing } from "@/components/nyascans/DotsRing";
import { Fingerprint, ShieldCheck, WarningCircle } from "@phosphor-icons/react";
import { startRegistration } from "@simplewebauthn/browser";
import { useState } from "react";

type ApiResult<T> = { data?: T; error?: { message?: string } };

type RegistrationOptions = Parameters<typeof startRegistration>[0]["optionsJSON"];

async function post<T>(payload: Record<string, unknown>) {
  const response = await fetch("/api/v1/security", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = (await response.json()) as ApiResult<T>;
  if (!response.ok || !result.data) {
    throw new Error(result.error?.message ?? "Passkey enrollment could not be completed.");
  }
  return result.data;
}

export function AdminPasskeyGate({ displayName, email }: { displayName: string; email: string }) {
  const [deviceName, setDeviceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function register() {
    setBusy(true);
    setError("");
    try {
      const begin = await post<{ challengeId: string; options: RegistrationOptions }>({ action: "PASSKEY_REGISTER_BEGIN" });
      const response = await startRegistration({ optionsJSON: begin.options });
      await post({ action: "PASSKEY_REGISTER_FINISH", challengeId: begin.challengeId, response, deviceName: deviceName.trim() || undefined });
      window.location.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Passkey registration was cancelled or failed. Try again.");
      setBusy(false);
    }
  }

  return (
    <main className="admin-passkey-page">
      <section className="admin-passkey-card" aria-labelledby="admin-passkey-title">
        <div className="admin-passkey-visual" aria-hidden="true">
          <span className="admin-passkey-orbit"><Fingerprint size={46} weight="duotone" /></span>
          <span className="admin-passkey-visual-mark"><ShieldCheck size={54} weight="duotone" /></span>
          <strong>Protected administration</strong>
          <p>One-time account enrollment. Direct access afterward.</p>
        </div>
        <div className="admin-passkey-content">
          <header>
            <span className="admin-passkey-icon"><ShieldCheck size={28} weight="duotone" /></span>
            <div>
              <p className="eyebrow">Administrator access</p>
              <h1 id="admin-passkey-title">Register a passkey to continue</h1>
            </div>
          </header>
          <p className="admin-passkey-intro">Your account has permission to use the admin console, but it needs one registered passkey first. This is a setup gate, not a repeated sign-in challenge. Normal site login remains unchanged.</p>
          <div className="admin-passkey-identity">
            <span aria-hidden="true">{displayName.slice(0, 1).toUpperCase()}</span>
            <div><strong>{displayName}</strong><small>{email}</small></div>
          </div>
          {error ? <p className="admin-passkey-error" role="alert"><WarningCircle size={18} /> {error}</p> : null}
          <label className="admin-passkey-device"><span>Device name (optional)</span><input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} maxLength={80} placeholder="e.g. Work laptop" autoComplete="off" /></label>
          <button className="button button-primary admin-passkey-register" type="button" onClick={() => void register()} disabled={busy}>{busy ? <DotsRing size={18} /> : <Fingerprint size={19} />} {busy ? "Waiting for your authenticator…" : "Register passkey"}</button>
          <p className="admin-passkey-help">Use Face ID, Touch ID, Windows Hello, or a hardware security key. If the browser prompt is cancelled, you can safely retry.</p>
        </div>
      </section>
    </main>
  );
}
