"use client";

import {
  ArrowClockwise,
  CaretLeft,
  CaretRight,
  MagnifyingGlass,
  Pulse,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  AdminPageScaffold,
  AdminSectionCard,
  AdminStatusBadge,
  type AdminStatusTone,
} from "@/components/nyascans/admin/AdminPageScaffold";

type BotActivityRecord = {
  id: string;
  requestId: string | null;
  actorName: string;
  action: string;
  result: "SUCCESS" | "DENIED" | "FAILURE";
  targetType: string;
  targetLabel: string | null;
  reason: string | null;
  createdAt: string;
};

type BotActivityResponse = {
  data?: BotActivityRecord[];
  pagination?: { page: number; pageCount: number; total: number };
  error?: { message?: string };
};

const resultTone: Record<BotActivityRecord["result"], AdminStatusTone> = {
  SUCCESS: "success",
  DENIED: "warning",
  FAILURE: "danger",
};

export function BotActivityPanel() {
  const [records, setRecords] = useState<BotActivityRecord[]>([]);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [result, setResult] = useState("ALL");
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
        result,
        query: submittedQuery,
      });
      const response = await fetch(`/api/v1/admin/bot-activity?${parameters}`, {
        cache: "no-store",
        signal,
      });
      const payload = (await response.json()) as BotActivityResponse;
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Bot activity could not be loaded.");
      }
      setRecords(payload.data ?? []);
      setPageCount(Math.max(1, Number(payload.pagination?.pageCount ?? 1)));
      setTotal(Number(payload.pagination?.total ?? 0));
    } catch (caught) {
      if (signal?.aborted) return;
      setError(caught instanceof Error ? caught.message : "Bot activity could not be loaded.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [page, result, submittedQuery]);

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
      kicker="Automation audit"
      title="Bot Activity"
      description="Read-only trail of authenticated bot API decisions and targets."
      state={
        loading
          ? { kind: "loading", message: "Loading bot activity…" }
          : error
            ? { kind: "error", title: "Bot activity unavailable", message: error, onRetry: () => void load() }
            : { kind: "ready" }
      }
      primaryAction={
        <button className="button button-secondary" type="button" onClick={() => void load()}>
          <ArrowClockwise size={17} /> Refresh
        </button>
      }
    >
      <AdminSectionCard icon={<Pulse size={20} />} title={`${total.toLocaleString()} bot events`} summary="Secrets and request bodies are redacted by the server audit layer.">
        <form className="admin-inventory-toolbar" onSubmit={search}>
          <label>
            <span className="sr-only">Search bot activity</span>
            <MagnifyingGlass size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Action or target" />
          </label>
          <select value={result} onChange={(event) => { setPage(1); setResult(event.target.value); }} aria-label="Result">
            <option value="ALL">All results</option>
            <option value="SUCCESS">Success</option>
            <option value="DENIED">Denied</option>
            <option value="FAILURE">Failure</option>
          </select>
          <button className="button button-primary" type="submit">Search</button>
        </form>
        {records.length ? (
          <div className="admin-inventory-table-wrap">
            <table className="admin-inventory-table">
              <thead><tr><th>When</th><th>Action</th><th>Target</th><th>Actor</th><th>Result</th></tr></thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id}>
                    <td><time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleString()}</time></td>
                    <td><strong>{record.action}</strong>{record.requestId ? <code>{record.requestId}</code> : null}</td>
                    <td><strong>{record.targetLabel ?? "Unlabelled target"}</strong><small>{record.targetType}</small></td>
                    <td>{record.actorName}</td>
                    <td><AdminStatusBadge tone={resultTone[record.result]} label={record.result.toLowerCase()} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="admin-inventory-empty">No bot events match these filters.</p>
        )}
        <nav className="admin-inventory-pagination" aria-label="Bot activity pages">
          <button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><CaretLeft size={16} /> Previous</button>
          <span>Page {page} of {pageCount}</span>
          <button type="button" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>Next <CaretRight size={16} /></button>
        </nav>
      </AdminSectionCard>
    </AdminPageScaffold>
  );
}
