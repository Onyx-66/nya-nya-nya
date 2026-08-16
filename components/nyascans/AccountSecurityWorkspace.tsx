"use client";

import {
  ArrowClockwise,
  Check,
  CheckCircle,
  Clock,
  Copy,
  Fingerprint,
  Key,
  LockSimple,
  ShieldCheck,
  SpinnerGap,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import { startRegistration } from "@simplewebauthn/browser";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

type SecurityStatus = {
  totpEnrolled: boolean;
  totpPending: boolean;
  passkeyCount: number;
  recoveryCodesRemaining: number;
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

type SetupData = { secret: string; otpauthUri: string };

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
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [totpCode, setTotpCode] = useState("");
  const [reauthPassword, setReauthPassword] = useState("");
  const [reauthCode, setReauthCode] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!setup?.otpauthUri) {
      setQrDataUrl("");
      return;
    }
    void QRCode.toDataURL(setup.otpauthUri, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 240,
      color: { dark: "#07111f", light: "#ffffff" },
    }).then((dataUrl) => {
      if (!cancelled) setQrDataUrl(dataUrl);
    }).catch(() => {
      if (!cancelled) setQrDataUrl("");
    });
    return () => { cancelled = true; };
  }, [setup?.otpauthUri]);

  async function refresh() {
    const response = await fetch("/api/v1/security", { cache: "no-store" });
    const data = await readJson<Omit<SecurityStatus, "passkeys"> & { passkeys: SecurityStatus["passkeys"] }>(response);
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

  async function beginTotp() {
    beginBusy("totp-begin");
    try {
      setSetup(await post<SetupData>({ action: "TOTP_BEGIN" }));
      setMessage("Scan the QR code with your authenticator, then enter the six-digit code.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Two-factor setup could not start.");
    } finally {
      setBusy("");
    }
  }

  async function verifyTotp() {
    beginBusy("totp-verify");
    try {
      const data = await post<{ enrolled: boolean; recoveryCodes: string[] }>({ action: "TOTP_VERIFY", code: totpCode });
      setRecoveryCodes(data.recoveryCodes);
      setSetup(null);
      setTotpCode("");
      await refresh();
      setMessage("Two-factor authentication is enabled. Save these recovery codes now; they are shown only once.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That authenticator code could not be verified.");
    } finally {
      setBusy("");
    }
  }

  async function disableTotp() {
    beginBusy("totp-disable");
    try {
      await post({ action: "TOTP_DISABLE", password: reauthPassword || undefined, code: reauthCode || undefined });
      setReauthPassword("");
      setReauthCode("");
      setRecoveryCodes([]);
      await refresh();
      setMessage("Two-factor authentication and its recovery codes have been disabled.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Two-factor authentication could not be disabled.");
    } finally {
      setBusy("");
    }
  }

  async function regenerateCodes() {
    beginBusy("recovery-regenerate");
    try {
      const data = await post<{ recoveryCodes: string[] }>({ action: "RECOVERY_CODES_REGENERATE", password: reauthPassword });
      setRecoveryCodes(data.recoveryCodes);
      setReauthPassword("");
      setMessage("Your previous recovery codes are invalid. Save this new set now.");
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Recovery codes could not be regenerated.");
    } finally {
      setBusy("");
    }
  }

  async function addPasskey() {
    beginBusy("passkey-add");
    try {
      const begin = await post<{ challengeId: string; options: Parameters<typeof startRegistration>[0]["optionsJSON"] }>({ action: "PASSKEY_REGISTER_BEGIN" });
      const response = await startRegistration({ optionsJSON: begin.options });
      await post({ action: "PASSKEY_REGISTER_FINISH", challengeId: begin.challengeId, response, deviceName: deviceName || undefined });
      setDeviceName("");
      await refresh();
      setMessage("Passkey added. You can now use it as an optional sign-in method and for admin access setup.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Passkey registration was cancelled or failed.");
    } finally {
      setBusy("");
    }
  }

  async function removePasskey(id: string) {
    if (!window.confirm("Remove this passkey from your NyaScans account?")) return;
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

  async function copyCodes() {
    try {
      await navigator.clipboard.writeText(recoveryCodes.join("\n"));
      setMessage("Recovery codes copied. Store them somewhere safe.");
    } catch {
      setError("Clipboard access was unavailable. Copy the codes manually.");
    }
  }

  const loading = !status;
  return (
    <div className="account-security-workspace">
      <div className="account-security-intro">
        <div>
          <p className="eyebrow">Account protection</p>
          <h2>Secure your sign-in without adding friction.</h2>
          <p>Two-factor authentication and passkeys are optional for normal site login. Admin-permissioned accounts must enroll one method before opening the admin panel.</p>
        </div>
        <span className="account-security-intro-icon"><ShieldCheck size={32} weight="fill" /></span>
      </div>

      {error ? <p className="account-security-feedback is-error" role="alert"><WarningCircle size={18} /> {error}</p> : null}
      {message ? <p className="account-security-feedback is-success" role="status"><CheckCircle size={18} /> {message}</p> : null}

      <section className="security-method-card" aria-labelledby="security-totp-title">
        <div className="security-method-header">
          <div className="security-method-heading"><span className="security-method-icon is-blue"><LockSimple size={23} weight="fill" /></span><div><p className="eyebrow">Authenticator app</p><h3 id="security-totp-title">Two-factor authentication</h3></div></div>
          <span className={`security-status-badge ${status?.totpEnrolled ? "is-enabled" : "is-disabled"}`}>{loading ? "Checking…" : status?.totpEnrolled ? "Enabled" : "Not enabled"}</span>
        </div>
        <p className="security-method-copy">Use an authenticator app to protect high-impact account actions. Your normal NyaScans sign-in remains unchanged.</p>
        {!status?.totpEnrolled && !setup ? (
          <button className="button button-primary" type="button" onClick={() => void beginTotp()} disabled={Boolean(busy)}>{busy === "totp-begin" ? <SpinnerGap size={18} className="spin" /> : <Key size={18} />} Enable authenticator</button>
        ) : null}
        {setup ? (
          <div className="totp-setup-panel">
            <div className="totp-setup-visual"><div className="totp-qr-frame">{qrDataUrl ? <img src={qrDataUrl} alt="QR code for authenticator enrollment" /> : <SpinnerGap size={28} className="spin" aria-label="Generating QR code" />}</div><small>Scan with Google Authenticator, 1Password, Microsoft Authenticator, or another TOTP app.</small></div>
            <div className="totp-setup-details"><div><span className="security-label">Manual setup key</span><code>{setup.secret}</code></div><div><span className="security-label">Authenticator code</span><input className="security-code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={totpCode} onChange={(event) => setTotpCode(event.target.value.replace(/\D/gu, "").slice(0, 6))} placeholder="000000" /></div><button className="button button-primary" type="button" onClick={() => void verifyTotp()} disabled={busy === "totp-verify" || totpCode.length !== 6}>{busy === "totp-verify" ? <SpinnerGap size={18} className="spin" /> : <Check size={18} />} Confirm and enable</button><button className="button button-quiet" type="button" onClick={() => setSetup(null)} disabled={Boolean(busy)}>Cancel</button></div>
          </div>
        ) : null}
        {status?.totpEnrolled ? (
          <div className="security-enabled-panel"><div><strong><CheckCircle size={18} weight="fill" /> Authenticator enabled</strong><p>{status.recoveryCodesRemaining} recovery codes remain unused.</p></div><div className="security-inline-actions"><button className="button button-secondary" type="button" onClick={() => setRecoveryCodes([])} disabled={Boolean(busy)}><ArrowClockwise size={17} /> Manage recovery codes</button></div></div>
        ) : null}
        {status?.totpEnrolled ? (
          <div className="security-recovery-panel"><div className="security-subheading"><div><h4>Recovery codes</h4><p>Each code works once if you lose access to your authenticator.</p></div><span>{status.recoveryCodesRemaining} left</span></div>{recoveryCodes.length ? <><div className="recovery-code-grid">{recoveryCodes.map((code) => <code key={code}>{code}</code>)}</div><div className="security-inline-actions"><button className="button button-secondary" type="button" onClick={() => void copyCodes()}><Copy size={17} /> Copy codes</button></div></> : <div className="security-reauth-row"><input type="password" value={reauthPassword} onChange={(event) => setReauthPassword(event.target.value)} placeholder="Current password to regenerate" autoComplete="current-password" /><button className="button button-secondary" type="button" onClick={() => void regenerateCodes()} disabled={busy === "recovery-regenerate" || !reauthPassword}>{busy === "recovery-regenerate" ? <SpinnerGap size={17} className="spin" /> : <ArrowClockwise size={17} />} Regenerate</button></div>}</div>
        ) : null}
        {status?.totpEnrolled ? (
          <details className="security-danger-disclosure"><summary>Disable two-factor authentication</summary><div className="security-danger-box"><p><WarningCircle size={18} /> Disabling this method removes the account’s TOTP factor and all unused recovery codes. Admin-permissioned accounts will be blocked from opening the admin panel until a passkey or authenticator is enrolled again.</p><div className="security-reauth-grid"><input type="password" value={reauthPassword} onChange={(event) => setReauthPassword(event.target.value)} placeholder="Current password" autoComplete="current-password" /><input inputMode="numeric" value={reauthCode} onChange={(event) => setReauthCode(event.target.value.replace(/\D/gu, "").slice(0, 6))} placeholder="Or 6-digit TOTP code" maxLength={6} /></div><button className="button button-danger" type="button" onClick={() => void disableTotp()} disabled={busy === "totp-disable" || (!reauthPassword && reauthCode.length !== 6)}>{busy === "totp-disable" ? <SpinnerGap size={17} className="spin" /> : <Trash size={17} />} Disable authenticator</button></div></details>
        ) : null}
      </section>

      <section className="security-method-card" aria-labelledby="security-passkeys-title">
        <div className="security-method-header"><div className="security-method-heading"><span className="security-method-icon is-purple"><Fingerprint size={23} weight="fill" /></span><div><p className="eyebrow">Passwordless option</p><h3 id="security-passkeys-title">Passkeys</h3></div></div><span className={`security-status-badge ${status?.passkeyCount ? "is-enabled" : "is-disabled"}`}>{loading ? "Checking…" : status?.passkeyCount ? `${status.passkeyCount} registered` : "Not registered"}</span></div>
        <p className="security-method-copy">Use Face ID, Touch ID, Windows Hello, or a hardware security key. Passkeys can be used as an alternative sign-in and satisfy the admin setup requirement.</p>
        <div className="passkey-add-row"><input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} maxLength={80} placeholder="Device name (optional)" /><button className="button button-primary" type="button" onClick={() => void addPasskey()} disabled={Boolean(busy)}>{busy === "passkey-add" ? <SpinnerGap size={18} className="spin" /> : <Fingerprint size={18} />} Add passkey</button></div>
        <div className="passkey-list">{status?.passkeys.length ? status.passkeys.map((passkey) => <article className="passkey-row" key={passkey.id}><span className="passkey-row-icon"><Fingerprint size={22} /></span><div className="passkey-row-copy"><strong>{passkey.deviceName}</strong><small>Added {formatDate(passkey.createdAt)} · Last used {formatDate(passkey.lastUsedAt)}{passkey.backedUp ? " · Synced" : ""}</small></div><button className="icon-button danger" type="button" aria-label={`Remove ${passkey.deviceName}`} title="Remove passkey" onClick={() => void removePasskey(passkey.id)} disabled={busy === `passkey-remove-${passkey.id}`}><Trash size={18} /></button></article>) : <div className="security-empty-state"><Fingerprint size={24} /><span>No passkeys registered yet.</span></div>}</div>
      </section>

      <section className="account-security-note"><Clock size={19} /><p><strong>Normal login is unchanged.</strong> No user is challenged with TOTP at regular sign-in. These methods are used only when you choose them, and admin panel access checks enrollment server-side.</p></section>
    </div>
  );
}
