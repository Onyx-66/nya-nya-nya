"use client";
/* eslint-disable @next/next/no-img-element */

import {
  ArrowDown,
  ArrowUp,
  Books,
  Plus,
  Sparkle,
  Trash,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { SystemNoticeBridge } from "@/components/nyascans/SystemNotifications";

type EditorialSeries = {
  id: string;
  slug: string;
  title: string;
  type: "MANGA" | "MANHWA" | "MANHUA";
  cover: string | null;
  isPublished: boolean;
};

type EditorialPick = {
  id?: string;
  seriesId: string;
  categoryLabel: string;
  shortDescription: string;
  sortOrder: number;
  isPublished: boolean;
};

async function readJson<T>(response: Response) {
  const payload = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message ?? "Editorial settings were not saved.");
  }
  return payload;
}

export function EditorialManagementPanel({ mode = "editorial" }: { mode?: "editorial" | "sliders" }) {
  const [series, setSeries] = useState<EditorialSeries[]>([]);
  const [picks, setPicks] = useState<EditorialPick[]>([]);
  const [query, setQuery] = useState("");
  const [selectedSeriesId, setSelectedSeriesId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/admin/editor-picks", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((response) =>
        readJson<{ series: EditorialSeries[]; picks: EditorialPick[] }>(
          response,
        ),
      )
      .then((payload) => {
        setSeries(payload.series);
        setPicks(payload.picks);
        setSelectedSeriesId(
          payload.series.find(
            (item) => !payload.picks.some((pick) => pick.seriesId === item.id),
          )?.id ?? "",
        );
      })
      .catch((loadError) => {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Editorial controls could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const seriesById = useMemo(
    () => new Map(series.map((item) => [item.id, item])),
    [series],
  );
  const available = useMemo(
    () =>
      series.filter(
        (item) =>
          !picks.some((pick) => pick.seriesId === item.id) &&
          `${item.title} ${item.slug}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [picks, query, series],
  );

  function addPick() {
    const selected = seriesById.get(selectedSeriesId);
    if (!selected || picks.length >= 12) return;
    setPicks((current) => [
      ...current,
      {
        seriesId: selected.id,
        categoryLabel: "Featured",
        shortDescription:
          "Explain why this series deserves a place in the homepage carousel.",
        sortOrder: (current.length + 1) * 10,
        isPublished: true,
      },
    ]);
    setSelectedSeriesId(
      available.find((item) => item.id !== selected.id)?.id ?? "",
    );
  }

  function updatePick(index: number, patch: Partial<EditorialPick>) {
    setPicks((current) =>
      current.map((pick, pickIndex) =>
        pickIndex === index ? { ...pick, ...patch } : pick,
      ),
    );
  }

  function movePick(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= picks.length) return;
    setPicks((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((pick, pickIndex) => ({
        ...pick,
        sortOrder: (pickIndex + 1) * 10,
      }));
    });
  }

  async function save() {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      await readJson(
        await fetch("/api/v1/admin/editor-picks", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            picks: picks.map((pick, index) => ({
              seriesId: pick.seriesId,
              categoryLabel: pick.categoryLabel,
              shortDescription: pick.shortDescription,
              sortOrder: (index + 1) * 10,
              isPublished: pick.isPublished,
            })),
          }),
        }),
      );
      setPicks((current) =>
        current.map((pick, index) => ({
          ...pick,
          sortOrder: (index + 1) * 10,
        })),
      );
      setMessage(mode === "sliders" ? "Homepage sliders saved." : "Homepage Editor’s Picks published.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Editorial settings were not saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="control-panel editorial-admin-panel">
      <header className="panel-header">
        <span><Sparkle size={20} /></span>
        <div>
          <p>{mode === "sliders" ? "Homepage presentation" : "Homepage curation"}</p>
          <h1>{mode === "sliders" ? "Sliders" : "Editor’s Picks"}</h1>
          <span>
            Add series, activate or deactivate each slide, and control the complete homepage carousel order.
          </span>
        </div>
        <button
          className="button button-primary"
          type="button"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : mode === "sliders" ? "Save sliders" : "Publish carousel"}
        </button>
      </header>

      {message ? <SystemNoticeBridge message={message} kind="success" /> : null}
      {error ? <SystemNoticeBridge message={error} kind="error" /> : null}

      <div className="editorial-picker">
        <label>
          Find series
          <input
            type="search"
            value={query}
            placeholder="Title or slug"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          Available series
          <select
            value={selectedSeriesId}
            onChange={(event) => setSelectedSeriesId(event.target.value)}
          >
            <option value="">Choose a series</option>
            {available.map((item) => (
              <option value={item.id} key={item.id}>
                {item.title} · {item.type}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button button-secondary"
          type="button"
          disabled={!selectedSeriesId || picks.length >= 12}
          onClick={addPick}
        >
          <Plus size={16} /> Add slider
        </button>
      </div>

      {loading ? (
        <div className="store-admin-loading">Loading editorial catalogue…</div>
      ) : picks.length ? (
        <div className="editorial-pick-list">
          {picks.map((pick, index) => {
            const item = seriesById.get(pick.seriesId);
            return (
              <article key={pick.seriesId}>
                <span className="editorial-order">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="editorial-cover">
                  {item?.cover ? (
                    <img src={item.cover} alt="" />
                  ) : (
                    <Books size={24} />
                  )}
                </div>
                <div className="editorial-fields">
                  <header>
                    <div>
                      <strong>{item?.title ?? "Unavailable series"}</strong>
                      <small>{item?.type ?? "Unknown type"}</small>
                    </div>
                    <label>
                      <input
                        type="checkbox"
                        checked={pick.isPublished}
                        onChange={(event) =>
                          updatePick(index, {
                            isPublished: event.target.checked,
                          })
                        }
                      />
                      {mode === "sliders" ? "Active" : "Published"}
                    </label>
                  </header>
                  <label>
                    Category chip
                    <input
                      value={pick.categoryLabel}
                      maxLength={60}
                      onChange={(event) =>
                        updatePick(index, {
                          categoryLabel: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Short description
                    <textarea
                      value={pick.shortDescription}
                      minLength={12}
                      maxLength={360}
                      onChange={(event) =>
                        updatePick(index, {
                          shortDescription: event.target.value,
                        })
                      }
                    />
                  </label>
                </div>
                <div className="editorial-actions">
                  <button
                    type="button"
                    disabled={index === 0}
                    aria-label={`Move ${item?.title ?? "series"} earlier`}
                    onClick={() => movePick(index, -1)}
                  >
                    <ArrowUp size={16} />
                  </button>
                  <button
                    type="button"
                    disabled={index === picks.length - 1}
                    aria-label={`Move ${item?.title ?? "series"} later`}
                    onClick={() => movePick(index, 1)}
                  >
                    <ArrowDown size={16} />
                  </button>
                  <button
                    className="is-danger"
                    type="button"
                    aria-label={`Remove ${item?.title ?? "series"}`}
                    onClick={() =>
                      setPicks((current) =>
                        current.filter(
                          (candidate) =>
                            candidate.seriesId !== pick.seriesId,
                        ),
                      )
                    }
                  >
                    <Trash size={16} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="store-admin-empty">
          <Sparkle size={28} />
          <strong>No sliders selected</strong>
          <span>Add up to 12 published series, then save the slider list.</span>
        </div>
      )}
    </section>
  );
}
