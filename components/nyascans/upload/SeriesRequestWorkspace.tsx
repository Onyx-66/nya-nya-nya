"use client";
/* eslint-disable @next/next/no-img-element */

import {
  ArrowRight,
  CheckCircle,
  FileText,
  FloppyDisk,
  Image as ImageIcon,
  SpinnerGap,
  WarningCircle,
} from "@phosphor-icons/react";
import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { optimizeStaticMedia } from "@/lib/client/media-optimizer";

type TeamOption = {
  id: string;
  name: string;
  slug: string;
  membershipRole: string;
};

type RequestRecord = {
  id: string;
  submittingTeamId: string;
  submittingTeamName?: string;
  status: string;
  revision: number;
  primaryTitle: string;
  alternativeTitles: string[];
  description: string;
  seriesType: "MANGA" | "MANHWA" | "MANHUA";
  publicationStatus: "ONGOING" | "COMPLETED" | "HIATUS" | "UPCOMING";
  authors: Array<{ id?: string; name: string }>;
  artists: Array<{ id?: string; name: string }>;
  publisherName: string;
  countryCode: string;
  languageCode: string;
  readingDirection: "VERTICAL" | "RIGHT_TO_LEFT" | "LEFT_TO_RIGHT";
  genres: Array<{ id?: string; name: string }>;
  requestedTeams?: Array<{ id: string; name?: string }>;
  team?: { id: string; name: string };
  externalSources: Array<{
    source: "MANGADEX" | "MANGAUPDATES";
    externalId: string;
    sourceUrl: string;
    responseHash?: string | null;
  }>;
  submitterNotes: string;
  duplicateConfirmation: boolean;
  duplicateExplanation: string;
  coverUrl?: string | null;
  bannerUrl?: string | null;
  submittedAt?: string | null;
  updatedAt?: string;
  approvedSeries?: { id: string; title: string; slug: string } | null;
  feedback?: Array<{
    id: string;
    kind: string;
    fieldPath: string | null;
    body: string;
    authorDisplayName: string | null;
    createdAt: string;
  }>;
  revisions?: Array<{
    revisionNumber: number;
    kind: string;
    changedFields: string[];
    createdAt: string;
  }>;
};

type RequestForm = {
  primaryTitle: string;
  alternativeTitles: string;
  description: string;
  seriesType: "MANGA" | "MANHWA" | "MANHUA";
  publicationStatus: "ONGOING" | "COMPLETED" | "HIATUS" | "UPCOMING";
  authors: string;
  artists: string;
  publisherName: string;
  countryCode: string;
  languageCode: string;
  readingDirection: "VERTICAL" | "RIGHT_TO_LEFT" | "LEFT_TO_RIGHT";
  genres: string;
  mangaDexId: string;
  mangaDexUrl: string;
  mangaUpdatesId: string;
  mangaUpdatesUrl: string;
  submitterNotes: string;
  duplicateConfirmation: boolean;
  duplicateExplanation: string;
};

const emptyForm: RequestForm = {
  primaryTitle: "",
  alternativeTitles: "",
  description: "",
  seriesType: "MANGA",
  publicationStatus: "ONGOING",
  authors: "",
  artists: "",
  publisherName: "",
  countryCode: "JP",
  languageCode: "ja",
  readingDirection: "RIGHT_TO_LEFT",
  genres: "",
  mangaDexId: "",
  mangaDexUrl: "",
  mangaUpdatesId: "",
  mangaUpdatesUrl: "",
  submitterNotes: "",
  duplicateConfirmation: false,
  duplicateExplanation: "",
};

type ApiErrorBody = {
  error?: { message?: string; fields?: Array<{ path: string; message: string }> };
};

type MetadataPreview = {
  source: "MANGADEX";
  externalId: string;
  sourceUrl: string;
  responseHash: string;
  fetchedAt: string;
  cached: boolean;
  fields: {
    title?: string;
    alternativeTitles?: string[];
    synopsis?: string;
    authors?: Array<{ name: string }>;
    artists?: Array<{ name: string }>;
    countryCode?: string;
    languageCode?: string;
    type?: RequestForm["seriesType"];
    status?: RequestForm["publicationStatus"];
    genres?: Array<{ name: string }>;
  };
};

type MetadataPreviewResult = {
  data: MetadataPreview;
  duplicate: { seriesId: string; title: string; slug: string } | null;
  duplicateRequest: {
    requestId: string;
    title: string;
    status: string;
  } | null;
  applyMode: "SELECT_FIELDS";
};

type ImportField =
  | "source"
  | "primaryTitle"
  | "alternativeTitles"
  | "description"
  | "authors"
  | "artists"
  | "countryCode"
  | "languageCode"
  | "seriesType"
  | "publicationStatus"
  | "genres";

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & ApiErrorBody;
  if (!response.ok) {
    const fieldMessage = payload.error?.fields?.[0]?.message;
    throw new Error(
      fieldMessage ?? payload.error?.message ?? "The request could not be saved.",
    );
  }
  return payload;
}

