"use client";

import {
  ArrowClockwise,
  CaretLeft,
  CaretRight,
  HashStraight,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  AdminPageScaffold,
  AdminSectionCard,
  AdminStatusBadge,
} from "@/components/nyascans/admin/AdminPageScaffold";

type IdentifierRecord = {
  publicRef: string;
  entityType: "SERIES" | "TEAM" | "CHAPTER";
  title: string;
  parentLabel: string | null;
  archived: boolean;
  createdAt: string;
};

type IdentifierResponse = {
  data?: IdentifierRecord[];
  pagination?: { page: number; pageCount: number; total: number };
  error?: { message?: string };
};

export function IdentifiersPanel() {
  const [records, setRecords] = useState<IdentifierRecord[]>([]);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [type, setType] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const parameters = new URLSearchParams({
        page: String(page),
        limit: "50",
        type,
        status,
        query: submittedQuery,
      });
      const response = await fetch(`/api/v1/admin/identifiers?${parameters}`, {
        cache: "no-store",
        signal,
      });
      const payload = (await response.json()) as IdentifierResponse;
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Identifiers could not be loaded.");
      }
      setRecords(payload.data ?? []);
      setPageCount(Math.max(1, Number(payload.pagination?.pageCount ?? 1)));
      setTotal(Number(payload.pagination?.total ?? 0));
    } catch (caught) {
      if (signal?.aborted) return;
      setError(caught instanceof Error ? caught.message : "Identifiers could not be loaded.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [page, status, submittedQuery, type]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [load]);

  function search(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setSubmittedQuery(query.trim());
  }

  return (
    <AdminPageScaffold
      breadcrumbs={["Administration", "System"]}
      kicker="Stable references"
      title="Public Identifiers"
      description="Read-only inventory of immutable series, team, and chapter references."
      state={
        loading
          ? { kind: "loading", message: "Loading identifier inventory…" }
          : error
            ? { kind: "error", title: "Identifiers unavailable", message: error, onRetry: () => void load() }
            : { kind: "ready" }
      }
      primaryAction={
        <button className="button button-secondary" type="button" onClick={() => void load()}>
          <ArrowClockwise size={17} /> Refresh
        </button>
      }
    >
      <AdminSectionCard
        icon={<HashStraight size={20} />}
        title={`${total.toLocaleString()} identifiers`}
        summary="References remain stable when display names or slugs change."
      >
        <form className="admin-inventory-toolbar" onSubmit={search}>
          <label>
            <span className="sr-only">Search identifiers</span>
            <MagnifyingGlass size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Reference or title" />
          </label>
          <select value={type} onChange={(event) => { setPage(1); setType(event.target.value); }} aria-label="Entity type">
            <option value="ALL">All types</option>
            <option value="SERIES">Series</option>
            <option value="TEAM">Teams</option>
            <option value="CHAPTER">Chapters</option>
          </select>
          <select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }} aria-label="Archive status">
            <option value="ALL">All states</option>
            <option value="ACTIVE">Active</option>
            <option value="ARCHIVED">Archived</option>
          </select>
          <button className="button button-primary" type="submit">Search</button>
        </form>
        {records.length ? (
          <div className="admin-inventory-table-wrap">
            <table className="admin-inventory-table">
              <thead><tr><th>Reference</th><th>Type</th><th>Title</th><th>State</th><th>Created</th></tr></thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.publicRef}>
                    <td><code>{record.publicRef}</code></td>
                    <td>{record.entityType}</td>
                    <td><strong>{record.title}</strong>{record.parentLabel ? <small>{record.parentLabel}</small> : null}</td>
                    <td><AdminStatusBadge tone={record.archived ? "neutral" : "success"} label={record.archived ? "Archived" : "Active"} /></td>
                    <td><time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleDateString()}</time></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="admin-inventory-empty">No identifiers match these filters.</p>
        )}
        <nav className="admin-inventory-pagination" aria-label="Identifier pages">
          <button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><CaretLeft size={16} /> Previous</button>
          <span>Page {page} of {pageCount}</span>
          <button type="button" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>Next <CaretRight size={16} /></button>
        </nav>
      </AdminSectionCard>
    </AdminPageScaffold>
  );
}
