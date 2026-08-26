"use client";
import { UnifiedSingleSelect } from "@/components/nyascans/UnifiedSingleSelect";
/* eslint-disable @next/next/no-img-element */

import {
  ArrowClockwise,
  Books,
  CaretLeft,
  CaretRight,
  Check,
  DownloadSimple,
  ImageSquare,
  MagnifyingGlass,
  Plus,
  SlidersHorizontal,
  X,
} from "@/components/nyascans/heroicons";
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AdminMediaField } from "@/components/nyascans/admin/AdminMediaField";
import {
  AdminCombobox,
  AdminFormField,
  AdminPageScaffold,
  AdminSectionCard,
  ConfirmActionDialog,
  useUnsavedChanges,
} from "@/components/nyascans/admin/AdminPageScaffold";
import { TaxonomyManager } from "@/components/nyascans/admin/TaxonomyManager";
import { SeriesGalleryModerationPanel } from "@/components/nyascans/admin/SeriesGalleryModerationPanel";

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
  status:
    | "ONGOING"
    | "COMPLETED"
    | "HIATUS"
    | "PAUSED"
    | "CANCELLED"
    | "UPCOMING";
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
  sliderUrl: string | null;
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
    status?:
      | "ONGOING"
      | "COMPLETED"
      | "HIATUS"
      | "PAUSED"
      | "CANCELLED"
      | "UPCOMING";
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
  sliderUrl: string | null;
  removeCover: boolean;
  removeBanner: boolean;
  removeSlider: boolean;
};

const seriesEditorTabs = [
  { key: "basic", label: "Basic Information" },
  { key: "titles", label: "Titles & Synopsis" },
  { key: "credits", label: "Credits & Publishing" },
  { key: "origin", label: "Origin & Classification" },
  { key: "teams", label: "Publishing Teams" },
  { key: "taxonomy", label: "Taxonomy" },
  { key: "artwork", label: "Cover, Banner & Slider Artwork" },
  { key: "import", label: "External Metadata Import" },
  { key: "visibility", label: "Visibility & Publication" },
  { key: "review", label: "Review & Save" },
] as const;

type SeriesEditorTab = (typeof seriesEditorTabs)[number]["key"];

const publishableRights: ReadonlySet<FormState["rightsStatus"]> = new Set([
  "LICENSED",
  "AUTHORIZED",
  "DEMO_ORIGINAL",
  "TEST_ORIGINAL",
]);

const emptyForm: FormState = {
  title: "",
  slug: "",
  alternativeTitles: [],
  synopsis: "",
  type: "MANGA",
  status: "ONGOING",
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
  sliderUrl: null,
  removeCover: false,
  removeBanner: false,
  removeSlider: false,
};

function freshEmptyForm(): FormState {
  return {
    ...emptyForm,
    alternativeTitles: [],
    authors: [],
    artists: [],
    genres: [],
    teamIds: [],
    externalSources: [],
  };
}

function slugFromTitle(title: string) {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function providerFromImportInput(value: string) {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLocaleLowerCase("en-US").replace(/^www\./u, "");
    if (host === "mangadex.org") return "MANGADEX" as const;
    if (host === "mangaupdates.com") return "MANGAUPDATES" as const;
  } catch {
    // A title or numeric ID has no provider host to detect.
  }
  return null;
}

