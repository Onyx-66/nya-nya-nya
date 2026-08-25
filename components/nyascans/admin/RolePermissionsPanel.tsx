"use client";
import { DotsRing } from "@/components/nyascans/DotsRing";

import { UnifiedSingleSelect } from "@/components/nyascans/UnifiedSingleSelect";

import { Key } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminPageScaffold } from "@/components/nyascans/admin/AdminPageScaffold";

type PermissionData = {
  roles: string[];
  definitions: Array<{ id: string; group: string; label: string }>;
  rules: Array<{ role: string; capability: string; allowed: boolean; revision: number }>;
  defaults: Record<string, Record<string, boolean>>;
};

export function RolePermissionsPanel() {
  const [data, setData] = useState<PermissionData | null>(null);
  const [role, setRole] = useState("ADMINISTRATOR");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/v1/admin/role-permissions", { cache: "no-store" });
      const payload = await response.json() as { data?: PermissionData; error?: { message?: string } };
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "Permission rules could not be loaded.");
      setData(payload.data);
      setRole((current) => payload.data!.roles.includes(current) ? current : payload.data!.roles[0]!);
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Permission rules could not be loaded." });
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const groups = useMemo(() => {
    const grouped = new Map<string, PermissionData["definitions"]>();
    data?.definitions.forEach((definition) => grouped.set(definition.group, [...(grouped.get(definition.group) ?? []), definition]));
    return [...grouped.entries()];
  }, [data]);

  async function update(capability: string, value: "DEFAULT" | "ALLOW" | "DENY") {
    const rule = data?.rules.find((entry) => entry.role === role && entry.capability === capability);
    setBusy(capability);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/admin/role-permissions", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ role, capability, allowed: value === "DEFAULT" ? null : value === "ALLOW", expectedRevision: Number(rule?.revision ?? 0) }),
      });
      const payload = await response.json() as { data?: PermissionData; error?: { message?: string } };
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "Permission could not be saved.");
      setData(payload.data);
      setMessage({ kind: "success", text: "Role permission saved and audited." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Permission could not be saved." });
    } finally { setBusy(""); }
  }

  return (
    <AdminPageScaffold breadcrumbs={["Community", "Permissions"]} kicker="Least privilege" title="Permissions" description="Control the exact capabilities assigned to each existing role. Owner-only controls remain non-delegable, and every override is revisioned and audited." message={message} state={loading ? { kind: "loading", message: "Loading permission registry…" } : data ? { kind: "ready" } : { kind: "error", title: "Permission registry unavailable", message: "The role rules could not be loaded.", onRetry: () => void load() }}>
      {data ? <div className="role-permission-workspace">
        <label><span>Role to configure</span><UnifiedSingleSelect value={role} onChange={(event) => setRole(event.target.value)}>{data.roles.map((entry) => <option key={entry} value={entry}>{entry.replaceAll("_", " ").toLowerCase().replace(/\b\w/gu, (letter) => letter.toUpperCase())}</option>)}</UnifiedSingleSelect></label>
        <div className="role-permission-groups">{groups.map(([group, definitions]) => <section key={group}><header><Key /><div><strong>{group}</strong><small>Default policy plus explicit audited overrides</small></div></header>{definitions.map((definition) => {
          const rule = data.rules.find((entry) => entry.role === role && entry.capability === definition.id);
          const value = rule ? rule.allowed ? "ALLOW" : "DENY" : "DEFAULT";
          return <article key={definition.id}><div><strong>{definition.label}</strong><code>{definition.id}</code><small>Default: {data.defaults[role]?.[definition.id] ? "Allowed" : "Denied"}</small></div><UnifiedSingleSelect aria-label={`${definition.label} for ${role}`} value={value} disabled={busy === definition.id} onChange={(event) => void update(definition.id, event.target.value as "DEFAULT" | "ALLOW" | "DENY")}><option value="DEFAULT">Use role default</option><option value="ALLOW">Explicitly allow</option><option value="DENY">Explicitly deny</option></UnifiedSingleSelect>{busy === definition.id ? <DotsRing /> : null}</article>;
        })}</section>)}</div>
      </div> : null}
    </AdminPageScaffold>
  );
}