function splitValues(value: string) {
  const seen = new Set<string>();
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => {
      const key = entry.normalize("NFKC").toLowerCase();
      if (!entry || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function requestData(form: RequestForm, teamId: string) {
  const externalSources = [
    form.mangaDexId || form.mangaDexUrl
      ? {
          source: "MANGADEX" as const,
          externalId: form.mangaDexId.trim(),
          sourceUrl: form.mangaDexUrl.trim(),
        }
      : null,
    form.mangaUpdatesId || form.mangaUpdatesUrl
      ? {
          source: "MANGAUPDATES" as const,
          externalId: form.mangaUpdatesId.trim(),
          sourceUrl: form.mangaUpdatesUrl.trim(),
        }
      : null,
  ].filter(Boolean);
  return {
    primaryTitle: form.primaryTitle,
    alternativeTitles: splitValues(form.alternativeTitles),
    description: form.description,
    seriesType: form.seriesType,
    publicationStatus: form.publicationStatus,
    authors: splitValues(form.authors).map((name) => ({ name })),
    artists: splitValues(form.artists).map((name) => ({ name })),
    publisherName: form.publisherName,
    countryCode: form.countryCode.toUpperCase(),
    languageCode: form.languageCode.toLowerCase(),
    readingDirection: form.readingDirection,
    genres: splitValues(form.genres).map((name) => ({ name })),
    requestingTeamIds: [teamId],
    externalSources,
    submitterNotes: form.submitterNotes,
    duplicateConfirmation: form.duplicateConfirmation,
    duplicateExplanation: form.duplicateExplanation,
  };
}

function formFromRequest(record: RequestRecord): RequestForm {
  const mangaDex = record.externalSources?.find(
    (source) => source.source === "MANGADEX",
  );
  const mangaUpdates = record.externalSources?.find(
    (source) => source.source === "MANGAUPDATES",
  );
  return {
    primaryTitle: record.primaryTitle,
    alternativeTitles: (record.alternativeTitles ?? []).join("\n"),
    description: record.description,
    seriesType: record.seriesType,
    publicationStatus: record.publicationStatus,
    authors: (record.authors ?? []).map((entry) => entry.name).join(", "),
    artists: (record.artists ?? []).map((entry) => entry.name).join(", "),
    publisherName: record.publisherName ?? "",
    countryCode: record.countryCode,
    languageCode: record.languageCode,
    readingDirection: record.readingDirection,
    genres: (record.genres ?? []).map((entry) => entry.name).join(", "),
    mangaDexId: mangaDex?.externalId ?? "",
    mangaDexUrl: mangaDex?.sourceUrl ?? "",
    mangaUpdatesId: mangaUpdates?.externalId ?? "",
    mangaUpdatesUrl: mangaUpdates?.sourceUrl ?? "",
    submitterNotes: record.submitterNotes ?? "",
    duplicateConfirmation: Boolean(record.duplicateConfirmation),
    duplicateExplanation: record.duplicateExplanation ?? "",
  };
}

function RequestStatus({ status }: { status: string }) {
  return (
    <span className={`upload-status upload-status-${status.toLowerCase()}`}>
      {status.replaceAll("_", " ").toLowerCase()}
    </span>
  );
}

const importFieldLabels: Record<ImportField, string> = {
  source: "MangaDex ID and canonical URL",
  primaryTitle: "Primary title",
  alternativeTitles: "Alternative titles",
  description: "Description",
  authors: "Authors",
  artists: "Artists",
  countryCode: "Country of origin",
  languageCode: "Original language",
  seriesType: "Series type",
  publicationStatus: "Publication status",
  genres: "Genres",
};

function importFieldValue(preview: MetadataPreview, field: ImportField) {
  const fields = preview.fields;
  switch (field) {
    case "source":
      return `${preview.externalId} · ${preview.sourceUrl}`;
    case "primaryTitle":
      return fields.title ?? "";
    case "alternativeTitles":
      return fields.alternativeTitles?.join(" · ") ?? "";
    case "description":
      return fields.synopsis ?? "";
    case "authors":
      return fields.authors?.map((author) => author.name).join(", ") ?? "";
    case "artists":
      return fields.artists?.map((artist) => artist.name).join(", ") ?? "";
    case "countryCode":
      return fields.countryCode ?? "";
    case "languageCode":
      return fields.languageCode ?? "";
    case "seriesType":
      return fields.type ?? "";
    case "publicationStatus":
      return fields.status ?? "";
    case "genres":
      return fields.genres?.map((genre) => genre.name).join(", ") ?? "";
  }
}

function availableImportFields(preview: MetadataPreview) {
  const fields = preview.fields;
  const available: ImportField[] = ["source"];
  if (fields.title) available.push("primaryTitle");
  if (fields.alternativeTitles?.length) available.push("alternativeTitles");
  if (fields.synopsis) available.push("description");
  if (fields.authors?.length) available.push("authors");
  if (fields.artists?.length) available.push("artists");
  if (fields.countryCode) available.push("countryCode");
  if (fields.languageCode) available.push("languageCode");
  if (fields.type) available.push("seriesType");
  if (fields.status) available.push("publicationStatus");
  if (fields.genres?.length) available.push("genres");
  return available;
}

export function AddSeriesRequestPanel() {
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [teamsLoaded, setTeamsLoaded] = useState(false);
  const [teamId, setTeamId] = useState("");
  const [form, setForm] = useState<RequestForm>(emptyForm);
  const [requestRecord, setRequestRecord] = useState<RequestRecord | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [banner, setBanner] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [metadataPreview, setMetadataPreview] =
    useState<MetadataPreviewResult | null>(null);
  const [acceptedImportFields, setAcceptedImportFields] = useState<
    Set<ImportField>
  >(new Set());
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const editId =
    typeof window === "undefined"
      ? ""
      : new URLSearchParams(window.location.search).get("id") ?? "";

  useEffect(() => {
    let cancelled = false;
    void fetch(
        editId
          ? `/api/v1/series-requests?id=${encodeURIComponent(editId)}`
          : "/api/v1/series-requests?limit=1",
        { cache: "no-store" },
      )
      .then((response) =>
        readJson<{
          data: RequestRecord[] | RequestRecord;
          capabilities: { teams: TeamOption[] };
        }>(response),
      )
      .then((payload) => {
        if (cancelled) return;
        const detail = editId
          ? ((payload as unknown as { data: RequestRecord }).data ?? null)
          : null;
        const availableTeams =
          (
            payload as unknown as {
              capabilities?: { teams?: TeamOption[] };
            }
          ).capabilities?.teams ?? [];
        setTeams(availableTeams);
        setTeamsLoaded(true);
        if (availableTeams.length) {
          setTeamId(detail?.submittingTeamId ?? availableTeams[0]!.id);
        }
        if (detail) {
          setRequestRecord(detail);
          setForm(formFromRequest(detail));
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setTeamsLoaded(true);
          setError(
            loadError instanceof Error
              ? loadError.message
              : "The request form could not be loaded.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [editId]);

  useEffect(() => {
    if (!editId || teams.length) return;
    void fetch("/api/v1/series-requests?limit=1", { cache: "no-store" })
      .then((response) =>
        readJson<{
          capabilities: { teams: TeamOption[] };
        }>(response),
      )
      .then((payload) => {
        setTeams(payload.capabilities.teams ?? []);
        setTeamsLoaded(true);
      })
      .catch(() => setTeamsLoaded(true));
  }, [editId, teams.length]);

  async function uploadMedia(
    request: RequestRecord,
    slot: "cover" | "banner",
    file: File,
  ) {
    const prepared = await optimizeStaticMedia(file, {
      maxWidth: slot === "cover" ? 1_600 : 2_400,
      maxHeight: slot === "cover" ? 2_400 : 1_200,
      maxBytes: slot === "cover" ? 3_000_000 : 4_000_000,
    });
    const body = new FormData();
    body.set("requestId", request.id);
    body.set("slot", slot);
    body.set("revision", String(request.revision));
    body.set("file", prepared);
    const payload = await readJson<{
      data: { revision: number };
    }>(
      await fetch("/api/v1/series-request-media", {
        method: "PUT",
        body,
      }),
    );
    return { ...request, revision: payload.data.revision };
  }

  async function previewMangaDex() {
    setImportBusy(true);
    setError("");
    setMessage("");
    setMetadataPreview(null);
    try {
      if (!teamId) throw new Error("Choose the submitting team first.");
      const input = form.mangaDexUrl.trim() || form.mangaDexId.trim();
      if (!input) {
        throw new Error("Enter a MangaDex title URL or UUID to preview.");
      }
      const preview = await readJson<MetadataPreviewResult>(
        await fetch("/api/v1/series-request-metadata-import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            source: "MANGADEX",
            input,
            teamId,
            seriesRequestId: requestRecord?.id,
          }),
        }),
      );
      setMetadataPreview(preview);
      setAcceptedImportFields(new Set(availableImportFields(preview.data)));
    } catch (previewError) {
      setError(
        previewError instanceof Error
          ? previewError.message
          : "The MangaDex preview could not be loaded.",
      );
    } finally {
      setImportBusy(false);
    }
  }

  function toggleImportField(field: ImportField) {
    setAcceptedImportFields((current) => {
      const next = new Set(current);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }

  function applyMetadataPreview() {
    if (!metadataPreview) return;
    if (metadataPreview.duplicate || metadataPreview.duplicateRequest) {
      setError(
        "This exact MangaDex identifier already belongs to a series or active request and cannot be applied.",
      );
      return;
    }
    const imported = metadataPreview.data;
    const fields = imported.fields;
    setForm((current) => ({
      ...current,
      primaryTitle:
        acceptedImportFields.has("primaryTitle") && fields.title
          ? fields.title
          : current.primaryTitle,
      alternativeTitles:
        acceptedImportFields.has("alternativeTitles") &&
        fields.alternativeTitles
          ? fields.alternativeTitles.join("\n")
          : current.alternativeTitles,
      description:
        acceptedImportFields.has("description") && fields.synopsis
          ? fields.synopsis
          : current.description,
      authors:
        acceptedImportFields.has("authors") && fields.authors
          ? fields.authors.map((author) => author.name).join(", ")
          : current.authors,
      artists:
        acceptedImportFields.has("artists") && fields.artists
          ? fields.artists.map((artist) => artist.name).join(", ")
          : current.artists,
      countryCode:
        acceptedImportFields.has("countryCode") && fields.countryCode
          ? fields.countryCode
          : current.countryCode,
      languageCode:
        acceptedImportFields.has("languageCode") && fields.languageCode
          ? fields.languageCode
          : current.languageCode,
      seriesType:
        acceptedImportFields.has("seriesType") && fields.type
          ? fields.type
          : current.seriesType,
      publicationStatus:
        acceptedImportFields.has("publicationStatus") && fields.status
          ? fields.status === "PAUSED"
            ? "HIATUS"
            : fields.status
          : current.publicationStatus,
      genres:
        acceptedImportFields.has("genres") && fields.genres
          ? fields.genres.map((genre) => genre.name).join(", ")
          : current.genres,
      mangaDexId: acceptedImportFields.has("source")
        ? imported.externalId
        : current.mangaDexId,
      mangaDexUrl: acceptedImportFields.has("source")
        ? imported.sourceUrl
        : current.mangaDexUrl,
    }));
    setMessage(
      "Selected MangaDex fields were applied to the form. Review them before saving or submitting.",
    );
  }

  async function save(intent: "DRAFT" | "SUBMIT") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (!teamId) throw new Error("Choose the submitting team.");
      if (intent === "SUBMIT" && !cover && !requestRecord?.coverUrl) {
        throw new Error("Add a portrait cover before submitting for review.");
      }
      const data = requestData(form, teamId);
      if (intent === "SUBMIT") {
        const duplicates = await readJson<{
          matches?: unknown[];
          exactExternalDuplicate?: boolean;
        }>(
          await fetch("/api/v1/series-requests", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "CHECK_DUPLICATES",
              requestId: requestRecord?.id,
              teamId,
              data,
            }),
          }),
        );
        if (
          (duplicates.matches?.length || duplicates.exactExternalDuplicate) &&
          !form.duplicateConfirmation
        ) {
          throw new Error(
            "Possible duplicates were found. Review the matches in My Series Requests, then confirm and explain why this is distinct.",
          );
        }
      }
      let saved = requestRecord;
      if (!saved) {
        const created = await readJson<{ data: RequestRecord }>(
          await fetch("/api/v1/series-requests", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "CREATE_DRAFT",
              teamId,
              data,
            }),
          }),
        );
        saved = created.data;
      } else {
        const updated = await readJson<{ data: RequestRecord }>(
          await fetch("/api/v1/series-requests", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action:
                saved.status === "CHANGES_REQUESTED" && intent === "SUBMIT"
                  ? "SAVE_DRAFT"
                  : "SAVE_DRAFT",
              requestId: saved.id,
              expectedRevision: saved.revision,
              data,
            }),
          }),
        );
        saved = updated.data;
      }
      if (cover) saved = await uploadMedia(saved, "cover", cover);
      if (banner) saved = await uploadMedia(saved, "banner", banner);
      if (intent === "SUBMIT") {
        const submitted = await readJson<{ data: RequestRecord }>(
          await fetch("/api/v1/series-requests", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action:
                saved.status === "CHANGES_REQUESTED" ? "RESUBMIT" : "SUBMIT",
              requestId: saved.id,
              expectedRevision: saved.revision,
              data,
            }),
          }),
        );
        saved = submitted.data;
      }
      setRequestRecord(saved);
      setCover(null);
      setBanner(null);
      setMessage(
        intent === "SUBMIT"
          ? "Series request submitted for administrator review."
          : "Draft saved privately.",
      );
      window.history.replaceState(
        {},
        "",
        `/upload-chapter/add-series?id=${encodeURIComponent(saved.id)}`,
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "The request could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  const editable =
    !requestRecord ||
    ["DRAFT", "CHANGES_REQUESTED"].includes(requestRecord.status);

  if (!teamsLoaded && !error) {
    return (
      <div className="upload-loading">
        <SpinnerGap className="spin" size={22} /> Loading eligible teams…
      </div>
    );
  }

  if (teamsLoaded && !teams.length) {
    return (
      <section className="upload-request-panel">
        <header className="upload-section-heading">
          <div>
            <span>Administrator-reviewed catalogue entry</span>
            <h2>No eligible publishing team</h2>
            <p>
              You need an active team role with series-request permission
              before you can create or edit a request.
            </p>
          </div>
        </header>
        <div className="upload-alert" role="status">
          <WarningCircle size={19} />
          Ask a team leader or administrator to grant series-request access,
          then return to this workspace.
        </div>
        <Link
          className="button button-secondary"
          href="/upload-chapter/series-requests"
        >
          View existing requests
        </Link>
      </section>
    );
  }

  return (
    <section className="upload-request-panel">
      <header className="upload-section-heading">
        <div>
          <span>Administrator-reviewed catalogue entry</span>
          <h2>{requestRecord ? "Edit series request" : "Request a new series"}</h2>
          <p>
            Save privately at any time. Submitting never publishes a title
            automatically.
          </p>
        </div>
        {requestRecord ? <RequestStatus status={requestRecord.status} /> : null}
      </header>
      {error ? (
        <div className="upload-alert is-error" role="alert">
          <WarningCircle size={19} /> {error}
        </div>
      ) : null}
      {message ? (
        <div className="upload-alert is-success" role="status">
          <CheckCircle size={19} /> {message}
        </div>
      ) : null}
      {!editable ? (
        <div className="upload-alert">
          This request is locked while it is being reviewed. Open My Series
          Requests to see feedback and decisions.
        </div>
      ) : null}
      <form
        className="series-request-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save("SUBMIT");
        }}
      >
        <fieldset disabled={!editable || busy}>
          <legend>Title and team</legend>
          <div className="upload-form-grid">
            <label>
              <span>Submitting team</span>
              <select
                value={teamId}
                disabled={Boolean(requestRecord)}
                onChange={(event) => setTeamId(event.target.value)}
                required
              >
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
              <small>You cannot submit on behalf of an ineligible team.</small>
            </label>
            <label>
              <span>Primary title</span>
              <input
                value={form.primaryTitle}
                minLength={2}
                maxLength={200}
                required
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    primaryTitle: event.target.value,
                  }))
                }
              />
            </label>
            <label className="upload-field-wide">
              <span>Alternative titles</span>
              <textarea
                value={form.alternativeTitles}
                rows={3}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    alternativeTitles: event.target.value,
                  }))
                }
                placeholder="One per line or comma-separated"
              />
            </label>
            <label className="upload-field-wide">
              <span>Description</span>
              <textarea
                value={form.description}
                minLength={20}
                maxLength={10_000}
                rows={6}
                required
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </label>
          </div>
        </fieldset>
        <fieldset disabled={!editable || busy}>
          <legend>Publication metadata</legend>
          <div className="upload-form-grid">
            <label>
              <span>Series type</span>
              <select
                value={form.seriesType}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    seriesType: event.target.value as RequestForm["seriesType"],
                  }))
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
                value={form.publicationStatus}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    publicationStatus: event.target
                      .value as RequestForm["publicationStatus"],
                  }))
                }
              >
                <option value="ONGOING">Ongoing</option>
                <option value="COMPLETED">Completed</option>
                <option value="HIATUS">Hiatus</option>
                <option value="UPCOMING">Upcoming</option>
              </select>
            </label>
            <label>
              <span>Authors</span>
              <input
                value={form.authors}
                required
                onChange={(event) =>
                  setForm((current) => ({ ...current, authors: event.target.value }))
                }
                placeholder="Comma-separated"
              />
            </label>
            <label>
              <span>Artists</span>
              <input
                value={form.artists}
                required
                onChange={(event) =>
                  setForm((current) => ({ ...current, artists: event.target.value }))
                }
                placeholder="Comma-separated"
              />
            </label>
            <label>
              <span>Publishing studio</span>
              <input
                value={form.publisherName}
                maxLength={180}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    publisherName: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              <span>Genres</span>
              <input
                value={form.genres}
                required
                onChange={(event) =>
                  setForm((current) => ({ ...current, genres: event.target.value }))
                }
                placeholder="Action, Fantasy"
              />
            </label>
            <label>
              <span>Country of origin</span>
              <input
                value={form.countryCode}
                minLength={2}
                maxLength={2}
                required
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    countryCode: event.target.value.toUpperCase(),
                  }))
                }
              />
            </label>
            <label>
              <span>Original language</span>
              <input
                value={form.languageCode}
                required
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    languageCode: event.target.value.toLowerCase(),
                  }))
                }
              />
            </label>
            <label>
              <span>Reading direction</span>
              <select
                value={form.readingDirection}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    readingDirection: event.target
                      .value as RequestForm["readingDirection"],
                  }))
                }
              >
                <option value="RIGHT_TO_LEFT">Right to left</option>
                <option value="LEFT_TO_RIGHT">Left to right</option>
                <option value="VERTICAL">Vertical strip</option>
              </select>
            </label>
          </div>
        </fieldset>
        <fieldset disabled={!editable || busy}>
          <legend>Artwork and source identifiers</legend>
          <div className="request-media-grid">
            <label>
              <ImageIcon size={22} />
              <span>
                <strong>Cover · required to submit</strong>
                <small>Portrait JPEG, PNG, or WebP near 2:3.</small>
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => setCover(event.target.files?.[0] ?? null)}
              />
              {requestRecord?.coverUrl ? (
                <img
                  src={`/api/v1/series-request-media?id=${encodeURIComponent(requestRecord.id)}&slot=cover&v=${requestRecord.revision}`}
                  alt="Current request cover"
                />
              ) : null}
            </label>
            <label>
              <ImageIcon size={22} />
              <span>
                <strong>Banner · optional</strong>
                <small>Wide JPEG, PNG, or WebP.</small>
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => setBanner(event.target.files?.[0] ?? null)}
              />
            </label>
          </div>
          <div className="upload-form-grid">
            <label>
              <span>MangaDex ID</span>
              <input
                value={form.mangaDexId}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    mangaDexId: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              <span>MangaDex URL</span>
              <input
                type="url"
                value={form.mangaDexUrl}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    mangaDexUrl: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              <span>MangaUpdates ID</span>
              <input
                value={form.mangaUpdatesId}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    mangaUpdatesId: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              <span>MangaUpdates URL</span>
              <input
                type="url"
                value={form.mangaUpdatesUrl}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    mangaUpdatesUrl: event.target.value,
                  }))
                }
              />
            </label>
          </div>
          <div className="request-import-workspace">
            <div>
              <strong>MangaDex metadata preview</strong>
              <p className="upload-helper">
                Load a read-only preview, then choose each field you want to
                apply. Nothing is published or changed automatically.
              </p>
            </div>
            <button
              type="button"
              className="button button-secondary"
              disabled={
                !editable ||
                busy ||
                importBusy ||
                (!form.mangaDexId.trim() && !form.mangaDexUrl.trim())
              }
              onClick={() => void previewMangaDex()}
            >
              {importBusy ? (
                <SpinnerGap className="spin" size={18} />
              ) : (
                <FileText size={18} />
              )}
              {importBusy ? "Loading preview…" : "Preview MangaDex metadata"}
            </button>
          </div>
          {metadataPreview ? (
            <section
              className="request-import-preview"
              aria-labelledby="mangadex-preview-heading"
            >
              <header>
                <div>
                  <span>
                    {metadataPreview.data.cached
                      ? "Cached provider response"
                      : "Fresh provider response"}
                  </span>
                  <h3 id="mangadex-preview-heading">
                    {metadataPreview.data.fields.title ??
                      metadataPreview.data.externalId}
                  </h3>
                </div>
                <small>
                  Previewed{" "}
                  {new Date(
                    metadataPreview.data.fetchedAt,
                  ).toLocaleString()}
                </small>
              </header>
              {metadataPreview.duplicate ? (
                <div className="upload-alert is-error" role="alert">
                  <WarningCircle size={19} />
                  <span>
                    Exact MangaDex match:{" "}
                    <Link
                      href={`/title/${metadataPreview.duplicate.slug}`}
                    >
                      {metadataPreview.duplicate.title}
                    </Link>
                    . This identifier cannot be used for a new series.
                  </span>
                </div>
              ) : null}
              {metadataPreview.duplicateRequest ? (
                <div className="upload-alert is-error" role="alert">
                  <WarningCircle size={19} />
                  An active request already uses this MangaDex ID:{" "}
                  {metadataPreview.duplicateRequest.title} (
                  {metadataPreview.duplicateRequest.status
                    .replaceAll("_", " ")
                    .toLowerCase()}
                  ).
                </div>
              ) : null}
              <div className="request-import-fields">
                {availableImportFields(metadataPreview.data).map((field) => (
                  <label key={field}>
                    <input
                      type="checkbox"
                      checked={acceptedImportFields.has(field)}
                      onChange={() => toggleImportField(field)}
                    />
                    <span>
                      <strong>{importFieldLabels[field]}</strong>
                      <small>{importFieldValue(metadataPreview.data, field)}</small>
                    </span>
                  </label>
                ))}
              </div>
              <div className="request-import-actions">
                <button
                  type="button"
                  className="button button-primary"
                  disabled={
                    Boolean(
                      metadataPreview.duplicate ||
                        metadataPreview.duplicateRequest,
                    ) || acceptedImportFields.size === 0
                  }
                  onClick={applyMetadataPreview}
                >
                  <CheckCircle size={18} /> Apply selected fields
                </button>
                <small>
                  MangaUpdates import remains unavailable because no permitted
                  stable provider API is configured; manual identifiers are
                  still validated.
                </small>
              </div>
            </section>
          ) : (
            <p className="upload-helper">
              MangaUpdates import is unavailable because no permitted stable
              provider API is configured. Manual source IDs remain supported
              and are checked for exact duplicates.
            </p>
          )}
        </fieldset>
        <fieldset disabled={!editable || busy}>
          <legend>Reviewer context</legend>
          <label className="upload-field-wide">
            <span>Notes for reviewers</span>
            <textarea
              rows={4}
              value={form.submitterNotes}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  submitterNotes: event.target.value,
                }))
              }
            />
          </label>
          <label className="upload-check">
            <input
              type="checkbox"
              checked={form.duplicateConfirmation}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  duplicateConfirmation: event.target.checked,
                }))
              }
            />
            I reviewed possible matches and believe this is a distinct series.
          </label>
          {form.duplicateConfirmation ? (
            <label className="upload-field-wide">
              <span>Why this is not a duplicate</span>
              <textarea
                minLength={12}
                required
                rows={3}
                value={form.duplicateExplanation}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    duplicateExplanation: event.target.value,
                  }))
                }
              />
            </label>
          ) : null}
        </fieldset>
        <div className="upload-action-bar">
          <button
            type="button"
            className="button button-secondary"
            disabled={!editable || busy}
            onClick={() => void save("DRAFT")}
          >
            <FloppyDisk size={18} /> {busy ? "Saving…" : "Save draft"}
          </button>
          <button
            type="submit"
            className="button button-primary"
            disabled={!editable || busy}
          >
            {busy ? <SpinnerGap className="spin" size={18} /> : <ArrowRight size={18} />}
            Submit for review
          </button>
        </div>
      </form>
    </section>
  );
}

