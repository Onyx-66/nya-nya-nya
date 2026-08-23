"use client";

import {
  ArrowSquareOut,
  Check,
  Copy,
  Key,
  PlugsConnected,
  Plus,
  SpinnerGap,
  WarningCircle,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { AdminCombobox, AdminPageScaffold, ConfirmActionDialog } from "@/components/nyascans/admin/AdminPageScaffold";

type ApiKeyRecord = {
  id: string;
  clientType: "EXTERNAL_API" | "DISCORD_BOT";
  appName: string;
  maskedKey: string;
  scopes: string[];
  allowedTeamId: string | null;
  allowedTeamName: string | null;
  status: "ACTIVE" | "REVOKED" | "ROTATED";
  expiresAt: string | null;
  lastUsedAt: string | null;
  requestCount: number;
  revision: number;
  createdAt: string;
};

type ApiPayload = {
  keys: ApiKeyRecord[];
  teams: Array<{ id: string; name: string; slug: string }>;
  availableScopes: string[];
  created?: { id: string; secret: string };
};

async function readJson(response: Response): Promise<ApiPayload> {
  const payload = await response.json() as ApiPayload & { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? "API Control could not complete this action.");
  return payload;
}

export function ApiControlPanel() {
  const [data, setData] = useState<ApiPayload>({ keys: [], teams: [], availableScopes: [] });
  const [appName, setAppName] = useState("");
  const [clientType, setClientType] = useState<"EXTERNAL_API" | "DISCORD_BOT">("DISCORD_BOT");
  const [teamId, setTeamId] = useState("");
  const [scopes, setScopes] = useState<string[]>(["bot:series:create", "bot:chapter:create"]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState("");
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error" | "neutral"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<{ action: "RESET" | "REVOKE"; key: ApiKeyRecord } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await readJson(await fetch("/api/v1/admin/api-keys", { cache: "no-store" })));
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "API keys could not be loaded." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function toggleScope(scope: string) {
    setScopes((current) => current.includes(scope) ? current.filter((entry) => entry !== scope) : [...current, scope]);
  }

  async function createKey() {
    if (!appName.trim() || !scopes.length) return;
    setBusy(true);
    setMessage(null);
    try {
      const next = await readJson(await fetch("/api/v1/admin/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientType, appName, scopes, allowedTeamId: teamId || null, expiresAt: null }),
      }));
      setData(next);
      setRevealedSecret(next.created?.secret ?? "");
      setAppName("");
      setClientType("DISCORD_BOT");
      setScopes(["bot:series:create", "bot:chapter:create"]);
      setMessage({ kind: "success", text: "API key created. Copy it now; the full value will never be shown again." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "API key could not be created." });
    } finally {
      setBusy(false);
    }
  }

  async function applyAction() {
    if (!confirm) return;
    setBusy(true);
    setMessage(null);
    try {
      const next = await readJson(await fetch("/api/v1/admin/api-keys", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: confirm.action, id: confirm.key.id, revision: confirm.key.revision }),
      }));
      setData(next);
      setConfirm(null);
      if (confirm.action === "RESET") {
        setRevealedSecret(next.created?.secret ?? "");
        setMessage({ kind: "success", text: "The old key was disabled immediately. Copy the replacement key now." });
      } else {
        setMessage({ kind: "success", text: "API key revoked." });
      }
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "API key could not be changed." });
    } finally {
      setBusy(false);
    }
  }

  async function copySecret() {
    await navigator.clipboard.writeText(revealedSecret);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_800);
  }

  return (
    <AdminPageScaffold
      breadcrumbs={["Settings", "Integrations & API"]}
      kicker="Connections and credentials"
      title="Integrations & API"
      description="Review external metadata connections and issue scoped credentials for bots and trusted publishing applications."
      message={message}
      state={loading ? { kind: "loading", message: "Loading masked credentials and usage…" } : { kind: "ready" }}
    >
      <section className="admin-integration-section">
        <header>
          <span>Metadata providers</span>
          <h3>Manga import connections</h3>
          <p>
            Imports use each provider’s official read-only API, with a shared
            cache, request budgets, explicit attribution, and human approval
            before publishing. Neither provider currently requires a private
            credential, so no key is stored or hard-coded.
          </p>
        </header>
        <div className="admin-integration-grid">
          {[
            {
              name: "MangaDex",
              host: "api.mangadex.org",
              href: "https://api.mangadex.org/docs/",
              cache: "Detail 12h · search 1h",
            },
            {
              name: "MangaUpdates",
              host: "api.mangaupdates.com",
              href: "https://api.mangaupdates.com/",
              cache: "Detail 12h · search 1h",
            },
          ].map((provider) => (
            <article key={provider.name}>
              <PlugsConnected size={20} />
              <div>
                <header>
                  <h4>{provider.name}</h4>
                  <span className="admin-status-badge tone-success">
                    Public API
                  </span>
                </header>
                <code>{provider.host}</code>
                <p>{provider.cache} · no credential required</p>
              </div>
              <a
                className="button button-secondary"
                href={provider.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                Provider API <ArrowSquareOut size={16} />
              </a>
            </article>
          ))}
        </div>
      </section>
      <section className="v46-api-security-note">
        <Key size={24} /><div><strong>Secrets are hashed at rest</strong><p>A raw key is revealed once. Reset creates a replacement and disables the previous key atomically. Keys are rate-limited to 60 requests per minute and 10,000 per day.</p></div>
      </section>
      {revealedSecret ? (
        <section className="v46-api-secret" role="status">
          <WarningCircle /><div><strong>Copy this key now</strong><code>{revealedSecret}</code><small>It cannot be recovered after you close this box.</small></div>
          <button className="button button-primary" type="button" onClick={() => void copySecret()}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy key"}</button>
        </section>
      ) : null}
      <section className="v46-api-create">
        <header><span>New application</span><h3>Create a scoped API key</h3></header>
        <div className="v46-api-form">
          <label><span>Credential type</span><select value={clientType} onChange={(event) => { const next = event.target.value as "EXTERNAL_API" | "DISCORD_BOT"; setClientType(next); setScopes(next === "DISCORD_BOT" ? ["bot:series:create", "bot:chapter:create"] : ["series:read", "upload:chapter"]); }}><option value="DISCORD_BOT">Discord Bot</option><option value="EXTERNAL_API">Trusted external API</option></select></label>
          <label><span>Application name</span><input value={appName} placeholder="NyaScans Discord Bot" maxLength={100} onChange={(event) => setAppName(event.target.value)} /></label>
          <label><span>Publishing team</span><AdminCombobox ariaLabel="Publishing team" value={teamId} emptyLabel="All verified teams" options={data.teams.map((team) => ({ value: team.id, label: team.name, description: team.slug }))} onChange={setTeamId} /></label>
          <fieldset><legend>Scopes</legend>{data.availableScopes.filter((scope) => clientType === "DISCORD_BOT" ? scope.startsWith("bot:") : !scope.startsWith("bot:")).map((scope) => <label key={scope}><input type="checkbox" checked={scopes.includes(scope)} onChange={() => toggleScope(scope)} /><span><strong>{scope}</strong><small>{scope.includes(":series:") ? "Create or read series metadata" : scope.includes(":thumbnail") ? "Set or replace chapter thumbnails" : scope.includes(":publish") ? "Publish assigned chapters" : "Create or manage chapter upload jobs"}</small></span></label>)}</fieldset>
          <button className="button button-primary" type="button" disabled={busy || !appName.trim() || !scopes.length} onClick={() => void createKey()}>{busy ? <SpinnerGap className="spin" /> : <Plus />} Create key</button>
        </div>
      </section>
      <section className="v46-api-list-section">
        <header><span>Credential inventory</span><h3>Applications and API keys</h3></header>
        <div className="v46-api-list">
          {data.keys.map((key) => (
            <article key={key.id} className={`is-${key.status.toLowerCase()}`}>
              <div className="v46-api-key-icon"><Key /></div>
              <div><header><h4>{key.appName}</h4><span>{key.status}</span></header><code>{key.maskedKey}</code><p>{key.scopes.join(" · ")}</p><small>{key.allowedTeamName ?? "All verified teams"} · {key.requestCount.toLocaleString()} requests · Last used {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : "never"}</small></div>
              {key.status === "ACTIVE" ? <div className="v46-api-actions"><button className="button button-secondary" type="button" onClick={() => setConfirm({ action: "RESET", key })}>Reset</button><button className="button button-danger" type="button" onClick={() => setConfirm({ action: "REVOKE", key })}>Revoke</button></div> : null}
            </article>
          ))}
        </div>
      </section>
      <section className="v46-api-docs"><h3>Bot endpoints</h3><code>GET /api/v1/bot/series</code><code>POST /api/v1/bot/series</code><code>POST /api/v1/bot/chapters</code><code>POST /api/v1/bot/chapters/bulk</code><p>Use a Discord Bot key with <code>Authorization: Bearer …</code>. Mutating calls require an <code>Idempotency-Key</code>; uploads may return <code>202 PROCESSING</code>.</p></section>
      <ConfirmActionDialog open={Boolean(confirm)} title={confirm?.action === "RESET" ? "Reset this API key?" : "Revoke this API key?"} description={confirm?.action === "RESET" ? "The current key will stop working immediately and a replacement secret will be shown once." : "The application will lose access immediately. This cannot be undone."} confirmLabel={confirm?.action === "RESET" ? "Reset and reveal new key" : "Revoke key"} destructive={confirm?.action === "REVOKE"} busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => void applyAction()} />
    </AdminPageScaffold>
  );
}