async function api<T>(response: Response) {
  const responseText = await response.text();
  let payload = {} as T & {
    error?: {
      code?: string;
      message?: string;
      fields?: Array<{ path: string; message: string }>;
      requestId?: string;
      details?: { retryable?: boolean } | null;
    };
  };
  if (responseText) {
    try {
      payload = JSON.parse(responseText) as typeof payload;
    } catch {
      if (response.ok) {
        throw new Error("The server returned an unreadable response.");
      }
    }
  }
  if (!response.ok) {
    const fieldMessage = payload.error?.fields?.[0]?.message;
    const requestId =
      payload.error?.requestId ?? response.headers.get("x-request-id") ?? "";
    const error = new Error(
      `${fieldMessage ?? payload.error?.message ?? `The request failed with HTTP ${response.status}.`}${requestId ? ` Reference: ${requestId}.` : ""}`,
    ) as Error & {
      code?: string;
      status?: number;
      requestId?: string;
      retryable?: boolean;
    };
    error.code = payload.error?.code;
    error.status = response.status;
    error.requestId = requestId;
    error.retryable = Boolean(payload.error?.details?.retryable);
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
    sliderUrl: record.sliderUrl,
    removeCover: false,
    removeBanner: false,
    removeSlider: false,
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
        <div className="admin-inline-field admin-entity-input-row">
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

export function SeriesManagementPanel({
  initialMode = "browse",
  onNavigateToCreate,
}: {
  initialMode?: "browse" | "create";
  onNavigateToCreate?: () => void;
}) {
  const [mode, setMode] = useState<"browse" | "create">(initialMode);
  const modeRef = useRef<"browse" | "create">(initialMode);
  const previousInitialModeRef = useRef(initialMode);
  const [creationEntry, setCreationEntry] = useState<
    ImportedData["source"] | "SCRATCH" | null
  >(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [records, setRecords] = useState<SeriesRecord[]>([]);
  const [options, setOptions] = useState<Options | null>(null);
  const [form, setForm] = useState<FormState>(() => freshEmptyForm());
  const [savedForm, setSavedForm] = useState<FormState>(() => freshEmptyForm());
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
  const [sliderFile, setSliderFile] = useState<File | null>(null);
  const [importSource, setImportSource] =
    useState<"MANGADEX" | "MANGAUPDATES">("MANGADEX");
  const [importInput, setImportInput] = useState("");
  const [imported, setImported] = useState<ImportedData | null>(null);
  const [pendingImportedCover, setPendingImportedCover] =
    useState<ImportedData | null>(null);
  const [importPreviews, setImportPreviews] = useState<
    Partial<Record<ImportedData["source"], ImportedData>>
  >({});
  const [importDuplicate, setImportDuplicate] = useState<string | null>(null);
  const [importPreviewDuplicates, setImportPreviewDuplicates] = useState<
    Partial<Record<ImportedData["source"], string>>
  >({});
  const [importConflictChoices, setImportConflictChoices] = useState<
    Record<string, ImportedData["source"]>
  >({});
  const [forceRefresh, setForceRefresh] = useState(false);
  const [importFields, setImportFields] = useState<Set<string>>(new Set());
  const [importApplied, setImportApplied] = useState(false);
  const [activeEditorTab, setActiveEditorTab] =
    useState<SeriesEditorTab>("basic");
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    destructive?: boolean;
    run(): void;
  } | null>(null);
  const metadataDirty = JSON.stringify(form) !== JSON.stringify(savedForm);
  const mediaDirty = Boolean(coverFile || bannerFile || sliderFile);
  const dirty =
    metadataDirty || mediaDirty ||
    Boolean(imported && importApplied);
  useUnsavedChanges(dirty, "series changes");

  function clearTransientState() {
    setAltDraft("");
    setAltEditIndex(null);
    setAltEditValue("");
    setTeamDraft("");
    setTeamSearch("");
    setTeamSearchResults([]);
    setCoverFile(null);
    setBannerFile(null);
    setSliderFile(null);
    setCreationEntry(null);
    setImportSource("MANGADEX");
    setImportInput("");
    setImported(null);
    setPendingImportedCover(null);
    setImportPreviews({});
    setImportDuplicate(null);
    setImportPreviewDuplicates({});
    setImportConflictChoices({});
    setForceRefresh(false);
    setImportFields(new Set());
    setImportApplied(false);
    setActiveEditorTab("basic");
  }

  function beginCreate(
    notifyNavigation = false,
    entry: ImportedData["source"] | "SCRATCH" | null = null,
    confirmedDiscard = false,
  ) {
    if (dirty && !confirmedDiscard) {
      setPendingConfirmation({
        title: "Discard unsaved series changes?",
        description:
          "The current series edits and selected media will be cleared before the new draft opens.",
        confirmLabel: "Discard and add series",
        run: () => beginCreate(notifyNavigation, entry, true),
      });
      return;
    }
    const next = freshEmptyForm();
    modeRef.current = "create";
    setMode("create");
    setForm(next);
    setSavedForm(freshEmptyForm());
    clearTransientState();
    setCreationEntry(entry);
    setMessage(null);
    if (notifyNavigation) onNavigateToCreate?.();
  }

  function returnToBrowse(confirmedDiscard = false) {
    if (dirty && !confirmedDiscard) {
      setPendingConfirmation({
        title: "Discard this new series draft?",
        description:
          "All unsaved metadata, provider choices, and selected artwork in this draft will be cleared.",
        confirmLabel: "Discard draft",
        run: () => returnToBrowse(true),
      });
      return;
    }
    modeRef.current = "browse";
    setMode("browse");
    const next = records[0] ? fromRecord(records[0]) : freshEmptyForm();
    setForm(next);
    setSavedForm(records[0] ? fromRecord(records[0]) : freshEmptyForm());
    clearTransientState();
    setMessage(null);
  }

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
      if (
        modeRef.current === "browse" &&
        !form.id &&
        seriesPayload.data[0]
      ) {
        const next = fromRecord(seriesPayload.data[0]);
        setForm(next);
        setSavedForm(next);
      }
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
          setSliderFile(null);
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
    if (previousInitialModeRef.current === initialMode) return;
    previousInitialModeRef.current = initialMode;
    const timer = window.setTimeout(() => {
      if (initialMode === "create") {
        const next = freshEmptyForm();
        modeRef.current = "create";
        setMode("create");
        setForm(next);
        setSavedForm(freshEmptyForm());
      } else {
        const next = records[0] ? fromRecord(records[0]) : freshEmptyForm();
        modeRef.current = "browse";
        setMode("browse");
        setForm(next);
        setSavedForm(records[0] ? fromRecord(records[0]) : freshEmptyForm());
      }
      clearTransientState();
      setMessage(null);
    }, 0);
    return () => window.clearTimeout(timer);
    // The navigation prop is the trigger; records intentionally use the current snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMode]);

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
  function selectRecord(record: SeriesRecord, confirmedDiscard = false) {
    if (dirty && !confirmedDiscard) {
      setPendingConfirmation({
        title: "Discard unsaved series changes?",
        description: `Open ${record.title} and clear the current unsaved edits and selected media.`,
        confirmLabel: "Discard and open",
        run: () => selectRecord(record, true),
      });
      return;
    }
    const next = fromRecord(record);
    modeRef.current = "browse";
    setMode("browse");
    setForm(next);
    setSavedForm(next);
    clearTransientState();
    setMessage(null);
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

  async function save(event?: FormEvent, publishOverride?: boolean) {
    event?.preventDefault();
    const creating = !form.id;
    const workingForm =
      publishOverride === undefined
        ? form
        : { ...form, isPublished: publishOverride };
    if (workingForm.isPublished && !publishableRights.has(workingForm.rightsStatus)) {
      setMessage({
        kind: "error",
        text: "Publishing is unavailable until Rights status is Licensed, Authorized, Demo Original, or Test Original. Save as a draft first, or update the rights status before publishing.",
      });
      return;
    }
    if (
      modeRef.current === "create" &&
      unresolvedImportConflicts.length > 0
    ) {
      setMessage({
        kind: "error",
        text: `Choose a MangaDex or MangaUpdates value for all ${unresolvedImportConflicts.length.toLocaleString()} unresolved provider ${unresolvedImportConflicts.length === 1 ? "difference" : "differences"} before saving or publishing.`,
      });
      return;
    }
    if (
      !workingForm.title.trim() ||
      !workingForm.slug.trim() ||
      workingForm.synopsis.trim().length < 20
    ) {
      setMessage({
        kind: "error",
        text: "Complete the required title, slug, and synopsis before saving.",
      });
      return;
    }
    setSaving(true);
    setMessage(null);
    let persistedRecord: SeriesRecord | null = null;
    let metadataPersisted = false;
    let mediaAttempted = false;
    let saveStage = "series metadata";
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
      const importedCover =
        pendingImportedCover &&
        importApplied &&
        pendingImportedCover.fields.coverReferenceUrl &&
        !coverFile
          ? pendingImportedCover
          : null;
      const selectedRecord = form.id
        ? records.find((record) => record.id === form.id) ?? null
        : null;
      if (!creating && !selectedRecord) {
        throw new Error("Reload this series before saving changes.");
      }
      let current: SeriesRecord | null = selectedRecord;
      const metadataNeedsSave =
        creating ||
        JSON.stringify(workingForm) !== JSON.stringify(savedForm);
      if (metadataDirty) {
        saveStage = creating ? "new series metadata" : "series metadata";
      }
      if (metadataNeedsSave) {
        const requestId = crypto.randomUUID();
        const saved = await fetch("/api/v1/admin/series-management", {
          method: form.id ? "PUT" : "POST",
          headers: {
            "content-type": "application/json",
            "x-request-id": requestId,
          },
          body: JSON.stringify({
            ...workingForm,
            publicationYear: workingForm.publicationYear
              ? Number(workingForm.publicationYear)
              : null,
            coverUrl: undefined,
            bannerUrl: undefined,
            sliderUrl: undefined,
            externalSources: workingForm.externalSources,
            importApplied,
          }),
        }).then((response) =>
          api<{ data: SeriesRecord }>(response),
        );
        current = saved.data;
        persistedRecord = current;
        metadataPersisted = true;
        applyPersistedRecord(current);
        if (creating) {
          setTotal((value) => value + 1);
        }
      }
      if (!current) throw new Error("Save the series metadata before adding artwork.");
      if (importedCover) {
        mediaAttempted = true;
        saveStage = "imported cover";
        const requestId = crypto.randomUUID();
        const media = await fetch("/api/v1/admin/series-media", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-request-id": requestId,
          },
          body: JSON.stringify({
            seriesId: current.id,
            revision: current.revision,
            source: importedCover.source,
            externalId: importedCover.externalId,
            responseHash: importedCover.responseHash,
          }),
        }).then((response) =>
          api<{ data: { revision: number; url: string } }>(response),
        );
        current = {
          ...current,
          revision: media.data.revision,
          coverUrl: media.data.url,
        };
        persistedRecord = current;
        applyPersistedRecord(current);
        setPendingImportedCover(null);
      }
      for (const [slot, file] of [
        ["cover", coverFile] as const,
        ["banner", bannerFile] as const,
        ["slider", sliderFile] as const,
      ]) {
        if (!file) continue;
        mediaAttempted = true;
        saveStage = `${slot} upload`;
        const upload = new FormData();
        upload.set("seriesId", current.id);
        upload.set("slot", slot);
        upload.set("revision", String(current.revision));
        upload.set("file", file);
        const media = await fetch("/api/v1/admin/series-media", {
          method: "PUT",
          headers: { "x-request-id": crypto.randomUUID() },
          body: upload,
        }).then((response) =>
          api<{ data: { revision: number; url: string } }>(response),
        );
        current = {
          ...current,
          revision: media.data.revision,
          [
            slot === "cover"
              ? "coverUrl"
              : slot === "banner"
                ? "bannerUrl"
                : "sliderUrl"
          ]: media.data.url,
        };
        persistedRecord = current;
        applyPersistedRecord(current);
        if (slot === "cover") setCoverFile(null);
        else if (slot === "banner") setBannerFile(null);
        else setSliderFile(null);
      }
      setImportApplied(false);
      setImported(null);
      setPendingImportedCover(null);
      setImportPreviews({});
      setImportDuplicate(null);
      setImportPreviewDuplicates({});
      setImportConflictChoices({});
      setImportFields(new Set());
      setImportInput("");
      setCreationEntry(null);
      if (modeRef.current === "create") {
        modeRef.current = "browse";
        setMode("browse");
      }
      setMessage({
        kind: "success",
        text: workingForm.isPublished
          ? `${current.title} was published successfully.`
          : `${current.title} was saved as a draft.`,
      });
    } catch (error) {
      if (persistedRecord || mediaAttempted) {
        if (persistedRecord) applyPersistedRecord(persistedRecord);
        setMessage({
          kind: "error",
          text: `${metadataPersisted ? "Series metadata was saved, but the" : "The"} ${saveStage} failed: ${
            error instanceof Error ? error.message : "retry the remaining image"
          }${metadataPersisted ? " The saved metadata and revision were retained." : ""}`,
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
    const detectedSource = providerFromImportInput(importInput);
    const requestSource = detectedSource ?? importSource;
    if (detectedSource && detectedSource !== importSource) {
      setImportSource(detectedSource);
      setCreationEntry(detectedSource);
    }
    setSaving(true);
    setMessage(null);
    try {
      const payload = await fetch("/api/v1/admin/metadata-import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: requestSource,
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
      setImportPreviews((current) => ({
        ...current,
        [payload.data.source]: payload.data,
      }));
      // A refreshed provider preview can change the disagreement set. Require
      // an explicit choice for every current conflict instead of carrying a
      // stale choice forward from an older response.
      setImportConflictChoices({});
      setImportDuplicate(payload.duplicate?.title ?? null);
      setImportPreviewDuplicates((current) => {
        const next = { ...current };
        if (payload.duplicate?.title) {
          next[payload.data.source] = payload.duplicate.title;
        } else {
          delete next[payload.data.source];
        }
        return next;
      });
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
          : `Metadata preview loaded from ${payload.data.source === "MANGADEX" ? "MangaDex" : "MangaUpdates"}${payload.data.cached ? " cache" : ""}. Choose which values to apply.`,
      });
    } catch (error) {
      setMessage({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : `Metadata could not be imported from ${requestSource === "MANGADEX" ? "MangaDex" : "MangaUpdates"}.`,
      });
    } finally {
      setSaving(false);
    }
  }

  function applyImported(
    candidate: ImportedData | null = imported,
    selectedFields: Set<string> = importFields,
    duplicateTitle: string | null = importDuplicate,
    updateCoverSelection = true,
  ) {
    if (!candidate || duplicateTitle) return;
    const fields = candidate.fields;
    setForm((current) => {
      const next = { ...current };
      for (const field of selectedFields) {
        if (field === "title" && fields.title) {
          next.title = fields.title;
          if (!next.slug) next.slug = slugFromTitle(fields.title);
        }
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
          (source) => source.source !== candidate.source,
        ),
        {
          source: candidate.source,
          externalId: candidate.externalId,
          sourceUrl: candidate.sourceUrl,
          responseHash: candidate.responseHash,
        },
      ];
      return next;
    });
    setImported(candidate);
    if (updateCoverSelection) {
      setPendingImportedCover(
        selectedFields.has("coverReferenceUrl") &&
          candidate.fields.coverReferenceUrl
          ? candidate
          : null,
      );
    }
    setImportDuplicate(null);
    setImportFields(new Set(selectedFields));
    setMessage({
      kind: "success",
      text: `${candidate.source === "MANGADEX" ? "MangaDex" : "MangaUpdates"} values were applied locally. Review them, then save as a draft or publish.`,
    });
    setImportApplied(true);
  }

  function applyImportPreview(candidate: ImportedData) {
    const conflictingFields = new Set(importConflicts.map(({ field }) => field));
    const fields = new Set(
      Object.entries(candidate.fields)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key]) => key)
        .filter((field) => !conflictingFields.has(field)),
    );
    applyImported(
      candidate,
      fields,
      importPreviewDuplicates[candidate.source] ?? null,
      !conflictingFields.has("coverReferenceUrl"),
    );
    if (conflictingFields.size) {
      setMessage({
        kind: "neutral",
        text: "Non-conflicting values were applied. Compare the provider differences below and choose each value before publishing.",
      });
    }
  }

  const selectedTeams = useMemo(
    () =>
      form.teamIds
        .map((id) => options?.teams.find((team) => team.id === id))
        .filter((team): team is TeamOption => Boolean(team)),
    [form.teamIds, options],
  );
  const assignableTeamOptions = useMemo(() => {
    const candidates =
      teamSearch.trim() && teamSearchResults.length
        ? teamSearchResults
        : options?.teams ?? [];
    return candidates
      .filter((team) => !form.teamIds.includes(team.id))
      .map((team) => ({
        value: team.id,
        label: team.name,
        description: team.verificationStatus,
      }));
  }, [form.teamIds, options, teamSearch, teamSearchResults]);

  function chooseTeamDraft(teamId: string) {
    setTeamDraft(teamId);
    if (teamId) {
      setTeamSearch("");
      setTeamSearchResults([]);
    }
  }

  function captureTeamSearch(event: FormEvent<HTMLDivElement>) {
    const target = event.target;
    if (
      target instanceof HTMLInputElement &&
      target.getAttribute("role") === "combobox"
    ) {
      setTeamDraft("");
      setTeamSearch(target.value);
    }
  }

  function chooseImportSource(source: ImportedData["source"]) {
    setCreationEntry(source);
    setImportSource(source);
    setImportInput("");
    const preview = importPreviews[source] ?? null;
    setImported(preview);
    setImportDuplicate(importPreviewDuplicates[source] ?? null);
    setImportFields(
      new Set(
        preview
          ? Object.entries(preview.fields)
              .filter(([, value]) => value !== undefined && value !== null)
              .map(([key]) => key)
          : [],
      ),
    );
    window.setTimeout(() => importInputRef.current?.focus(), 0);
  }

  function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    const submitter = (event.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    void save(event, submitter?.value === "publish");
  }

  const visibleImportPreviews = (
    ["MANGADEX", "MANGAUPDATES"] as const
  )
    .map((source) => importPreviews[source])
    .filter((candidate): candidate is ImportedData => Boolean(candidate));
  const mangaDexPreview = importPreviews.MANGADEX;
  const mangaUpdatesPreview = importPreviews.MANGAUPDATES;
  const importConflicts =
    mangaDexPreview && mangaUpdatesPreview
      ? Object.keys(mangaDexPreview.fields)
          .filter((field) => {
            const mangaDexValue = (
              mangaDexPreview.fields as Record<string, unknown>
            )[field];
            const mangaUpdatesValue = (
              mangaUpdatesPreview.fields as Record<string, unknown>
            )[field];
            return (
              mangaDexValue !== undefined &&
              mangaDexValue !== null &&
              mangaUpdatesValue !== undefined &&
              mangaUpdatesValue !== null &&
              JSON.stringify(mangaDexValue) !==
                JSON.stringify(mangaUpdatesValue)
            );
          })
          .map((field) => ({
            field,
            mangaDexValue: (
              mangaDexPreview.fields as Record<string, unknown>
            )[field],
            mangaUpdatesValue: (
              mangaUpdatesPreview.fields as Record<string, unknown>
            )[field],
          }))
      : [];
  const unresolvedImportConflicts = importConflicts.filter(
    ({ field }) => !importConflictChoices[field],
  );
  const hasUnresolvedProviderConflicts =
    mode === "create" && unresolvedImportConflicts.length > 0;

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
      breadcrumbs={
        mode === "create"
          ? ["Catalog", "Series", "Add Series"]
          : ["Catalog", "Series"]
      }
      kicker={mode === "create" ? "Catalog creation" : "Catalog control"}
      title={mode === "create" ? "Add Series" : "Series"}
      description={
        mode === "create"
          ? "Import a trusted match or enter the essentials manually, then review everything on this page before saving."
          : "Select and edit an existing series, including canonical credits, publishing teams, media, and external metadata."
      }
      primaryAction={
        mode === "create" ? (
          <button
            className="button button-secondary"
            type="button"
            onClick={() => returnToBrowse()}
          >
            <CaretLeft size={16} /> Back to series
          </button>
        ) : (
          <button
            className="button button-primary"
            type="button"
            onClick={() => beginCreate(true)}
          >
            + Add Series
          </button>
        )
      }
      state={state}
      message={message}
    >
      {mode === "create" ? (
        <form className="series-create-page" onSubmit={handleCreateSubmit}>
          <AdminSectionCard
            icon={<DownloadSimple size={16} />}
            title="Choose how to begin"
            summary="Find a provider match first, or clear the page for a fully manual entry. Importing never publishes automatically."
          >
            <div className="series-create-entry-grid">
              <button
                className="series-create-entry-card"
                type="button"
                aria-pressed={creationEntry === "MANGADEX"}
                onClick={() => chooseImportSource("MANGADEX")}
              >
                <DownloadSimple size={20} />
                <strong>Import from MangaDex</strong>
                <span>Search by title or use an official title URL.</span>
              </button>
              <button
                className="series-create-entry-card"
                type="button"
                aria-pressed={creationEntry === "MANGAUPDATES"}
                onClick={() => chooseImportSource("MANGAUPDATES")}
              >
                <DownloadSimple size={20} />
                <strong>Import from MangaUpdates</strong>
                <span>Search by title or use an official series URL.</span>
              </button>
              <button
                className="series-create-entry-card"
                type="button"
                aria-pressed={creationEntry === "SCRATCH"}
                onClick={() => beginCreate(false, "SCRATCH")}
              >
                <Plus size={20} />
                <strong>Start from scratch</strong>
                <span>Clear imported and entered values for manual creation.</span>
              </button>
            </div>

            {creationEntry === "MANGADEX" ||
            creationEntry === "MANGAUPDATES" ? (
            <div className="series-create-import-search">
              <label>
                <span>
                  {importSource === "MANGADEX"
                    ? "MangaDex title or URL"
                    : "MangaUpdates title or URL"}
                </span>
                <div className="admin-inline-field">
                  <input
                    ref={importInputRef}
                    value={importInput}
                    placeholder={
                      importSource === "MANGADEX"
                        ? "Search by title or paste a MangaDex URL"
                        : "Search by title or paste a MangaUpdates URL"
                    }
                    onChange={(event) => setImportInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        if (importInput.trim() && !saving) void previewImport();
                      }
                    }}
                  />
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={!importInput.trim() || saving}
                    onClick={() => void previewImport()}
                  >
                    <MagnifyingGlass size={16} />
                    {saving ? "Searching…" : "Find match"}
                  </button>
                </div>
              </label>
            </div>
            ) : null}

            {visibleImportPreviews.length ? (
              <div className="series-create-result-grid" aria-live="polite">
                {visibleImportPreviews.map((candidate) => {
                  const duplicateTitle =
                    importPreviewDuplicates[candidate.source] ?? null;
                  return (
                    <article
                      className="series-create-result-card"
                      key={`${candidate.source}-${candidate.externalId}`}
                    >
                      <span className="series-create-result-cover">
                        {candidate.fields.coverReferenceUrl ? (
                          <img
                            src={candidate.fields.coverReferenceUrl}
                            alt=""
                          />
                        ) : (
                          <Books size={20} />
                        )}
                      </span>
                      <div>
                        <small>
                          {candidate.source === "MANGADEX"
                            ? "MangaDex"
                            : "MangaUpdates"}
                          {candidate.cached ? " · Cached" : " · Fresh"}
                        </small>
                        <strong>
                          {candidate.fields.title ?? candidate.externalId}
                        </strong>
                        <span>
                          {candidate.fields.status
                            ? candidate.fields.status.replaceAll("_", " ")
                            : "Status not supplied"}
                        </span>
                      </div>
                      <button
                        className="button button-primary"
                        type="button"
                        disabled={Boolean(duplicateTitle)}
                        onClick={() => applyImportPreview(candidate)}
                      >
                        Use this
                      </button>
                      {duplicateTitle ? (
                        <p className="admin-disabled-reason">
                          Already linked to {duplicateTitle}.
                        </p>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : null}

            {importConflicts.length ? (
              <section className="series-create-conflicts">
                <header>
                  <strong>Resolve provider differences</strong>
                  <p>
                    Both sources supplied different values. Choose each field
                    explicitly; no conflicting value is applied silently.
                  </p>
                </header>
                <p
                  id="series-create-conflict-status"
                  className={`series-create-conflict-status ${
                    unresolvedImportConflicts.length ? "is-pending" : "is-resolved"
                  }`}
                  role="status"
                >
                  {unresolvedImportConflicts.length
                    ? `${unresolvedImportConflicts.length.toLocaleString()} of ${importConflicts.length.toLocaleString()} provider ${importConflicts.length === 1 ? "difference still needs" : "differences still need"} an explicit choice before this series can be saved or published.`
                    : `All ${importConflicts.length.toLocaleString()} provider ${importConflicts.length === 1 ? "difference is" : "differences are"} resolved.`}
                </p>
                <div>
                  {importConflicts.map(
                    ({ field, mangaDexValue, mangaUpdatesValue }) => (
                      <article key={field}>
                        <span>{field.replace(/([A-Z])/g, " $1")}</span>
                        <button
                          type="button"
                          aria-pressed={
                            importConflictChoices[field] === "MANGADEX"
                          }
                          disabled={Boolean(
                            importPreviewDuplicates.MANGADEX,
                          )}
                          onClick={() => {
                            if (!mangaDexPreview) return;
                            applyImported(
                              mangaDexPreview,
                              new Set([field]),
                              importPreviewDuplicates.MANGADEX ?? null,
                              field === "coverReferenceUrl",
                            );
                            setImportConflictChoices((current) => ({
                              ...current,
                              [field]: "MANGADEX",
                            }));
                          }}
                        >
                          <small>MangaDex</small>
                          <strong>
                            {field === "coverReferenceUrl"
                              ? "Use MangaDex cover"
                              : displayImportValue(mangaDexValue)}
                          </strong>
                        </button>
                        <button
                          type="button"
                          aria-pressed={
                            importConflictChoices[field] === "MANGAUPDATES"
                          }
                          disabled={Boolean(
                            importPreviewDuplicates.MANGAUPDATES,
                          )}
                          onClick={() => {
                            if (!mangaUpdatesPreview) return;
                            applyImported(
                              mangaUpdatesPreview,
                              new Set([field]),
                              importPreviewDuplicates.MANGAUPDATES ?? null,
                              field === "coverReferenceUrl",
                            );
                            setImportConflictChoices((current) => ({
                              ...current,
                              [field]: "MANGAUPDATES",
                            }));
                          }}
                        >
                          <small>MangaUpdates</small>
                          <strong>
                            {field === "coverReferenceUrl"
                              ? "Use MangaUpdates cover"
                              : displayImportValue(mangaUpdatesValue)}
                          </strong>
                        </button>
                      </article>
                    ),
                  )}
                </div>
              </section>
            ) : null}
          </AdminSectionCard>

          <div className="series-create-columns">
            <div className="series-create-column">
              <AdminSectionCard
                icon={<ImageSquare size={16} />}
                title="Artwork & at a glance"
                summary="The visual identity and facts an editor needs to scan quickly."
              >
                <AdminMediaField
                  label="Main cover"
                  helperText="Portrait artwork used in cards and listings. JPEG, PNG, or WebP; up to 8 MB."
                  recommendedDimensions="1200 × 1800 px (2:3)"
                  currentUrl={form.removeCover ? null : form.coverUrl}
                  file={coverFile}
                  accept="image/jpeg,image/png,image/webp"
                  cropProfile={{
                    aspect: 2 / 3,
                    outputWidth: 1200,
                    outputHeight: 1800,
                    maxBytes: 3_000_000,
                  }}
                  busy={saving}
                  onSelect={(file) => {
                    setCoverFile(file);
                    setField("removeCover", false);
                  }}
                  onRemove={() => {
                    if (coverFile) {
                      setCoverFile(null);
                      setField("removeCover", false);
                    } else {
                      setField("removeCover", true);
                    }
                  }}
                />
                <AdminMediaField
                  label="Series banner"
                  helperText="Wide artwork for the public series header and promotional placements; up to 12 MB."
                  recommendedDimensions="2400 × 900 px"
                  currentUrl={form.removeBanner ? null : form.bannerUrl}
                  file={bannerFile}
                  accept="image/jpeg,image/png,image/webp"
                  cropProfile={{
                    aspect: 8 / 3,
                    outputWidth: 2400,
                    outputHeight: 900,
                    maxBytes: 4_000_000,
                  }}
                  busy={saving}
                  onSelect={(file) => {
                    setBannerFile(file);
                    setField("removeBanner", false);
                  }}
                  onRemove={() => {
                    if (bannerFile) {
                      setBannerFile(null);
                      setField("removeBanner", false);
                    } else {
                      setField("removeBanner", true);
                    }
                  }}
                />
                <div className="series-create-fact-grid">
                  <label>
                    <span>Status</span>
                    <UnifiedSingleSelect
                      value={form.status}
                      onChange={(event) =>
                        setField(
                          "status",
                          event.target.value as FormState["status"],
                        )
                      }
                    >
                      <option value="ONGOING">Ongoing</option>
                      <option value="COMPLETED">Completed</option>
                      <option value="HIATUS">Hiatus</option>
                      <option value="PAUSED">Paused</option>
                      <option value="CANCELLED">Cancelled</option>
                      <option value="UPCOMING">Upcoming</option>
                    </UnifiedSingleSelect>
                  </label>
                  <label>
                    <span>Type</span>
                    <UnifiedSingleSelect
                      value={form.type}
                      onChange={(event) =>
                        setField(
                          "type",
                          event.target.value as FormState["type"],
                        )
                      }
                    >
                      <option value="MANGA">Manga</option>
                      <option value="MANHWA">Manhwa</option>
                      <option value="MANHUA">Manhua</option>
                    </UnifiedSingleSelect>
                  </label>
                  <label>
                    <span>Original language</span>
                    <AdminCombobox
                      ariaLabel="Original language"
                      value={form.languageCode}
                      options={(options?.languages ?? []).map((language) => ({
                        value: language.code,
                        label: language.name,
                        description: language.code,
                      }))}
                      onChange={(languageCode) =>
                        setField("languageCode", languageCode)
                      }
                    />
                  </label>
                  <label>
                    <span>Country of origin</span>
                    <AdminCombobox
                      ariaLabel="Country of origin"
                      value={form.countryCode}
                      options={(options?.countries ?? []).map((country) => ({
                        value: country.code,
                        label: country.name,
                        description: country.code,
                      }))}
                      onChange={(countryCode) => {
                        const suggested =
                          options?.countryLanguageDefaults[countryCode];
                        setForm((current) => ({
                          ...current,
                          countryCode,
                          languageCode:
                            suggested && !current.languageCode
                              ? suggested
                              : current.languageCode,
                          }));
                      }}
                    />
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
                </div>
              </AdminSectionCard>
            </div>

            <div className="series-create-column">
              <AdminSectionCard
                icon={<Books size={16} />}
                title="Core metadata"
                summary="The public title, description, classification, credits, and responsible team."
              >
                <div className="series-create-identity-grid">
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
                          slug: current.slug
                            ? current.slug
                            : slugFromTitle(title),
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
                </div>

                <div className="admin-entity-field">
                  <label>
                    <span>Alternative titles</span>
                    <div className="admin-inline-field">
                      <input
                        value={altDraft}
                        placeholder="Type titles separated by commas"
                        onChange={(event) => setAltDraft(event.target.value)}
                        onKeyDown={(event) => {
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
                        form.alternativeTitles.filter(
                          (_, item) => item !== index,
                        ),
                      )
                    }
                  />
                </div>

                <label>
                  <span>Synopsis <b>Required</b></span>
                  <textarea
                    required
                    minLength={20}
                    maxLength={10_000}
                    rows={10}
                    value={form.synopsis}
                    onChange={(event) =>
                      setField("synopsis", event.target.value)
                    }
                  />
                  <small>{form.synopsis.length.toLocaleString()} / 10,000</small>
                </label>

                <EntityInput
                  label="Genres & Tags"
                  values={form.genres}
                  suggestions={options?.genres ?? []}
                  suggestionKind="genres"
                  onChange={(genres) => setField("genres", genres)}
                />
                <div className="series-create-credit-grid">
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
                </div>
                <EntityInput
                  label="Original publisher or studio"
                  values={form.publisher ? [form.publisher] : []}
                  suggestions={options?.publishers ?? []}
                  suggestionKind="publishers"
                  multiple={false}
                  createLabel="Select"
                  onChange={(publishers) =>
                    setField("publisher", publishers[0] ?? null)
                  }
                />

                <div className="series-create-team-picker">
                  <AdminFormField label="Assigned publishing team">
                    <div
                      className="admin-inline-field"
                      onChangeCapture={captureTeamSearch}
                    >
                      <AdminCombobox
                        value={teamDraft}
                        options={assignableTeamOptions}
                        ariaLabel="Search and choose a publishing team"
                        placeholder="Search eligible teams…"
                        onChange={chooseTeamDraft}
                      />
                      <button
                        className="button button-secondary"
                        type="button"
                        disabled={!teamDraft}
                        onClick={() => {
                          if (
                            !teamDraft ||
                            form.teamIds.includes(teamDraft)
                          ) return;
                          setField("teamIds", [
                            ...form.teamIds,
                            teamDraft,
                          ]);
                          setTeamDraft("");
                        }}
                      >
                        <Plus size={15} /> Assign
                      </button>
                    </div>
                  </AdminFormField>
                  <div className="admin-team-selection admin-team-picker">
                    {selectedTeams.length ? (
                      selectedTeams.map((team) => (
                        <article className="admin-team-row" key={team.id}>
                          <div className="admin-team-identity">
                            <strong>{team.name}</strong>
                            <small>{team.verificationStatus}</small>
                          </div>
                          <label className="admin-team-primary">
                            <input
                              type="radio"
                              name="new-primary-team"
                              checked={form.primaryTeamId === team.id}
                              onChange={() =>
                                setField("primaryTeamId", team.id)
                              }
                            />
                            Primary
                          </label>
                          <button
                            type="button"
                            aria-label={`Remove ${team.name}`}
                            onClick={() => {
                              setField(
                                "teamIds",
                                form.teamIds.filter(
                                  (id) => id !== team.id,
                                ),
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
                      <p className="admin-inline-empty">
                        No publishing teams assigned.
                      </p>
                    )}
                  </div>
                </div>
              </AdminSectionCard>
            </div>
          </div>

          <details className="admin-section-card is-collapsible series-create-advanced">
            <summary>
              <span className="admin-section-card-heading">
                <span aria-hidden="true">
                  <SlidersHorizontal size={16} />
                </span>
                <span>
                  <strong>Advanced details</strong>
                  <small>
                    Rights, access defaults, provider attribution, and optional
                    featured artwork.
                  </small>
                </span>
              </span>
            </summary>
            <div className="admin-section-card-content">
            <div className="series-create-advanced-grid">
              <label>
                <span>Reading direction</span>
                <UnifiedSingleSelect
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
                </UnifiedSingleSelect>
              </label>
              <label>
                <span>Default chapter access</span>
                <UnifiedSingleSelect
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
                </UnifiedSingleSelect>
              </label>
              <label>
                <span>Rights status</span>
                <UnifiedSingleSelect
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
                </UnifiedSingleSelect>
                <small>
                  Publish requires Licensed, Authorized, Demo Original, or Test Original rights. Other statuses remain draft-only.
                </small>
              </label>
            </div>

            {form.externalSources.length ? (
              <div className="admin-source-list">
                {form.externalSources.map((source) => (
                  <article key={source.source}>
                    <strong>{source.source}</strong>
                    <span>{source.externalId}</span>
                    <a href={source.sourceUrl} target="_blank" rel="noreferrer">
                      Open attributed source
                    </a>
                  </article>
                ))}
              </div>
            ) : (
              <p className="admin-inline-empty">
                No external metadata source is attached to this draft.
              </p>
            )}

            <AdminMediaField
              label="Featured slider image"
              helperText="Optional square artwork for homepage features. The main cover is used when this is empty."
              recommendedDimensions="1200 × 1200 px (1:1)"
              currentUrl={form.removeSlider ? null : form.sliderUrl}
              file={sliderFile}
              accept="image/jpeg,image/png,image/webp"
              cropProfile={{
                aspect: 1,
                outputWidth: 1200,
                outputHeight: 1200,
                maxBytes: 3_000_000,
              }}
              busy={saving}
              onSelect={(file) => {
                setSliderFile(file);
                setField("removeSlider", false);
              }}
              onRemove={() => {
                if (sliderFile) {
                  setSliderFile(null);
                  setField("removeSlider", false);
                } else {
                  setField("removeSlider", true);
                }
              }}
            />
            </div>
          </details>

          <footer className="admin-sticky-actions series-create-actions">
            <button
              className="button button-secondary"
              type="submit"
              name="series-create-action"
              value="draft"
              aria-describedby={
                importConflicts.length ? "series-create-conflict-status" : undefined
              }
              disabled={
                saving ||
                !dirty ||
                hasUnresolvedProviderConflicts ||
                !form.title.trim() ||
                !form.slug.trim() ||
                form.synopsis.trim().length < 20
              }
            >
              {saving ? "Saving…" : "Save as draft"}
            </button>
            <button
              className="button button-primary"
              type="submit"
              name="series-create-action"
              value="publish"
              aria-describedby={
                importConflicts.length ? "series-create-conflict-status" : undefined
              }
              disabled={
                saving ||
                !dirty ||
                hasUnresolvedProviderConflicts ||
                !form.title.trim() ||
                !form.slug.trim() ||
                form.synopsis.trim().length < 20
              }
            >
              {saving ? "Publishing…" : "Publish now"}
            </button>
          </footer>
        </form>
      ) : (
        <>
      <SeriesGalleryModerationPanel />
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
            <button
              className="admin-icon-action"
              type="submit"
              aria-label="Search series"
            >
              <Check size={16} />
            </button>
          </form>
          <button
            className="admin-record-refresh"
            type="button"
            onClick={() => void load(query, page)}
          >
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
                  <span className="series-record-cover">
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
        {form.id ? (
        <form className="admin-editor-form" onSubmit={save}>
          <nav
            className="admin-subnav"
            role="tablist"
            aria-label="Series editor sections"
          >
            {seriesEditorTabs.map((tab) => (
              <button
                id={`series-editor-tab-${tab.key}`}
                key={tab.key}
                type="button"
                role="tab"
                aria-controls={`series-editor-panel-${tab.key}`}
                aria-selected={activeEditorTab === tab.key}
                tabIndex={activeEditorTab === tab.key ? 0 : -1}
                onClick={() => setActiveEditorTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div
            id="series-editor-panel-basic"
            className="admin-editor-box"
            role="tabpanel"
            aria-labelledby="series-editor-tab-basic"
            hidden={activeEditorTab !== "basic"}
          >
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
                  <UnifiedSingleSelect
                    value={form.type}
                    onChange={(event) =>
                      setField("type", event.target.value as FormState["type"])
                    }
                  >
                    <option value="MANGA">Manga</option>
                    <option value="MANHWA">Manhwa</option>
                    <option value="MANHUA">Manhua</option>
                  </UnifiedSingleSelect>
                </label>
                <label>
                  <span>Publication status</span>
                  <UnifiedSingleSelect
                    value={form.status}
                    onChange={(event) =>
                      setField("status", event.target.value as FormState["status"])
                    }
                  >
                    <option value="ONGOING">Ongoing</option>
                    <option value="COMPLETED">Completed</option>
                    <option value="HIATUS">Hiatus</option>
                    <option value="PAUSED">Paused</option>
                    <option value="CANCELLED">Cancelled</option>
                    <option value="UPCOMING">Upcoming</option>
                  </UnifiedSingleSelect>
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
                  <UnifiedSingleSelect
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
                  </UnifiedSingleSelect>
                </label>
              </div>
            </section>
          </div>

          <div
            id="series-editor-panel-titles"
            className="admin-editor-box"
            role="tabpanel"
            aria-labelledby="series-editor-tab-titles"
            hidden={activeEditorTab !== "titles"}
          >
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
          </div>

          <div
            id="series-editor-panel-credits"
            className="admin-editor-box"
            role="tabpanel"
            aria-labelledby="series-editor-tab-credits"
            hidden={activeEditorTab !== "credits"}
          >
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
          </div>

          <div
            id="series-editor-panel-origin"
            className="admin-editor-box"
            role="tabpanel"
            aria-labelledby="series-editor-tab-origin"
            hidden={activeEditorTab !== "origin"}
          >
            <section className="admin-form-section">
              <header>
                <h3>Origin and classification</h3>
                <p>Country and language use stable supported codes; genres reuse canonical entries.</p>
              </header>
              <div className="admin-form-grid">
                <label>
                  <span>Country of origin</span>
                  <AdminCombobox
                    ariaLabel="Country of origin"
                    value={form.countryCode}
                    options={(options?.countries ?? []).map((country) => ({
                      value: country.code,
                      label: country.name,
                      description: country.code,
                    }))}
                    onChange={(countryCode) => {
                      const suggested =
                        options?.countryLanguageDefaults[countryCode];
                      const currentLanguage = form.languageCode;
                      setField("countryCode", countryCode);
                      if (!suggested || suggested === currentLanguage) return;
                      if (!currentLanguage) {
                        setField("languageCode", suggested);
                        return;
                      }
                      const languageName = options?.languages.find(
                        (language) => language.code === suggested,
                      )?.name;
                      setPendingConfirmation({
                        title: "Apply the usual original language?",
                        description: `${
                          options?.countries.find(
                            (country) => country.code === countryCode,
                          )?.name ?? countryCode
                        } usually uses ${languageName ?? suggested}. The country change is already applied; keep the current language or apply this suggestion.`,
                        confirmLabel: "Apply language",
                        destructive: false,
                        run: () => setField("languageCode", suggested),
                      });
                    }}
                  />
                </label>
                <label>
                  <span>Original language</span>
                  <AdminCombobox
                    ariaLabel="Original language"
                    value={form.languageCode}
                    options={(options?.languages ?? []).map((language) => ({
                      value: language.code,
                      label: language.name,
                      description: language.code,
                    }))}
                    onChange={(languageCode) =>
                      setField("languageCode", languageCode)
                    }
                  />
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
          </div>

          <div
            id="series-editor-panel-teams"
            className="admin-editor-box"
            role="tabpanel"
            aria-labelledby="series-editor-tab-teams"
            hidden={activeEditorTab !== "teams"}
          >
            <section className="admin-form-section">
              <header>
                <h3>NyaScans publishing teams</h3>
                <p>Assign multiple scanlation teams without confusing them with the original publisher.</p>
              </header>
              <AdminFormField label="Find an eligible team">
                <div
                  className="admin-inline-field"
                  onChangeCapture={captureTeamSearch}
                >
                  <AdminCombobox
                    value={teamDraft}
                    options={assignableTeamOptions}
                    ariaLabel="Search and choose a publishing team"
                    placeholder="Search eligible teams…"
                    onChange={chooseTeamDraft}
                  />
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
              </AdminFormField>
              <div className="admin-team-selection admin-team-picker">
                {selectedTeams.length ? (
                  selectedTeams.map((team) => (
                    <article className="admin-team-row" key={team.id}>
                      <div className="admin-team-identity">
                        <strong>{team.name}</strong>
                        <small>{team.verificationStatus}</small>
                      </div>
                      <label className="admin-team-primary">
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
          </div>

          <div
            id="series-editor-panel-taxonomy"
            className="admin-editor-box"
            role="tabpanel"
            aria-labelledby="series-editor-tab-taxonomy"
            hidden={activeEditorTab !== "taxonomy"}
          >
            <section className="admin-form-section">
              <TaxonomyManager />
            </section>
          </div>

          <div
            id="series-editor-panel-artwork"
            className="admin-editor-box"
            role="tabpanel"
            aria-labelledby="series-editor-tab-artwork"
            hidden={activeEditorTab !== "artwork"}
          >
            <section className="admin-form-section">
              <header>
                <h3>Cover, banner, and slider artwork</h3>
                <p>Images upload through the verified storage pipeline after metadata saves successfully.</p>
              </header>
              <AdminMediaField
                label="Main cover"
                helperText="Portrait artwork used in cards and listings. JPEG, PNG, or WebP; up to 8 MB."
                recommendedDimensions="1200 × 1800 px (2:3)"
                currentUrl={form.removeCover ? null : form.coverUrl}
                file={coverFile}
                accept="image/jpeg,image/png,image/webp"
                cropProfile={{
                  aspect: 2 / 3,
                  outputWidth: 1200,
                  outputHeight: 1800,
                  maxBytes: 3_000_000,
                }}
                busy={saving}
                onSelect={(file) => {
                  setCoverFile(file);
                  setField("removeCover", false);
                }}
                onRemove={() => {
                  if (coverFile) {
                    setCoverFile(null);
                    setField("removeCover", false);
                  } else {
                    setField("removeCover", true);
                  }
                }}
              />
              <AdminMediaField
                label="Series banner"
                helperText="Wide artwork for the public series header and promotional placements; up to 12 MB."
                recommendedDimensions="2400 × 900 px"
                currentUrl={form.removeBanner ? null : form.bannerUrl}
                file={bannerFile}
                accept="image/jpeg,image/png,image/webp"
                cropProfile={{
                  aspect: 8 / 3,
                  outputWidth: 2400,
                  outputHeight: 900,
                  maxBytes: 4_000_000,
                }}
                busy={saving}
                onSelect={(file) => {
                  setBannerFile(file);
                  setField("removeBanner", false);
                }}
                onRemove={() => {
                  if (bannerFile) {
                    setBannerFile(null);
                    setField("removeBanner", false);
                  } else {
                    setField("removeBanner", true);
                  }
                }}
              />
              <AdminMediaField
                label="Featured slider image"
                helperText="Optional square artwork for homepage slider styles. The cover is used automatically when this is empty."
                recommendedDimensions="1200 × 1200 px (1:1)"
                currentUrl={form.removeSlider ? null : form.sliderUrl}
                file={sliderFile}
                accept="image/jpeg,image/png,image/webp"
                cropProfile={{
                  aspect: 1,
                  outputWidth: 1200,
                  outputHeight: 1200,
                  maxBytes: 3_000_000,
                }}
                busy={saving}
                onSelect={(file) => {
                  setSliderFile(file);
                  setField("removeSlider", false);
                }}
                onRemove={() => {
                  if (sliderFile) {
                    setSliderFile(null);
                    setField("removeSlider", false);
                  } else {
                    setField("removeSlider", true);
                  }
                }}
              />
            </section>
          </div>

          <div
            id="series-editor-panel-import"
            className="admin-editor-box"
            role="tabpanel"
            aria-labelledby="series-editor-tab-import"
            hidden={activeEditorTab !== "import"}
          >
            <section className="admin-form-section">
              <header>
                <h3>External metadata import</h3>
                <p>Preview source values and apply only the fields you choose. Nothing saves automatically.</p>
              </header>
              <div className="admin-import-controls">
                <label>
                  <span>Source</span>
                  <UnifiedSingleSelect
                    value={importSource}
                    onChange={(event) =>
                      setImportSource(
                        event.target.value as typeof importSource,
                      )
                    }
                  >
                    <option value="MANGADEX">MangaDex</option>
                    <option value="MANGAUPDATES">MangaUpdates</option>
                  </UnifiedSingleSelect>
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
                  {imported.fields.coverReferenceUrl ? (
                    <div className="admin-import-cover-preview">
                      {/* External artwork is previewed here, then re-derived and
                          verified by the server before it enters storage. */}
                      <img
                        src={imported.fields.coverReferenceUrl}
                        alt="Imported cover preview"
                      />
                      <span>Provider cover will be imported with the selected metadata.</span>
                    </div>
                  ) : null}
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
                    onClick={() => applyImported()}
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
          </div>

          <div
            id="series-editor-panel-visibility"
            className="admin-editor-box"
            role="tabpanel"
            aria-labelledby="series-editor-tab-visibility"
            hidden={activeEditorTab !== "visibility"}
          >
            <section className="admin-form-section">
              <header>
                <h3>Visibility and publication</h3>
                <p>Publishing makes the series available through the public catalogue API.</p>
              </header>
              <div className="admin-form-grid">
                <label>
                  <span>Default chapter access</span>
                  <UnifiedSingleSelect
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
                  </UnifiedSingleSelect>
                </label>
                <label>
                  <span>Rights status</span>
                  <UnifiedSingleSelect
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
                  </UnifiedSingleSelect>
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
          </div>

          <div
            id="series-editor-panel-review"
            className="admin-editor-box"
            role="tabpanel"
            aria-labelledby="series-editor-tab-review"
            hidden={activeEditorTab !== "review"}
          >
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
          </div>

          <footer className="admin-sticky-actions">
            <div className="admin-save-state">
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
                setSliderFile(null);
                setImported(null);
                setPendingImportedCover(null);
                setImportPreviews({});
                setImportDuplicate(null);
                setImportPreviewDuplicates({});
                setImportConflictChoices({});
                setImportFields(new Set());
                setImportApplied(false);
                setImportInput("");
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
        ) : (
          <section className="admin-editor-empty">
            <Books size={28} />
            <h2>No series selected</h2>
            <p>
              Choose an existing series from the catalog browser, or use Add
              Series to create one from a provider match or from scratch.
            </p>
          </section>
        )}
      </div>
        </>
      )}
      <ConfirmActionDialog
        open={Boolean(pendingConfirmation)}
        title={pendingConfirmation?.title ?? "Confirm action"}
        description={pendingConfirmation?.description ?? ""}
        confirmLabel={pendingConfirmation?.confirmLabel ?? "Confirm"}
        destructive={pendingConfirmation?.destructive ?? true}
        onCancel={() => setPendingConfirmation(null)}
        onConfirm={() => {
          const action = pendingConfirmation?.run;
          setPendingConfirmation(null);
          action?.();
        }}
      />
    </AdminPageScaffold>
  );
}
