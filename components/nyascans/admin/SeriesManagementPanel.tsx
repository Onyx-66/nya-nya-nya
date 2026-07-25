"use client";
/* eslint-disable @next/next/no-img-element */

import {
  ArrowClockwise,
  CaretLeft,
  CaretRight,
  Check,
  DownloadSimple,
  MagnifyingGlass,
  Plus,
  X,
} from "@phosphor-icons/react";
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AdminMediaField } from "@/components/nyascans/admin/AdminMediaField";
import {
  AdminPageScaffold,
  useUnsavedChanges,
} from "@/components/nyascans/admin/AdminPageScaffold";
import { TaxonomyManager } from "@/components/nyascans/admin/TaxonomyManager";

type Entity = { id?: string; name: string };
type TeamOption = { id: string; name: string; verificationStatus: string };
type SeriesRecord = {
  id: string;
  revision: number;
  title: string;
  slug: string;
  alternativeTitles: string[];
  synopsis: string;
  type: "MANGA" | "MANHWA" | "MANHUA";
  status: "ONGOING" | "COMPLETED" | "HIATUS" | "UPCOMING";
  ageRating: "EVERYONE" | "TEEN" | "MATURE";
  publicationYear: number | null;
  authors: Entity[];
  artists: Entity[];
  publisher: Entity | null;
  countryCode: string;
  languageCode: string;
  genres: Entity[];
  teams: Array<Entity & { isPrimary: boolean }>;
  readingDirection: "VERTICAL" | "RIGHT_TO_LEFT" | "LEFT_TO_RIGHT";
  accessType: "FREE" | "PAID";
  rightsStatus:
    | "PENDING_REVIEW"
    | "LICENSED"
    | "AUTHORIZED"
    | "DEMO_ORIGINAL"
    | "TEST_ORIGINAL"
    | "EXPIRED"
    | "REVOKED"
    | "TAKEDOWN";
  isPublished: boolean;
  archivedAt: string | null;
  coverUrl: string | null;
  bannerUrl: string | null;
  externalSources: Array<{
    source: "MANGADEX" | "MANGAUPDATES";
    externalId: string;
    sourceUrl: string;
    responseHash?: string | null;
  }>;
  chapterCount: number;
  updatedAt: string;
};

type Options = {
  countries: Array<{ code: string; name: string }>;
  languages: Array<{ code: string; name: string }>;
  countryLanguageDefaults: Record<string, string>;
  creators: Entity[];
  publishers: Entity[];
  genres: Array<Entity & { usageCount: number }>;
  teams: TeamOption[];
};

type ImportedData = {
  source: "MANGADEX" | "MANGAUPDATES";
  externalId: string;
  sourceUrl: string;
  responseHash: string;
  cached: boolean;
  fields: {
    title?: string;
    alternativeTitles?: string[];
    synopsis?: string;
    authors?: Entity[];
    artists?: Entity[];
    publisher?: Entity | null;
    countryCode?: string;
    languageCode?: string;
    type?: "MANGA" | "MANHWA" | "MANHUA";
    status?: "ONGOING" | "COMPLETED" | "HIATUS" | "UPCOMING";
    publicationYear?: number | null;
    genres?: Entity[];
    coverReferenceUrl?: string | null;
  };
};

type FormState = {
  id?: string;
  revision?: number;
  title: string;
  slug: string;
  alternativeTitles: string[];
  synopsis: string;
  type: SeriesRecord["type"];
  status: SeriesRecord["status"];
  ageRating: SeriesRecord["ageRating"];
  publicationYear: string;
  authors: Entity[];
  artists: Entity[];
  publisher: Entity | null;
  countryCode: string;
  languageCode: string;
  genres: Entity[];
  teamIds: string[];
  primaryTeamId: string | null;
  readingDirection: SeriesRecord["readingDirection"];
  accessType: SeriesRecord["accessType"];
  rightsStatus: SeriesRecord["rightsStatus"];
  isPublished: boolean;
  externalSources: SeriesRecord["externalSources"];
  coverUrl: string | null;
  bannerUrl: string | null;
  removeCover: boolean;
  removeBanner: boolean;
};

const tabs = [
  ["basic", "Basic information"],
  ["titles", "Titles & synopsis"],
  ["credits", "Credits & publishing"],
  ["origin", "Origin & classification"],
  ["taxonomy", "Taxonomy"],
  ["teams", "Teams"],
  ["media", "Media"],
  ["external", "External metadata"],
  ["visibility", "Visibility"],
  ["review", "Review & save"],
] as const;

const emptyForm: FormState = {
  title: "",
  slug: "",
  alternativeTitles: [],
  synopsis: "",
  type: "MANGA",
  status: "ONGOING",
  ageRating: "TEEN",
  publicationYear: "",
  authors: [],
  artists: [],
  publisher: null,
  countryCode: "JP",
  languageCode: "ja",
  genres: [],
  teamIds: [],
  primaryTeamId: null,
  readingDirection: "RIGHT_TO_LEFT",
  accessType: "FREE",
  rightsStatus: "PENDING_REVIEW",
  isPublished: false,
  externalSources: [],
  coverUrl: null,
  bannerUrl: null,
  removeCover: false,
  removeBanner: false,
};

async function api<T>(response: Response) {
  const payload = (await response.json()) as T & {
    error?: {
      code?: string;
      message?: string;
      fields?: Array<{ path: string; message: string }>;
    };
  };
  if (!response.ok) {
    const fieldMessage = payload.error?.fields?.[0]?.message;
    const error = new Error(
      fieldMessage ?? payload.error?.message ?? "The request could not be completed.",
    ) as Error & { code?: string; status?: number };
    error.code = payload.error?.code;
    error.status = response.status;
    throw error;
  }
  return payload;
}