export function SeriesRequestsPanel() {
  const [records, setRecords] = useState<RequestRecord[]>([]);
  const [selected, setSelected] = useState<RequestRecord | null>(null);
  const [eligibleTeamIds, setEligibleTeamIds] = useState<Set<string>>(
    new Set(),
  );
  const [status, setStatus] = useState("ALL");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const requestSequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);

  async function load() {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setBusy(true);
    setError("");
    try {
      const payload = await readJson<{
        data: RequestRecord[];
        capabilities?: { teams?: TeamOption[] };
      }>(
        await fetch(
          `/api/v1/series-requests?status=${encodeURIComponent(status)}&limit=30`,
          { cache: "no-store", signal: controller.signal },
        ),
      );
      if (controller.signal.aborted || sequence !== requestSequence.current) return;
      setRecords(payload.data ?? []);
      setEligibleTeamIds(
        new Set((payload.capabilities?.teams ?? []).map((team) => team.id)),
      );
      const preferred =
        payload.data.find((entry) => entry.id === selected?.id) ??
        payload.data[0] ??
        null;
      if (!preferred) {
        setSelected(null);
      } else {
        const detail = await readJson<{ data: RequestRecord }>(
          await fetch(
            `/api/v1/series-requests?id=${encodeURIComponent(preferred.id)}`,
            { cache: "no-store", signal: controller.signal },
          ),
        );
        if (controller.signal.aborted || sequence !== requestSequence.current) return;
        setSelected(detail.data);
      }
    } catch (loadError) {
      if ((loadError as Error).name === "AbortError") return;
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Series requests could not be loaded.",
      );
    } finally {
      if (sequence === requestSequence.current) setBusy(false);
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load();
    }, 0);
    return () => {
      window.clearTimeout(timeout);
      requestController.current?.abort();
    };
    // The loader is intentionally re-run only when the server-side filter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function open(record: RequestRecord) {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setBusy(true);
    setError("");
    try {
      const payload = await readJson<{ data: RequestRecord }>(
        await fetch(
          `/api/v1/series-requests?id=${encodeURIComponent(record.id)}`,
          { cache: "no-store", signal: controller.signal },
        ),
      );
      if (controller.signal.aborted || sequence !== requestSequence.current) return;
      setSelected(payload.data);
    } catch (openError) {
      if ((openError as Error).name === "AbortError") return;
      setError(
        openError instanceof Error
          ? openError.message
          : "The request detail could not be loaded.",
      );
    } finally {
      if (sequence === requestSequence.current) setBusy(false);
    }
  }

  async function mutate(action: "WITHDRAW" | "DELETE_DRAFT" | "CLONE_TO_DRAFT") {
    if (!selected) return;
    if (
      ["WITHDRAW", "DELETE_DRAFT"].includes(action) &&
      !window.confirm(
        action === "WITHDRAW"
          ? "Withdraw this request from review?"
          : "Delete this private draft and its temporary media?",
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload = await readJson<{ data: RequestRecord }>(
        await fetch("/api/v1/series-requests", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action,
            requestId: selected.id,
            expectedRevision: selected.revision,
            ...(action === "WITHDRAW" ? { reason } : {}),
          }),
        }),
      );
      setSelected(payload.data);
      setReason("");
      await load();
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "The request action failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  const counts = useMemo(
    () =>
      records.reduce<Record<string, number>>((result, record) => {
        result[record.status] = (result[record.status] ?? 0) + 1;
        return result;
      }, {}),
    [records],
  );

  return (
    <section className="upload-request-panel">
      <header className="upload-section-heading">
        <div>
          <span>Team catalogue requests</span>
          <h2>My series requests</h2>
          <p>Track drafts, reviewer feedback, revisions, and final decisions.</p>
        </div>
        {eligibleTeamIds.size ? (
          <Link
            className="button button-primary"
            href="/upload-chapter/add-series"
          >
            New request <ArrowRight size={17} />
          </Link>
        ) : null}
      </header>
      {error ? (
        <div className="upload-alert is-error" role="alert">
          <WarningCircle size={19} /> {error}
        </div>
      ) : null}
      <div className="upload-filter-row">
        <label>
          <span>Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            {[
              "ALL",
              "DRAFT",
              "SUBMITTED",
              "UNDER_REVIEW",
              "CHANGES_REQUESTED",
              "APPROVED",
              "REJECTED",
              "WITHDRAWN",
            ].map((value) => (
              <option value={value} key={value}>
                {value.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <span>{records.length} shown</span>
        {Object.entries(counts).map(([key, value]) => (
          <small key={key}>
            {key.replaceAll("_", " ")} · {value}
          </small>
        ))}
      </div>
      <div className="request-list-layout">
        <div className="request-record-list">
          {busy && !records.length ? (
            <div className="upload-loading">
              <SpinnerGap className="spin" size={22} /> Loading requests…
            </div>
          ) : records.length ? (
            records.map((record) => (
              <button
                type="button"
                key={record.id}
                className={selected?.id === record.id ? "is-selected" : ""}
                onClick={() => void open(record)}
              >
                <span className="request-record-cover">
                  {record.coverUrl ? (
                    <img src={record.coverUrl} alt="" loading="lazy" />
                  ) : (
                    <FileText size={20} />
                  )}
                </span>
                <div>
                  <strong>{record.primaryTitle}</strong>
                  <small>
                    {record.team?.name ?? "Publishing team"} · updated{" "}
                    {record.updatedAt
                      ? new Date(record.updatedAt).toLocaleDateString()
                      : "recently"}
                  </small>
                </div>
                <RequestStatus status={record.status} />
              </button>
            ))
          ) : (
            <div className="upload-empty">
              <FileText size={28} />
              <strong>No matching series requests</strong>
              <p>Create a private draft when your team is ready.</p>
            </div>
          )}
        </div>
        {records.length ? (
        <aside className="request-detail">
          {selected ? (
            <>
              <div>
                <span>Request #{selected.id.slice(-8)}</span>
                <h3>{selected.primaryTitle}</h3>
                <RequestStatus status={selected.status} />
              </div>
              <dl>
                <div>
                  <dt>Type</dt>
                  <dd>{selected.seriesType}</dd>
                </div>
                <div>
                  <dt>Publication</dt>
                  <dd>{selected.publicationStatus}</dd>
                </div>
                <div>
                  <dt>Revision</dt>
                  <dd>{selected.revision}</dd>
                </div>
              </dl>
              <p>{selected.description}</p>
              {selected.coverUrl ? (
                <img
                  src={selected.coverUrl}
                  alt={`${selected.primaryTitle} request cover`}
                />
              ) : null}
              <section>
                <h4>Reviewer feedback</h4>
                {selected.feedback?.length ? (
                  selected.feedback.map((entry) => (
                    <article key={entry.id}>
                      <strong>{entry.kind.replaceAll("_", " ")}</strong>
                      <p>{entry.body}</p>
                      <small>
                        {entry.authorDisplayName ?? "Review team"} ·{" "}
                        {new Date(entry.createdAt).toLocaleString()}
                      </small>
                    </article>
                  ))
                ) : (
                  <p>No submitter-visible feedback yet.</p>
                )}
              </section>
              {eligibleTeamIds.has(selected.submittingTeamId) &&
              ["DRAFT", "CHANGES_REQUESTED"].includes(selected.status) ? (
                <a
                  className="button button-primary"
                  href={`/upload-chapter/add-series?id=${encodeURIComponent(selected.id)}`}
                >
                  Edit and {selected.status === "CHANGES_REQUESTED" ? "resubmit" : "continue"}
                </a>
              ) : null}
              {["SUBMITTED", "UNDER_REVIEW", "CHANGES_REQUESTED"].includes(
                selected.status,
              ) ? (
                <div className="request-action-reason">
                  <label>
                    <span>Withdrawal reason</span>
                    <textarea
                      minLength={8}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={busy || reason.trim().length < 8}
                    onClick={() => void mutate("WITHDRAW")}
                  >
                    Withdraw request
                  </button>
                </div>
              ) : null}
              {selected.status === "DRAFT" ? (
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() => void mutate("DELETE_DRAFT")}
                >
                  Delete draft
                </button>
              ) : null}
              {["REJECTED", "WITHDRAWN"].includes(selected.status) ? (
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() => void mutate("CLONE_TO_DRAFT")}
                >
                  Clone into a new draft
                </button>
              ) : null}
              {selected.approvedSeries ? (
                <a
                  className="button button-secondary request-approved-link"
                  href={`/title/${selected.approvedSeries.slug}`}
                >
                  Open approved series <ArrowRight size={16} />
                </a>
              ) : null}
            </>
          ) : null}
        </aside>
        ) : null}
      </div>
    </section>
  );
}
