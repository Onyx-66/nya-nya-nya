"use client";
import { DotsRing } from "@/components/nyascans/DotsRing";

import {
  Check,
  ClipboardText,
  Copy,
  Fingerprint,
  Key,
  LockKey,
  ShieldCheck,
} from "@phosphor-icons/react";
import {
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";

const EMPTY_CODE = ["", "", "", "", "", ""] as const;

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
  const [digits, setDigits] = useState<string[]>([...EMPTY_CODE]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [factorReset, setFactorReset] = useState(false);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const code = digits.join("");
  const enrollmentReady = (enrolled && !factorReset) || Boolean(setup);

  function focusDigit(index: number) {
    inputRefs.current[Math.max(0, Math.min(5, index))]?.focus();
  }

  function applyDigits(start: number, value: string) {
    const incoming = value.replace(/\D/gu, "").slice(0, 6 - start);
    if (!incoming) {
      setDigits((current) =>
        current.map((digit, index) => (index === start ? "" : digit)),
      );
      return;
    }
    setDigits((current) => {
      const next = [...current];
      for (let offset = 0; offset < incoming.length; offset += 1) {
        next[start + offset] = incoming[offset] ?? "";
      }
      return next;
    });
    focusDigit(Math.min(5, start + incoming.length));
  }

  function handleDigitKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
    index: number,
  ) {
    if (event.key === "Backspace") {
      event.preventDefault();
      if (digits[index]) {
        setDigits((current) =>
          current.map((digit, position) =>
            position === index ? "" : digit,
          ),
        );
      } else if (index > 0) {
        setDigits((current) =>
          current.map((digit, position) =>
            position === index - 1 ? "" : digit,
          ),
        );
        focusDigit(index - 1);
      }
    } else if (event.key === "Delete") {
      event.preventDefault();
      setDigits((current) =>
        current.map((digit, position) =>
          position === index ? "" : digit,
        ),
      );
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusDigit(index - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      focusDigit(index + 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusDigit(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusDigit(5);
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>, index: number) {
    const pasted = event.clipboardData.getData("text").replace(/\D/gu, "");
    if (!pasted) return;
    event.preventDefault();
    applyDigits(pasted.length === 6 ? 0 : index, pasted);
  }

  async function fillFromClipboard() {
    if (!navigator.clipboard?.readText) return;
    try {
      const clipboardValue = await navigator.clipboard.readText();
      const pasted = clipboardValue.replace(/\D/gu, "").slice(0, 6);
      if (pasted) applyDigits(0, pasted);
    } catch {
      // Clipboard permissions are optional; manual entry remains available.
    }
  }

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

  async function recoverAuthenticator(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/v1/admin-mfa", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "RESET", password: recoveryPassword }),
      });
      const payload = await response.json() as { data?: { reset?: boolean }; error?: { message?: string } };
      if (!response.ok || !payload.data?.reset) throw new Error(payload.error?.message ?? "Authenticator recovery could not start.");
      setRecoveryPassword("");
      setFactorReset(true);
      await begin();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Authenticator recovery could not start.");
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
        body: JSON.stringify({ action: "VERIFY", code: code.replace(/\D/gu, "").slice(0, 6) }),
      });
      const payload = await response.json() as { data?: { verified?: boolean; suspicious?: boolean }; error?: { message?: string } };
      if (!response.ok || !payload.data?.verified) throw new Error(payload.error?.message ?? "The authenticator code was rejected.");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The authenticator code was rejected.");
      setDigits([...EMPTY_CODE]);
      window.requestAnimationFrame(() => focusDigit(0));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="admin-mfa-page">
      <section className="admin-mfa-card" aria-labelledby="admin-mfa-title">
        <div className="admin-mfa-visual" aria-hidden="true">
          <span className="admin-mfa-orbit"><Fingerprint size={46} weight="duotone" /></span>
          <span className="admin-mfa-visual-mark"><ShieldCheck size={54} weight="duotone" /></span>
          <strong>Protected operations</strong>
          <p>One configured account. Direct administrator access.</p>
        </div>
        <div className="admin-mfa-content">
          <header>
            <span className="admin-mfa-icon"><ShieldCheck size={28} weight="duotone" /></span>
            <div>
              <p className="eyebrow">Protected administration</p>
              <h1 id="admin-mfa-title">Set up 2FA to continue</h1>
            </div>
          </header>
          <ol className="admin-mfa-progress" aria-label="Verification progress">
            <li className="is-complete"><Check aria-hidden="true" /><span>Account</span></li>
            <li className={busy ? "is-complete" : "is-active"} aria-current={!busy ? "step" : undefined}><Key aria-hidden="true" /><span>Setup</span></li>
            <li className={busy ? "is-active" : ""} aria-current={busy ? "step" : undefined}><LockKey aria-hidden="true" /><span>Confirm</span></li>
          </ol>
          <p className="admin-mfa-intro" id="admin-mfa-instructions">
            {enrollmentReady
              ? "Enter the current six-digit code from your authenticator app."
              : "An authenticator app is mandatory before this account can open the administration panel."}
          </p>
          <div className="admin-mfa-identity">
            <span aria-hidden="true">{displayName.slice(0, 1).toUpperCase()}</span>
            <div><strong>{displayName}</strong><small>{email}</small></div>
            <CheckCircleMark />
          </div>
          {!enrollmentReady ? (
            <button className="button button-primary" type="button" disabled={busy} onClick={() => void begin()}>
              {busy ? <DotsRing /> : <Key />} Set up authenticator
            </button>
          ) : null}
          {setup ? (
            <div className="admin-mfa-setup">
              <strong>Add NyaScans to your authenticator</strong>
              <ol><li>Open a TOTP authenticator app.</li><li>Add an account with the protected key below or open the authenticator link.</li><li>Enter the generated six-digit code.</li></ol>
              <div><code>{setup.secret}</code><button type="button" aria-label="Copy authenticator key" onClick={() => void navigator.clipboard.writeText(setup.secret)}><Copy /></button></div>
              <a className="button button-secondary" href={setup.otpauthUri}>Open authenticator app</a>
            </div>
          ) : null}
          {enrollmentReady ? (
            <>
            <form onSubmit={verify} aria-describedby="admin-mfa-instructions admin-mfa-security-note">
              <fieldset disabled={busy}>
                <legend>Authenticator code</legend>
                <div className="admin-mfa-code-tools">
                  <span>Enter the current six-digit code</span>
                  <button type="button" className="admin-mfa-paste" onClick={() => void fillFromClipboard()} disabled={busy}>
                    <ClipboardText size={16} aria-hidden="true" /> Paste from clipboard
                  </button>
                </div>
                <div className="admin-mfa-code" role="group" aria-label="Six-digit authenticator code">
                  {digits.map((digit, index) => (
                    <input
                      key={index}
                      ref={(element) => { inputRefs.current[index] = element; }}
                      autoFocus={index === 0}
                      inputMode="numeric"
                      autoComplete={index === 0 ? "one-time-code" : "off"}
                      pattern="[0-9]*"
                      maxLength={index === 0 ? 6 : 1}
                      value={digit}
                      aria-label={`Digit ${index + 1} of 6`}
                      aria-invalid={Boolean(message)}
                      onFocus={(event) => {
                        event.currentTarget.select();
                        if (index === 0 && !code) void fillFromClipboard();
                      }}
                      onChange={(event) => applyDigits(index, event.target.value)}
                      onKeyDown={(event) => handleDigitKeyDown(event, index)}
                      onPaste={(event) => handlePaste(event, index)}
                    />
                  ))}
                </div>
              </fieldset>
              {message ? <p className="admin-mfa-error" role="alert">{message}</p> : null}
              <button className="button button-primary" type="submit" disabled={busy || code.length !== 6}>
                {busy ? <DotsRing /> : <ShieldCheck />} Verify and open admin
              </button>
            </form>
            <details className="admin-mfa-recovery">
              <summary>Authenticator code not working?</summary>
              <p>Confirm your account password to replace the old authenticator with a new Google Authenticator setup.</p>
              <form onSubmit={recoverAuthenticator}>
                <label>
                  <span>Account password</span>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={recoveryPassword}
                    onChange={(event) => setRecoveryPassword(event.target.value)}
                    disabled={busy}
                    required
                  />
                </label>
                <button className="button button-secondary" type="submit" disabled={busy || !recoveryPassword}>
                  {busy ? <DotsRing /> : <Key />} Reset and enroll a new authenticator
                </button>
              </form>
            </details>
            </>
          ) : message ? <p className="admin-mfa-error" role="alert">{message}</p> : null}
          <footer id="admin-mfa-security-note">
            <LockKey size={17} aria-hidden="true" />
            <span><strong>One-time account setup</strong>Enable an authenticator once; future administrator-panel opens do not require another challenge.</span>
          </footer>
        </div>
      </section>
    </main>
  );
}

function CheckCircleMark() {
  return <span className="admin-mfa-identity-check" aria-label="Account confirmed"><Check size={14} /></span>;
}