function fromRecord(record: SeriesRecord): FormState {
  return {
    id: record.id,
    revision: record.revision,
    title: record.title,
    slug: record.slug,
    alternativeTitles: record.alternativeTitles,
    synopsis: record.synopsis,
    type: record.type,
    status: record.status,
    ageRating: record.ageRating,
    publicationYear:
      record.publicationYear === null ? "" : String(record.publicationYear),
    authors: record.authors,
    artists: record.artists,
    publisher: record.publisher,
    countryCode: record.countryCode,
    languageCode: record.languageCode,
    genres: record.genres,
    teamIds: record.teams.map((team) => team.id!),
    primaryTeamId:
      record.teams.find((team) => team.isPrimary)?.id ?? null,
    readingDirection: record.readingDirection,
    accessType: record.accessType,
    rightsStatus: record.rightsStatus,
    isPublished: record.isPublished,
    externalSources: record.externalSources,
    coverUrl: record.coverUrl,
    bannerUrl: record.bannerUrl,
    removeCover: false,
    removeBanner: false,
  };
}

function normalized(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function displayImportValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "Empty";
  if (Array.isArray(value)) {
    return (
      value
        .map((entry) =>
          typeof entry === "object" && entry
            ? String((entry as Entity).name ?? "")
            : String(entry),
        )
        .filter(Boolean)
        .join(", ") || "Empty"
    );
  }
  if (typeof value === "object") {
    return String((value as Entity).name ?? "Configured value");
  }
  return String(value);
}

function ChipList({
  values,
  onRemove,
  onEdit,
}: {
  values: Entity[];
  onRemove(index: number): void;
  onEdit?(index: number, value: Entity): void;
}) {
  return (
    <div className="admin-chip-list">
      {values.map((value, index) => (
        <span key={`${value.id ?? normalized(value.name)}-${index}`}>
          {onEdit ? (
            <button
              type="button"
              title={`Edit ${value.name}`}
              onClick={() => onEdit(index, value)}
            >
              {value.name}
            </button>
          ) : (
            <em>{value.name}</em>
          )}
          <button
            type="button"
            aria-label={`Remove ${value.name}`}
            onClick={() => onRemove(index)}
          >
            <X size={13} />
          </button>
        </span>
      ))}
    </div>
  );
}

