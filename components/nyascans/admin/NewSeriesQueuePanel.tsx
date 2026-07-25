"use client";
/* eslint-disable @next/next/no-img-element */

import {
  ArrowClockwise,
  ArrowSquareOut,
  CaretLeft,
  CaretRight,
  CheckCircle,
  Clock,
  Eye,
  FileText,
  LinkSimple,
  MagnifyingGlass,
  NotePencil,
  Plus,
  ShieldCheck,
  Trash,
  UserSwitch,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AdminPageScaffold,
  ConfirmActionDialog,
  useUnsavedChanges,
} from "@/components/nyascans/admin/AdminPageScaffold";

type RequestStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "CHANGES_REQUESTED"
  | "APPROVED"
  | "REJECTED"
  | "WITHDRAWN";

type DuplicateMatch = {
  kind: "SERIES" | "REQUEST";
  id: string;
  title: string;
  slug: string | null;
  status: string;
  reasons: string[];
  score: number;
  exactExternalId: boolean;
};

type RequestedTeam = {
  id: string;
  name: string;
  isPrimary: boolean;
  requestedCanUpload: boolean;
  requestedCanPublish: boolean;
};

type RequestSummary = {
  id: string;
  revision: number;
  status: RequestStatus;
  primaryTitle: string;
  alternativeTitles: string[];
  description: string;
  seriesType: "MANGA" | "MANHWA" | "MANHUA";
  publicationStatus: string;
  authors: Array<{ id?: string; name: string }>;
  artists: Array<{ id?: string; name: string }>;
  publisherName: string;
  countryCode: string;
  languageCode: string;
  readingDirection: string;
  genres: Array<{ id?: string; name: string }>;
  coverUrl: string | null;
  bannerUrl: string | null;
  externalSources: Array<{
    source: string;
    externalId: string;
    sourceUrl: string;
  }>;
  submitterNotes: string;
  duplicateConfirmation: boolean;
  duplicateExplanation: string;
  duplicateRiskScore: number;
  duplicateMatches: DuplicateMatch[];
  team: { id: string; name: string };
  submitter: { id: string; displayName: string };
  assignedReviewer: { id: string; displayName: string } | null;
  requestedTeams: RequestedTeam[];
  approvedSeries: { id: string; title: string; slug: string } | null;
  submittedAt: string | null;
  reviewStartedAt: string | null;
  reviewedAt: string | null;
  withdrawnAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type FeedbackRecord = {
  id: string;
  requestRevision: number;
  visibility: "SUBMITTER" | "INTERNAL";
  kind: string;
  fieldPath: string | null;
  body: string;
  authorUserId: string | null;
  authorDisplayName: string | null;
  createdAt: string;
};

type RevisionRecord = {
  revisionNumber: number;
  kind: string;
  snapshot: unknown;
  changedFields: unknown;
  authorUserId: string | null;
  authorDisplayName: string | null;
  createdAt: string;
};

type RequestDetail = RequestSummary & {
  feedback: FeedbackRecord[];
  revisions: RevisionRecord[];
};

type QueueOptions = {
  teams: Array<{ id: string; name: string }>;
  reviewers: Array<{ id: string; displayName: string }>;
  statuses: RequestStatus[];
};

type QueueFilters = {
  query: string;
  status: "ALL" | RequestStatus;
  teamId: string;
  reviewerId: string;
  type: "ALL" | "MANGA" | "MANHWA" | "MANHUA";
  duplicateRisk: "ALL" | "NONE" | "POSSIBLE";
  source: "ALL" | "ANY" | "NONE" | "MANGADEX" | "MANGAUPDATES";
  from: string;
  to: string;
};

type TeamRight = {
  teamId: string;
  name: string;
  canUpload: boolean;
  canPublish: boolean;
  uploadRequiresReview: boolean;
  allowedLanguages: string[];
  isPrimary: boolean;
};

type ExistingSeries = {
  id: string;
  title: string;
  slug: string;
  status: string;
  isPublished: boolean;
  archivedAt: string | null;
  coverUrl: string | null;
  chapterCount: number;
};

type DetailTab = "metadata" | "duplicates" | "review" | "decision";
type PendingAction =
  | "START_REVIEW"
  | "ASSIGN_REVIEWER"
  | "ADD_FEEDBACK"
  | "REQUEST_CHANGES"
  | "REJECT"
  | "APPROVE"
  | "ATTACH_EXISTING";

const defaultFilters: QueueFilters = {
  query: "",
  status: "ALL",
  teamId: "",
  reviewerId: "",
  type: "ALL",
  duplicateRisk: "ALL",
  source: "ALL",
  from: "",
  to: "",
};

class QueueApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function api<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  const payload = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new QueueApiError(
      response.status,
      payload.error?.message ?? "The review action could not be completed.",
    );
  }
  return payload;
}

function humanize(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not yet";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Unavailable";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function safeExternalUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function isoBoundary(value: string, end: boolean) {
  if (!value) return "";
  const date = new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(date.valueOf()) ? "" : date.toISOString();
}

function languageList(value: string) {
  return [
    ...new Set(
      value
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

function revisionChanges(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === "string") return humanize(entry);
        if (entry && typeof entry === "object") {
          const candidate = entry as Record<string, unknown>;
          return humanize(
            String(
              candidate.fieldPath ??
                candidate.field ??
                candidate.path ??
                candidate.name ??
                "Metadata",
            ),
          );
        }
        return "Metadata";
      })
      .filter(Boolean);
  }
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).map(humanize);
  }
  return [];
}

function statusExplanation(status: RequestStatus) {
  switch (status) {
    case "DRAFT":
      return "The team has not submitted this draft for review.";
    case "SUBMITTED":
      return "Waiting for an administrator to start or decide the review.";
    case "UNDER_REVIEW":
      return "An administrator is actively reviewing this request.";
    case "CHANGES_REQUESTED":
      return "Returned to the team with required corrections.";
    case "APPROVED":
      return "Approved and linked to a canonical series.";
    case "REJECTED":
      return "Closed without publishing a series.";
    case "WITHDRAWN":
      return "Withdrawn by the requesting team.";
  }
}

function rightsFor(detail: RequestDetail): TeamRight[] {
  const primaryId =
    detail.requestedTeams.find((team) => team.isPrimary)?.id ??
    detail.requestedTeams[0]?.id;
  return detail.requestedTeams.map((team) => ({
    teamId: team.id,
    name: team.name,
    canUpload: team.requestedCanUpload,
    canPublish:
      team.requestedCanUpload && team.requestedCanPublish,
    uploadRequiresReview: true,
    allowedLanguages: detail.languageCode ? [detail.languageCode] : [],
    isPrimary: team.id === primaryId,
  }));
}

function requestSearchParams(
  filters: QueueFilters,
  page: number,
  selectedId?: string,
) {
  const parameters = new URLSearchParams();
  if (filters.query) parameters.set("query", filters.query);
  if (filters.status !== "ALL") parameters.set("status", filters.status);
  if (filters.teamId) parameters.set("teamId", filters.teamId);
  if (filters.reviewerId)
    parameters.set("reviewerId", filters.reviewerId);
  if (filters.type !== "ALL") parameters.set("type", filters.type);
  if (filters.duplicateRisk !== "ALL")
    parameters.set("duplicateRisk", filters.duplicateRisk);
  if (filters.source !== "ALL") parameters.set("source", filters.source);
  if (filters.from) parameters.set("from", filters.from);
  if (filters.to) parameters.set("to", filters.to);
  if (page > 1) parameters.set("page", String(page));
  if (selectedId) parameters.set("id", selectedId);
  return parameters;
}

