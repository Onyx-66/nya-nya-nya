export type CommerceLifecycle =
  | "DRAFT"
  | "SCHEDULED"
  | "ACTIVE"
  | "EXPIRED"
  | "HIDDEN"
  | "ARCHIVED";

export const commerceEffectiveLifecycleSql = `CASE
  WHEN p.archived_at IS NOT NULL OR p.lifecycle_status = 'ARCHIVED'
    THEN 'ARCHIVED'
  WHEN p.lifecycle_status = 'HIDDEN' THEN 'HIDDEN'
  WHEN p.lifecycle_status = 'EXPIRED' THEN 'EXPIRED'
  WHEN p.ends_at IS NOT NULL AND datetime(p.ends_at) <= datetime('now')
    THEN 'EXPIRED'
  WHEN p.starts_at IS NOT NULL AND datetime(p.starts_at) > datetime('now')
    THEN 'SCHEDULED'
  WHEN p.lifecycle_status = 'DRAFT' THEN 'DRAFT'
  ELSE 'ACTIVE'
END`;

export function commerceEffectiveLifecycle(
  row: {
    lifecycleStatus: string;
    startsAt: string | null;
    endsAt: string | null;
    archivedAt: string | null;
  },
  now = Date.now(),
): CommerceLifecycle {
  if (row.archivedAt || row.lifecycleStatus === "ARCHIVED") return "ARCHIVED";
  if (row.lifecycleStatus === "HIDDEN") return "HIDDEN";
  if (row.lifecycleStatus === "EXPIRED") return "EXPIRED";
  if (row.endsAt && Date.parse(row.endsAt) <= now) return "EXPIRED";
  if (row.startsAt && Date.parse(row.startsAt) > now) return "SCHEDULED";
  return row.lifecycleStatus === "DRAFT" ? "DRAFT" : "ACTIVE";
}
