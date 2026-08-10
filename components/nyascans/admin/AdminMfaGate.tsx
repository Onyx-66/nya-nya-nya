"use client";

import { Copy, Key, ShieldCheck, SpinnerGap } from "@phosphor-icons/react";
import { useState, type FormEvent } from "react";

export function AdminMfaGate({
  displayName,
  email,
  enrolled,
}: {
  displayName: string;
  email: string;
  enrolled: boolean;
}) {
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function begin() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/v1/admin-mfa", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "BEGIN" }),
      });
      const payload = await response.json() as { data?: { secret: string; otpauthUri: string }; error?: { message?: string } };
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "Authenticator enrollment could not start.");
      setSetup(payload.data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Authenticator enrollment could not start.");
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/v1/admin-mfa", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "VERIFY", code }),
      });
      const payload = await response.json() as { data?: { verified?: boolean; suspicious?: boolean }; error?: { message?: string } };
      if (!response.ok || !payload.data?.verified) throw new Error(payload.error?.message ?? "The authenticator code was rejected.");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The authenticator code was rejected.");
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  const enrollmentReady = enrolled || Boolean(setup);
  return (
    <main className="admin-mfa-page">
      <section className="admin-mfa-card" aria-labelledby="admin-mfa-title">
        <span className="admin-mfa-icon"><ShieldCheck size={32} weight="duotone" /></span>
        <p className="eyebrow">Protected administration</p>
        <h1 id="admin-mfa-title">Two-factor verification</h1>
        <p>
          {enrollmentReady
            ? "Enter the current six-digit code from your authenticator app. Administrator sessions expire after one hour."
            : "An authenticator app is mandatory before this account can open the administration panel."}
        </p>
        <div className="admin-mfa-identity"><strong>{displayName}</strong><span>{email}</span></div>
        {!enrollmentReady ? (
          <button className="button button-primary" type="button" disabled={busy} onClick={() => void begin()}>
            {busy ? <SpinnerGap className="spin" /> : <Key />} Set up authenticator
          </button>
        ) : null}
        {setup ? (
          <div className="admin-mfa-setup">
            <strong>Add NyaScans to your authenticator</strong>
            <ol><li>Open Google Authenticator, 1Password, Authy, or another TOTP app.</li><li>Add an account with the key below, or open the authenticator link.</li><li>Enter the generated six-digit code.</li></ol>
            <div><code>{setup.secret}</code><button type="button" aria-label="Copy authenticator key" onClick={() => void navigator.clipboard.writeText(setup.secret)}><Copy /></button></div>
            <a className="button button-secondary" href={setup.otpauthUri}>Open authenticator app</a>
          </div>
        ) : null}
        {enrollmentReady ? (
          <form onSubmit={verify}>
            <label><span>Authenticator code</span><input autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/gu, "").slice(0, 6))} placeholder="000000" /></label>
            <button className="button button-primary" type="submit" disabled={busy || code.length !== 6}>{busy ? <SpinnerGap className="spin" /> : <ShieldCheck />} Verify and open admin</button>
          </form>
        ) : null}
        {message ? <p className="admin-mfa-error" role="alert">{message}</p> : null}
        <small>No authenticator secret or verification code is written to application logs.</small>
      </section>
    </main>
  );
}