function apiSearchParams(filters: QueueFilters, page: number) {
  const parameters = requestSearchParams(filters, page);
  parameters.delete("from");
  parameters.delete("to");
  if (filters.from) parameters.set("from", isoBoundary(filters.from, false));
  if (filters.to) parameters.set("to", isoBoundary(filters.to, true));
  parameters.set("limit", "20");
  return parameters;
}

function MetadataValue({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>{children || "Not provided"}</strong>
    </div>
  );
}

export function NewSeriesQueuePanel() {
  const [initialized, setInitialized] = useState(false);
  const [filters, setFilters] = useState<QueueFilters>(defaultFilters);
  const [appliedFilters, setAppliedFilters] =
    useState<QueueFilters>(defaultFilters);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({
    page: 1,
    pages: 1,
    total: 0,
  });
  const [options, setOptions] = useState<QueueOptions>({
    teams: [],
    reviewers: [],
    statuses: [],
  });
  const [requests, setRequests] = useState<RequestSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const selectedIdRef = useRef("");
  const initialRequestedId = useRef("");
  const loadedDetailId = useRef("");
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [detailRefresh, setDetailRefresh] = useState(0);
  const [tab, setTab] = useState<DetailTab>("metadata");
  const [message, setMessage] = useState<{
    kind: "success" | "error" | "neutral";
    text: string;
  } | null>(null);
  const [busyAction, setBusyAction] = useState<PendingAction | null>(null);
  const [pendingAction, setPendingAction] =
    useState<PendingAction | null>(null);

  const [reviewerId, setReviewerId] = useState("");
  const [assignmentReason, setAssignmentReason] = useState("");
  const [feedbackVisibility, setFeedbackVisibility] =
    useState<"SUBMITTER" | "INTERNAL">("SUBMITTER");
  const [feedbackField, setFeedbackField] = useState("");
  const [feedbackBody, setFeedbackBody] = useState("");
  const [changeReason, setChangeReason] = useState("");
  const [changeFields, setChangeFields] = useState([
    { fieldPath: "", comment: "" },
  ]);
  const [rejectionReason, setRejectionReason] = useState("");
  const [approvalReason, setApprovalReason] = useState("");
  const [attachReason, setAttachReason] = useState("");
  const [teamRights, setTeamRights] = useState<TeamRight[]>([]);
  const [savedTeamRights, setSavedTeamRights] = useState<TeamRight[]>([]);
  const [seriesQuery, setSeriesQuery] = useState("");
  const [seriesResults, setSeriesResults] = useState<ExistingSeries[]>([]);
  const [selectedSeries, setSelectedSeries] =
    useState<ExistingSeries | null>(null);
  const [seriesSearching, setSeriesSearching] = useState(false);

  const actionDraftDirty = Boolean(
    assignmentReason ||
      feedbackField ||
      feedbackBody ||
      changeReason ||
      changeFields.some((field) => field.fieldPath || field.comment) ||
      rejectionReason ||
      approvalReason ||
      attachReason ||
      seriesQuery ||
      selectedSeries ||
      JSON.stringify(teamRights) !== JSON.stringify(savedTeamRights),
  );
  useUnsavedChanges(actionDraftDirty, "new-series review notes");

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const parameters = new URLSearchParams(window.location.search);
      const next: QueueFilters = {
        query: parameters.get("query") ?? "",
        status:
          (parameters.get("status") as QueueFilters["status"]) ?? "ALL",
        teamId: parameters.get("teamId") ?? "",
        reviewerId: parameters.get("reviewerId") ?? "",
        type: (parameters.get("type") as QueueFilters["type"]) ?? "ALL",
        duplicateRisk:
          (parameters.get(
            "duplicateRisk",
          ) as QueueFilters["duplicateRisk"]) ?? "ALL",
        source:
          (parameters.get("source") as QueueFilters["source"]) ?? "ALL",
        from: parameters.get("from") ?? "",
        to: parameters.get("to") ?? "",
      };
      const requestedPage = Math.max(
        1,
        Number.parseInt(parameters.get("page") ?? "1", 10) || 1,
      );
      initialRequestedId.current = parameters.get("id") ?? "";
      setFilters(next);
      setAppliedFilters(next);
      setPage(requestedPage);
      setInitialized(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!initialized) return;
    const controller = new AbortController();
    void api<{
      data: RequestSummary[];
      pagination: {
        page: number;
        pages: number;
        total: number;
      };
      options: QueueOptions;
    }>(
      `/api/v1/admin/series-requests?${apiSearchParams(appliedFilters, page)}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then((payload) => {
        setRequests(payload.data);
        setPagination(payload.pagination);
        setOptions(payload.options);
        const explicitlyRequested = initialRequestedId.current;
        const currentStillVisible = payload.data.some(
          (request) => request.id === selectedIdRef.current,
        );
        const desired =
          explicitlyRequested ||
          (currentStillVisible ? selectedIdRef.current : "") ||
          payload.data[0]?.id ||
          "";
        initialRequestedId.current = "";
        if (desired !== selectedIdRef.current) {
          selectedIdRef.current = desired;
          setDetailLoading(Boolean(desired));
          setDetailError("");
          setSelectedId(desired);
          if (!desired) {
            loadedDetailId.current = "";
            setDetail(null);
          }
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setLoadError(
          error instanceof Error
            ? error.message
            : "The queue could not be loaded.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setListLoading(false);
      });
    return () => controller.abort();
  }, [appliedFilters, initialized, page, refresh]);

  useEffect(() => {
    if (!initialized) return;
    const parameters = requestSearchParams(
      appliedFilters,
      page,
      selectedId || undefined,
    );
    const query = parameters.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    );
  }, [appliedFilters, initialized, page, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    void api<{
      data: RequestDetail;
      capabilities: {
        canApprove: boolean;
        canReject: boolean;
        canRequestChanges: boolean;
        canReassign: boolean;
        canAttachExisting: boolean;
      };
    }>(
      `/api/v1/admin/series-requests?id=${encodeURIComponent(selectedId)}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then((payload) => {
        if (loadedDetailId.current !== payload.data.id) {
          const nextRights = rightsFor(payload.data);
          loadedDetailId.current = payload.data.id;
          setTeamRights(nextRights);
          setSavedTeamRights(nextRights);
          setReviewerId(payload.data.assignedReviewer?.id ?? "");
          setAssignmentReason("");
          setFeedbackVisibility("SUBMITTER");
          setFeedbackField("");
          setFeedbackBody("");
          setChangeReason("");
          setChangeFields([{ fieldPath: "", comment: "" }]);
          setRejectionReason("");
          setApprovalReason("");
          setAttachReason("");
          setSeriesQuery("");
          setSeriesResults([]);
          setSelectedSeries(null);
          setTab("metadata");
        }
        setDetail(payload.data);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setDetailError(
          error instanceof Error
            ? error.message
            : "This request could not be loaded.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [detailRefresh, selectedId]);

  const mutableReview = Boolean(
    detail &&
      ["SUBMITTED", "UNDER_REVIEW", "CHANGES_REQUESTED"].includes(
        detail.status,
      ),
  );
  const canDecide = Boolean(
    detail && ["SUBMITTED", "UNDER_REVIEW"].includes(detail.status),
  );
  const canReject = Boolean(
    detail &&
      ["SUBMITTED", "UNDER_REVIEW", "CHANGES_REQUESTED"].includes(
        detail.status,
      ),
  );
  const teamRightsValid =
    teamRights.length > 0 &&
    teamRights.filter((right) => right.isPrimary).length === 1 &&
    teamRights.every(
      (right) =>
        (!right.canPublish || right.canUpload) &&
        right.allowedLanguages.every((language) =>
          /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/.test(language),
        ),
    );

  function discardActionDrafts() {
    if (!detail) return;
    const nextRights = rightsFor(detail);
    setTeamRights(nextRights);
    setSavedTeamRights(nextRights);
    setAssignmentReason("");
    setFeedbackField("");
    setFeedbackBody("");
    setChangeReason("");
    setChangeFields([{ fieldPath: "", comment: "" }]);
    setRejectionReason("");
    setApprovalReason("");
    setAttachReason("");
    setSeriesQuery("");
    setSeriesResults([]);
    setSelectedSeries(null);
  }

  function chooseRequest(requestId: string) {
    if (
      actionDraftDirty &&
      !window.confirm(
        "Discard the unsent review notes and open another request?",
      )
    ) {
      return;
    }
    discardActionDrafts();
    selectedIdRef.current = requestId;
    setDetailLoading(true);
    setDetailError("");
    setSelectedId(requestId);
    setMessage(null);
  }

  function confirmQueueNavigation() {
    if (
      actionDraftDirty &&
      !window.confirm("Discard the unsent review notes and continue?")
    ) {
      return false;
    }
    discardActionDrafts();
    return true;
  }

  function submitFilters(event: FormEvent) {
    event.preventDefault();
    if (!confirmQueueNavigation()) return;
    setListLoading(true);
    setLoadError("");
    setPage(1);
    setAppliedFilters(filters);
    setRefresh((value) => value + 1);
  }

  function resetFilters() {
    if (!confirmQueueNavigation()) return;
    setListLoading(true);
    setLoadError("");
    setFilters(defaultFilters);
    setAppliedFilters(defaultFilters);
    setPage(1);
    setRefresh((value) => value + 1);
  }

  async function mutate(
    action: PendingAction,
    body: Record<string, unknown>,
    success: string,
  ) {
    if (!detail) return;
    setBusyAction(action);
    setMessage(null);
    try {
      const payload = await api<{ data: RequestDetail }>(
        "/api/v1/admin/series-requests",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action,
            requestId: detail.id,
            expectedRevision: detail.revision,
            ...body,
          }),
        },
      );
      setDetail(payload.data);
      setRequests((current) =>
        current.map((request) =>
          request.id === payload.data.id ? payload.data : request,
        ),
      );
      setMessage({ kind: "success", text: success });
      setRefresh((value) => value + 1);
      if (action === "ADD_FEEDBACK") {
        setFeedbackField("");
        setFeedbackBody("");
      } else if (action === "ASSIGN_REVIEWER") {
        setAssignmentReason("");
      } else if (
        action === "APPROVE" ||
        action === "ATTACH_EXISTING" ||
        action === "REJECT" ||
        action === "REQUEST_CHANGES"
      ) {
        discardActionDrafts();
      }
    } catch (error) {
      const conflict = error instanceof QueueApiError && error.status === 409;
      setMessage({
        kind: "error",
        text:
          error instanceof Error
            ? `${error.message}${conflict ? " The latest revision is being reloaded." : ""}`
            : "The review action could not be completed.",
      });
      if (conflict) {
        setDetailLoading(true);
        setDetailError("");
        setDetailRefresh((value) => value + 1);
        setRefresh((value) => value + 1);
      }
    } finally {
      setBusyAction(null);
      setPendingAction(null);
    }
  }

  async function confirmPendingAction() {
    if (!detail || !pendingAction) return;
    switch (pendingAction) {
      case "START_REVIEW":
        await mutate(
          pendingAction,
          {},
          "Review started and assigned to you.",
        );
        return;
      case "ASSIGN_REVIEWER":
        await mutate(
          pendingAction,
          {
            reviewerUserId: reviewerId || null,
            reason: assignmentReason.trim(),
          },
          reviewerId
            ? "Reviewer assignment updated."
            : "Reviewer assignment cleared.",
        );
        return;
      case "ADD_FEEDBACK":
        await mutate(
          pendingAction,
          {
            visibility: feedbackVisibility,
            body: feedbackBody.trim(),
            fieldPath: feedbackField.trim() || null,
          },
          feedbackVisibility === "INTERNAL"
            ? "Internal note added."
            : "Submitter-visible feedback added.",
        );
        return;
      case "REQUEST_CHANGES":
        await mutate(
          pendingAction,
          {
            reason: changeReason.trim(),
            fields: changeFields.map((field) => ({
              fieldPath: field.fieldPath.trim(),
              comment: field.comment.trim(),
            })),
          },
          "Changes requested and the submitting team was notified.",
        );
        return;
      case "REJECT":
        await mutate(
          pendingAction,
          { reason: rejectionReason.trim() },
          "Request rejected and preserved in review history.",
        );
        return;
      case "APPROVE":
        await mutate(
          pendingAction,
          {
            reason: approvalReason.trim(),
            teamRights: teamRights.map((right) => ({
              teamId: right.teamId,
              canUpload: right.canUpload,
              canPublish: right.canPublish,
              uploadRequiresReview: right.uploadRequiresReview,
              allowedLanguages: right.allowedLanguages,
              isPrimary: right.isPrimary,
            })),
          },
          "Request approved and its canonical series was created.",
        );
        return;
      case "ATTACH_EXISTING":
        if (!selectedSeries) return;
        await mutate(
          pendingAction,
          {
            seriesId: selectedSeries.id,
            reason: attachReason.trim(),
            teamRights: teamRights.map((right) => ({
              teamId: right.teamId,
              canUpload: right.canUpload,
              canPublish: right.canPublish,
              uploadRequiresReview: right.uploadRequiresReview,
              allowedLanguages: right.allowedLanguages,
              isPrimary: right.isPrimary,
            })),
          },
          "Request attached to the existing canonical series.",
        );
    }
  }

  async function searchSeries(event: FormEvent) {
    event.preventDefault();
    if (seriesQuery.trim().length < 2) {
      setMessage({
        kind: "neutral",
        text: "Enter at least two characters to search canonical series.",
      });
      return;
    }
    setSeriesSearching(true);
    setMessage(null);
    try {
      const payload = await api<{ data: ExistingSeries[] }>(
        `/api/v1/admin/series-management?query=${encodeURIComponent(seriesQuery.trim())}&status=ALL&page=1&limit=12`,
        { cache: "no-store" },
      );
      setSeriesResults(
        payload.data.filter((series) => !series.archivedAt),
      );
    } catch (error) {
      setMessage({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Canonical series search failed.",
      });
    } finally {
      setSeriesSearching(false);
    }
  }

  function selectDuplicateSeries(match: DuplicateMatch) {
    if (match.kind !== "SERIES" || !match.slug) return;
    setSelectedSeries({
      id: match.id,
      title: match.title,
      slug: match.slug,
      status: match.status,
      isPublished: true,
      archivedAt: null,
      coverUrl: null,
      chapterCount: 0,
    });
    setTab("decision");
  }

  const dialogCopy = useMemo(() => {
    switch (pendingAction) {
      case "START_REVIEW":
        return {
          title: "Start this review?",
          description:
            "The request will move to Under Review and be assigned to your administrator account.",
          confirmLabel: "Start review",
          destructive: false,
        };
      case "ASSIGN_REVIEWER":
        return {
          title: "Update reviewer assignment?",
          description:
            "The assignment and its reason will be recorded in the immutable review history.",
          confirmLabel: reviewerId ? "Assign reviewer" : "Clear assignment",
          destructive: false,
        };
      case "ADD_FEEDBACK":
        return {
          title:
            feedbackVisibility === "INTERNAL"
              ? "Add internal note?"
              : "Send feedback to the team?",
          description:
            feedbackVisibility === "INTERNAL"
              ? "Only administrators will be able to read this note."
              : "Eligible members of the submitting team will be able to read this feedback.",
          confirmLabel:
            feedbackVisibility === "INTERNAL" ? "Add note" : "Send feedback",
          destructive: false,
        };
      case "REQUEST_CHANGES":
        return {
          title: "Return this request for changes?",
          description:
            "The request will be locked for administrators until the team corrects the identified fields and resubmits it.",
          confirmLabel: "Request changes",
          destructive: true,
        };
      case "REJECT":
        return {
          title: "Reject this request?",
          description:
            "Nothing will be published. The request, reason, media references, and history remain available for audit.",
          confirmLabel: "Reject request",
          destructive: true,
        };
      case "APPROVE":
        return {
          title: "Approve and create the canonical series?",
          description:
            "Reviewed metadata, media, source identifiers, and team rights will be committed transactionally. This cannot be approved twice.",
          confirmLabel: "Approve request",
          destructive: false,
        };
      case "ATTACH_EXISTING":
        return {
          title: "Attach to the existing series?",
          description: `This request will be approved without creating another series and linked to ${selectedSeries?.title ?? "the selected canonical series"}.`,
          confirmLabel: "Attach and approve",
          destructive: false,
        };
      default:
        return {
          title: "Confirm review action",
          description: "This action will be recorded in review history.",
          confirmLabel: "Confirm",
          destructive: false,
        };
    }
  }, [feedbackVisibility, pendingAction, reviewerId, selectedSeries?.title]);

  const detailTabs = detail
    ? [
        { key: "metadata", label: "Submitted data" },
        {
          key: "duplicates",
          label: "Duplicate review",
          count: detail.duplicateMatches.length,
        },
        {
          key: "review",
          label: "Feedback & history",
          count: detail.feedback.length,
        },
        { key: "decision", label: "Review actions" },
      ]
    : [];

  return (
    <AdminPageScaffold
      breadcrumbs={["Admin", "Catalogue & publishing"]}
      kicker="Title creation approval"
      title="New Series Queue"
      description="Review team-submitted title requests, compare likely duplicates, record feedback, and create or attach one canonical series."
      message={message}
      primaryAction={
        <button
          className="button button-secondary"
          type="button"
          disabled={listLoading}
          onClick={() => {
            setListLoading(true);
            setLoadError("");
            setRefresh((value) => value + 1);
          }}
        >
          <ArrowClockwise size={16} />
          Refresh queue
        </button>
      }
    >
      <form className="nsq-filter-panel" onSubmit={submitFilters}>
        <label className="nsq-query-field">
          <span>Search request</span>
          <div>
            <MagnifyingGlass size={17} aria-hidden="true" />
            <input
              value={filters.query}
              maxLength={160}
              placeholder="Title, submitter, team or source ID"
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  query: event.target.value,
                }))
              }
            />
          </div>
        </label>
        <label>
          Status
          <select
            value={filters.status}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                status: event.target.value as QueueFilters["status"],
              }))
            }
          >
            <option value="ALL">All statuses</option>
            {options.statuses.map((status) => (
              <option key={status} value={status}>
                {humanize(status)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Team
          <select
            value={filters.teamId}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                teamId: event.target.value,
              }))
            }
          >
            <option value="">All teams</option>
            {options.teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Reviewer
          <select
            value={filters.reviewerId}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                reviewerId: event.target.value,
              }))
            }
          >
            <option value="">All reviewers</option>
            <option value="UNASSIGNED">Unassigned</option>
            {options.reviewers.map((reviewer) => (
              <option key={reviewer.id} value={reviewer.id}>
                {reviewer.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Series type
          <select
            value={filters.type}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                type: event.target.value as QueueFilters["type"],
              }))
            }
          >
            <option value="ALL">All types</option>
            <option value="MANGA">Manga</option>
            <option value="MANHWA">Manhwa</option>
            <option value="MANHUA">Manhua</option>
          </select>
        </label>
        <label>
          Duplicate risk
          <select
            value={filters.duplicateRisk}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                duplicateRisk: event.target
                  .value as QueueFilters["duplicateRisk"],
              }))
            }
          >
            <option value="ALL">Any risk</option>
            <option value="POSSIBLE">Possible duplicate</option>
            <option value="NONE">No detected match</option>
          </select>
        </label>
        <label>
          Source
          <select
            value={filters.source}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                source: event.target.value as QueueFilters["source"],
              }))
            }
          >
            <option value="ALL">Any source state</option>
            <option value="ANY">Has a source</option>
            <option value="NONE">No source</option>
            <option value="MANGADEX">MangaDex</option>
            <option value="MANGAUPDATES">MangaUpdates</option>
          </select>
        </label>
        <label>
          Submitted from
          <input
            type="date"
            value={filters.from}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                from: event.target.value,
              }))
            }
          />
        </label>
        <label>
          Submitted through
          <input
            type="date"
            min={filters.from || undefined}
            value={filters.to}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                to: event.target.value,
              }))
            }
          />
        </label>
        <div className="nsq-filter-actions">
          <button className="button button-primary" type="submit">
            Apply filters
          </button>
          <button
            className="button button-secondary"
            type="button"
            onClick={resetFilters}
          >
            Reset
          </button>
        </div>
      </form>

      <div className="nsq-queue-summary" aria-live="polite">
        <span>
          <FileText size={17} />
          <strong>{pagination.total.toLocaleString("en-US")}</strong>{" "}
          matching requests
        </span>
        <span>
          Page {pagination.page} of {pagination.pages}
        </span>
      </div>

      {loadError ? (
        <div className="admin-state-card" role="alert">
          <WarningCircle size={24} />
          <h3>Queue unavailable</h3>
          <p>{loadError}</p>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => {
              setListLoading(true);
              setLoadError("");
              setRefresh((value) => value + 1);
            }}
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="admin-master-detail nsq-master-detail">
          <aside className="admin-record-list nsq-request-list">
            {listLoading ? (
              <div className="nsq-list-loading" role="status">
                <span className="admin-spinner" />
                Loading requests…
              </div>
            ) : requests.length ? (
              requests.map((request) => (
                <button
                  type="button"
                  key={request.id}
                  aria-current={selectedId === request.id}
                  onClick={() => chooseRequest(request.id)}
                >
                  <span className="admin-list-avatar nsq-list-cover">
                    {request.coverUrl ? (
                      <img src={request.coverUrl} alt="" />
                    ) : (
                      <FileText size={19} aria-hidden="true" />
                    )}
                  </span>
                  <span>
                    <strong>{request.primaryTitle}</strong>
                    <small>
                      {request.team.name} · {request.seriesType} ·{" "}
                      {request.countryCode.toUpperCase()}/
                      {request.languageCode.toUpperCase()}
                    </small>
                    <em>
                      {request.submitter.displayName} ·{" "}
                      {formatDate(request.submittedAt)}
                    </em>
                    <em>
                      Reviewer:{" "}
                      {request.assignedReviewer?.displayName ?? "Unassigned"}
                    </em>
                    <small>
                      {request.externalSources.length
                        ? request.externalSources
                            .map(
                              (source) =>
                                `${humanize(source.source)} ${source.externalId}`,
                            )
                            .join(" · ")
                        : "No external source"}
                    </small>
                  </span>
                  <span
                    className="nsq-status"
                    data-status={request.status}
                    title={statusExplanation(request.status)}
                  >
                    {humanize(request.status)}
                  </span>
                  {request.duplicateRiskScore > 0 ? (
                    <span
                      className="nsq-risk-dot"
                      title={`Duplicate risk ${request.duplicateRiskScore}%`}
                      aria-label={`Duplicate risk ${request.duplicateRiskScore}%`}
                    />
                  ) : null}
                </button>
              ))
            ) : (
              <div className="nsq-list-empty">
                <FileText size={26} />
                <strong>No matching requests</strong>
                <p>Adjust the filters or wait for a team submission.</p>
              </div>
            )}
            <nav className="nsq-pagination" aria-label="Queue pages">
              <button
                className="button button-secondary"
                type="button"
                aria-label="Previous queue page"
                disabled={page <= 1 || listLoading}
                onClick={() => {
                  if (!confirmQueueNavigation()) return;
                  setListLoading(true);
                  setLoadError("");
                  setPage((value) => Math.max(1, value - 1));
                }}
              >
                <CaretLeft size={15} />
              </button>
              <span>
                {pagination.page} / {pagination.pages}
              </span>
              <button
                className="button button-secondary"
                type="button"
                aria-label="Next queue page"
                disabled={page >= pagination.pages || listLoading}
                onClick={() => {
                  if (!confirmQueueNavigation()) return;
                  setListLoading(true);
                  setLoadError("");
                  setPage((value) =>
                    Math.min(pagination.pages, value + 1),
                  );
                }}
              >
                <CaretRight size={15} />
              </button>
            </nav>
          </aside>

          <section className="nsq-detail-shell">
            {detailLoading ? (
              <div className="admin-state-card" role="status">
                <span className="admin-spinner" />
                <h3>Loading request</h3>
                <p>Retrieving private media and review history…</p>
              </div>
            ) : detailError ? (
              <div className="admin-state-card" role="alert">
                <WarningCircle size={24} />
                <h3>Request unavailable</h3>
                <p>{detailError}</p>
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => {
                    setDetailLoading(true);
                    setDetailError("");
                    setDetailRefresh((value) => value + 1);
                  }}
                >
                  Try again
                </button>
              </div>
            ) : detail ? (
              <>
                <header className="nsq-detail-header">
                  <div>
                    <span className="ops-kicker">
                      Request {detail.id.slice(-8)}
                    </span>
                    <h3>{detail.primaryTitle}</h3>
                    <p>
                      Submitted by {detail.submitter.displayName} for{" "}
                      {detail.team.name}.
                    </p>
                  </div>
                  <div>
                    <span
                      className="nsq-status"
                      data-status={detail.status}
                    >
                      {humanize(detail.status)}
                    </span>
                    <small>{statusExplanation(detail.status)}</small>
                  </div>
                </header>

                <div
                  className="admin-subnav nsq-detail-tabs"
                  role="tablist"
                  aria-label="Request review sections"
                >
                  {detailTabs.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      role="tab"
                      aria-selected={tab === item.key}
                      onClick={() => setTab(item.key as DetailTab)}
                    >
                      {item.label}
                      {"count" in item ? <small>{item.count}</small> : null}
                    </button>
                  ))}
                </div>

                {tab === "metadata" ? (
                  <div className="nsq-detail-content">
                    <section className="admin-form-section nsq-media-review">
                      <header>
                        <div>
                          <h3>Artwork and public-page preview</h3>
                          <p>
                            Private request media remains access-controlled
                            until a decision is committed.
                          </p>
                        </div>
                      </header>
                      <div className="nsq-artwork-grid">
                        <figure className="nsq-banner-preview">
                          {detail.bannerUrl ? (
                            <img
                              src={detail.bannerUrl}
                              alt={`${detail.primaryTitle} banner preview`}
                            />
                          ) : (
                            <span>No banner submitted</span>
                          )}
                          <figcaption>Banner preview</figcaption>
                        </figure>
                        <article className="nsq-public-preview">
                          <div className="nsq-cover-preview">
                            {detail.coverUrl ? (
                              <img
                                src={detail.coverUrl}
                                alt={`${detail.primaryTitle} cover preview`}
                              />
                            ) : (
                              <FileText size={34} />
                            )}
                          </div>
                          <div>
                            <span>
                              {detail.seriesType} ·{" "}
                              {humanize(detail.publicationStatus)}
                            </span>
                            <h4>{detail.primaryTitle}</h4>
                            <p>{detail.description}</p>
                            <div className="nsq-chip-row">
                              {detail.genres.slice(0, 6).map((genre) => (
                                <span key={genre.id ?? genre.name}>
                                  {genre.name}
                                </span>
                              ))}
                            </div>
                          </div>
                        </article>
                      </div>
                    </section>

                    <section className="admin-form-section">
                      <header>
                        <div>
                          <h3>Submitted metadata</h3>
                          <p>
                            Values shown here are the exact reviewed request
                            revision, not a client-side draft.
                          </p>
                        </div>
                      </header>
                      <div className="admin-review-grid">
                        <MetadataValue label="Primary title">
                          {detail.primaryTitle}
                        </MetadataValue>
                        <MetadataValue label="Alternative titles">
                          {detail.alternativeTitles.join(" · ")}
                        </MetadataValue>
                        <MetadataValue label="Type">
                          {humanize(detail.seriesType)}
                        </MetadataValue>
                        <MetadataValue label="Publication status">
                          {humanize(detail.publicationStatus)}
                        </MetadataValue>
                        <MetadataValue label="Country / language">
                          {detail.countryCode.toUpperCase()} ·{" "}
                          {detail.languageCode.toUpperCase()}
                        </MetadataValue>
                        <MetadataValue label="Reading direction">
                          {humanize(detail.readingDirection)}
                        </MetadataValue>
                        <MetadataValue label="Authors">
                          {detail.authors.map((author) => author.name).join(", ")}
                        </MetadataValue>
                        <MetadataValue label="Artists">
                          {detail.artists.map((artist) => artist.name).join(", ")}
                        </MetadataValue>
                        <MetadataValue label="Publishing studio">
                          {detail.publisherName}
                        </MetadataValue>
                        <MetadataValue label="Genres">
                          {detail.genres.map((genre) => genre.name).join(", ")}
                        </MetadataValue>
                      </div>
                      <div className="nsq-long-copy">
                        <span>Description</span>
                        <p>{detail.description}</p>
                      </div>
                      <div className="nsq-long-copy">
                        <span>Submitter notes</span>
                        <p>
                          {detail.submitterNotes ||
                            "No additional reviewer notes were supplied."}
                        </p>
                      </div>
                    </section>

                    <section className="admin-form-section">
                      <header>
                        <div>
                          <h3>Team and source context</h3>
                          <p>
                            Approval rights can be narrowed before the
                            canonical series is created.
                          </p>
                        </div>
                      </header>
                      <div className="nsq-team-cards">
                        {detail.requestedTeams.map((team) => (
                          <article key={team.id}>
                            <ShieldCheck size={19} />
                            <div>
                              <strong>{team.name}</strong>
                              <span>
                                {team.isPrimary ? "Primary request team" : "Additional team"}
                              </span>
                            </div>
                            <small>
                              {team.requestedCanUpload
                                ? "Upload requested"
                                : "Attribution only"}
                              {team.requestedCanPublish
                                ? " · Publish requested"
                                : ""}
                            </small>
                          </article>
                        ))}
                      </div>
                      <div className="nsq-source-list">
                        {detail.externalSources.length ? (
                          detail.externalSources.map((source) => {
                            const href = safeExternalUrl(source.sourceUrl);
                            return (
                              <article key={source.source}>
                                <LinkSimple size={18} />
                                <div>
                                  <strong>{humanize(source.source)}</strong>
                                  <span>{source.externalId}</span>
                                </div>
                                {href ? (
                                  <a
                                    className="button button-secondary"
                                    href={href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    Open source
                                    <ArrowSquareOut size={14} />
                                  </a>
                                ) : (
                                  <span>URL unavailable</span>
                                )}
                              </article>
                            );
                          })
                        ) : (
                          <p>No external source was supplied.</p>
                        )}
                      </div>
                    </section>
                  </div>
                ) : null}

                {tab === "duplicates" ? (
                  <div className="nsq-detail-content">
                    <section className="admin-form-section">
                      <header>
                        <div>
                          <h3>Duplicate assessment</h3>
                          <p>
                            Similarity is a review aid. Exact external IDs
                            block creating a second canonical series.
                          </p>
                        </div>
                        <span className="nsq-risk-score">
                          {detail.duplicateRiskScore}% risk
                        </span>
                      </header>
                      {detail.duplicateConfirmation ? (
                        <div className="admin-notice admin-notice-neutral">
                          <NotePencil size={18} />
                          <span>
                            Team explanation:{" "}
                            {detail.duplicateExplanation ||
                              "No explanation was recorded."}
                          </span>
                        </div>
                      ) : null}
                      <div className="nsq-comparison-grid">
                        <article className="nsq-comparison-request">
                          <span>Submitted request</span>
                          <h4>{detail.primaryTitle}</h4>
                          <p>
                            {detail.authors
                              .map((author) => author.name)
                              .join(", ") || "No author supplied"}
                          </p>
                          <small>
                            {detail.seriesType} ·{" "}
                            {detail.countryCode.toUpperCase()} ·{" "}
                            {detail.languageCode.toUpperCase()}
                          </small>
                        </article>
                        {detail.duplicateMatches.length ? (
                          detail.duplicateMatches.map((match) => (
                            <article
                              className="nsq-duplicate-card"
                              key={`${match.kind}:${match.id}`}
                            >
                              <header>
                                <span>{humanize(match.kind)}</span>
                                <strong>{match.score}%</strong>
                              </header>
                              <h4>{match.title}</h4>
                              <small>
                                {humanize(match.status)}
                                {match.exactExternalId
                                  ? " · Exact source ID"
                                  : ""}
                              </small>
                              <ul>
                                {match.reasons.map((reason) => (
                                  <li key={reason}>{reason}</li>
                                ))}
                              </ul>
                              <div>
                                {match.kind === "SERIES" && match.slug ? (
                                  <>
                                    <a
                                      className="button button-secondary"
                                      href={`/title/${encodeURIComponent(match.slug)}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      <Eye size={14} />
                                      Open series
                                    </a>
                                    {canDecide ? (
                                      <button
                                        className="button button-secondary"
                                        type="button"
                                        onClick={() =>
                                          selectDuplicateSeries(match)
                                        }
                                      >
                                        Use for attachment
                                      </button>
                                    ) : null}
                                  </>
                                ) : (
                                  <button
                                    className="button button-secondary"
                                    type="button"
                                    onClick={() => chooseRequest(match.id)}
                                  >
                                    Open request
                                  </button>
                                )}
                              </div>
                            </article>
                          ))
                        ) : (
                          <div className="nsq-no-duplicates">
                            <CheckCircle size={26} weight="fill" />
                            <strong>No likely match detected</strong>
                            <p>
                              Review source identifiers and metadata before
                              approval even when automated matching is clear.
                            </p>
                          </div>
                        )}
                      </div>
                    </section>
                  </div>
                ) : null}

                {tab === "review" ? (
                  <div className="nsq-detail-content">
                    <section className="admin-form-section">
                      <header>
                        <div>
                          <h3>Reviewer assignment</h3>
                          <p>
                            Assignment changes require a reason and use the
                            current request revision.
                          </p>
                        </div>
                      </header>
                      {mutableReview ? (
                        <div className="nsq-assignment-form">
                          <label>
                            Assigned reviewer
                            <select
                              value={reviewerId}
                              onChange={(event) =>
                                setReviewerId(event.target.value)
                              }
                            >
                              <option value="">Unassigned</option>
                              {options.reviewers.map((reviewer) => (
                                <option key={reviewer.id} value={reviewer.id}>
                                  {reviewer.displayName}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Assignment reason
                            <input
                              value={assignmentReason}
                              minLength={8}
                              maxLength={1_000}
                              placeholder="Why this assignment is changing"
                              onChange={(event) =>
                                setAssignmentReason(event.target.value)
                              }
                            />
                          </label>
                          <button
                            className="button button-secondary"
                            type="button"
                            disabled={
                              assignmentReason.trim().length < 8 ||
                              Boolean(busyAction)
                            }
                            title={
                              assignmentReason.trim().length < 8
                                ? "Enter a reason of at least 8 characters."
                                : undefined
                            }
                            onClick={() =>
                              setPendingAction("ASSIGN_REVIEWER")
                            }
                          >
                            <UserSwitch size={16} />
                            Update assignment
                          </button>
                        </div>
                      ) : (
                        <p className="nsq-readonly-note">
                          This completed request is read-only. Its assignment
                          history remains below.
                        </p>
                      )}
                    </section>

                    <section className="admin-form-section">
                      <header>
                        <div>
                          <h3>Feedback and internal notes</h3>
                          <p>
                            Submitter feedback is visible to the eligible team.
                            Internal notes never leave the administrator queue.
                          </p>
                        </div>
                      </header>
                      {mutableReview ? (
                        <div className="nsq-feedback-composer">
                          <label>
                            Visibility
                            <select
                              value={feedbackVisibility}
                              onChange={(event) =>
                                setFeedbackVisibility(
                                  event.target.value as
                                    | "SUBMITTER"
                                    | "INTERNAL",
                                )
                              }
                            >
                              <option value="SUBMITTER">
                                Submitter-visible feedback
                              </option>
                              <option value="INTERNAL">
                                Administrator-only note
                              </option>
                            </select>
                          </label>
                          <label>
                            Related field, optional
                            <input
                              value={feedbackField}
                              maxLength={240}
                              placeholder="e.g. cover or authors"
                              onChange={(event) =>
                                setFeedbackField(event.target.value)
                              }
                            />
                          </label>
                          <label className="nsq-span-all">
                            Message
                            <textarea
                              value={feedbackBody}
                              minLength={2}
                              maxLength={4_000}
                              placeholder={
                                feedbackVisibility === "INTERNAL"
                                  ? "Record context for other administrators"
                                  : "Give the team clear, actionable guidance"
                              }
                              onChange={(event) =>
                                setFeedbackBody(event.target.value)
                              }
                            />
                          </label>
                          <button
                            className="button button-primary"
                            type="button"
                            disabled={
                              feedbackBody.trim().length < 2 ||
                              Boolean(busyAction)
                            }
                            onClick={() =>
                              setPendingAction("ADD_FEEDBACK")
                            }
                          >
                            {feedbackVisibility === "INTERNAL"
                              ? "Add internal note"
                              : "Send feedback"}
                          </button>
                        </div>
                      ) : null}
                      <div className="nsq-feedback-timeline">
                        {detail.feedback.length ? (
                          detail.feedback.map((record) => (
                            <article
                              key={record.id}
                              data-visibility={record.visibility}
                            >
                              <span>
                                {record.visibility === "INTERNAL"
                                  ? "Internal only"
                                  : "Visible to submitter"}
                              </span>
                              <div>
                                <strong>
                                  {record.authorDisplayName ?? "System"}
                                </strong>
                                <time dateTime={record.createdAt}>
                                  {formatDate(record.createdAt)}
                                </time>
                              </div>
                              {record.fieldPath ? (
                                <small>Field: {record.fieldPath}</small>
                              ) : null}
                              <p>{record.body}</p>
                            </article>
                          ))
                        ) : (
                          <p className="nsq-readonly-note">
                            No reviewer feedback has been recorded.
                          </p>
                        )}
                      </div>
                    </section>

                    <section className="admin-form-section">
                      <header>
                        <div>
                          <h3>Revision history</h3>
                          <p>
                            Resubmissions and decisions preserve their author,
                            timestamp, and changed-field summary.
                          </p>
                        </div>
                      </header>
                      <div className="nsq-revision-timeline">
                        {detail.revisions.map((revision) => {
                          const changes = revisionChanges(
                            revision.changedFields,
                          );
                          return (
                            <article key={revision.revisionNumber}>
                              <span>{revision.revisionNumber}</span>
                              <div>
                                <strong>{humanize(revision.kind)}</strong>
                                <small>
                                  {revision.authorDisplayName ?? "System"} ·{" "}
                                  {formatDate(revision.createdAt)}
                                </small>
                                <p>
                                  {changes.length
                                    ? changes.join(" · ")
                                    : "No field-level changes recorded."}
                                </p>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  </div>
                ) : null}

                {tab === "decision" ? (
                  <div className="nsq-detail-content">
                    {detail.status === "SUBMITTED" ? (
                      <section className="nsq-start-review">
                        <div>
                          <Clock size={23} />
                          <div>
                            <strong>Begin an accountable review</strong>
                            <p>
                              Starting review records you as the reviewer and
                              moves the request to Under Review.
                            </p>
                          </div>
                        </div>
                        <button
                          className="button button-primary"
                          type="button"
                          disabled={Boolean(busyAction)}
                          onClick={() =>
                            setPendingAction("START_REVIEW")
                          }
                        >
                          Start review
                        </button>
                      </section>
                    ) : null}

                    {canDecide || canReject ? (
                      <>
                        {canDecide ? (
                          <section className="admin-form-section">
                            <header>
                              <div>
                                <h3>Approved team rights</h3>
                                <p>
                                  These rights apply only to this series. They
                                  never grant global administrator access.
                                </p>
                              </div>
                            </header>
                            <div className="nsq-rights-list">
                              {teamRights.map((right, index) => (
                                <article key={right.teamId}>
                                  <header>
                                    <div>
                                      <strong>{right.name}</strong>
                                      <small>
                                        Team relationship after approval
                                      </small>
                                    </div>
                                    <label className="admin-check-row">
                                      <input
                                        type="radio"
                                        name="primary-team"
                                        checked={right.isPrimary}
                                        onChange={() =>
                                          setTeamRights((current) =>
                                            current.map((entry) => ({
                                              ...entry,
                                              isPrimary:
                                                entry.teamId === right.teamId,
                                            })),
                                          )
                                        }
                                      />
                                      Primary
                                    </label>
                                  </header>
                                  <div>
                                    <label className="admin-check-row">
                                      <input
                                        type="checkbox"
                                        checked={right.canUpload}
                                        onChange={(event) =>
                                          setTeamRights((current) =>
                                            current.map((entry, entryIndex) =>
                                              entryIndex === index
                                                ? {
                                                    ...entry,
                                                    canUpload:
                                                      event.target.checked,
                                                    canPublish:
                                                      event.target.checked
                                                        ? entry.canPublish
                                                        : false,
                                                  }
                                                : entry,
                                            ),
                                          )
                                        }
                                      />
                                      Upload chapters
                                    </label>
                                    <label className="admin-check-row">
                                      <input
                                        type="checkbox"
                                        checked={right.canPublish}
                                        disabled={!right.canUpload}
                                        onChange={(event) =>
                                          setTeamRights((current) =>
                                            current.map((entry, entryIndex) =>
                                              entryIndex === index
                                                ? {
                                                    ...entry,
                                                    canPublish:
                                                      event.target.checked,
                                                  }
                                                : entry,
                                            ),
                                          )
                                        }
                                      />
                                      Publish without admin
                                    </label>
                                    <label className="admin-check-row">
                                      <input
                                        type="checkbox"
                                        checked={right.uploadRequiresReview}
                                        onChange={(event) =>
                                          setTeamRights((current) =>
                                            current.map((entry, entryIndex) =>
                                              entryIndex === index
                                                ? {
                                                    ...entry,
                                                    uploadRequiresReview:
                                                      event.target.checked,
                                                  }
                                                : entry,
                                            ),
                                          )
                                        }
                                      />
                                      Uploads require review
                                    </label>
                                    <label>
                                      Allowed languages
                                      <input
                                        value={right.allowedLanguages.join(
                                          ", ",
                                        )}
                                        placeholder="en, fr"
                                        onChange={(event) =>
                                          setTeamRights((current) =>
                                            current.map((entry, entryIndex) =>
                                              entryIndex === index
                                                ? {
                                                    ...entry,
                                                    allowedLanguages:
                                                      languageList(
                                                        event.target.value,
                                                      ),
                                                  }
                                                : entry,
                                            ),
                                          )
                                        }
                                      />
                                    </label>
                                  </div>
                                </article>
                              ))}
                            </div>
                            {!teamRightsValid ? (
                              <p className="nsq-validation-error" role="alert">
                                Choose one primary team and use valid language
                                codes. Publishing requires upload permission.
                              </p>
                            ) : null}
                          </section>
                        ) : null}

                        {canDecide ? (
                          <div className="nsq-decision-grid">
                            <section className="admin-form-section">
                              <header>
                                <div>
                                  <h3>Approve new canonical series</h3>
                                  <p>
                                    Creates exactly one public series with the
                                    reviewed metadata and media.
                                  </p>
                                </div>
                              </header>
                              <label>
                                Approval reason
                                <textarea
                                  value={approvalReason}
                                  minLength={8}
                                  maxLength={4_000}
                                  placeholder="Record why this request is ready"
                                  onChange={(event) =>
                                    setApprovalReason(event.target.value)
                                  }
                                />
                              </label>
                              <button
                                className="button button-primary"
                                type="button"
                                disabled={
                                  approvalReason.trim().length < 8 ||
                                  !teamRightsValid ||
                                  Boolean(busyAction)
                                }
                                title={
                                  approvalReason.trim().length < 8
                                    ? "Enter an approval reason of at least 8 characters."
                                    : !teamRightsValid
                                      ? "Resolve the team-rights validation."
                                      : undefined
                                }
                                onClick={() =>
                                  setPendingAction("APPROVE")
                                }
                              >
                                <CheckCircle size={17} weight="fill" />
                                Approve and create
                              </button>
                            </section>

                            <section className="admin-form-section">
                              <header>
                                <div>
                                  <h3>Attach to an existing series</h3>
                                  <p>
                                    Use this for a duplicate request. No second
                                    canonical record will be created.
                                  </p>
                                </div>
                              </header>
                              <form
                                className="nsq-series-search"
                                onSubmit={searchSeries}
                              >
                                <label>
                                  Search canonical series
                                  <input
                                    value={seriesQuery}
                                    minLength={2}
                                    maxLength={160}
                                    placeholder="Title or alternative title"
                                    onChange={(event) =>
                                      setSeriesQuery(event.target.value)
                                    }
                                  />
                                </label>
                                <button
                                  className="button button-secondary"
                                  type="submit"
                                  disabled={seriesSearching}
                                >
                                  <MagnifyingGlass size={15} />
                                  {seriesSearching ? "Searching…" : "Search"}
                                </button>
                              </form>
                              {seriesResults.length ? (
                                <div className="nsq-series-results">
                                  {seriesResults.map((series) => (
                                    <button
                                      type="button"
                                      key={series.id}
                                      aria-pressed={
                                        selectedSeries?.id === series.id
                                      }
                                      onClick={() =>
                                        setSelectedSeries(series)
                                      }
                                    >
                                      <span>
                                        {series.coverUrl ? (
                                          <img src={series.coverUrl} alt="" />
                                        ) : (
                                          <FileText size={18} />
                                        )}
                                      </span>
                                      <div>
                                        <strong>{series.title}</strong>
                                        <small>
                                          {series.isPublished
                                            ? "Published"
                                            : "Draft"}{" "}
                                          · {series.chapterCount} chapters
                                        </small>
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                              {selectedSeries ? (
                                <div className="nsq-selected-series">
                                  <CheckCircle size={18} weight="fill" />
                                  <span>
                                    Attach to <strong>{selectedSeries.title}</strong>
                                  </span>
                                </div>
                              ) : null}
                              <label>
                                Attachment reason
                                <textarea
                                  value={attachReason}
                                  minLength={8}
                                  maxLength={4_000}
                                  placeholder="Explain why this is the same canonical title"
                                  onChange={(event) =>
                                    setAttachReason(event.target.value)
                                  }
                                />
                              </label>
                              <button
                                className="button button-secondary"
                                type="button"
                                disabled={
                                  !selectedSeries ||
                                  attachReason.trim().length < 8 ||
                                  !teamRightsValid ||
                                  Boolean(busyAction)
                                }
                                onClick={() =>
                                  setPendingAction("ATTACH_EXISTING")
                                }
                              >
                                <LinkSimple size={17} />
                                Attach and approve
                              </button>
                            </section>
                          </div>
                        ) : null}

                        {canDecide ? (
                          <section className="admin-form-section nsq-change-request">
                            <header>
                              <div>
                                <h3>Request structured changes</h3>
                                <p>
                                  Identify every field the team must correct.
                                  The next submission preserves a diff.
                                </p>
                              </div>
                            </header>
                            <label>
                              Overall reason
                              <textarea
                                value={changeReason}
                                minLength={10}
                                maxLength={4_000}
                                placeholder="Summarize why the request needs revision"
                                onChange={(event) =>
                                  setChangeReason(event.target.value)
                                }
                              />
                            </label>
                            <div className="nsq-change-fields">
                              {changeFields.map((field, index) => (
                                <div key={index}>
                                  <label>
                                    Field
                                    <input
                                      value={field.fieldPath}
                                      maxLength={240}
                                      placeholder="e.g. cover, authors, description"
                                      onChange={(event) =>
                                        setChangeFields((current) =>
                                          current.map((entry, entryIndex) =>
                                            entryIndex === index
                                              ? {
                                                  ...entry,
                                                  fieldPath:
                                                    event.target.value,
                                                }
                                              : entry,
                                          ),
                                        )
                                      }
                                    />
                                  </label>
                                  <label>
                                    Required correction
                                    <input
                                      value={field.comment}
                                      maxLength={2_000}
                                      placeholder="Describe the needed change"
                                      onChange={(event) =>
                                        setChangeFields((current) =>
                                          current.map((entry, entryIndex) =>
                                            entryIndex === index
                                              ? {
                                                  ...entry,
                                                  comment: event.target.value,
                                                }
                                              : entry,
                                          ),
                                        )
                                      }
                                    />
                                  </label>
                                  <button
                                    className="button button-ghost"
                                    type="button"
                                    aria-label={`Remove change field ${index + 1}`}
                                    disabled={changeFields.length === 1}
                                    onClick={() =>
                                      setChangeFields((current) =>
                                        current.filter(
                                          (_, entryIndex) =>
                                            entryIndex !== index,
                                        ),
                                      )
                                    }
                                  >
                                    <Trash size={15} />
                                  </button>
                                </div>
                              ))}
                              <button
                                className="button button-secondary"
                                type="button"
                                disabled={changeFields.length >= 30}
                                onClick={() =>
                                  setChangeFields((current) => [
                                    ...current,
                                    { fieldPath: "", comment: "" },
                                  ])
                                }
                              >
                                <Plus size={15} />
                                Add another field
                              </button>
                            </div>
                            <button
                              className="button button-secondary"
                              type="button"
                              disabled={
                                changeReason.trim().length < 10 ||
                                changeFields.some(
                                  (field) =>
                                    !field.fieldPath.trim() ||
                                    field.comment.trim().length < 2,
                                ) ||
                                Boolean(busyAction)
                              }
                              onClick={() =>
                                setPendingAction("REQUEST_CHANGES")
                              }
                            >
                              Request changes
                            </button>
                          </section>
                        ) : null}

                        {canReject ? (
                          <section className="admin-form-section nsq-reject-section">
                            <header>
                              <div>
                                <h3>Reject without publication</h3>
                                <p>
                                  Rejection preserves the request and reason for
                                  audit. Internal notes remain private.
                                </p>
                              </div>
                            </header>
                            <label>
                              Rejection reason
                              <textarea
                                value={rejectionReason}
                                minLength={10}
                                maxLength={4_000}
                                placeholder="Give a clear, meaningful reason"
                                onChange={(event) =>
                                  setRejectionReason(event.target.value)
                                }
                              />
                            </label>
                            <button
                              className="button button-danger"
                              type="button"
                              disabled={
                                rejectionReason.trim().length < 10 ||
                                Boolean(busyAction)
                              }
                              onClick={() => setPendingAction("REJECT")}
                            >
                              Reject request
                            </button>
                          </section>
                        ) : null}
                      </>
                    ) : (
                      <section className="admin-form-section">
                        <header>
                          <div>
                            <h3>
                              {["APPROVED", "REJECTED", "WITHDRAWN"].includes(
                                detail.status,
                              )
                                ? "Decision complete"
                                : "No review action available"}
                            </h3>
                            <p>{statusExplanation(detail.status)}</p>
                          </div>
                        </header>
                        {detail.approvedSeries ? (
                          <a
                            className="nsq-approved-series"
                            href={`/title/${encodeURIComponent(detail.approvedSeries.slug)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <CheckCircle size={21} weight="fill" />
                            <span>
                              Canonical series
                              <strong>{detail.approvedSeries.title}</strong>
                            </span>
                            <ArrowSquareOut size={16} />
                          </a>
                        ) : null}
                      </section>
                    )}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="admin-state-card">
                <FileText size={26} />
                <h3>Select a request</h3>
                <p>
                  Choose a team submission to inspect its metadata, duplicate
                  risk, private review history, and available decisions.
                </p>
              </div>
            )}
          </section>
        </div>
      )}

      <ConfirmActionDialog
        open={Boolean(pendingAction)}
        title={dialogCopy.title}
        description={dialogCopy.description}
        confirmLabel={dialogCopy.confirmLabel}
        destructive={dialogCopy.destructive}
        busy={Boolean(busyAction)}
        onCancel={() => {
          if (!busyAction) setPendingAction(null);
        }}
        onConfirm={() => void confirmPendingAction()}
      />
    </AdminPageScaffold>
  );
}