function EntityInput({
  label,
  values,
  suggestions,
  suggestionKind,
  multiple = true,
  createLabel = "Add",
  onChange,
}: {
  label: string;
  values: Entity[];
  suggestions: Entity[];
  suggestionKind: "creators" | "publishers" | "genres";
  multiple?: boolean;
  createLabel?: string;
  onChange(values: Entity[]): void;
}) {
  const [draft, setDraft] = useState("");
  const [feedback, setFeedback] = useState("");
  const [liveSuggestions, setLiveSuggestions] = useState(suggestions);
  const listId = `entity-${label.toLowerCase().replace(/\W+/g, "-")}`;
  const displayedSuggestions = draft.trim()
    ? liveSuggestions
    : suggestions;
  useEffect(() => {
    if (!draft.trim()) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(
        `/api/v1/admin/series-options?query=${encodeURIComponent(draft)}&limit=30`,
        { cache: "no-store", signal: controller.signal },
      )
        .then((response) => api<{ data: Options }>(response))
        .then((payload) => {
          if (!controller.signal.aborted) {
            setLiveSuggestions(payload.data[suggestionKind]);
          }
        })
        .catch(() => {
          // Existing suggestions remain usable during a recoverable lookup error.
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [draft, suggestionKind]);
  function add() {
    const name = draft.trim().replace(/\s+/g, " ");
    if (!name) return;
    const existing = displayedSuggestions.find(
      (entry) => normalized(entry.name) === normalized(name),
    );
    const value = existing ?? { name };
    if (
      values.some(
        (entry) => normalized(entry.name) === normalized(value.name),
      )
    ) {
      setFeedback(`${value.name} is already selected.`);
      setDraft("");
      return;
    }
    onChange(multiple ? [...values, value] : [value]);
    setFeedback(
      existing
        ? `Selected the existing ${existing.name} entry.`
        : `${name} will be created when the series is saved.`,
    );
    setDraft("");
  }
  return (
    <div className="admin-entity-field">
      <label>
        <span>{label}</span>
        <div>
          <input
            value={draft}
            list={listId}
            placeholder={`Search or create ${label.toLowerCase()}`}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
          />
          <button className="button button-secondary" type="button" onClick={add}>
            <Plus size={15} /> {createLabel}
          </button>
        </div>
      </label>
      <datalist id={listId}>
        {displayedSuggestions.map((entry) => (
          <option key={entry.id ?? entry.name} value={entry.name} />
        ))}
      </datalist>
      <ChipList
        values={values}
        onRemove={(index) => onChange(values.filter((_, item) => item !== index))}
      />
      {feedback ? (
        <small className="admin-entity-feedback" role="status">
          {feedback}
        </small>
      ) : null}
    </div>
  );
}

export function SeriesManagementPanel() {
  const [records, setRecords] = useState<SeriesRecord[]>([]);
  const [options, setOptions] = useState<Options | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [savedForm, setSavedForm] = useState<FormState>(emptyForm);
  const [activeTab, setActiveTab] =
    useState<(typeof tabs)[number][0]>("basic");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    kind: "success" | "error" | "neutral";
    text: string;
  } | null>(null);
  const [altDraft, setAltDraft] = useState("");
  const [altEditIndex, setAltEditIndex] = useState<number | null>(null);
  const [altEditValue, setAltEditValue] = useState("");
  const [teamDraft, setTeamDraft] = useState("");
  const [teamSearch, setTeamSearch] = useState("");
  const [teamSearchResults, setTeamSearchResults] = useState<TeamOption[]>([]);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [importSource, setImportSource] =
    useState<"MANGADEX" | "MANGAUPDATES">("MANGADEX");
  const [importInput, setImportInput] = useState("");
  const [imported, setImported] = useState<ImportedData | null>(null);
  const [importDuplicate, setImportDuplicate] = useState<string | null>(null);
  const [forceRefresh, setForceRefresh] = useState(false);
  const [importFields, setImportFields] = useState<Set<string>>(new Set());
  const [importApplied, setImportApplied] = useState(false);
  const dirty =
    JSON.stringify(form) !== JSON.stringify(savedForm) ||
    Boolean(coverFile || bannerFile);
  useUnsavedChanges(dirty, "series changes");

  async function load(search = query, requestedPage = page) {
    setLoading(true);
    setMessage(null);
    try {
      const [seriesPayload, optionsPayload] = await Promise.all([
        fetch(
          `/api/v1/admin/series-management?query=${encodeURIComponent(search)}&page=${requestedPage}&limit=20`,
        ).then((response) =>
          api<{
            data: SeriesRecord[];
            pagination: { page: number; total: number };
          }>(response),
        ),
        fetch("/api/v1/admin/series-options?limit=100").then((response) =>
          api<{ data: Options }>(response),
        ),
      ]);
      setRecords(seriesPayload.data);
      setPage(seriesPayload.pagination.page);
      setTotal(seriesPayload.pagination.total);
      setOptions(optionsPayload.data);
    } catch (error) {
      if (
        form.id &&
        (error as Error & { code?: string }).code === "STALE_VERSION"
      ) {
        try {
          const refreshed = await fetch(
            `/api/v1/admin/series-management?id=${encodeURIComponent(form.id)}`,
            { cache: "no-store" },
          ).then((response) => api<{ data: SeriesRecord }>(response));
          const next = fromRecord(refreshed.data);
          setForm(next);
          setSavedForm(next);
          setCoverFile(null);
          setBannerFile(null);
          setRecords((items) => [
            refreshed.data,
            ...items.filter((item) => item.id !== refreshed.data.id),
          ]);
        } catch {
          // The original conflict message remains the safest recovery state.
        }
      }
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Series could not be loaded.",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load("", 1), 0);
    return () => window.clearTimeout(timer);
    // Initial load only; search is submitted explicitly to avoid noisy requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!teamSearch.trim()) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(
        `/api/v1/admin/series-options?query=${encodeURIComponent(teamSearch)}&limit=50`,
        { cache: "no-store", signal: controller.signal },
      )
        .then((response) => api<{ data: Options }>(response))
        .then((payload) => {
          if (controller.signal.aborted) return;
          setTeamSearchResults(payload.data.teams);
          setOptions((current) => {
            if (!current) return payload.data;
            const additions = payload.data.teams.filter(
              (team) =>
                !current.teams.some(
                  (existing) => existing.id === team.id,
                ),
            );
            return additions.length
              ? { ...current, teams: [...current.teams, ...additions] }
              : current;
          });
        })
        .catch(() => {
          // The current eligible-team list remains usable on lookup failure.
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [teamSearch]);
  const displayedTeamSearchResults = teamSearch.trim()
    ? teamSearchResults
    : [];

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const stored = window.sessionStorage.getItem(
        "nyascans-admin-series-tab",
      );
      if (stored && tabs.some(([key]) => key === stored)) {
        setActiveTab(stored as (typeof tabs)[number][0]);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  function changeTab(key: string) {
    const next = key as (typeof tabs)[number][0];
    setActiveTab(next);
    window.sessionStorage.setItem("nyascans-admin-series-tab", next);
  }

  function startNew() {
    if (dirty && !window.confirm("Discard the unsaved series changes?")) return;
    setForm(emptyForm);
    setSavedForm(emptyForm);
    setCoverFile(null);
    setBannerFile(null);
    setImported(null);
    setImportDuplicate(null);
    setImportApplied(false);
    setAltEditIndex(null);
    setAltEditValue("");
    setActiveTab("basic");
    setMessage(null);
  }

  function selectRecord(record: SeriesRecord) {
    if (dirty && !window.confirm("Discard the unsaved series changes?")) return;
    const next = fromRecord(record);
    setForm(next);
    setSavedForm(next);
    setCoverFile(null);
    setBannerFile(null);
    setImported(null);
    setImportDuplicate(null);
    setImportApplied(false);
    setAltEditIndex(null);
    setAltEditValue("");
    setActiveTab("basic");
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function addAlternativeTitles(raw = altDraft) {
    const candidates = raw
      .split(",")
      .map((value) => value.trim().replace(/\s+/g, " "))
      .filter(Boolean);
    const existing = new Set(form.alternativeTitles.map(normalized));
    const additions = candidates.filter((title) => {
      const key = normalized(title);
      if (existing.has(key)) return false;
      existing.add(key);
      return true;
    });
    setField("alternativeTitles", [...form.alternativeTitles, ...additions]);
    setAltDraft("");
  }

  function saveAlternativeTitleEdit() {
    if (altEditIndex === null) return;
    const value = altEditValue.trim().replace(/\s+/g, " ");
    if (!value) return;
    const titles = [...form.alternativeTitles];
    titles[altEditIndex] = value;
    const deduped = titles.filter(
      (title, item) =>
        titles.findIndex(
          (candidate) => normalized(candidate) === normalized(title),
        ) === item,
    );
    setField("alternativeTitles", deduped);
    setAltEditIndex(null);
    setAltEditValue("");
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    setSaving(true);
    setMessage(null);
    let persistedRecord: SeriesRecord | null = null;
    const applyPersistedRecord = (record: SeriesRecord) => {
      const next = fromRecord(record);
      setForm(next);
      setSavedForm(next);
      setRecords((items) => [
        record,
        ...items.filter((item) => item.id !== record.id),
      ]);
    };
    try {
      const method = form.id ? "PUT" : "POST";
      const saved = await fetch("/api/v1/admin/series-management", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          publicationYear: form.publicationYear
            ? Number(form.publicationYear)
            : null,
          coverUrl: undefined,
          bannerUrl: undefined,
          externalSources: form.externalSources,
          importApplied,
        }),
      }).then((response) =>
        api<{ data: SeriesRecord }>(response),
      );
      let current = saved.data;
      persistedRecord = current;
      applyPersistedRecord(current);
      setImportApplied(false);
      for (const [slot, file] of [
        ["cover", coverFile] as const,
        ["banner", bannerFile] as const,
      ]) {
        if (!file) continue;
        const upload = new FormData();
        upload.set("seriesId", current.id);
        upload.set("slot", slot);
        upload.set("revision", String(current.revision));
        upload.set("file", file);
        const media = await fetch("/api/v1/admin/series-media", {
          method: "PUT",
          body: upload,
        }).then((response) =>
          api<{ data: { revision: number; url: string } }>(response),
        );
        current = {
          ...current,
          revision: media.data.revision,
          [slot === "cover" ? "coverUrl" : "bannerUrl"]: media.data.url,
        };
        persistedRecord = current;
        applyPersistedRecord(current);
        if (slot === "cover") setCoverFile(null);
        else setBannerFile(null);
      }
      setMessage({
        kind: "success",
        text: `${current.title} was saved successfully.`,
      });
    } catch (error) {
      if (persistedRecord) {
        applyPersistedRecord(persistedRecord);
        setMessage({
          kind: "error",
          text: `Series metadata was saved, but one media upload failed: ${
            error instanceof Error ? error.message : "retry the remaining image"
          }. The saved record and revision have been retained.`,
        });
        return;
      }
      if (
        form.id &&
        (error as Error & { code?: string }).code === "STALE_VERSION"
      ) {
        try {
          const refreshed = await fetch(
            `/api/v1/admin/series-management?id=${encodeURIComponent(form.id)}`,
            { cache: "no-store" },
          ).then((response) => api<{ data: SeriesRecord }>(response));
          applyPersistedRecord(refreshed.data);
        } catch {
          // Preserve the original concurrency error when recovery also fails.
        }
      }
      setMessage({
        kind: "error",
        text:
          (error as Error & { code?: string }).code === "STALE_VERSION"
            ? "A newer version was loaded. Review it before applying your changes again."
            : error instanceof Error
            ? error.message
            : "The series could not be saved.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function previewImport() {
    setSaving(true);
    setMessage(null);
    try {
      const payload = await fetch("/api/v1/admin/metadata-import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: importSource,
          input: importInput,
          seriesId: form.id,
          refresh: forceRefresh,
        }),
      }).then((response) =>
        api<{
          data: ImportedData;
          duplicate: { title: string } | null;
        }>(response),
      );
      setImported(payload.data);
      setImportDuplicate(payload.duplicate?.title ?? null);
      setImportFields(
        new Set(
          Object.entries(payload.data.fields)
            .filter(([, value]) => value !== undefined && value !== null)
            .map(([key]) => key),
        ),
      );
      setMessage({
        kind: payload.duplicate ? "error" : "neutral",
        text: payload.duplicate
          ? `This source is already linked to ${payload.duplicate.title}.`
          : `Metadata preview loaded${payload.data.cached ? " from cache" : ""}. Choose which values to apply.`,
      });
    } catch (error) {
      setMessage({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Metadata could not be imported.",
      });
    } finally {
      setSaving(false);
    }
  }

  function applyImported() {
    if (!imported || importDuplicate) return;
    const fields = imported.fields;
    setForm((current) => {
      const next = { ...current };
      for (const field of importFields) {
        if (field === "title" && fields.title) next.title = fields.title;
        if (field === "alternativeTitles" && fields.alternativeTitles) {
          const unique = new Map(
            [...next.alternativeTitles, ...fields.alternativeTitles].map(
              (title) => [normalized(title), title],
            ),
          );
          next.alternativeTitles = [...unique.values()];
        }
        if (field === "synopsis" && fields.synopsis) next.synopsis = fields.synopsis;
        if (field === "authors" && fields.authors) next.authors = fields.authors;
        if (field === "artists" && fields.artists) next.artists = fields.artists;
        if (field === "publisher") next.publisher = fields.publisher ?? null;
        if (field === "countryCode" && fields.countryCode) {
          next.countryCode = fields.countryCode;
        }
        if (field === "languageCode" && fields.languageCode) {
          next.languageCode = fields.languageCode;
        }
        if (field === "type" && fields.type) next.type = fields.type;
        if (field === "status" && fields.status) next.status = fields.status;
        if (field === "publicationYear") {
          next.publicationYear =
            fields.publicationYear === null ||
            fields.publicationYear === undefined
              ? ""
              : String(fields.publicationYear);
        }
        if (field === "genres" && fields.genres) next.genres = fields.genres;
      }
      next.externalSources = [
        ...current.externalSources.filter(
          (source) => source.source !== imported.source,
        ),
        {
          source: imported.source,
          externalId: imported.externalId,
          sourceUrl: imported.sourceUrl,
          responseHash: imported.responseHash,
        },
      ];
      return next;
    });
    setMessage({
      kind: "success",
      text: "Selected import values were applied locally. Save the series to publish them.",
    });
    setImportDuplicate(null);
    setImportApplied(true);
  }

  const selectedTeams = useMemo(
    () =>
      form.teamIds
        .map((id) => options?.teams.find((team) => team.id === id))
        .filter((team): team is TeamOption => Boolean(team)),
    [form.teamIds, options],
  );

  const state = loading
    ? ({ kind: "loading", message: "Loading series and canonical lookups…" } as const)
    : !options
      ? ({
          kind: "error",
          title: "Series management is unavailable",
          message: message?.text ?? "Reload the management data to continue.",
          onRetry: () => void load(),
        } as const)
      : ({ kind: "ready" } as const);

  return (
    <AdminPageScaffold
      breadcrumbs={["Administration", "Catalogue", "Series"]}
      kicker="Catalogue control"
      title="Series management"
      description="Create and maintain complete series records, canonical credits, publishing teams, media, and external metadata."
      primaryAction={
        <button className="button button-primary" type="button" onClick={startNew}>
          <Plus size={17} /> New series
        </button>
      }
      tabs={tabs.map(([key, label]) => ({ key, label }))}
      activeTab={activeTab}
      onTabChange={changeTab}
      state={state}
      message={message}
    >
      <div className="admin-master-detail">
        <aside className="admin-record-browser">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void load(query, 1);
            }}
          >
            <MagnifyingGlass size={17} />
            <input
              value={query}
              placeholder="Search titles and aliases"
              onChange={(event) => setQuery(event.target.value)}
            />
            <button type="submit" aria-label="Search series">
              <Check size={16} />
            </button>
          </form>
          <button type="button" onClick={() => void load(query, page)}>
            <ArrowClockwise size={15} /> Refresh
          </button>
          <div>
            {records.length ? (
              records.map((record) => (
                <button
                  type="button"
                  className={form.id === record.id ? "is-active" : ""}
                  key={record.id}
                  onClick={() => selectRecord(record)}
                >
                  <span>
                    {record.coverUrl ? (
                      <img src={record.coverUrl} alt="" />
                    ) : (
                      record.title.slice(0, 1)
                    )}
                  </span>
                  <div>
                    <strong>{record.title}</strong>
                    <small>
                      {record.type} · {record.isPublished ? "Published" : "Draft"}
                    </small>
                  </div>
                </button>
              ))
            ) : (
              <p>No matching series.</p>
            )}
          </div>
          <footer className="admin-pagination">
            <span>
              {total ? (page - 1) * 20 + 1 : 0}–
              {Math.min(total, page * 20)} of {total}
            </span>
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => void load(query, Math.max(1, page - 1))}
            >
              <CaretLeft size={15} /> Previous
            </button>
            <button
              type="button"
              disabled={page * 20 >= total || loading}
              onClick={() => void load(query, page + 1)}
            >
              Next <CaretRight size={15} />
            </button>
          </footer>
        </aside>
        <form className="admin-editor-form" onSubmit={save}>
          {activeTab === "basic" ? (
            <section className="admin-form-section">
              <header>
                <h3>Basic information</h3>
                <p>Primary identity, format, publication state, and reading behavior.</p>
              </header>
              <div className="admin-form-grid">
                <label>
                  <span>Primary title <b>Required</b></span>
                  <input
                    required
                    value={form.title}
                    onChange={(event) => {
                      const title = event.target.value;
                      setForm((current) => ({
                        ...current,
                        title,
                        slug:
                          current.id || current.slug
                            ? current.slug
                            : title
                                .toLowerCase()
                                .normalize("NFKD")
                                .replace(/[^a-z0-9]+/g, "-")
                                .replace(/^-|-$/g, ""),
                      }));
                    }}
                  />
                </label>
                <label>
                  <span>URL slug <b>Required</b></span>
                  <input
                    required
                    pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                    value={form.slug}
                    onChange={(event) =>
                      setField("slug", event.target.value.toLowerCase())
                    }
                  />
                </label>
                <label>
                  <span>Series type</span>
                  <select
                    value={form.type}
                    onChange={(event) =>
                      setField("type", event.target.value as FormState["type"])
                    }
                  >
                    <option value="MANGA">Manga</option>
                    <option value="MANHWA">Manhwa</option>
                    <option value="MANHUA">Manhua</option>
                  </select>
                </label>
                <label>
                  <span>Publication status</span>
                  <select
                    value={form.status}
                    onChange={(event) =>
                      setField("status", event.target.value as FormState["status"])
                    }
                  >
                    <option value="ONGOING">Ongoing</option>
                    <option value="COMPLETED">Completed</option>
                    <option value="HIATUS">Hiatus</option>
                    <option value="UPCOMING">Upcoming</option>
                  </select>
                </label>
                <label>
                  <span>Content rating</span>
                  <select
                    value={form.ageRating}
                    onChange={(event) =>
                      setField(
                        "ageRating",
                        event.target.value as FormState["ageRating"],
                      )
                    }
                  >
                    <option value="EVERYONE">Everyone</option>
                    <option value="TEEN">Teen</option>
                    <option value="MATURE">Mature</option>
                  </select>
                </label>
                <label>
                  <span>Original publication year</span>
                  <input
                    type="number"
                    min="1800"
                    max="2200"
                    value={form.publicationYear}
                    onChange={(event) =>
                      setField("publicationYear", event.target.value)
                    }
                  />
                </label>
                <label>
                  <span>Reading direction</span>
                  <select
                    value={form.readingDirection}
                    onChange={(event) =>
                      setField(
                        "readingDirection",
                        event.target.value as FormState["readingDirection"],
                      )
                    }
                  >
                    <option value="VERTICAL">Vertical</option>
                    <option value="RIGHT_TO_LEFT">Right to left</option>
                    <option value="LEFT_TO_RIGHT">Left to right</option>
                  </select>
                </label>
              </div>
            </section>
          ) : null}

          {activeTab === "titles" ? (
            <section className="admin-form-section">
              <header>
                <h3>Titles and synopsis</h3>
                <p>Aliases are stored as structured searchable values.</p>
              </header>
              <div className="admin-entity-field">
                <label>
                  <span>Alternative titles</span>
                  <div>
                    <input
                      value={altDraft}
                      placeholder="Type titles separated by commas"
                      onChange={(event) => setAltDraft(event.target.value)}
                      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addAlternativeTitles();
                        }
                      }}
                      onBlur={() => altDraft && addAlternativeTitles()}
                    />
                    <button
                      className="button button-secondary"
                      type="button"
                      onClick={() => addAlternativeTitles()}
                    >
                      <Plus size={15} /> Add
                    </button>
                  </div>
                </label>
                <ChipList
                  values={form.alternativeTitles.map((name) => ({ name }))}
                  onRemove={(index) =>
                    setField(
                      "alternativeTitles",
                      form.alternativeTitles.filter((_, item) => item !== index),
                    )
                  }
                  onEdit={(index, value) => {
                    setAltEditIndex(index);
                    setAltEditValue(value.name);
                  }}
                />
                {altEditIndex !== null ? (
                  <div className="admin-inline-field">
                    <input
                      aria-label="Edit alternative title"
                      autoFocus
                      value={altEditValue}
                      onChange={(event) => setAltEditValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          saveAlternativeTitleEdit();
                        }
                        if (event.key === "Escape") {
                          setAltEditIndex(null);
                          setAltEditValue("");
                        }
                      }}
                    />
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={!altEditValue.trim()}
                      onClick={saveAlternativeTitleEdit}
                    >
                      <Check size={15} /> Save title
                    </button>
                    <button
                      className="button button-ghost"
                      type="button"
                      onClick={() => {
                        setAltEditIndex(null);
                        setAltEditValue("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : null}
              </div>
              <label>
                <span>Synopsis <b>Required</b></span>
                <textarea
                  required
                  minLength={20}
                  maxLength={10_000}
                  rows={12}
                  value={form.synopsis}
                  onChange={(event) => setField("synopsis", event.target.value)}
                />
                <small>{form.synopsis.length.toLocaleString()} / 10,000</small>
              </label>
            </section>
          ) : null}

          {activeTab === "credits" ? (
            <section className="admin-form-section">
              <header>
                <h3>Credits and publishing</h3>
                <p>Select canonical people and organizations, or create a new exact entry.</p>
              </header>
              <EntityInput
                label="Authors"
                values={form.authors}
                suggestions={options?.creators ?? []}
                suggestionKind="creators"
                onChange={(authors) => setField("authors", authors)}
              />
              <EntityInput
                label="Artists"
                values={form.artists}
                suggestions={options?.creators ?? []}
                suggestionKind="creators"
                onChange={(artists) => setField("artists", artists)}
              />
              <EntityInput
                label="Original publisher / studio"
                values={form.publisher ? [form.publisher] : []}
                suggestions={options?.publishers ?? []}
                suggestionKind="publishers"
                multiple={false}
                createLabel="Select"
                onChange={(publishers) =>
                  setField("publisher", publishers[0] ?? null)
                }
              />
            </section>
          ) : null}

          {activeTab === "origin" ? (
            <section className="admin-form-section">
              <header>
                <h3>Origin and classification</h3>
                <p>Country and language use stable supported codes; genres reuse canonical entries.</p>
              </header>
              <div className="admin-form-grid">
                <label>
                  <span>Country of origin</span>
                  <select
                    value={form.countryCode}
                    onChange={(event) => {
                      const countryCode = event.target.value;
                      const suggested =
                        options?.countryLanguageDefaults[countryCode];
                      setForm((current) => {
                        if (!suggested || suggested === current.languageCode) {
                          return { ...current, countryCode };
                        }
                        if (!current.languageCode) {
                          return {
                            ...current,
                            countryCode,
                            languageCode: suggested,
                          };
                        }
                        const replace = window.confirm(
                          "This country usually uses a different original language. Apply the suggestion?",
                        );
                        return {
                          ...current,
                          countryCode,
                          languageCode: replace
                            ? suggested
                            : current.languageCode,
                        };
                      });
                    }}
                  >
                    {options?.countries.map((country) => (
                      <option key={country.code} value={country.code}>
                        {country.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Original language</span>
                  <select
                    value={form.languageCode}
                    onChange={(event) =>
                      setField("languageCode", event.target.value)
                    }
                  >
                    {options?.languages.map((language) => (
                      <option key={language.code} value={language.code}>
                        {language.name}
                      </option>
                    ))}
                  </select>
                  <small>This field remains independently selectable.</small>
                </label>
              </div>
              <EntityInput
                label="Genres"
                values={form.genres}
                suggestions={options?.genres ?? []}
                suggestionKind="genres"
                onChange={(genres) => setField("genres", genres)}
              />
            </section>
          ) : null}

          {activeTab === "teams" ? (
            <section className="admin-form-section">
              <header>
                <h3>NyaScans publishing teams</h3>
                <p>Assign multiple scanlation teams without confusing them with the original publisher.</p>
              </header>
              <label>
                <span>Find an eligible team</span>
                <div className="admin-inline-field">
                  <input
                    value={teamSearch}
                    placeholder="Search teams"
                    onChange={(event) => setTeamSearch(event.target.value)}
                  />
                  <select
                    value={teamDraft}
                    onChange={(event) => setTeamDraft(event.target.value)}
                  >
                    <option value="">Choose team…</option>
                    {(displayedTeamSearchResults.length
                      ? displayedTeamSearchResults
                      : options?.teams ?? []
                    )
                      .filter((team) => !form.teamIds.includes(team.id))
                      .map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                  </select>
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={!teamDraft}
                    onClick={() => {
                      if (!teamDraft || form.teamIds.includes(teamDraft)) return;
                      setField("teamIds", [...form.teamIds, teamDraft]);
                      setTeamDraft("");
                    }}
                  >
                    <Plus size={15} /> Assign
                  </button>
                </div>
              </label>
              <div className="admin-team-selection">
                {selectedTeams.length ? (
                  selectedTeams.map((team) => (
                    <article key={team.id}>
                      <div>
                        <strong>{team.name}</strong>
                        <small>{team.verificationStatus}</small>
                      </div>
                      <label>
                        <input
                          type="radio"
                          name="primary-team"
                          checked={form.primaryTeamId === team.id}
                          onChange={() => setField("primaryTeamId", team.id)}
                        />
                        Primary
                      </label>
                      <button
                        type="button"
                        aria-label={`Remove ${team.name}`}
                        onClick={() => {
                          setField(
                            "teamIds",
                            form.teamIds.filter((id) => id !== team.id),
                          );
                          if (form.primaryTeamId === team.id) {
                            setField("primaryTeamId", null);
                          }
                        }}
                      >
                        <X size={16} />
                      </button>
                    </article>
                  ))
                ) : (
                  <p className="admin-inline-empty">No publishing teams assigned.</p>
                )}
              </div>
            </section>
          ) : null}

          {activeTab === "taxonomy" ? <TaxonomyManager /> : null}

          {activeTab === "media" ? (
            <section className="admin-form-section">
              <header>
                <h3>Cover and banner</h3>
                <p>Images upload through the verified storage pipeline after metadata saves successfully.</p>
              </header>
              <AdminMediaField
                label="Main cover"
                helperText="Portrait artwork used in cards and listings. JPEG, PNG, or WebP; up to 8 MB."
                recommendedDimensions="1200 × 1800 px (2:3)"
                currentUrl={form.removeCover ? null : form.coverUrl}
                file={coverFile}
                accept="image/jpeg,image/png,image/webp"
                busy={saving}
                onSelect={(file) => {
                  setCoverFile(file);
                  setField("removeCover", false);
                }}
                onRemove={() => {
                  setCoverFile(null);
                  setField("removeCover", true);
                }}
              />
              <AdminMediaField
                label="Series banner"
                helperText="Wide artwork for the public series header and promotional placements; up to 12 MB."
                recommendedDimensions="2400 × 900 px"
                currentUrl={form.removeBanner ? null : form.bannerUrl}
                file={bannerFile}
                accept="image/jpeg,image/png,image/webp"
                busy={saving}
                onSelect={(file) => {
                  setBannerFile(file);
                  setField("removeBanner", false);
                }}
                onRemove={() => {
                  setBannerFile(null);
                  setField("removeBanner", true);
                }}
              />
            </section>
          ) : null}

          {activeTab === "external" ? (
            <section className="admin-form-section">
              <header>
                <h3>External metadata import</h3>
                <p>Preview source values and apply only the fields you choose. Nothing saves automatically.</p>
              </header>
              <div className="admin-import-controls">
                <label>
                  <span>Source</span>
                  <select
                    value={importSource}
                    onChange={(event) =>
                      setImportSource(
                        event.target.value as typeof importSource,
                      )
                    }
                  >
                    <option value="MANGADEX">MangaDex</option>
                    <option value="MANGAUPDATES">MangaUpdates</option>
                  </select>
                </label>
                <label>
                  <span>
                    {importSource === "MANGADEX"
                      ? "MangaDex series URL or UUID"
                      : "MangaUpdates ID"}
                  </span>
                  <input
                    value={importInput}
                    onChange={(event) => setImportInput(event.target.value)}
                  />
                </label>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={!importInput.trim() || saving}
                  onClick={() => void previewImport()}
                >
                  <DownloadSimple size={17} />
                  {saving ? "Retrieving…" : "Preview metadata"}
                </button>
                {form.id ? (
                  <label className="admin-check-row">
                    <input
                      type="checkbox"
                      checked={forceRefresh}
                      onChange={(event) =>
                        setForceRefresh(event.target.checked)
                      }
                    />
                    Refresh from the source instead of using a valid cache
                  </label>
                ) : null}
              </div>
              {imported ? (
                <div className="admin-import-preview">
                  <header>
                    <div>
                      <strong>{imported.source}</strong>
                      <small>{imported.externalId}</small>
                    </div>
                    <span>{imported.cached ? "Cached response" : "Fresh response"}</span>
                  </header>
                  {Object.entries(imported.fields)
                    .filter(([, value]) => value !== undefined && value !== null)
                    .map(([field, value]) => (
                      <label key={field}>
                        <input
                          type="checkbox"
                          checked={importFields.has(field)}
                          onChange={(event) => {
                            setImportFields((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(field);
                              else next.delete(field);
                              return next;
                            });
                          }}
                        />
                        <span>
                          <strong>{field.replace(/([A-Z])/g, " $1")}</strong>
                          <small>
                            Current:{" "}
                            {displayImportValue(
                              (form as unknown as Record<string, unknown>)[
                                field
                              ],
                            )}
                          </small>
                          <small>
                            Imported: {displayImportValue(value)}
                          </small>
                        </span>
                      </label>
                    ))}
                  <button
                    className="button button-primary"
                    type="button"
                    disabled={!importFields.size || Boolean(importDuplicate)}
                    onClick={applyImported}
                  >
                    Apply selected fields
                  </button>
                  {importDuplicate ? (
                    <p className="admin-disabled-reason">
                      This identifier is already linked to {importDuplicate}.
                      Open that record instead of creating a duplicate.
                    </p>
                  ) : null}
                </div>
              ) : null}
              {form.externalSources.length ? (
                <div className="admin-source-list">
                  {form.externalSources.map((source) => (
                    <article key={source.source}>
                      <strong>{source.source}</strong>
                      <span>{source.externalId}</span>
                      <a href={source.sourceUrl} target="_blank" rel="noreferrer">
                        Open source
                      </a>
                    </article>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {activeTab === "visibility" ? (
            <section className="admin-form-section">
              <header>
                <h3>Visibility and publication</h3>
                <p>Publishing makes the series available through the public catalogue API.</p>
              </header>
              <div className="admin-form-grid">
                <label>
                  <span>Default chapter access</span>
                  <select
                    value={form.accessType}
                    onChange={(event) =>
                      setField(
                        "accessType",
                        event.target.value as FormState["accessType"],
                      )
                    }
                  >
                    <option value="FREE">Free</option>
                    <option value="PAID">Paid</option>
                  </select>
                </label>
                <label>
                  <span>Rights status</span>
                  <select
                    value={form.rightsStatus}
                    onChange={(event) =>
                      setField(
                        "rightsStatus",
                        event.target.value as FormState["rightsStatus"],
                      )
                    }
                  >
                    {[
                      "PENDING_REVIEW",
                      "LICENSED",
                      "AUTHORIZED",
                      "DEMO_ORIGINAL",
                      "TEST_ORIGINAL",
                      "EXPIRED",
                      "REVOKED",
                      "TAKEDOWN",
                    ].map((value) => (
                      <option key={value} value={value}>
                        {value.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="admin-toggle-row">
                <input
                  type="checkbox"
                  checked={form.isPublished}
                  onChange={(event) =>
                    setField("isPublished", event.target.checked)
                  }
                />
                <span>
                  <strong>Publish this series</strong>
                  <small>
                    Leave disabled to keep a private draft for rights and metadata review.
                  </small>
                </span>
              </label>
            </section>
          ) : null}

          {activeTab === "review" ? (
            <section className="admin-form-section">
              <header>
                <h3>Review and save</h3>
                <p>Confirm the public metadata before publishing or updating this record.</p>
              </header>
              <div className="admin-review-grid">
                <article>
                  <span>Identity</span>
                  <strong>{form.title || "Untitled series"}</strong>
                  <small>{form.type} · {form.status} · {form.publicationYear || "Year not set"}</small>
                </article>
                <article>
                  <span>Credits</span>
                  <strong>{form.authors.map((author) => author.name).join(", ") || "No authors"}</strong>
                  <small>{form.artists.map((artist) => artist.name).join(", ") || "No artists"}</small>
                </article>
                <article>
                  <span>Classification</span>
                  <strong>{form.genres.map((genre) => genre.name).join(", ") || "No genres"}</strong>
                  <small>{form.countryCode} · {form.languageCode}</small>
                </article>
                <article>
                  <span>Publication</span>
                  <strong>{form.isPublished ? "Published" : "Private draft"}</strong>
                  <small>{form.rightsStatus.replaceAll("_", " ")} · {form.accessType}</small>
                </article>
              </div>
              {!form.title || !form.slug || form.synopsis.length < 20 ? (
                <div className="admin-notice admin-notice-error" role="alert">
                  Complete the required title, slug, and synopsis before saving.
                </div>
              ) : null}
            </section>
          ) : null}

          <footer className="admin-sticky-actions">
            <div>
              <strong>{dirty ? "Unsaved changes" : "All changes saved"}</strong>
              <small>
                {form.id
                  ? `Revision ${form.revision ?? 1}`
                  : "A new series starts as a private draft unless published."}
              </small>
            </div>
            <button
              className="button button-secondary"
              type="button"
              disabled={!dirty || saving}
              onClick={() => {
                setForm(savedForm);
                setCoverFile(null);
                setBannerFile(null);
              }}
            >
              Reset changes
            </button>
            <button
              className="button button-primary"
              type="submit"
              disabled={
                saving ||
                !dirty ||
                !form.title ||
                !form.slug ||
                form.synopsis.length < 20
              }
              title={
                !dirty
                  ? "There are no changes to save."
                  : !form.title || !form.slug || form.synopsis.length < 20
                    ? "Complete the required fields first."
                    : undefined
              }
            >
              {saving ? "Saving…" : form.isPublished ? "Save & publish" : "Save draft"}
            </button>
          </footer>
        </form>
      </div>
    </AdminPageScaffold>
  );
}
