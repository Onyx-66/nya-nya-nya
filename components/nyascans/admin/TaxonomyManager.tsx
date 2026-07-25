"use client";

import {
  ArrowClockwise,
  CaretLeft,
  CaretRight,
  Plus,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { useUnsavedChanges } from "@/components/nyascans/admin/AdminPageScaffold";

type EntityType = "GENRE" | "CREATOR" | "PUBLISHER";

type TaxonomyEntry = {
  id: string;
  name: string;
  archivedAt: string | null;
  revision: number;
  usageCount: number;
};

async function request<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  const payload = (await response.json()) as T & {
    error?: { message?: string };
    message?: string;
  };
  if (!response.ok) {
    throw new Error(
      payload.error?.message ?? "The taxonomy action could not be completed.",
    );
  }
  return payload;
}

export function TaxonomyManager() {
  const [type, setType] = useState<EntityType>("GENRE");
  const [entries, setEntries] = useState<TaxonomyEntry[]>([]);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("");
  const [replacementId, setReplacementId] = useState("");
  const [replacementQuery, setReplacementQuery] = useState("");
  const [replacementOptions, setReplacementOptions] = useState<
    TaxonomyEntry[]
  >([]);
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    kind: "success" | "error" | "neutral";
    text: string;
  } | null>(null);
  const selected = useMemo(
    () => entries.find((entry) => entry.id === selectedId) ?? null,
    [entries, selectedId],
  );
  const dirty = Boolean(
    (selected && name !== selected.name) || replacementId || newName,
  );
  useUnsavedChanges(dirty, "taxonomy changes");

  async function load(preferredId?: string) {
    setLoading(true);
    try {
      const payload = await request<{
        data: TaxonomyEntry[];
        pagination: { total: number };
      }>(
        `/api/v1/admin/taxonomy?type=${type}&query=${encodeURIComponent(
          appliedQuery,
        )}&page=${page}&limit=30`,
        { cache: "no-store" },
      );
      setEntries(payload.data);
      setTotal(payload.pagination.total);
      const next =
        payload.data.find((entry) => entry.id === preferredId) ??
        payload.data.find((entry) => entry.id === selectedId) ??
        payload.data[0] ??
        null;
      setSelectedId(next?.id ?? "");
      setName(next?.name ?? "");
      setReplacementId("");
      setReplacementQuery("");
      setReplacementOptions([]);
      setNewName("");
      setMessage(null);
      setHasLoaded(true);
    } catch (error) {
      setMessage({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Taxonomy entries could not be loaded.",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedQuery, page, type]);

  useEffect(() => {
    if (!selected || selected.archivedAt) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void request<{
        data: TaxonomyEntry[];
      }>(
        `/api/v1/admin/taxonomy?type=${type}&query=${encodeURIComponent(
          replacementQuery,
        )}&page=1&limit=100`,
        { cache: "no-store", signal: controller.signal },
      )
        .then((payload) => setReplacementOptions(payload.data))
        .catch((error) => {
          if ((error as Error).name !== "AbortError") {
            setMessage({
              kind: "error",
              text: "Replacement entries could not be searched.",
            });
          }
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [replacementQuery, selected, type]);

  function select(entry: TaxonomyEntry) {
    if (dirty && !window.confirm("Discard unsaved taxonomy changes?")) return;
    setSelectedId(entry.id);
    setName(entry.name);
    setReplacementId("");
    setReplacementQuery("");
    setNewName("");
    setMessage(null);
  }

  async function create() {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const payload = await request<{
        data: TaxonomyEntry;
        reused: boolean;
        message?: string;
      }>("/api/v1/admin/taxonomy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, name: newName }),
      });
      setNewName("");
      await load(payload.data.id);
      setMessage({
        kind: payload.reused ? "neutral" : "success",
        text:
          payload.message ??
          `${payload.data.name} was created and is ready to assign.`,
      });
    } catch (error) {
      setMessage({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "The entry could not be created.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function mutate(
    action: "RENAME" | "ARCHIVE" | "RESTORE" | "MERGE",
  ) {
    if (!selected) return;
    if (
      action === "MERGE" &&
      !window.confirm(
        `Merge ${selected.name} into the selected replacement? All series references will move atomically.`,
      )
    ) {
      return;
    }
    if (
      action === "ARCHIVE" &&
      !window.confirm(
        `${selected.name} is used by ${selected.usageCount} series. Archive it from future selection?`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await request("/api/v1/admin/taxonomy", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type,
          id: selected.id,
          revision: selected.revision,
          action,
          ...(action === "RENAME" ? { name } : {}),
          ...(action === "MERGE" ? { replacementId } : {}),
        }),
      });
      await load(action === "MERGE" ? replacementId : selected.id);
      setMessage({
        kind: "success",
        text:
          action === "MERGE"
            ? "References were merged and the duplicate was archived."
            : `${selected.name} was ${action.toLowerCase()}d successfully.`,
      });
    } catch (error) {
      setMessage({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "The entry could not be updated.",
      });
    } finally {
      setBusy(false);
    }
  }

  if (!hasLoaded) {
    return (
      <section className="admin-form-section taxonomy-manager">
        <div
          className="admin-state-card"
          role={loading ? "status" : "alert"}
        >
          <h3>
            {loading
              ? "Loading canonical taxonomy"
              : "Taxonomy could not be loaded"}
          </h3>
          <p>
            {loading
              ? "Loading genres, creators, publishers, and usage counts…"
              : message?.text ??
                "The taxonomy service is temporarily unavailable."}
          </p>
          {!loading ? (
            <button
              className="button button-secondary"
              type="button"
              onClick={() => void load()}
            >
              <ArrowClockwise size={16} /> Retry
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="admin-form-section taxonomy-manager">
      <header>
        <div>
          <h3>Canonical taxonomy and credits</h3>
          <p>
            Inspect usage, reuse capitalization-only duplicates, and move
            references safely before archiving an entry.
          </p>
        </div>
      </header>
      {message ? (
        <div
          className={`admin-notice admin-notice-${message.kind}`}
          role={message.kind === "error" ? "alert" : "status"}
        >
          {message.text}
        </div>
      ) : null}
      <div className="admin-filter-bar">
        <label>
          Entity type
          <select
            value={type}
            onChange={(event) => {
              if (dirty && !window.confirm("Discard unsaved taxonomy changes?")) {
                return;
              }
              setType(event.target.value as EntityType);
              setPage(1);
            }}
          >
            <option value="GENRE">Genres</option>
            <option value="CREATOR">Authors and artists</option>
            <option value="PUBLISHER">Publishing studios</option>
          </select>
        </label>
        <label>
          Search
          <input
            value={query}
            placeholder="Name"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                setAppliedQuery(query);
                setPage(1);
              }
            }}
          />
        </label>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => {
            setAppliedQuery(query);
            setPage(1);
          }}
        >
          Search
        </button>
        <button
          className="button button-ghost"
          type="button"
          onClick={() => void load()}
        >
          <ArrowClockwise size={16} /> Refresh
        </button>
      </div>
      <div className="taxonomy-create-row">
        <label>
          Create or reuse
          <input
            value={newName}
            placeholder={
              type === "GENRE"
                ? "e.g. science fiction"
                : "Preferred display name"
            }
            onChange={(event) => setNewName(event.target.value)}
          />
        </label>
        <button
          className="button button-primary"
          type="button"
          disabled={busy || !newName.trim()}
          onClick={() => void create()}
        >
          <Plus size={16} /> Add entry
        </button>
      </div>
      {loading ? (
        <div className="settings-loading">Loading taxonomy entries…</div>
      ) : entries.length ? (
        <div className="taxonomy-layout">
          <div className="taxonomy-list">
            {entries.map((entry) => (
              <button
                type="button"
                key={entry.id}
                aria-current={entry.id === selectedId ? "true" : undefined}
                onClick={() => select(entry)}
              >
                <span>
                  <strong>{entry.name}</strong>
                  <small>
                    {entry.usageCount} series ·{" "}
                    {entry.archivedAt ? "Archived" : "Active"}
                  </small>
                </span>
              </button>
            ))}
          </div>
          {selected ? (
            <div className="taxonomy-editor">
              <label>
                Preferred display name
                <input
                  value={name}
                  disabled={Boolean(selected.archivedAt)}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <button
                className="button button-secondary"
                type="button"
                disabled={
                  busy ||
                  Boolean(selected.archivedAt) ||
                  name.trim() === selected.name
                }
                onClick={() => void mutate("RENAME")}
              >
                Rename
              </button>
              <label>
                Find replacement
                <input
                  value={replacementQuery}
                  disabled={Boolean(selected.archivedAt)}
                  placeholder="Search active entries"
                  onChange={(event) =>
                    setReplacementQuery(event.target.value)
                  }
                />
              </label>
              <label>
                Merge into active replacement
                <select
                  value={replacementId}
                  disabled={Boolean(selected.archivedAt)}
                  onChange={(event) => setReplacementId(event.target.value)}
                >
                  <option value="">Choose replacement</option>
                  {replacementOptions
                    .filter(
                      (entry) =>
                        entry.id !== selected.id && !entry.archivedAt,
                    )
                    .map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name} · {entry.usageCount} series
                      </option>
                    ))}
                </select>
              </label>
              <button
                className="button button-danger"
                type="button"
                disabled={
                  busy || Boolean(selected.archivedAt) || !replacementId
                }
                onClick={() => void mutate("MERGE")}
              >
                Merge references
              </button>
              <button
                className="button button-secondary"
                type="button"
                disabled={busy}
                onClick={() =>
                  void mutate(selected.archivedAt ? "RESTORE" : "ARCHIVE")
                }
              >
                {selected.archivedAt ? "Restore entry" : "Archive entry"}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="admin-state-card">
          <h3>No matching entries</h3>
          <p>Create a canonical value or change the search.</p>
        </div>
      )}
      <footer className="admin-pagination">
        <span>
          {total ? (page - 1) * 30 + 1 : 0}–{Math.min(total, page * 30)} of{" "}
          {total}
        </span>
        <button
          type="button"
          disabled={page === 1}
          onClick={() => setPage((value) => Math.max(1, value - 1))}
        >
          <CaretLeft size={16} /> Previous
        </button>
        <button
          type="button"
          disabled={page * 30 >= total}
          onClick={() => setPage((value) => value + 1)}
        >
          Next <CaretRight size={16} />
        </button>
      </footer>
    </section>
  );
}
