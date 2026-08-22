import { env } from "cloudflare:workers";
import { z } from "zod";
import { demoSeries } from "@/lib/catalog";
import { normalizeChapterNumber } from "@/lib/chapter-number";
import {
  continuityFallbackReason,
  selectPreferredRelease,
} from "@/lib/reader-continuity";
import {
  countryCodeSchema,
  languageCodeSchema,
  languageOptions,
  normalizedLookupKey,
} from "@/lib/admin-metadata";
import {
  commercialSettingsSchema,
  sanitizeCommercialSettingsForPublic,
} from "@/lib/commercial-settings";
import {
  discussionSettingsSchema,
} from "@/lib/discussion-settings";
import {
  canAny,
  highestRole,
  sumBalancedEntries,
} from "@/lib/permissions.mjs";
import {
  ADMIN_PERMISSION_REGISTRY,
  capabilityForAdminPath,
} from "@/lib/admin-permissions";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  getDiscussionSettingsDocument,
  saveDiscussionSettings,
} from "@/lib/server/discussion-settings";
import {
  assertPaidEconomyRevisionFresh,
  getCommercialSettingsDocument,
  paidEconomyRevisionGuardSql,
  requirePaidEconomyPublicDocument,
  saveCommercialSettings,
} from "@/lib/server/commercial-settings";
import {
  ensureWalletAccount,
  grantCurrencyReward,
  platformAccountId,
  walletSnapshot as currencyWalletSnapshot,
} from "@/lib/server/economy";
import { getRewardSettingsDocument } from "@/lib/server/reward-settings";
import {
  actorHasCapability,
  getActor,
  requireActor,
  requireAdminCapability,
  requireOwner,
} from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";
import {
  decideChapterAccess,
  requireReadableChapter,
  resolveChapterAccess,
  type ChapterAccessRecord,
} from "@/lib/server/chapter-access";
import {
  activeChapterDiscountGuardSql,
  noActiveChapterDiscountGuardSql,
  resolveSeriesChapterDiscounts,
} from "@/lib/server/content-discounts";
import { requireChapterManagementScope } from "@/lib/server/chapter-management";
import {
  getSiteThemeDocument,
  saveSiteTheme,
} from "@/lib/server/site-settings";
import {
  getSiteConfiguration,
  getSiteConfigurationDocument,
  saveSiteConfiguration,
} from "@/lib/server/site-configuration";
import {
  siteConfigurationSchema,
  type SiteConfiguration,
} from "@/lib/site-configuration";
import {
  auditStatement,
  deleteMediaObject,
  retryPendingMediaCleanup,
  validateImageFile,
  writeAudit,
} from "@/lib/server/admin-utils";
import { siteThemeSchema } from "@/lib/site-theme";
import {
  storeCollectionInputSchema,
  storeEquipSchema,
  storeItemInputSchema,
  storePurchaseSchema,
  testCoinGrantSchema,
} from "@/lib/storefront";
import { storeProductsResponse } from "@/app/api/v1/store/products/route";
import { createHostedCheckout } from "@/lib/server/payments/checkout";
import {
  getFeatureStates,
  requireFeature,
} from "@/lib/server/feature-flags";
import {
  effectiveChapterAccessSql,
  publicPaidChapterPredicate,
  publicPaidSeriesPredicate,
} from "@/lib/server/public-content-visibility";

type RouteContext = {
  params: Promise<{ resource: string[] }>;
};

const progressSchema = z.object({
  chapterId: z.string().min(3).max(120),
  pageIndex: z.number().int().min(0).max(10000),
  scrollOffset: z.number().int().min(0).max(10000000).default(0),
  progressBasisPoints: z.number().int().min(0).max(10000),
  markCompleted: z.boolean().default(true),
});

const librarySchema = z.object({
  seriesId: z.string().min(3).max(120),
  listType: z.enum(["READING", "PLANNING", "COMPLETED", "ON_HOLD", "DROPPED"]),
  favorite: z.boolean().default(false),
});

const unlockSchema = z.object({
  seriesSlug: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  chapterSlug: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  idempotencyKey: z.string().min(12).max(160),
});

const analyticsEventSchema = z
  .object({
    eventId: z.string().uuid(),
    sessionId: z.string().uuid(),
    visitorId: z.string().uuid(),
    eventType: z.enum([
      "HOME_VIEW",
      "LATEST_VIEW",
      "BROWSE_VIEW",
      "SERIES_VIEW",
      "CHAPTER_START",
      "CHAPTER_COMPLETE",
    ]),
    seriesSlug: z.string().trim().max(120).optional(),
    chapterSlug: z.string().trim().max(120).optional(),
  })
  .superRefine((value, context) => {
    const seriesRequired = [
      "SERIES_VIEW",
      "CHAPTER_START",
      "CHAPTER_COMPLETE",
    ].includes(value.eventType);
    const chapterRequired = [
      "CHAPTER_START",
      "CHAPTER_COMPLETE",
    ].includes(value.eventType);
    if (
      seriesRequired &&
      (!value.seriesSlug ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.seriesSlug))
    ) {
      context.addIssue({
        code: "custom",
        path: ["seriesSlug"],
        message: "This event needs a valid series slug.",
      });
    }
    if (
      chapterRequired &&
      (!value.chapterSlug ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.chapterSlug))
    ) {
      context.addIssue({
        code: "custom",
        path: ["chapterSlug"],
        message: "This event needs a valid chapter slug.",
      });
    }
  });

const analyticsRangeSchema = z
  .enum(["24h", "7d", "30d", "custom"])
  .default("24h");

const orderSchema = z.object({
  productId: z.string().min(3).max(80),
  billingCycle: z.enum(["MONTHLY", "ANNUAL"]).optional(),
  idempotencyKey: z.string().min(8).max(120).regex(/^[A-Za-z0-9._:-]+$/u),
});

const reviewWriteSchema = z.object({
  seriesSlug: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  rating: z.number().int().min(1).max(5),
  body: z.string().trim().max(4000).default(""),
  spoiler: z.boolean().default(false),
});

const reviewUpdateSchema = reviewWriteSchema.extend({
  reviewId: z.string().uuid(),
});

const accountSettingsSchema = z
  .object({
    displayName: z.string().trim().min(2).max(80).optional(),
    contentLanguage: z.string().trim().min(2).max(24).optional(),
    readerMode: z.enum(["VERTICAL", "SINGLE", "DOUBLE"]).optional(),
    matureContent: z.boolean().optional(),
    readingDirection: z.enum(["AUTO", "LTR", "RTL"]).optional(),
    brightness: z.number().int().min(40).max(100).optional(),
    readerTypeDefaults: z.object({
      manga: z.enum(["SYSTEM", "VERTICAL", "SINGLE_LTR", "SINGLE_RTL", "DOUBLE_LTR", "DOUBLE_RTL"]),
      vertical: z.enum(["SYSTEM", "VERTICAL", "SINGLE_LTR", "SINGLE_RTL", "DOUBLE_LTR", "DOUBLE_RTL"]),
    }).optional(),
    commentReplyBadge: z.boolean().optional(),
    readerSettings: z.object({
      mode: z.enum(["vertical", "single", "double"]),
      imageFit: z.enum(["width", "height", "page", "original", "smart"]),
      imageSpacing: z.number().int().min(0).max(40),
      topMargin: z.number().int().min(56).max(180),
      bottomMargin: z.number().int().min(64).max(220),
      brightness: z.number().int().min(35).max(120),
      backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      readerTheme: z.enum(["dark", "paper", "sepia"]),
      tapZones: z.boolean(),
      readingDirection: z.enum(["ltr", "rtl"]),
      volumeNavigation: z.boolean(),
      keepAwake: z.boolean(),
      autoMarkRead: z.boolean(),
      preloadNextChapter: z.boolean(),
      saveReadingProgress: z.boolean(),
      rememberSettings: z.boolean(),
    }).optional(),
    notifications: z
      .record(z.string().max(60), z.boolean())
      .optional(),
    privacy: z.record(z.string().max(60), z.boolean()).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Choose at least one account setting to update.",
  });

const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use lowercase letters, numbers, and single hyphens.",
  );

const adminSeriesSchema = z.object({
  title: z.string().trim().min(2).max(160),
  slug: slugSchema,
  nativeTitle: z.string().trim().max(160).default(""),
  synopsis: z.string().trim().min(20).max(4000),
  type: z.enum(["MANHWA", "MANGA", "MANHUA"]),
  status: z.enum(["ONGOING", "COMPLETED", "HIATUS", "PAUSED", "CANCELLED", "UPCOMING"]),
  originCountry: countryCodeSchema,
  originalLanguage: languageCodeSchema,
  readingDirection: z.enum(["VERTICAL", "RIGHT_TO_LEFT", "LEFT_TO_RIGHT"]),
  accessType: z.enum(["FREE", "PAID"]),
  teamId: z
    .union([z.string().min(3).max(120), z.literal("")])
    .transform((value) => value || null)
    .nullable()
    .optional(),
});

const adminTeamSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: slugSchema,
  description: z.string().trim().min(12).max(1200),
});

const adminTeamUpdateSchema = z.object({
  id: z.string().min(3).max(120),
  verificationStatus: z.enum(["PENDING", "VERIFIED", "SUSPENDED"]),
  expectedRevision: z.coerce.number().int().min(1),
});

const adminUserUpdateSchema = z.object({
  id: z.string().min(3).max(120),
  expectedAccessRevision: z.coerce.number().int().min(1),
  expectedStatus: z.enum(["ACTIVE", "SUSPENDED"]),
  roles: z
    .array(
      z.enum([
      "OWNER",
      "ADMINISTRATOR",
      "MANAGER",
      "MODERATOR",
      "TEAM_LEADER",
      "UPLOADER",
      "USER",
      ]),
    )
    .min(1)
    .max(7)
    .optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
}).refine((value) => value.roles || value.status, {
  message: "Choose a role or account status to update.",
});

const balanceAdjustmentSchema = z.object({
  userId: z.string().min(3).max(120),
  currency: z.enum(["ONYX", "SHARDS"]),
  delta: z.number().int().min(-10_000_000).max(10_000_000).refine(Boolean),
  reason: z.string().trim().min(8).max(500),
  idempotencyKey: z.string().min(12).max(160),
});

const chapterAccessTypeSchema = z.enum(["FREE", "PAID"]);

const editorPickWriteSchema = z.object({
  picks: z
    .array(
      z.object({
        seriesId: z.string().trim().min(3).max(120),
        categoryLabel: z.string().trim().min(2).max(60),
        shortDescription: z.string().trim().min(12).max(360),
        sortOrder: z.number().int().min(0).max(1000),
        isPublished: z.boolean(),
      }),
    )
    .max(12),
});

const teamMembershipWriteSchema = z.object({
  teamId: z.string().trim().min(3).max(120),
  userId: z.string().trim().min(3).max(120),
  membershipRole: z.enum(["OWNER", "LEADER", "UPLOADER"]),
  status: z.enum(["ACTIVE", "INACTIVE"]),
  expectedRevision: z.coerce.number().int().min(1).nullable().optional(),
});

const seriesTeamAssignmentWriteSchema = z.object({
  seriesId: z.string().trim().min(3).max(120),
  teamId: z.string().trim().min(3).max(120),
  canUpload: z.boolean(),
  canPublish: z.boolean(),
  expectedSeriesRevision: z.coerce.number().int().min(1),
});

const workspaceSettingsSchema = z.object({
  defaultTeamId: z.string().trim().max(120).nullable(),
  defaultLanguage: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/),
  reviewNotifications: z.boolean(),
  uploadNotifications: z.boolean(),
});

const workspaceReviewSchema = z.object({
  chapterId: z.string().trim().min(3).max(120),
  expectedRevision: z.coerce.number().int().min(1),
  action: z.enum(["SUBMIT", "PUBLISH", "RETURN"]),
  approvalDecision: z.enum(["APPROVE", "UNDER_SCOPE", "REJECT"]).optional(),
  reason: z.string().trim().min(8).max(500),
});

function uploaderReviewDecisionStatements(
  db: D1Database,
  input: {
    decision: "APPROVE" | "UNDER_SCOPE" | "REJECT";
    jobId: string;
    uploaderUserId: string;
    expectedApprovalRevision: number | null;
    reviewerUserId: string;
    note: string;
  },
) {
  const approvalStatus =
    input.decision === "APPROVE"
      ? "APPROVED"
      : input.decision === "UNDER_SCOPE"
        ? "UNDER_SCOPE"
        : "REJECTED";
  return [
    db.prepare(
      `INSERT INTO uploader_approvals
       (user_id, status, reviewed_by_user_id, reviewed_at, note)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         status = excluded.status,
         reviewed_by_user_id = excluded.reviewed_by_user_id,
         reviewed_at = excluded.reviewed_at,
         note = excluded.note,
         revision = uploader_approvals.revision + 1,
         updated_at = CURRENT_TIMESTAMP
       WHERE uploader_approvals.revision = ?`,
    ).bind(
      input.uploaderUserId,
      approvalStatus,
      input.reviewerUserId,
      input.note,
      input.expectedApprovalRevision,
    ),
    db.prepare(
      `UPDATE upload_publish_guards
          SET verified = CASE WHEN changes() = 1 THEN 1 ELSE 0 END
        WHERE job_id = ?`,
    ).bind(input.jobId),
    db.prepare(
      `INSERT INTO upload_review_events
       (id, job_id, uploader_user_id, reviewer_user_id, decision, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      randomId(),
      input.jobId,
      input.uploaderUserId,
      input.reviewerUserId,
      input.decision,
      input.note,
    ),
  ];
}

const adminChapterAccessSchema = z
  .object({
    id: z.string().min(3).max(120),
    expectedRevision: z.coerce.number().int().min(1),
    chapterNumber: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .transform(normalizeChapterNumber),
    title: z.string().trim().max(240),
    volume: z.string().trim().max(40),
    language: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/),
    format: z.enum(["VERTICAL", "PAGED"]),
    version: z.number().int().min(1).max(99),
    releaseNotes: z.string().trim().max(2000),
    pageOrder: z
      .array(z.string().uuid())
      .max(5000)
      .refine(
        (items) => new Set(items).size === items.length,
        "Page order cannot contain duplicate page IDs.",
      ),
    publishedAt: z.string().trim().max(40).nullable().optional(),
    accessType: chapterAccessTypeSchema,
    priceOnyx: z.number().int().min(0).max(100000),
    state: z.enum(["DRAFT", "READY_FOR_REVIEW", "PUBLISHED"]),
    reason: z.string().trim().min(6).max(500),
  })
  .superRefine((value, context) => {
    if (value.accessType === "PAID" && value.priceOnyx <= 0) {
      context.addIssue({
        code: "custom",
        path: ["priceOnyx"],
        message: "Paid chapters need a premium coin price.",
      });
    }
  });

const discussionCommentSchema = z.object({
  seriesSlug: z.string().min(2).max(120),
  chapterSlug: z.string().min(2).max(120).nullable().optional(),
  affiliationTeamId: z.string().min(3).max(120).nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  body: z.string().trim().max(2500),
  spoiler: z.boolean().default(false),
  mediaIds: z.array(z.string().uuid()).max(4).default([]),
  gifIds: z
    .array(z.string().trim().min(3).max(160))
    .max(4)
    .default([])
    .refine((items) => new Set(items).size === items.length, {
      message: "Choose each GIF only once.",
    }),
}).superRefine((value, context) => {
  if (
    value.body.length < 2 &&
    value.mediaIds.length === 0 &&
    value.gifIds.length === 0
  ) {
    context.addIssue({
      code: "custom",
      path: ["body"],
      message: "Write at least two characters or attach an image or GIF.",
    });
  }
});

const discussionReactionSchema = z.object({
  commentId: z.string().uuid(),
  reaction: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/),
});

const discussionVoteSchema = z.object({
  commentId: z.string().uuid(),
  value: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
});

const discussionEditSchema = z.object({
  commentId: z.string().uuid(),
  body: z.string().trim().min(2).max(2500),
  spoiler: z.boolean().default(false),
});

const discussionPinSchema = z.object({
  commentId: z.string().uuid(),
  pinned: z.boolean(),
});

const workspaceCommentModerationSchema = z
  .object({
    commentId: z.string().uuid(),
    seriesSlug: slugSchema,
    expectedRevision: z.coerce.number().int().min(1),
    action: z.enum([
      "EDIT",
      "HIDE",
      "RESTORE",
      "DELETE",
      "PIN",
      "UNPIN",
      "BAN_SERIES",
      "UNBAN_SERIES",
      "SUSPEND_USER",
    ]),
    body: z.string().trim().min(2).max(2500).optional(),
    reason: z.string().trim().min(6).max(500).optional(),
  })
  .superRefine((value, context) => {
    if (value.action === "EDIT" && !value.body) {
      context.addIssue({
        code: "custom",
        path: ["body"],
        message: "Moderator edits need replacement text.",
      });
    }
    if (
      ["EDIT", "HIDE", "DELETE", "BAN_SERIES", "SUSPEND_USER"].includes(
        value.action,
      ) &&
      !value.reason
    ) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "This moderation action needs an audit reason.",
      });
    }
  });

const discussionMediaIdSchema = z.string().uuid();

const discussionImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const chapterImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function detectedImageType(bytes: Uint8Array) {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  if (
    bytes.length >= 6 &&
    ["GIF87a", "GIF89a"].includes(String.fromCharCode(...bytes.slice(0, 6)))
  ) {
    return "image/gif";
  }
  return null;
}

function imageDimensions(bytes: Uint8Array, contentType: string) {
  if (contentType === "image/png" && bytes.length >= 24) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return {
      width: view.getUint32(16),
      height: view.getUint32(20),
    };
  }
  if (contentType === "image/jpeg" && bytes.length >= 10) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      const length = (bytes[offset + 2] << 8) + bytes[offset + 3];
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        ) &&
        offset + 8 < bytes.length
      ) {
        return {
          height: (bytes[offset + 5] << 8) + bytes[offset + 6],
          width: (bytes[offset + 7] << 8) + bytes[offset + 8],
        };
      }
      if (length < 2) break;
      offset += 2 + length;
    }
  }
  if (
    contentType === "image/webp" &&
    bytes.length >= 30
  ) {
    const chunk = String.fromCharCode(...bytes.slice(12, 16));
    if (chunk === "VP8X") {
      return {
        width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
        height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
      };
    }
    if (
      chunk === "VP8 " &&
      bytes.length >= 30 &&
      bytes[23] === 0x9d &&
      bytes[24] === 0x01 &&
      bytes[25] === 0x2a
    ) {
      return {
        width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
        height: (bytes[28] | (bytes[29] << 8)) & 0x3fff,
      };
    }
    if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
      const bits =
        bytes[21] |
        (bytes[22] << 8) |
        (bytes[23] << 16) |
        (bytes[24] << 24);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
      };
    }
  }
  if (contentType === "image/gif" && bytes.length >= 10) {
    return {
      width: bytes[6] | (bytes[7] << 8),
      height: bytes[8] | (bytes[9] << 8),
    };
  }
  return null;
}

function safeFilename(value: string) {
  const leaf = value.replaceAll("\\", "/").split("/").at(-1) ?? "upload";
  return leaf
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 140) || "upload";
}

function normalizeOptionalDate(
  value: string | null | undefined,
  fieldLabel: string,
) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new ApiError(
      422,
      "RELEASE_DATE_INVALID",
      `${fieldLabel} must be a valid date and time.`,
    );
  }
  return new Date(timestamp).toISOString();
}

function countValue(
  result: { results?: unknown[] } | undefined,
) {
  const row = result?.results?.[0];
  return Number(
    row && typeof row === "object"
      ? (row as Record<string, unknown>).count ?? 0
      : 0,
  );
}

type AnalyticsRange = z.infer<typeof analyticsRangeSchema>;
type AnalyticsPresetRange = Exclude<AnalyticsRange, "custom">;

const analyticsRangeConfig: Record<
  AnalyticsPresetRange,
  {
    count: number;
    unit: "hour" | "day";
    sqlFormat: string;
  }
> = {
  "24h": {
    count: 24,
    unit: "hour",
    sqlFormat: "%Y-%m-%dT%H:00:00Z",
  },
  "7d": {
    count: 7,
    unit: "day",
    sqlFormat: "%Y-%m-%d",
  },
  "30d": {
    count: 30,
    unit: "day",
    sqlFormat: "%Y-%m-%d",
  },
};

function analyticsBuckets(range: AnalyticsPresetRange) {
  const config = analyticsRangeConfig[range];
  const end = new Date();
  if (config.unit === "hour") {
    end.setUTCMinutes(0, 0, 0);
  } else {
    end.setUTCHours(0, 0, 0, 0);
  }
  return Array.from({ length: config.count }, (_, index) => {
    const date = new Date(end);
    const offset = config.count - index - 1;
    if (config.unit === "hour") date.setUTCHours(date.getUTCHours() - offset);
    else date.setUTCDate(date.getUTCDate() - offset);
    return {
      bucket:
        config.unit === "hour"
          ? `${date.toISOString().slice(0, 13)}:00:00Z`
          : date.toISOString().slice(0, 10),
      readers: 0,
      views: 0,
      chapterStarts: 0,
      chapterCompletions: 0,
      comments: 0,
      unlocks: 0,
      onyxSpent: 0,
    };
  });
}

function analyticsWindow(url: URL) {
  const range = analyticsRangeSchema.parse(
    url.searchParams.get("range") ?? undefined,
  );
  if (range !== "custom") {
    const buckets = analyticsBuckets(range);
    return {
      range,
      startAt: buckets[0]!.bucket,
      endAt: new Date().toISOString(),
      bucketFormat: analyticsRangeConfig[range].sqlFormat,
      buckets,
    };
  }

  const dateSchema = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.");
  const start = dateSchema.parse(url.searchParams.get("start"));
  const end = dateSchema.parse(url.searchParams.get("end"));
  const startDate = new Date(`${start}T00:00:00.000Z`);
  const inclusiveEndDate = new Date(`${end}T00:00:00.000Z`);
  const endDate = new Date(inclusiveEndDate);
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const durationDays = Math.ceil(
    (endDate.getTime() - startDate.getTime()) / 86_400_000,
  );
  if (
    Number.isNaN(startDate.getTime()) ||
    Number.isNaN(endDate.getTime()) ||
    startDate > inclusiveEndDate ||
    inclusiveEndDate > today ||
    durationDays < 1 ||
    durationDays > 366
  ) {
    throw new ApiError(
      422,
      "ANALYTICS_RANGE_INVALID",
      "Choose a valid custom period of up to 366 days that does not extend into the future.",
    );
  }
  const buckets = Array.from({ length: durationDays }, (_, index) => {
    const date = new Date(startDate);
    date.setUTCDate(date.getUTCDate() + index);
    return {
      bucket: date.toISOString().slice(0, 10),
      readers: 0,
      views: 0,
      chapterStarts: 0,
      chapterCompletions: 0,
      comments: 0,
      unlocks: 0,
      onyxSpent: 0,
    };
  });
  return {
    range,
    startAt: startDate.toISOString(),
    endAt: endDate.toISOString(),
    bucketFormat: "%Y-%m-%d",
    buckets,
  };
}

function isAdminActor(
  actor: NonNullable<Awaited<ReturnType<typeof getActor>>>,
) {
  return actor.adminMfaEnrolled && actor.roles.some((role) =>
    ["OWNER", "ADMINISTRATOR"].includes(role),
  ) && actorHasCapability(actor, "admin.console.access");
}

function isGlobalModerator(
  actor: NonNullable<Awaited<ReturnType<typeof getActor>>>,
) {
  const elevatedAdmin = actor.roles.some((role) => ["OWNER", "ADMINISTRATOR"].includes(role));
  return actorHasCapability(actor, "comments.moderate.global") && (!elevatedAdmin || actor.adminMfaEnrolled);
}

function publicSeriesPredicate(alias = "s") {
  return `${alias}.is_published = 1
    AND ${alias}.archived_at IS NULL
    AND ${publicPaidSeriesPredicate(alias)}
    AND ${alias}.rights_status IN
      ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')`;
}

function requestId(request: Request) {
  return request.headers.get("x-request-id") ?? randomId();
}

function pathOf(resource: string[]) {
  return resource.join("/");
}

function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expectedOrigin = new URL(request.url).origin;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (
    origin === expectedOrigin ||
    (!origin && fetchSite === "same-origin")
  ) {
    return;
  }
  throw new ApiError(
    403,
    "ORIGIN_MISMATCH",
    "This action must come from NyaScans.",
  );
}

async function validateSeriesSlug(seriesSlug: string) {
  slugSchema.parse(seriesSlug);
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Series validation is temporarily unavailable.",
    );
  }
  const stored = await env.DB.prepare(
    `SELECT s.id FROM series s
     WHERE s.slug = ? AND ${publicSeriesPredicate("s")} LIMIT 1`,
  )
    .bind(seriesSlug)
    .first();
  if (stored) return;
  throw new ApiError(
    404,
    "SERIES_NOT_FOUND",
    "This series is not available.",
  );
}

async function requireSeriesModerator(
  actor: NonNullable<Awaited<ReturnType<typeof getActor>>>,
  seriesSlug: string,
) {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Discussion moderation is unavailable.",
    );
  }
  if (isGlobalModerator(actor)) return;
  if (!actor.roles.includes("TEAM_LEADER")) {
    throw new ApiError(
      403,
      "MODERATION_PERMISSION_REQUIRED",
      "This account cannot moderate series discussions.",
    );
  }
  const participation = await env.DB.prepare(
    `SELECT s.id
      FROM series s
      JOIN team_memberships tm ON tm.user_id = ?
      JOIN teams t ON t.id = tm.team_id
      WHERE s.slug = ?
        AND ${publicSeriesPredicate("s")}
        AND tm.status = 'ACTIVE'
        AND t.is_archived = 0
        AND t.verification_status = 'VERIFIED'
        AND UPPER(tm.membership_role) IN
          ('OWNER', 'MANAGER', 'TEAM_LEADER')
        AND EXISTS (
          SELECT 1
            FROM chapters team_release
           WHERE team_release.series_id = s.id
             AND team_release.team_id = t.id
             AND team_release.state = 'PUBLISHED'
             AND team_release.visibility = 'PUBLIC'
             AND team_release.published_at IS NOT NULL
             AND datetime(team_release.published_at) <= datetime('now')
        )
      LIMIT 1`,
  )
    .bind(actor.id, seriesSlug)
    .first();
  if (!participation) {
    throw new ApiError(
      403,
      "SERIES_MODERATION_SCOPE_REQUIRED",
      "You can moderate only series managed by your active team.",
    );
  }
}

async function assertDiscussionAllowed(
  actorId: string,
  seriesSlug: string,
) {
  if (!env.DB) return;
  const restriction = await env.DB.prepare(
    `SELECT 1 AS blocked
       FROM discussion_user_restrictions
      WHERE series_slug = ?
        AND user_id = ?
      LIMIT 1`,
  )
    .bind(seriesSlug, actorId)
    .first();
  if (restriction) {
    throw new ApiError(
      403,
      "SERIES_DISCUSSION_RESTRICTED",
      "This account is restricted from participating in this series discussion.",
    );
  }
}

async function resolveCommentAffiliation(
  actor: NonNullable<Awaited<ReturnType<typeof getActor>>>,
  seriesSlug: string,
  chapterSlug: string | null,
  requestedTeamId: string | null,
) {
  if (!env.DB) return null;
  if (chapterSlug) {
    const access = await resolveChapterAccess(actor, seriesSlug, chapterSlug);
    if (!access.canRead) {
      throw new ApiError(
        access.reason === "UNAVAILABLE" ? 404 : 403,
        access.reason === "UNAVAILABLE"
          ? "CHAPTER_SCOPE_INVALID"
          : "CHAPTER_ACCESS_REQUIRED",
        access.reason === "UNAVAILABLE"
          ? "The selected chapter is not publicly available."
          : "Unlock this chapter before joining its discussion.",
      );
    }
  }
  const rows = await env.DB.prepare(
    `SELECT t.id,
            CASE
              WHEN ? IS NOT NULL AND chapter.team_id = t.id THEN 0
              WHEN ? IS NOT NULL AND t.id = ? THEN 1
              WHEN tm.is_primary = 1 THEN 2
              ELSE 3
            END AS precedence
     FROM series s
     JOIN team_memberships tm ON tm.user_id = ?
     JOIN teams t ON t.id = tm.team_id
     LEFT JOIN chapters chapter
       ON chapter.series_id = s.id AND chapter.slug = ?
     WHERE s.slug = ?
       AND ${publicSeriesPredicate("s")}
       AND tm.status = 'ACTIVE'
       AND t.is_archived = 0
       AND t.verification_status = 'VERIFIED'
       AND EXISTS (
         SELECT 1
           FROM chapters team_release
          WHERE team_release.series_id = s.id
            AND team_release.team_id = t.id
            AND team_release.state = 'PUBLISHED'
            AND team_release.visibility = 'PUBLIC'
            AND team_release.published_at IS NOT NULL
            AND datetime(team_release.published_at) <= datetime('now')
       )
     ORDER BY precedence, t.name COLLATE NOCASE`,
  )
    .bind(
      chapterSlug,
      requestedTeamId,
      requestedTeamId,
      actor.id,
      chapterSlug,
      seriesSlug,
    )
    .all<{ id: string; precedence: number }>();
  if (
    requestedTeamId &&
    !rows.results.some((team) => team.id === requestedTeamId)
  ) {
    throw new ApiError(
      422,
      "TEAM_AFFILIATION_INVALID",
      "Choose an active verified team that has published this series.",
    );
  }
  // The server-side ordering is authoritative: a chapter release team wins
  // over a requested or primary affiliation when it is eligible.
  return rows.results[0]?.id ?? null;
}

async function walletSnapshot(userId: string) {
  if (!env.DB) {
    throw new ApiError(503, "DATABASE_UNAVAILABLE", "Wallet storage is unavailable.");
  }

  const account = { id: `la_user_${userId}` };
  await env.DB.prepare(
    `INSERT OR IGNORE INTO ledger_accounts
     (id, owner_type, owner_id, currency, account_type)
     VALUES (?, 'USER', ?, 'ONYX', 'AVAILABLE')`,
  )
    .bind(account.id, userId)
    .run();

  const balance = await env.DB.prepare(
    `SELECT COALESCE(SUM(entry.amount), 0) AS balance
       FROM ledger_accounts ledger_account
       LEFT JOIN ledger_entries entry ON entry.account_id = ledger_account.id
      WHERE ledger_account.owner_type = 'USER'
        AND ledger_account.owner_id = ?
        AND ledger_account.currency = 'ONYX'
        AND (
          ledger_account.account_type = 'AVAILABLE'
          OR ledger_account.account_type LIKE 'PAYMENT_DEBT:%'
        )`,
  )
    .bind(userId)
    .first<{ balance: number }>();

  const activity = await env.DB.prepare(
    `SELECT t.id, t.kind, t.memo, t.created_at AS createdAt, e.amount
     FROM ledger_entries e
     JOIN ledger_transactions t ON t.id = e.transaction_id
     JOIN ledger_accounts ledger_account ON ledger_account.id = e.account_id
     WHERE ledger_account.owner_type = 'USER'
       AND ledger_account.owner_id = ?
       AND ledger_account.currency = 'ONYX'
       AND (
         ledger_account.account_type = 'AVAILABLE'
         OR ledger_account.account_type LIKE 'PAYMENT_DEBT:%'
       )
     ORDER BY t.created_at DESC
     LIMIT 20`,
  )
    .bind(userId)
    .all();

  return {
    balance: Number(balance?.balance ?? 0),
    currency: "ONYX",
    accountId: account.id,
    activity: activity.results,
  };
}

function publicSeriesCover(slug: string, coverKey: string | null | undefined) {
  const normalized = coverKey?.trim() ?? "";
  if (!normalized) return null;
  if (normalized.startsWith("/") || /^https?:\/\//.test(normalized)) {
    return normalized;
  }
  return `/api/v1/series-cover?slug=${encodeURIComponent(slug)}`;
}

function publicSeriesBanner(
  seriesId: string,
  bannerKey: string | null | undefined,
  revision: number,
) {
  const normalized = bannerKey?.trim() ?? "";
  if (!normalized) return null;
  if (normalized.startsWith("/") || /^https?:\/\//.test(normalized)) {
    return normalized;
  }
  return `/api/v1/series-media?id=${encodeURIComponent(seriesId)}&slot=banner&v=${revision}`;
}

function publicSeriesSlider(
  seriesId: string,
  sliderKey: string | null | undefined,
  revision: number,
) {
  const normalized = sliderKey?.trim() ?? "";
  if (!normalized) return null;
  if (normalized.startsWith("/") || /^https?:\/\//.test(normalized)) {
    return normalized;
  }
  return `/api/v1/series-media?id=${encodeURIComponent(seriesId)}&slot=slider&v=${revision}`;
}

async function fixedReaderManifest(
  pages: Array<Record<string, unknown>>,
  seriesSlug: string,
  chapterSlug: string,
  fixedPages: { first: boolean; last: boolean } = { first: true, last: true },
) {
  const configuration = await getSiteConfiguration();
  const first = configuration.reader.firstPage;
  const last = configuration.reader.lastPage;
  const scopedUrl = (
    slot: "first" | "last",
    revision: number,
  ) =>
    `/api/v1/site-media?slot=${slot}&series=${encodeURIComponent(
      seriesSlug,
    )}&chapter=${encodeURIComponent(chapterSlug)}&v=${revision}`;
  const content = pages.map((pageRecord, index) => ({
    ...pageRecord,
    kind: "CONTENT",
    contentPageIndex: Number(pageRecord.pageIndex ?? index),
  }));
  return [
    ...(fixedPages.first && first.enabled && first.key
      ? [
          {
            id: `fixed_first_${first.revision}`,
            pageIndex: -1,
            contentPageIndex: null,
            width: first.width,
            height: first.height,
            sha256: `fixed-first-${first.revision}`,
            processingStatus: "READY",
            kind: "FIXED_FIRST",
            url: scopedUrl("first", first.revision),
          },
        ]
      : []),
    ...content,
    ...(fixedPages.last && last.enabled && last.key
      ? [
          {
            id: `fixed_last_${last.revision}`,
            pageIndex: content.length,
            contentPageIndex: null,
            width: last.width,
            height: last.height,
            sha256: `fixed-last-${last.revision}`,
            processingStatus: "READY",
            kind: "FIXED_LAST",
            url: scopedUrl("last", last.revision),
          },
        ]
      : []),
  ].map((pageRecord, displayIndex) => ({
    ...pageRecord,
    displayIndex,
  }));
}

function safeJsonRecord(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function storeItemPreviewUrl(
  itemId: string,
  previewKey: string | null | undefined,
  version: string | null | undefined,
) {
  return previewKey
    ? `/api/v1/store-preview?id=${encodeURIComponent(itemId)}&v=${encodeURIComponent(version ?? previewKey)}`
    : null;
}

function chapterAccessContract(
  decision: Awaited<ReturnType<typeof resolveChapterAccess>> & {
    isFresh?: boolean;
  },
) {
  return {
    chapterId: decision.chapterId,
    teamId: decision.teamId,
    seriesSlug: decision.seriesSlug,
    chapterSlug: decision.chapterSlug,
    chapterNumber: normalizeChapterNumber(decision.chapterNumber),
    chapterLabel: decision.chapterLabel,
    language: decision.language,
    version: decision.version,
    teamName: decision.teamName,
    accessType: decision.accessType,
    accessLevel: decision.accessLevel,
    priceOnyx: decision.priceOnyx,
    basePriceOnyx: decision.basePriceOnyx,
    discountTargetType: decision.discountTargetType,
    discountPercentage: decision.discountPercentage,
    discountEndsAt: decision.discountEndsAt,
    publishedAt: decision.publishedAt,
    isFresh: Boolean(decision.isFresh),
    canRead: decision.canRead,
    isUnlocked: decision.isUnlocked,
    administratorPreview: decision.administratorPreview,
    reason: decision.reason,
  };
}

export async function GET(request: Request, context: RouteContext) {
  const id = requestId(request);
  try {
    const { resource } = await context.params;
    const path = pathOf(resource);
    const url = new URL(request.url);

    if (path === "recent-reviews") {
      if (!env.DB) {
        throw new ApiError(503, "DATABASE_UNAVAILABLE", "Recent reviews are temporarily unavailable.");
      }
      const limit = Math.min(12, Math.max(1, Number(url.searchParams.get("limit") ?? 6) || 6));
      const rows = await env.DB.prepare(
        `SELECT r.id,
                r.rating,
                r.body,
                r.spoiler,
                r.created_at AS createdAt,
                u.display_name AS displayName,
                s.slug AS seriesSlug,
                s.title AS seriesTitle,
                s.cover_key AS coverKey,
                COALESCE((
                  SELECT COUNT(*)
                    FROM review_reactions rr
                   WHERE rr.review_id = r.id
                ), 0) AS reactionCount
           FROM reviews r
           JOIN users u ON u.id = r.user_id
           JOIN series s ON s.id = r.series_id
          WHERE r.moderation_status = 'VISIBLE'
            AND r.body <> ''
            AND ${publicSeriesPredicate("s")}
          ORDER BY datetime(r.created_at) DESC
          LIMIT ?`,
      ).bind(limit).all<{
        id: string;
        rating: number;
        body: string;
        spoiler: number | boolean;
        createdAt: string;
        displayName: string;
        seriesSlug: string;
        seriesTitle: string;
        coverKey: string | null;
        reactionCount: number;
      }>();
      return json(id, {
        data: rows.results.map((review) => ({
          ...review,
          coverUrl:
            review.coverKey &&
            (review.coverKey.startsWith("/") || review.coverKey.startsWith("http://") || review.coverKey.startsWith("https://"))
              ? review.coverKey
              : review.coverKey
                ? `/api/v1/series-cover?slug=${encodeURIComponent(review.seriesSlug)}`
                : null,
        })),
      });
    }

    if (path === "site-commercial-settings") {
      const document = await getCommercialSettingsDocument();
      const featureStates = env.DB ? await getFeatureStates(env.DB) : null;
      const sanitizedSettings = sanitizeCommercialSettingsForPublic(
        document.settings,
      );
      const publicDocument = {
        ...document,
        runtimeFeatures: {
          premiumUnlocks:
            featureStates?.premium_unlocks.effective === true,
          payments: featureStates?.payments.effective === true,
          memberships: featureStates?.memberships.effective === true,
          onyxPurchases:
            featureStates?.onyx_purchases.effective === true,
          adSupportedUnlocks:
            featureStates?.ad_supported_unlocks.effective === true,
          teamPayouts:
            featureStates?.team_payouts.effective === true,
        },
        settings: {
          ...sanitizedSettings,
          economy: {
            ...sanitizedSettings.economy,
            premiumEconomyPublic: Boolean(
              sanitizedSettings.economy.premiumEconomyPublic &&
                featureStates?.premium_unlocks.effective,
            ),
          },
        },
      };
      return json(id, publicDocument, {
        headers: {
          "cache-control": "no-store",
        },
      });
    }

    if (path === "site-configuration") {
      const document = await getSiteConfigurationDocument();
      const publicSlot = (
        slot: SiteConfiguration["brand"]["logo"],
        name:
          | "logo"
          | "compact-logo"
          | "app-icon"
          | "first-page"
          | "last-page",
      ) => ({
        ...slot,
        key: slot.key ? `public/site/${name}-configured` : null,
      });
      return json(id, {
        ...document,
        settings: {
          ...document.settings,
          brand: {
            ...document.settings.brand,
            logo: publicSlot(document.settings.brand.logo, "logo"),
            compactLogo: publicSlot(
              document.settings.brand.compactLogo,
              "compact-logo",
            ),
            appIcon: publicSlot(document.settings.brand.appIcon, "app-icon"),
          },
          reader: {
            firstPage: publicSlot(
              document.settings.reader.firstPage,
              "first-page",
            ),
            lastPage: publicSlot(
              document.settings.reader.lastPage,
              "last-page",
            ),
          },
        },
      }, {
        headers: {
          "cache-control": "public, max-age=30, stale-while-revalidate=120",
        },
      });
    }

    if (path === "site-media") {
      if (!env.BUCKET) {
        throw new ApiError(
          503,
          "MEDIA_UNAVAILABLE",
          "Site media is temporarily unavailable.",
        );
      }
      const slot = z
        .enum(["logo", "compact", "app", "first", "last"])
        .parse(url.searchParams.get("slot"));
      if (!["logo", "compact", "app"].includes(slot)) {
        const actor = await getActor();
        if (!actor || !isAdminActor(actor)) {
          const seriesSlug = slugSchema.parse(
            url.searchParams.get("series") ?? "",
          );
          const chapterSlug = slugSchema.parse(
            url.searchParams.get("chapter") ?? "",
          );
          const decision = await resolveChapterAccess(
            actor,
            seriesSlug,
            chapterSlug,
          );
          if (!decision.canRead) {
            throw new ApiError(
              403,
              "CHAPTER_LOCKED",
              "This reader page is not available to this account.",
            );
          }
        }
      }
      const settings = await getSiteConfiguration();
      const media =
        slot === "logo"
          ? settings.brand.logo
          : slot === "compact"
            ? settings.brand.compactLogo
            : slot === "app"
              ? settings.brand.appIcon
          : slot === "first"
            ? settings.reader.firstPage
            : settings.reader.lastPage;
      if (!media.enabled || !media.key) {
        throw new ApiError(
          404,
          "SITE_MEDIA_NOT_FOUND",
          "This site image is not enabled.",
        );
      }
      const object = await env.BUCKET.get(media.key);
      if (!object) {
        throw new ApiError(
          404,
          "SITE_MEDIA_NOT_FOUND",
          "This site image is unavailable.",
        );
      }
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("content-disposition", "inline");
      headers.set(
        "cache-control",
        ["logo", "compact", "app"].includes(slot)
          ? "public, max-age=3600, stale-while-revalidate=86400"
          : "private, no-store",
      );
      headers.set("x-content-type-options", "nosniff");
      if (!["logo", "compact", "app"].includes(slot)) {
        headers.set("vary", "cookie");
      }
      headers.set("etag", object.httpEtag);
      if (request.headers.get("if-none-match") === object.httpEtag) {
        return new Response(null, { status: 304, headers });
      }
      return new Response(object.body, { headers });
    }

    if (path === "health" || path === "ready") {
      let database = "unavailable";
      try {
        if (env.DB) {
          await env.DB.prepare("SELECT 1 AS ok").first();
          database = "ok";
        }
      } catch {
        database = "degraded";
      }
      const status = database === "ok" ? "ok" : "degraded";
      return json(
        id,
        {
          status,
          service: "nyascans-edge",
          checks: { database, objectStorage: env.BUCKET ? "ok" : "unavailable" },
        },
        { status: status === "ok" ? 200 : 503 },
      );
    }

    if (path === "chapter-access") {
      const seriesSlug = slugSchema.parse(
        url.searchParams.get("series") ?? "",
      );
      const chapterSlug = slugSchema.parse(
        url.searchParams.get("chapter") ?? "",
      );
      const actor = await getActor();
      const decision = await resolveChapterAccess(
        actor,
        seriesSlug,
        chapterSlug,
      );
      if (
        decision.reason === "UNAVAILABLE" &&
        (!actor || !isAdminActor(actor))
      ) {
        throw new ApiError(
          404,
          "CHAPTER_NOT_FOUND",
          "This chapter is not available.",
        );
      }
      return json(
        id,
        { data: chapterAccessContract(decision) },
        {
          headers: {
            "cache-control": "private, no-store",
            vary: "cookie",
          },
        },
      );
    }

    if (path === "reader-context") {
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Reader context is temporarily unavailable.",
        );
      }
      const seriesSlug = slugSchema.parse(
        url.searchParams.get("series") ?? "",
      );
      const chapterSlug = slugSchema.parse(
        url.searchParams.get("chapter") ?? "",
      );
      const actor = await getActor();
      const access = await resolveChapterAccess(
        actor,
        seriesSlug,
        chapterSlug,
      );
      if (
        access.reason === "UNAVAILABLE" &&
        (!actor || !isAdminActor(actor))
      ) {
        throw new ApiError(
          404,
          "CHAPTER_NOT_FOUND",
          "This chapter is not available.",
        );
      }
      const record = await env.DB.prepare(
        `SELECT s.id AS seriesId,
                s.slug AS seriesSlug,
                s.title AS seriesTitle,
                s.cover_key AS coverKey,
                s.reading_direction AS readingDirection,
                c.id AS chapterId,
                c.slug AS chapterSlug,
                c.chapter_number AS chapterNumber,
                c.title AS chapterTitle,
                c.language,
                c.version,
                c.team_id AS teamId,
                c.published_at AS publishedAt,
                c.comments_enabled AS commentsEnabled,
                t.name AS teamName
           FROM chapters c
           JOIN series s ON s.id = c.series_id
           LEFT JOIN teams t ON t.id = c.team_id
          WHERE s.slug = ?
            AND c.slug = ?
          LIMIT 1`,
      )
        .bind(seriesSlug, chapterSlug)
        .first<{
          seriesId: string;
          seriesSlug: string;
          seriesTitle: string;
          coverKey: string | null;
          readingDirection: string;
          chapterId: string;
          chapterSlug: string;
          chapterNumber: string;
          chapterTitle: string;
          language: string;
          version: number;
          teamId: string | null;
          publishedAt: string | null;
          commentsEnabled: number;
          teamName: string | null;
        }>();
      if (!record) {
        throw new ApiError(
          404,
          "CHAPTER_NOT_FOUND",
          "This chapter is not available.",
        );
      }
      const [previousTarget, nextTarget] = await Promise.all([
        env.DB.prepare(
          `SELECT candidate.chapter_number AS chapterNumber
             FROM chapters candidate
             LEFT JOIN content_visibility_overrides candidate_visibility
               ON candidate_visibility.chapter_id = candidate.id
            WHERE candidate.series_id = ?
              AND candidate.state = 'PUBLISHED'
              AND candidate.visibility = 'PUBLIC'
              AND candidate.published_at IS NOT NULL
              AND datetime(candidate.published_at) <= datetime('now')
              AND ${publicPaidChapterPredicate("candidate", "candidate_visibility")}
              AND CAST(candidate.chapter_number AS REAL) < CAST(? AS REAL)
            ORDER BY CAST(candidate.chapter_number AS REAL) DESC,
                     candidate.chapter_number DESC
            LIMIT 1`,
        )
          .bind(record.seriesId, record.chapterNumber)
          .first<{ chapterNumber: string }>(),
        env.DB.prepare(
        `SELECT candidate.chapter_number AS chapterNumber
           FROM chapters candidate
           LEFT JOIN content_visibility_overrides candidate_visibility
             ON candidate_visibility.chapter_id = candidate.id
          WHERE candidate.series_id = ?
            AND candidate.state = 'PUBLISHED'
            AND candidate.visibility = 'PUBLIC'
            AND candidate.published_at IS NOT NULL
            AND datetime(candidate.published_at) <= datetime('now')
            AND ${publicPaidChapterPredicate("candidate", "candidate_visibility")}
            AND CAST(candidate.chapter_number AS REAL) > CAST(? AS REAL)
          ORDER BY CAST(candidate.chapter_number AS REAL) ASC,
                   candidate.chapter_number ASC
          LIMIT 1`,
        )
          .bind(record.seriesId, record.chapterNumber)
          .first<{ chapterNumber: string }>(),
      ]);
      type ContinuityCandidate = {
        chapterSlug: string;
        chapterNumber: string;
        title: string;
        language: string;
        version: number;
        teamId: string | null;
        teamName: string | null;
        publishedAt: string | null;
      };
      const loadContinuityCandidates = async (
        chapterNumber: string | undefined,
      ) => {
        if (!chapterNumber) return [] as ContinuityCandidate[];
        const rows = await env.DB.prepare(
          `SELECT c.slug AS chapterSlug,
                  c.chapter_number AS chapterNumber,
                  c.title,
                  c.language,
                  c.version,
                  c.team_id AS teamId,
                  t.name AS teamName,
                  c.published_at AS publishedAt
             FROM chapters c
             LEFT JOIN teams t ON t.id = c.team_id
             LEFT JOIN content_visibility_overrides visibility_override
               ON visibility_override.chapter_id = c.id
            WHERE c.series_id = ?
              AND c.chapter_number = ?
              AND c.state = 'PUBLISHED'
              AND c.visibility = 'PUBLIC'
              AND c.published_at IS NOT NULL
              AND datetime(c.published_at) <= datetime('now')
              AND ${publicPaidChapterPredicate("c", "visibility_override")}
            ORDER BY c.version DESC,
                     datetime(c.published_at) DESC,
                     c.id DESC
            LIMIT 50`,
        )
          .bind(record.seriesId, chapterNumber)
          .all<ContinuityCandidate>();
        return rows.results;
      };
      const [previousCandidates, nextCandidates] = await Promise.all([
        loadContinuityCandidates(previousTarget?.chapterNumber),
        loadContinuityCandidates(nextTarget?.chapterNumber),
      ]);
      const preference = {
        teamId: record.teamId,
        language: record.language,
      };
      const previous = selectPreferredRelease(
        previousCandidates,
        preference,
      );
      const next = selectPreferredRelease(nextCandidates, preference);
      const alternativeContract = async (candidate: ContinuityCandidate) => {
        const decision = await resolveChapterAccess(
          actor,
          record.seriesSlug,
          candidate.chapterSlug,
        );
        return {
          ...chapterAccessContract(decision),
          title: candidate.title,
        };
      };
      const [previousAlternatives, nextAlternatives] = await Promise.all([
        Promise.all(previousCandidates.map(alternativeContract)),
        Promise.all(nextCandidates.map(alternativeContract)),
      ]);
      const coverKey = record.coverKey?.trim() ?? "";
      let chapterManagementHref: string | null = null;
      if (actor) {
        try {
          const management = await requireChapterManagementScope(
            actor,
            record.seriesId,
            record.chapterId,
          );
          chapterManagementHref = management.administrator
            ? `/onyx/admin/access/series/${encodeURIComponent(record.seriesId)}/chapters/${encodeURIComponent(record.chapterId)}`
            : `/dashboard/series/${encodeURIComponent(record.seriesId)}/chapters/${encodeURIComponent(record.chapterId)}`;
        } catch {
          chapterManagementHref = null;
        }
      }
      return json(
        id,
        {
          series: {
            slug: record.seriesSlug,
            title: record.seriesTitle,
            cover:
              coverKey &&
              (coverKey.startsWith("/") || /^https?:\/\//.test(coverKey))
                ? coverKey
                : coverKey
                  ? `/api/v1/series-cover?slug=${encodeURIComponent(record.seriesSlug)}`
                  : null,
            readingDirection: record.readingDirection,
            teamName: record.teamName ?? "Independent release",
          },
          chapter: {
            id: record.chapterId,
            teamId: record.teamId,
            slug: record.chapterSlug,
            number: normalizeChapterNumber(record.chapterNumber),
            title: record.chapterTitle,
            label: access.chapterLabel,
            language: record.language,
            version: Number(record.version),
            publishedAt: record.publishedAt,
            commentsEnabled: Boolean(record.commentsEnabled),
          },
          previousChapter: previous
            ? {
                slug: previous.chapterSlug,
                number: normalizeChapterNumber(previous.chapterNumber),
                title: previous.title,
              }
            : null,
          nextChapter: next
            ? {
                slug: next.chapterSlug,
                number: normalizeChapterNumber(next.chapterNumber),
                title: next.title,
              }
            : null,
          previousAlternatives,
          nextAlternatives,
          previousFallbackReason: previous
            ? null
            : continuityFallbackReason(previousCandidates, preference),
          nextFallbackReason: next
            ? null
            : continuityFallbackReason(nextCandidates, preference),
          nextFallbackRequired: !next && nextAlternatives.length > 0,
          chapterManagementHref,
          access: chapterAccessContract(access),
        },
        {
          headers: {
            "cache-control": "private, no-store",
            vary: "cookie",
          },
        },
      );
    }

    if (path === "chapter-access-list") {
      const seriesSlug = slugSchema.parse(
        url.searchParams.get("series") ?? "",
      );
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Chapter availability is temporarily unavailable.",
        );
      }
      const seriesRecord = await env.DB.prepare(
        `SELECT s.id FROM series s
         WHERE s.slug = ? AND ${publicSeriesPredicate("s")} LIMIT 1`,
      )
        .bind(seriesSlug)
        .first<{ id: string }>();
      if (!seriesRecord) {
        throw new ApiError(
          404,
          "SERIES_NOT_FOUND",
          "This series is not available.",
        );
      }
      const actor = await getActor();
      const featureStates = await getFeatureStates(env.DB);
      const paidChapterPredicate = `AND ${publicPaidChapterPredicate(
        "c",
        "visibility_override",
      )}`;
      const releaseRows = await env.DB.prepare(
        `SELECT c.id,
                s.id AS seriesId,
                c.team_id AS teamId,
                s.slug AS seriesSlug,
                c.slug AS chapterSlug,
                c.chapter_number AS chapterNumber,
                CASE
                  WHEN c.title = '' THEN 'Chapter ' || c.chapter_number
                  ELSE 'Chapter ' || c.chapter_number || ' · ' || c.title
                END AS chapterLabel,
                c.language,
                c.version,
                c.thumbnail_key AS thumbnailKey,
                c.revision AS chapterRevision,
                t.name AS teamName,
                t.slug AS teamSlug,
                s.access_type AS seriesAccessType,
                c.uploader_user_id AS uploaderUserId,
                uploader.display_name AS uploaderName,
                uploader_profile.username AS uploaderUsername,
                CASE
                  WHEN (${effectiveChapterAccessSql("c", "visibility_override")}) = 'FREE'
                  THEN 'FREE' ELSE 'PAID'
                END AS accessType,
                ${effectiveChapterAccessSql("c", "visibility_override")} AS accessLevel,
                CASE
                  WHEN (${effectiveChapterAccessSql("c", "visibility_override")})
                       IN ('FREE', 'PREMIUM')
                  THEN 0 ELSE c.price_onyx
                END AS priceOnyx,
                c.published_at AS publishedAt,
                datetime(c.published_at) >
                  datetime('now', '-36 hours') AS isFresh,
                EXISTS (
                  SELECT 1 FROM reading_progress rp
                   WHERE rp.user_id = ? AND rp.chapter_id = c.id
                     AND (rp.completed_at IS NOT NULL OR rp.progress_basis_points >= 9200)
                ) AS isRead,
                c.state,
                c.visibility,
                s.is_published AS seriesPublished,
                s.archived_at AS seriesArchivedAt,
                s.rights_status AS rightsStatus,
                EXISTS (
                  SELECT 1
                    FROM teams preview_team
                   WHERE preview_team.id = c.team_id
                     AND preview_team.is_archived = 0
                     AND preview_team.verification_status = 'VERIFIED'
                ) AS teamPreviewAllowed
           FROM chapters c
           JOIN series s ON s.id = c.series_id
           LEFT JOIN teams t ON t.id = c.team_id
           LEFT JOIN users uploader ON uploader.id = c.uploader_user_id
           LEFT JOIN user_profiles uploader_profile
             ON uploader_profile.user_id = c.uploader_user_id
           LEFT JOIN content_visibility_overrides visibility_override
             ON visibility_override.chapter_id = c.id
          WHERE c.series_id = ?
            AND c.state = 'PUBLISHED'
            AND c.visibility = 'PUBLIC'
            AND datetime(c.published_at) <= datetime('now')
            ${paidChapterPredicate}
          ORDER BY CAST(c.chapter_number AS REAL) DESC,
                   c.version DESC,
                   datetime(c.published_at) DESC,
                   c.id DESC
          LIMIT 1000`,
      )
        .bind(actor?.id ?? "", seriesRecord.id)
        .all<
          Omit<
            ChapterAccessRecord,
            "seriesPublished" | "priceOnyx" | "teamPreviewAllowed"
          > & {
            seriesPublished: number;
            priceOnyx: number;
            teamPreviewAllowed: number;
            isFresh: number;
            isRead: number;
            thumbnailKey: string | null;
            chapterRevision: number;
            uploaderUserId: string | null;
            uploaderName: string | null;
            uploaderUsername: string | null;
            teamSlug: string | null;
          }
        >();
      const unlockedIds = new Set<string>();
      let canUploadChapter = false;
      let hasActiveMembership = false;
      if (actor) {
        const entitlements = await env.DB.prepare(
          `SELECT e.chapter_id AS chapterId
             FROM entitlements e
             JOIN chapters c ON c.id = e.chapter_id
            WHERE e.user_id = ?
              AND c.series_id = ?
              AND e.revoked_at IS NULL
              AND e.starts_at <= CURRENT_TIMESTAMP
              AND (e.expires_at IS NULL OR e.expires_at > CURRENT_TIMESTAMP)`,
        )
          .bind(actor.id, seriesRecord.id)
          .all<{ chapterId: string }>();
        for (const entitlement of entitlements.results) {
          unlockedIds.add(entitlement.chapterId);
        }
        if (featureStates.memberships.effective) {
          hasActiveMembership = Boolean(
            await env.DB.prepare(
              `SELECT 1 FROM user_memberships membership
                WHERE membership.user_id = ?
                  AND membership.status IN ('ACTIVE', 'TRIALING')
                  AND (membership.current_period_end IS NULL
                       OR datetime(membership.current_period_end) > datetime('now'))
                  AND NOT EXISTS (
                    SELECT 1 FROM payment_financial_states financial_state
                     WHERE financial_state.membership_id = membership.id
                       AND financial_state.membership_risk_active = 1
                  )
                LIMIT 1`,
            )
              .bind(actor.id)
              .first(),
          );
        }
        if (isAdminActor(actor)) {
          canUploadChapter = actorHasCapability(actor, "upload.create");
        } else if (actorHasCapability(actor, "upload.create")) {
          const verifiedMembership = await env.DB.prepare(
            `SELECT 1
               FROM team_memberships tm
               JOIN teams t ON t.id = tm.team_id
              WHERE tm.user_id = ?
                AND tm.status = 'ACTIVE'
                AND UPPER(tm.membership_role) IN
                  ('OWNER', 'LEADER', 'TEAM_LEADER', 'MANAGER', 'UPLOADER')
                AND t.is_archived = 0
                AND t.verification_status = 'VERIFIED'
              LIMIT 1`,
          )
            .bind(actor.id)
            .first();
          canUploadChapter = Boolean(verifiedMembership);
        }
      }
      const chapterDiscounts = await resolveSeriesChapterDiscounts(
        seriesRecord.id,
        releaseRows.results.map((chapter) => ({
          chapterId: chapter.id,
          basePrice: Number(chapter.priceOnyx),
        })),
      );
      const decisions = releaseRows.results.map((chapter) => {
        const basePriceOnyx = Number(chapter.priceOnyx);
        const price = chapterDiscounts.get(chapter.id) ?? {
          basePriceOnyx,
          priceOnyx: basePriceOnyx,
          discountId: null,
          discountRevision: null,
          discountTargetType: null,
          discountPercentage: null,
          discountEndsAt: null,
        };
        return {
          ...decideChapterAccess(
            {
              ...chapter,
              ...price,
              seriesPublished: Boolean(chapter.seriesPublished),
              teamPreviewAllowed: Boolean(chapter.teamPreviewAllowed),
            },
            actor,
            unlockedIds.has(chapter.id),
            hasActiveMembership,
          ),
          isFresh: Boolean(chapter.isFresh),
          isRead: Boolean(chapter.isRead),
        };
      });
      return json(
        id,
        {
          data: decisions.map((chapter, index) => {
            const source = releaseRows.results[index];
            return {
              ...chapterAccessContract(chapter),
              uploaderUserId: source?.uploaderUserId ?? null,
              uploaderName: source?.uploaderName ?? "NyaScans member",
              uploaderUsername: source?.uploaderUsername ?? null,
              teamSlug: source?.teamSlug ?? null,
              isRead: Boolean(source?.isRead),
              thumbnailUrl: source?.thumbnailKey
                ? `/api/v1/chapter-thumbnail?id=${encodeURIComponent(chapter.chapterId)}&v=${Number(source.chapterRevision ?? 1)}`
                : null,
            };
          }),
          permissions: {
            canUploadChapter,
          },
        },
        {
          headers: {
            "cache-control": "private, no-store",
            vary: "cookie",
          },
        },
      );
    }

    if (path === "chapter-pages") {
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Chapter pages are unavailable.",
        );
      }
      const seriesSlug = slugSchema.parse(
        url.searchParams.get("series") ?? "",
      );
      const chapterSlug = slugSchema.parse(
        url.searchParams.get("chapter") ?? "",
      );
      const actor = await getActor();
      const decision = await resolveChapterAccess(
        actor,
        seriesSlug,
        chapterSlug,
      );
      if (!decision.canRead) {
        throw new ApiError(
          403,
          "CHAPTER_LOCKED",
          "This chapter is not available to this account.",
        );
      }
      const chapterFixedPages = await env.DB.prepare(
        `SELECT include_fixed_first_page AS includeFirst,
                include_fixed_last_page AS includeLast
           FROM chapters WHERE id = ? LIMIT 1`,
      )
        .bind(decision.chapterId)
        .first<{ includeFirst: number; includeLast: number }>();
      const fixedPages = {
        first: chapterFixedPages?.includeFirst !== 0,
        last: chapterFixedPages?.includeLast !== 0,
      };
      const pages = await env.DB.prepare(
        `SELECT id,
                page_index AS pageIndex,
                width,
                height,
                sha256,
                processing_status AS processingStatus
           FROM chapter_pages
          WHERE chapter_id = ?
          ORDER BY page_index ASC`,
      )
        .bind(decision.chapterId)
        .all<{
          id: string;
          pageIndex: number;
          width: number;
          height: number;
          sha256: string;
          processingStatus: string;
        }>();
      const readyPages = pages.results.filter(
        (pageRecord) => pageRecord.processingStatus === "READY",
      );
      if (pages.results.length === 0) {
        const testingFixture = await env.DB.prepare(
          `SELECT s.slug,
                  s.cover_key AS coverKey,
                  s.rights_status AS rightsStatus
             FROM chapters c
             JOIN series s ON s.id = c.series_id
            WHERE c.id = ?
              AND s.rights_status IN ('DEMO_ORIGINAL', 'TEST_ORIGINAL')
            LIMIT 1`,
        )
          .bind(decision.chapterId)
          .first<{
            slug: string;
            coverKey: string | null;
            rightsStatus: string;
          }>();
        const fallbackUrl = testingFixture
          ? publicSeriesCover(testingFixture.slug, testingFixture.coverKey)
          : null;
        if (fallbackUrl) {
          const manifest = await fixedReaderManifest(
            [
              {
                id: `fixture_${decision.chapterId}`,
                pageIndex: 0,
                width: 1200,
                height: 1800,
                sha256: `rights-safe-fixture-${decision.chapterId}`,
                processingStatus: "READY",
                url: fallbackUrl,
                testingFixture: true,
              },
            ],
            seriesSlug,
            chapterSlug,
            fixedPages,
          );
          return json(
            id,
            {
              data: manifest,
            },
            {
              headers: {
                "cache-control": "private, no-store",
                vary: "cookie",
              },
            },
          );
        }
        throw new ApiError(
          409,
          "CHAPTER_PAGES_PROCESSING",
          "This chapter has no processed pages yet. Retry after the upload finishes.",
        );
      }
      const contiguous = readyPages.every(
        (pageRecord, index) => Number(pageRecord.pageIndex) === index,
      );
      if (pages.results.length > 0 && (!contiguous || readyPages.length !== pages.results.length)) {
        throw new ApiError(
          409,
          "CHAPTER_PAGES_INCOMPLETE",
          "Some chapter pages are still processing or out of order. Retry after the release is finalized.",
        );
      }
      return json(
        id,
        {
          data: await fixedReaderManifest(
            readyPages.map((pageRecord) => ({
              ...pageRecord,
              url: `/api/v1/chapter-page?id=${encodeURIComponent(pageRecord.id)}&v=${encodeURIComponent(pageRecord.sha256.slice(0, 16))}`,
            })),
            seriesSlug,
            chapterSlug,
            fixedPages,
          ),
        },
        {
          headers: {
            "cache-control": "private, no-store",
            vary: "cookie",
          },
        },
      );
    }

    if (path === "chapter-page") {
      if (!env.DB || !env.BUCKET) {
        throw new ApiError(
          503,
          "MEDIA_UNAVAILABLE",
          "Chapter media is unavailable.",
        );
      }
      const pageId = z
        .string()
        .trim()
        .min(3)
        .max(160)
        .parse(url.searchParams.get("id"));
      const pageRecord = await env.DB.prepare(
        `SELECT cp.object_key AS objectKey,
                s.slug AS seriesSlug,
                c.slug AS chapterSlug
           FROM chapter_pages cp
           JOIN chapters c ON c.id = cp.chapter_id
           JOIN series s ON s.id = c.series_id
          WHERE cp.id = ?
            AND cp.processing_status = 'READY'
          LIMIT 1`,
      )
        .bind(pageId)
        .first<{
          objectKey: string;
          seriesSlug: string;
          chapterSlug: string;
        }>();
      if (!pageRecord) {
        throw new ApiError(404, "PAGE_NOT_FOUND", "This page was not found.");
      }
      const decision = await resolveChapterAccess(
        await getActor(),
        pageRecord.seriesSlug,
        pageRecord.chapterSlug,
      );
      if (!decision.canRead) {
        throw new ApiError(
          403,
          "CHAPTER_LOCKED",
          "This chapter is not available to this account.",
        );
      }
      const object = await env.BUCKET.get(pageRecord.objectKey);
      if (!object) {
        throw new ApiError(404, "PAGE_NOT_FOUND", "This page was not found.");
      }
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("content-disposition", "inline");
      headers.set("cache-control", "private, no-store");
      headers.set("vary", "cookie");
      headers.set("etag", object.httpEtag);
      if (request.headers.get("if-none-match") === object.httpEtag) {
        return new Response(null, { status: 304, headers });
      }
      return new Response(object.body, { headers });
    }

    if (path === "catalog") {
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "The catalog is temporarily unavailable.",
        );
      }
      const page = z.coerce.number().int().min(1).max(100000).catch(1).parse(
        url.searchParams.get("page"),
      );
      const pageSize = z.coerce
        .number()
        .int()
        .min(6)
        .max(66)
        .catch(24)
        .parse(url.searchParams.get("pageSize"));
      const statusValues = (url.searchParams.get("status") ?? "")
        .split(",")
        .map((value) => value.trim().toUpperCase())
        .filter((value): value is "ONGOING" | "COMPLETED" | "HIATUS" | "PAUSED" | "CANCELLED" | "UPCOMING" =>
          ["ONGOING", "COMPLETED", "HIATUS", "PAUSED", "CANCELLED", "UPCOMING"].includes(value as never),
        )
        .slice(0, 6);
      const type = z
        .enum(["MANHWA", "MANGA", "MANHUA"])
        .optional()
        .catch(undefined)
        .parse(url.searchParams.get("type")?.toUpperCase());
      const access = z
        .enum(["FREE", "PAID"])
        .optional()
        .catch(undefined)
        .parse(url.searchParams.get("access")?.toUpperCase());
      const genreValues = (url.searchParams.get("genre") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => value.slice(0, 80))
        .slice(0, 12);
      const creatorValues = (url.searchParams.get("creator") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => value.slice(0, 120))
        .slice(0, 12);
      const minimumChapters = z
        .coerce
        .number()
        .int()
        .min(0)
        .max(10000)
        .optional()
        .catch(undefined)
        .parse(url.searchParams.get("minChapters") ?? undefined);
      const hideFollowed = ["1", "true"].includes(
        (url.searchParams.get("hideFollowed") ?? "").toLowerCase(),
      );
      const query = z
        .string()
        .trim()
        .max(160)
        .catch("")
        .parse(url.searchParams.get("q") ?? "");
      const sort = z
        .enum(["latest", "added", "viewed", "followed", "rated", "title"])
        .catch("latest")
        .parse(url.searchParams.get("sort"));
      const clauses = [publicSeriesPredicate("s")];
      const bindings: Array<string | number> = [];
      if (query) {
        const pattern = `%${query
          .toLowerCase()
          .replaceAll("%", "\\%")
          .replaceAll("_", "\\_")}%`;
        clauses.push(
          `(LOWER(s.title) LIKE ? ESCAPE '\\' OR
            LOWER(COALESCE(s.native_title, '')) LIKE ? ESCAPE '\\' OR
            LOWER(s.synopsis) LIKE ? ESCAPE '\\' OR
            EXISTS (
              SELECT 1
                FROM series_aliases sa
               WHERE sa.series_id = s.id
                 AND LOWER(sa.alias) LIKE ? ESCAPE '\\'
            ))`,
        );
        bindings.push(pattern, pattern, pattern, pattern);
      }
      if (statusValues.length) {
        clauses.push(`s.status IN (${statusValues.map(() => "?").join(", ")})`);
        bindings.push(...statusValues);
      }
      if (type) {
        clauses.push("s.type = ?");
        bindings.push(type);
      }
      if (access) {
        clauses.push("s.access_type = ?");
        bindings.push(access);
      }
      if (genreValues.length) {
        const genrePlaceholders = genreValues.map(() => "?").join(", ");
        clauses.push(`EXISTS (
          SELECT 1
            FROM series_genres sg_filter
            JOIN genres g_filter ON g_filter.id = sg_filter.genre_id
           WHERE sg_filter.series_id = s.id
             AND (LOWER(g_filter.slug) IN (${genrePlaceholders}) OR LOWER(g_filter.name) IN (${genrePlaceholders}))
        )`);
        const normalizedGenres = genreValues.map((value) => value.toLowerCase());
        bindings.push(...normalizedGenres, ...normalizedGenres);
      }
      if (creatorValues.length) {
        const creatorPatterns = creatorValues.map((creatorValue) => `%${creatorValue
          .toLowerCase()
          .replaceAll("%", "\\\\%")
          .replaceAll("_", "\\\\_")}%`);
        const creatorTerms = creatorPatterns.map(() => "LOWER(c_filter.name) LIKE ? ESCAPE '\\'").join(" OR ");
        const publisherTerms = creatorPatterns.map(() => "LOWER(p_filter.name) LIKE ? ESCAPE '\\'").join(" OR ");
        clauses.push(`(
          EXISTS (
            SELECT 1
              FROM series_creators sc_filter
              JOIN creators c_filter ON c_filter.id = sc_filter.creator_id
             WHERE sc_filter.series_id = s.id
               AND (${creatorTerms})
          )
          OR EXISTS (
            SELECT 1
              FROM publishers p_filter
             WHERE p_filter.id = s.publisher_id
               AND (${publisherTerms})
          )
        )`);
        bindings.push(...creatorPatterns, ...creatorPatterns);
      }
      if (minimumChapters && minimumChapters > 0) {
        clauses.push(`(
          SELECT COUNT(DISTINCT CASE
            WHEN mc_filter.id IS NULL THEN NULL
            WHEN NOT (${publicPaidChapterPredicate("mc_filter", "mc_visibility")}) THEN NULL
            WHEN LTRIM(mc_filter.chapter_number, '0') = '' THEN '0'
            ELSE LTRIM(mc_filter.chapter_number, '0')
          END)
            FROM chapters mc_filter
            LEFT JOIN content_visibility_overrides mc_visibility
              ON mc_visibility.chapter_id = mc_filter.id
           WHERE mc_filter.series_id = s.id
             AND mc_filter.state = 'PUBLISHED'
             AND mc_filter.visibility = 'PUBLIC'
             AND datetime(mc_filter.published_at) <= datetime('now')
        ) >= ?`);
        bindings.push(minimumChapters);
      }
      if (hideFollowed) {
        const actor = await getActor().catch(() => null);
        if (actor) {
          clauses.push(`NOT EXISTS (
            SELECT 1
              FROM follows hidden_follow
             WHERE hidden_follow.user_id = ?
               AND hidden_follow.series_id = s.id
          )`);
          bindings.push(actor.id);
        }
      }
      const orderBy = {
        latest: "COALESCE(latestPublishedAt, s.updated_at) DESC",
        added: "s.created_at DESC",
        viewed: "s.view_count DESC, s.updated_at DESC",
        followed: "s.follower_count DESC, s.updated_at DESC",
        rated: "s.rating_tenths DESC, s.updated_at DESC",
        title: "s.title COLLATE NOCASE ASC",
      }[sort];
      const where = clauses.join(" AND ");
      const [rows, totalRow] = await Promise.all([
        env.DB.prepare(
          `SELECT s.id,
                  s.slug,
                  s.title,
                  s.native_title AS nativeTitle,
                  s.synopsis,
                  s.type,
                  s.status,
                  s.origin_country AS originCountry,
                  s.original_language AS originalLanguage,
                  s.reading_direction AS readingDirection,
                  s.access_type AS accessType,
                  s.cover_key AS coverKey,
                  s.rating_tenths AS ratingTenths,
                  s.follower_count AS followerCount,
                  s.view_count AS viewCount,
                  MAX(CASE
                    WHEN c.id IS NOT NULL
                     AND ${publicPaidChapterPredicate("c", "visibility_override")}
                    THEN c.published_at
                    ELSE NULL
                  END) AS latestPublishedAt,
                  COUNT(DISTINCT CASE
                    WHEN c.id IS NULL THEN NULL
                    WHEN NOT (${publicPaidChapterPredicate("c", "visibility_override")})
                    THEN NULL
                    WHEN LTRIM(c.chapter_number, '0') = '' THEN '0'
                    ELSE LTRIM(c.chapter_number, '0')
                  END) AS chapterCount,
                  (
                    SELECT latest.chapter_number
                      FROM chapters latest
                      LEFT JOIN content_visibility_overrides latest_visibility
                        ON latest_visibility.chapter_id = latest.id
                     WHERE latest.series_id = s.id
                       AND latest.state = 'PUBLISHED'
                       AND latest.visibility = 'PUBLIC'
                       AND datetime(latest.published_at) <= datetime('now')
                       AND ${publicPaidChapterPredicate("latest", "latest_visibility")}
                     ORDER BY latest.published_at DESC, latest.created_at DESC
                     LIMIT 1
                  ) AS latestChapterNumber,
                  (
                    SELECT COUNT(*)
                      FROM discussion_comments dc_catalog
                     WHERE dc_catalog.series_slug = s.slug
                       AND dc_catalog.moderation_status = 'VISIBLE'
                       AND dc_catalog.deleted_at IS NULL
                  ) AS commentCount
             FROM series s
             LEFT JOIN chapters c
               ON c.series_id = s.id
              AND c.state = 'PUBLISHED'
              AND c.visibility = 'PUBLIC'
              AND datetime(c.published_at) <= datetime('now')
             LEFT JOIN content_visibility_overrides visibility_override
               ON visibility_override.chapter_id = c.id
            WHERE ${where}
            GROUP BY s.id
            ORDER BY ${orderBy}
            LIMIT ? OFFSET ?`,
        )
          .bind(...bindings, pageSize, (page - 1) * pageSize)
          .all(),
        env.DB.prepare(
          `SELECT COUNT(*) AS count FROM series s WHERE ${where}`,
        )
          .bind(...bindings)
          .first<{ count: number }>(),
      ]);
      const total = Number(totalRow?.count ?? 0);
      const [genreRows, creatorRows, publisherRows] = await Promise.all([
        env.DB.prepare(
          `SELECT g.slug AS value,
                  g.name AS label,
                  COUNT(DISTINCT sg.series_id) AS count
             FROM genres g
             LEFT JOIN series_genres sg ON sg.genre_id = g.id
             LEFT JOIN series genre_series ON genre_series.id = sg.series_id
            WHERE g.archived_at IS NULL
              AND (genre_series.id IS NULL OR (${publicSeriesPredicate("genre_series")}))
            GROUP BY g.id
            ORDER BY g.name COLLATE NOCASE ASC
            LIMIT 80`,
        ).all(),
        env.DB.prepare(
          `SELECT c.name AS value,
                  c.name AS label,
                  'creator' AS kind,
                  COUNT(DISTINCT sc.series_id) AS count
             FROM creators c
             JOIN series_creators sc ON sc.creator_id = c.id
             JOIN series creator_series ON creator_series.id = sc.series_id
            WHERE c.archived_at IS NULL
              AND ${publicSeriesPredicate("creator_series")}
            GROUP BY c.id
            ORDER BY c.name COLLATE NOCASE ASC
            LIMIT 120`,
        ).all(),
        env.DB.prepare(
          `SELECT p.name AS value,
                  p.name AS label,
                  'publisher' AS kind,
                  COUNT(DISTINCT publisher_series.id) AS count
             FROM publishers p
             JOIN series publisher_series ON publisher_series.publisher_id = p.id
            WHERE p.archived_at IS NULL
              AND ${publicSeriesPredicate("publisher_series")}
            GROUP BY p.id
            ORDER BY p.name COLLATE NOCASE ASC
            LIMIT 80`,
        ).all(),
      ]);
      const facets = {
        genres: (genreRows.results as Array<Record<string, unknown>>).map((row) => ({
          value: String(row.value ?? ""),
          label: String(row.label ?? row.value ?? ""),
          count: Number(row.count ?? 0),
        })),
        creators: ([
          ...(creatorRows.results as Array<Record<string, unknown>>),
          ...(publisherRows.results as Array<Record<string, unknown>>),
        ] as Array<Record<string, unknown>>)
          .map((row) => ({
            value: String(row.value ?? ""),
            label: String(row.label ?? row.value ?? ""),
            kind: row.kind === "publisher" ? "publisher" : "creator",
            count: Number(row.count ?? 0),
          }))
          .sort((left, right) => left.label.localeCompare(right.label))
          .slice(0, 160),
      };
      const data = (
        rows.results as Array<
          Record<string, unknown> & {
            slug: string;
            coverKey?: string | null;
          }
        >
      ).map((row) => {
        const coverKey = row.coverKey?.trim() ?? "";
        return {
          ...row,
          cover:
            coverKey && (coverKey.startsWith("/") || /^https?:\/\//.test(coverKey))
              ? coverKey
              : coverKey
                ? `/api/v1/series-cover?slug=${encodeURIComponent(row.slug)}`
                : null,
        };
      });
      return json(id, {
        data,
        pagination: {
          page,
          pageSize,
          total,
          pageCount: Math.max(1, Math.ceil(total / pageSize)),
          hasPrevious: page > 1,
          hasNext: page * pageSize < total,
        },
        facets,
      });
    }

    if (path === "series-cover") {
      if (!env.DB || !env.BUCKET) {
        throw new ApiError(
          503,
          "MEDIA_UNAVAILABLE",
          "Series artwork is temporarily unavailable.",
        );
      }
      const seriesSlug = slugSchema.parse(
        url.searchParams.get("slug") ?? "",
      );
      const record = await env.DB.prepare(
        `SELECT cover_key AS coverKey
           FROM series s
          WHERE s.slug = ?
            AND ${publicSeriesPredicate("s")}
          LIMIT 1`,
      )
        .bind(seriesSlug)
        .first<{ coverKey: string | null }>();
      if (!record?.coverKey || record.coverKey.startsWith("/")) {
        throw new ApiError(404, "COVER_NOT_FOUND", "Cover artwork was not found.");
      }
      const object = await env.BUCKET.get(record.coverKey);
      if (!object) {
        throw new ApiError(404, "COVER_NOT_FOUND", "Cover artwork was not found.");
      }
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("cache-control", "no-store");
      headers.set("content-disposition", "inline");
      return new Response(object.body, { headers });
    }

    if (path === "latest-releases") {
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Latest releases are temporarily unavailable.",
        );
      }
      const page = z.coerce
        .number()
        .int()
        .min(1)
        .max(100000)
        .catch(1)
        .parse(url.searchParams.get("page"));
      const pageSize = z.coerce
        .number()
        .int()
        .min(1)
        .max(24)
        .catch(12)
        .parse(url.searchParams.get("pageSize"));
      const presentation = z
        .enum(["cards", "table"])
        .catch("cards")
        .parse(url.searchParams.get("mode"));
      const period = z
        .enum(["today", "week", "month", "all"])
        .catch("all")
        .parse(url.searchParams.get("period"));
      const parsedLanguages = z
        .array(languageCodeSchema)
        .max(languageOptions.length)
        .parse(
          (url.searchParams.get("languages") ?? "")
            .split(",")
            .map((value) => value.trim().toLowerCase())
            .filter(Boolean),
        );
      const languages = [...new Set(parsedLanguages)];
      const languagePlaceholders = languages.map(() => "?").join(", ");
      const newestLanguagePredicate = languages.length
        ? `AND LOWER(newest.language) IN (${languagePlaceholders})`
        : "";
      const chapterLanguagePredicate = languages.length
        ? `AND LOWER(c.language) IN (${languagePlaceholders})`
        : "";
      const viewer = await getActor().catch(() => null);
      const newestPaidPredicate = `AND ${publicPaidChapterPredicate(
        "newest",
        "newest_visibility",
      )}`;
      const chapterPaidPredicate = `AND ${publicPaidChapterPredicate(
        "c",
        "visibility_override",
      )}`;
      const seriesPeriodPredicate = {
        today: "AND date(newest.published_at) = date('now')",
        week:
          "AND datetime(newest.published_at) >= datetime('now', '-7 days')",
        month:
          "AND datetime(newest.published_at) >= datetime('now', '-1 month')",
        all: "",
      }[period];
      const countPeriodPredicate = {
        today: "AND date(c.published_at) = date('now')",
        week: "AND datetime(c.published_at) >= datetime('now', '-7 days')",
        month: "AND datetime(c.published_at) >= datetime('now', '-1 month')",
        all: "",
      }[period];
      const newInPeriodExpression = {
        today: "date(c.published_at) = date('now')",
        week: "datetime(c.published_at) >= datetime('now', '-7 days')",
        month: "datetime(c.published_at) >= datetime('now', '-1 month')",
        all: "0",
      }[period];
      if (presentation === "table") {
        const resultPageSize = 15;
        const [releaseRows, totalRow, availableLanguageRows] = await Promise.all([
          env.DB.prepare(
            `SELECT s.id,
                    s.slug,
                    s.title,
                    s.type,
                    s.status,
                    s.cover_key AS coverKey,
                    s.rating_tenths AS ratingTenths,
                    c.published_at AS latestPublishedAt,
                    c.slug AS chapterSlug,
                    c.chapter_number AS chapterNumber,
                    c.title AS chapterTitle,
                    c.language,
                    c.version,
                    CASE
                      WHEN (${effectiveChapterAccessSql("c", "visibility_override")}) = 'FREE'
                      THEN 'FREE' ELSE 'PAID'
                    END AS accessType,
                    ${effectiveChapterAccessSql("c", "visibility_override")} AS effectiveAccessType,
                    CASE
                      WHEN (${effectiveChapterAccessSql("c", "visibility_override")})
                           IN ('FREE', 'PREMIUM')
                      THEN 0 ELSE c.price_onyx
                    END AS priceOnyx,
                    c.published_at AS publishedAt,
                    (SELECT COUNT(*) FROM comments cm WHERE cm.chapter_id = c.id AND cm.moderation_status = 'VISIBLE') AS commentCount,
                    (SELECT COUNT(*) FROM chapter_reactions cr WHERE cr.chapter_id = c.id) AS reactionCount,
                    CASE WHEN EXISTS (
                      SELECT 1
                        FROM reading_progress rp
                       WHERE rp.user_id = ?
                         AND rp.chapter_id = c.id
                         AND (
                           rp.completed_at IS NOT NULL
                           OR rp.progress_basis_points >= 9200
                         )
                    ) THEN 1 ELSE 0 END AS isRead,
                    datetime(c.published_at) >
                      datetime('now', '-24 hours') AS isFresh,
                    t.name AS teamName,
                    t.slug AS teamSlug
               FROM chapters c
               JOIN series s ON s.id = c.series_id
               LEFT JOIN teams t ON t.id = c.team_id
               LEFT JOIN content_visibility_overrides visibility_override
                 ON visibility_override.chapter_id = c.id
              WHERE ${publicSeriesPredicate("s")}
                AND c.state = 'PUBLISHED'
                AND c.visibility = 'PUBLIC'
                AND c.published_at IS NOT NULL
                AND datetime(c.published_at) <= datetime('now')
                ${chapterPaidPredicate}
                ${chapterLanguagePredicate}
                ${countPeriodPredicate}
              ORDER BY datetime(c.published_at) DESC,
                       datetime(c.created_at) DESC,
                       c.id DESC
              LIMIT ? OFFSET ?`,
          )
            .bind(
              viewer?.id ?? "",
              ...languages,
              resultPageSize,
              (page - 1) * resultPageSize,
            )
            .all<{
              id: string;
              slug: string;
              title: string;
              type: string;
              status: string;
              coverKey: string | null;
              ratingTenths: number;
              latestPublishedAt: string;
              chapterSlug: string;
              chapterNumber: string;
              chapterTitle: string;
              language: string;
              version: number;
              accessType: string;
              effectiveAccessType: string;
              priceOnyx: number;
              publishedAt: string;
              commentCount: number;
              reactionCount: number;
              isRead: number | boolean;
              isFresh: number | boolean;
              teamName: string | null;
              teamSlug: string | null;
            }>(),
          env.DB.prepare(
            `SELECT COUNT(*) AS count
               FROM chapters c
               JOIN series s ON s.id = c.series_id
               LEFT JOIN content_visibility_overrides visibility_override
                 ON visibility_override.chapter_id = c.id
              WHERE ${publicSeriesPredicate("s")}
                AND c.state = 'PUBLISHED'
                AND c.visibility = 'PUBLIC'
                AND c.published_at IS NOT NULL
                AND datetime(c.published_at) <= datetime('now')
                ${chapterPaidPredicate}
                ${chapterLanguagePredicate}
                ${countPeriodPredicate}`,
          ).bind(...languages).first<{ count: number }>(),
          env.DB.prepare(
            `SELECT DISTINCT LOWER(c.language) AS language
               FROM chapters c
               JOIN series s ON s.id = c.series_id
               LEFT JOIN content_visibility_overrides visibility_override
                 ON visibility_override.chapter_id = c.id
              WHERE ${publicSeriesPredicate("s")}
                AND c.state = 'PUBLISHED'
                AND c.visibility = 'PUBLIC'
                AND c.published_at IS NOT NULL
                AND datetime(c.published_at) <= datetime('now')
                ${chapterPaidPredicate}
                ${countPeriodPredicate}
              ORDER BY language ASC`,
          ).all<{ language: string }>(),
        ]);
        const total = Number(totalRow?.count ?? 0);
        return json(
          id,
          {
            data: releaseRows.results.map((release) => {
              const coverKey = release.coverKey?.trim() ?? "";
              return {
                id: release.id,
                slug: release.slug,
                title: release.title,
                type: release.type,
                status: release.status,
                cover:
                  coverKey &&
                  (coverKey.startsWith("/") || /^https?:\/\//.test(coverKey))
                    ? coverKey
                    : coverKey
                      ? `/api/v1/series-cover?slug=${encodeURIComponent(release.slug)}`
                      : null,
                ratingTenths: release.ratingTenths,
                latestPublishedAt: release.latestPublishedAt,
                chapters: [
                  {
                    slug: release.chapterSlug,
                    chapterNumber: normalizeChapterNumber(release.chapterNumber),
                    title: release.chapterTitle,
                    language: release.language,
                    version: release.version,
                    accessType: release.accessType,
                    effectiveAccessType: release.effectiveAccessType,
                    priceOnyx: release.priceOnyx,
                    publishedAt: release.publishedAt,
                    commentCount: Number(release.commentCount ?? 0),
                    reactionCount: Number(release.reactionCount ?? 0),
                    isRead: Boolean(release.isRead),
                    isFresh: Boolean(release.isFresh),
                    isNewInPeriod: period === "all" ? false : true,
                    teamName: release.teamName,
                    teamSlug: release.teamSlug,
                  },
                ],
              };
            }),
            pagination: {
              page,
              pageSize: resultPageSize,
              total,
              pageCount: Math.max(1, Math.ceil(total / resultPageSize)),
              hasPrevious: page > 1,
              hasNext: page * resultPageSize < total,
            },
            period,
            availableLanguages: availableLanguageRows.results.map(
              (row) => row.language,
            ),
          },
          {
            headers: {
              "cache-control": "private, no-store",
              vary: "cookie",
            },
          },
        );
      }
      const resultPageSize = pageSize;
      const chapterPresentationPredicate = "";
      const chapterPresentationOrder = `CAST(chapterNumber AS REAL) DESC,
             datetime(publishedAt) DESC,
             datetime(createdAt) DESC,
             id DESC`;
      const chapterPresentationLimit = 4;
      const [seriesRows, totalRow, availableLanguageRows] = await Promise.all([
        env.DB.prepare(
          `SELECT s.id,
                  s.slug,
                  s.title,
                  s.type,
                  s.status,
                  s.cover_key AS coverKey,
                  s.rating_tenths AS ratingTenths,
                  c.published_at AS latestPublishedAt
             FROM series s
             JOIN chapters c
               ON c.id = (
                 SELECT newest.id
                   FROM chapters newest
                   LEFT JOIN content_visibility_overrides newest_visibility
                     ON newest_visibility.chapter_id = newest.id
                  WHERE newest.series_id = s.id
                    AND newest.state = 'PUBLISHED'
                    AND newest.visibility = 'PUBLIC'
                    AND datetime(newest.published_at) <= datetime('now')
                    ${newestPaidPredicate}
                    ${newestLanguagePredicate}
                    ${seriesPeriodPredicate}
                  ORDER BY datetime(newest.published_at) DESC,
                           datetime(newest.created_at) DESC,
                           newest.id DESC
                  LIMIT 1
               )
            WHERE ${publicSeriesPredicate("s")}
            ORDER BY datetime(c.published_at) DESC,
                     datetime(c.created_at) DESC,
                     c.id DESC,
                     s.id ASC
            LIMIT ? OFFSET ?`,
        )
          .bind(
            ...languages,
            resultPageSize,
            (page - 1) * resultPageSize,
          )
          .all<{
            id: string;
            slug: string;
            title: string;
            type: string;
            status: string;
            coverKey: string | null;
            ratingTenths: number;
            latestPublishedAt: string;
          }>(),
        env.DB.prepare(
          `SELECT COUNT(DISTINCT s.id) AS count
             FROM series s
             JOIN chapters c ON c.series_id = s.id
             LEFT JOIN content_visibility_overrides visibility_override
               ON visibility_override.chapter_id = c.id
            WHERE ${publicSeriesPredicate("s")}
              AND c.state = 'PUBLISHED'
              AND c.visibility = 'PUBLIC'
              AND datetime(c.published_at) <= datetime('now')
              ${chapterPaidPredicate}
              ${chapterLanguagePredicate}
              ${countPeriodPredicate}`,
        ).bind(...languages).first<{ count: number }>(),
        env.DB.prepare(
          `SELECT DISTINCT LOWER(c.language) AS language
             FROM chapters c
             JOIN series s ON s.id = c.series_id
             LEFT JOIN content_visibility_overrides visibility_override
               ON visibility_override.chapter_id = c.id
            WHERE ${publicSeriesPredicate("s")}
              AND c.state = 'PUBLISHED'
              AND c.visibility = 'PUBLIC'
              AND datetime(c.published_at) <= datetime('now')
              ${chapterPaidPredicate}
              ${countPeriodPredicate}
            ORDER BY language ASC`,
        ).all<{ language: string }>(),
      ]);
      const chapterResults = seriesRows.results.length
        ? await env.DB.batch(
            seriesRows.results.map((seriesRecord) =>
              env.DB!.prepare(
                `WITH ranked AS (
                   SELECT c.slug,
                          c.chapter_number AS chapterNumber,
                          c.title,
                          c.language,
                          c.version,
                          CASE
                            WHEN (${effectiveChapterAccessSql("c", "visibility_override")}) = 'FREE'
                            THEN 'FREE' ELSE 'PAID'
                          END AS accessType,
                          ${effectiveChapterAccessSql("c", "visibility_override")} AS effectiveAccessType,
                          CASE
                            WHEN (${effectiveChapterAccessSql("c", "visibility_override")})
                                 IN ('FREE', 'PREMIUM')
                            THEN 0 ELSE c.price_onyx
                          END AS priceOnyx,
                          c.published_at AS publishedAt,
                          CASE WHEN EXISTS (
                            SELECT 1
                              FROM reading_progress rp
                              JOIN chapters read_chapter
                                ON read_chapter.id = rp.chapter_id
                             WHERE rp.user_id = ?
                               AND read_chapter.series_id = c.series_id
                               AND CAST(read_chapter.chapter_number AS REAL) =
                                   CAST(c.chapter_number AS REAL)
                               AND (
                                 rp.completed_at IS NOT NULL
                                 OR rp.progress_basis_points >= 9200
                               )
                          ) THEN 1 ELSE 0 END AS isRead,
                          datetime(c.published_at) >
                            datetime('now', '-24 hours') AS isFresh,
                          CASE WHEN ${newInPeriodExpression}
                               THEN 1 ELSE 0 END AS isNewInPeriod,
                          c.created_at AS createdAt,
                          c.id,
                          t.name AS teamName,
                          t.slug AS teamSlug,
                          ROW_NUMBER() OVER (
                            PARTITION BY LTRIM(c.chapter_number, '0')
                            ORDER BY datetime(c.published_at) DESC,
                                     datetime(c.created_at) DESC,
                                     c.id DESC
                          ) AS releaseRank
                     FROM chapters c
                     LEFT JOIN teams t ON t.id = c.team_id
                     LEFT JOIN content_visibility_overrides visibility_override
                       ON visibility_override.chapter_id = c.id
                    WHERE c.series_id = ?
                      AND c.state = 'PUBLISHED'
                      AND c.visibility = 'PUBLIC'
                      AND datetime(c.published_at) <= datetime('now')
                      ${chapterPaidPredicate}
                      ${chapterLanguagePredicate}
                      ${chapterPresentationPredicate}
                 )
                 SELECT slug,
                        chapterNumber,
                        title,
                        language,
                        version,
                        accessType,
                        effectiveAccessType,
                        priceOnyx,
                        publishedAt,
                        isRead,
                        isFresh,
                        isNewInPeriod,
                        teamName,
                        teamSlug
                  FROM ranked
                  WHERE releaseRank = 1
                  ORDER BY ${chapterPresentationOrder}
                  LIMIT ${chapterPresentationLimit}`,
              ).bind(viewer?.id ?? "", seriesRecord.id, ...languages),
            ),
          )
        : [];
      const total = Number(totalRow?.count ?? 0);
      return json(
        id,
        {
          data: seriesRows.results.map((seriesRecord, index) => {
            const coverKey = seriesRecord.coverKey?.trim() ?? "";
            return {
              ...seriesRecord,
              cover:
                coverKey &&
                (coverKey.startsWith("/") || /^https?:\/\//.test(coverKey))
                  ? coverKey
                  : coverKey
                    ? `/api/v1/series-cover?slug=${encodeURIComponent(seriesRecord.slug)}`
                    : null,
              chapters: (chapterResults[index]?.results ?? []).map(
                (chapterValue) => {
                  const chapter = chapterValue as Record<string, unknown>;
                  return {
                  ...chapter,
                  chapterNumber: normalizeChapterNumber(
                    String(chapter.chapterNumber),
                  ),
                  isFresh: Boolean(chapter.isFresh),
                  isNewInPeriod: Boolean(chapter.isNewInPeriod),
                  isRead: Boolean(chapter.isRead),
                  };
                },
              ),
            };
          }),
          pagination: {
            page,
            pageSize: resultPageSize,
            total,
            pageCount: Math.max(1, Math.ceil(total / resultPageSize)),
            hasPrevious: page > 1,
            hasNext: page * resultPageSize < total,
          },
          period,
          availableLanguages: availableLanguageRows.results.map((row) => row.language),
        },
        {
          headers: {
            "cache-control": "private, no-store",
            vary: "cookie",
          },
        },
      );
    }

    if (path === "search") {
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Search is temporarily unavailable.",
        );
      }
      const query = z
        .string()
        .trim()
        .max(160)
        .catch("")
        .parse(url.searchParams.get("q") ?? "");
      const type = z
        .enum(["MANGA", "MANHWA", "MANHUA"])
        .optional()
        .catch(undefined)
        .parse(url.searchParams.get("type")?.toUpperCase());
      const access = z
        .enum(["FREE", "PAID"])
        .optional()
        .catch(undefined)
        .parse(url.searchParams.get("access")?.toUpperCase());
      const clauses = [publicSeriesPredicate("s")];
      const bindings: string[] = [];
      if (query) {
        const pattern = `%${query
          .toLowerCase()
          .replaceAll("\\", "\\\\")
          .replaceAll("%", "\\%")
          .replaceAll("_", "\\_")}%`;
        clauses.push(
          `(LOWER(s.title) LIKE ? ESCAPE '\\'
            OR LOWER(COALESCE(s.native_title, '')) LIKE ? ESCAPE '\\'
            OR EXISTS (
             SELECT 1
               FROM series_aliases sa
              WHERE sa.series_id = s.id
                AND LOWER(sa.alias) LIKE ? ESCAPE '\\'
           ))`,
        );
        bindings.push(pattern, pattern, pattern);
      }
      if (type) {
        clauses.push("s.type = ?");
        bindings.push(type);
      }
      if (access) {
        clauses.push("s.access_type = ?");
        bindings.push(access);
      }
      const select = `SELECT s.id,
                s.slug,
                s.title,
                s.native_title AS nativeTitle,
                s.type,
                s.status,
                s.access_type AS accessType,
                s.cover_key AS coverKey,
                s.rating_tenths AS ratingTenths,
                s.follower_count AS followerCount,
                s.view_count AS viewCount,
                s.updated_at AS updatedAt,
                COALESCE((
                  SELECT GROUP_CONCAT(sa.alias, '||')
                    FROM series_aliases sa
                   WHERE sa.series_id = s.id
                ), '') AS aliases,
                (
                  SELECT c.chapter_number
                    FROM chapters c
                    LEFT JOIN content_visibility_overrides visibility_override
                      ON visibility_override.chapter_id = c.id
                   WHERE c.series_id = s.id
                     AND c.state = 'PUBLISHED'
                     AND c.visibility = 'PUBLIC'
                     AND datetime(c.published_at) <= datetime('now')
                     AND ${publicPaidChapterPredicate("c", "visibility_override")}
                   ORDER BY datetime(c.published_at) DESC,
                            datetime(c.created_at) DESC,
                            c.id DESC
                   LIMIT 1
                ) AS latestChapterNumber,
                (
                  SELECT c.title
                    FROM chapters c
                    LEFT JOIN content_visibility_overrides visibility_override
                      ON visibility_override.chapter_id = c.id
                   WHERE c.series_id = s.id
                     AND c.state = 'PUBLISHED'
                     AND c.visibility = 'PUBLIC'
                     AND datetime(c.published_at) <= datetime('now')
                     AND ${publicPaidChapterPredicate("c", "visibility_override")}
                   ORDER BY datetime(c.published_at) DESC,
                            datetime(c.created_at) DESC,
                            c.id DESC
                   LIMIT 1
                ) AS latestChapterTitle,
                (
                  SELECT c.slug
                    FROM chapters c
                    LEFT JOIN content_visibility_overrides visibility_override
                      ON visibility_override.chapter_id = c.id
                   WHERE c.series_id = s.id
                     AND c.state = 'PUBLISHED'
                     AND c.visibility = 'PUBLIC'
                     AND datetime(c.published_at) <= datetime('now')
                     AND ${publicPaidChapterPredicate("c", "visibility_override")}
                   ORDER BY datetime(c.published_at) DESC,
                            datetime(c.created_at) DESC,
                            c.id DESC
                   LIMIT 1
                ) AS latestChapterSlug
           FROM series s`;
      type SearchRow = {
        id: string;
        slug: string;
        title: string;
        nativeTitle: string | null;
        type: string;
        status: string;
        accessType: string;
        coverKey: string | null;
        ratingTenths: number;
        followerCount: number;
        viewCount: number;
        updatedAt: string;
        aliases: string;
        latestChapterNumber: string | null;
        latestChapterTitle: string | null;
        latestChapterSlug: string | null;
      };
      const result = await env.DB.prepare(
        `${select}
          WHERE ${clauses.join(" AND ")}
          ORDER BY
            CASE
              WHEN ? <> '' AND LOWER(s.title) = LOWER(?) THEN 0
              WHEN ? <> '' AND LOWER(s.title) LIKE LOWER(?) || '%' THEN 1
              ELSE 2
            END,
            s.rating_tenths DESC,
            s.follower_count DESC,
            s.updated_at DESC
          LIMIT 12`,
      )
        .bind(...bindings, query, query, query, query)
        .all<SearchRow>();
      const normalizeSearchRow = (row: SearchRow) => {
        const aliases = row.aliases ? row.aliases.split("||").filter(Boolean) : [];
        return {
          ...row,
          aliases,
          alternativeTitle: row.nativeTitle || aliases[0] || null,
          cover: publicSeriesCover(row.slug, row.coverKey),
          latestChapter: row.latestChapterNumber
            ? {
                number: row.latestChapterNumber,
                title: row.latestChapterTitle ?? "",
                slug: row.latestChapterSlug,
              }
            : null,
        };
      };
      const data = result.results.map(normalizeSearchRow);

      let trending = data;
      let popular = data;
      if (!query && !type && !access) {
        const [trendingRows, popularRows] = await Promise.all([
          env.DB.prepare(
            `${select}
              WHERE ${publicSeriesPredicate("s")}
              ORDER BY COALESCE((
                SELECT MAX(datetime(c.published_at))
                  FROM chapters c
                  LEFT JOIN content_visibility_overrides visibility_override
                    ON visibility_override.chapter_id = c.id
                 WHERE c.series_id = s.id
                   AND c.state = 'PUBLISHED'
                   AND c.visibility = 'PUBLIC'
                   AND datetime(c.published_at) <= datetime('now')
                   AND ${publicPaidChapterPredicate("c", "visibility_override")}
              ), datetime(s.updated_at)) DESC,
              s.rating_tenths DESC
              LIMIT 6`,
          ).all<SearchRow>(),
          env.DB.prepare(
            `${select}
              WHERE ${publicSeriesPredicate("s")}
              ORDER BY s.follower_count DESC,
                       s.view_count DESC,
                       s.rating_tenths DESC,
                       s.title COLLATE NOCASE
              LIMIT 6`,
          ).all<SearchRow>(),
        ]);
        trending = trendingRows.results.map(normalizeSearchRow);
        popular = popularRows.results.map(normalizeSearchRow);
      }
      return json(
        id,
        { data, trending, popular, query },
        { headers: { "cache-control": "no-store" } },
      );
    }

    if (path === "reviews") {
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Review storage is unavailable.",
        );
      }
      const seriesSlug = slugSchema.parse(
        url.searchParams.get("series") ?? "",
      );
      const sort = z
        .enum(["newest", "oldest", "highest"])
        .catch("newest")
        .parse(url.searchParams.get("sort"));
      const seriesRecord = await env.DB.prepare(
        `SELECT s.id FROM series s
         WHERE s.slug = ? AND ${publicSeriesPredicate("s")} LIMIT 1`,
      )
        .bind(seriesSlug)
        .first<{ id: string }>();
      if (!seriesRecord) {
        return json(id, {
          data: [],
          aggregate: {
            average: 0,
            total: 0,
            distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
          },
          viewerReview: null,
        });
      }

      const actor = await getActor().catch(() => null);
      const orderBy =
        sort === "oldest"
          ? "r.created_at ASC"
          : sort === "highest"
            ? "r.rating DESC, r.created_at DESC"
            : "r.created_at DESC";
      const [reviewRows, distributionRows] = await Promise.all([
        env.DB.prepare(
          `SELECT r.id,
                  r.rating,
                  r.body,
                  r.spoiler,
                  r.moderation_status AS moderationStatus,
                  r.created_at AS createdAt,
                  r.updated_at AS updatedAt,
                  u.display_name AS displayName,
                  u.primary_role AS role,
                  CASE WHEN ? <> '' AND r.user_id = ? THEN 1 ELSE 0 END AS ownedByViewer
             FROM reviews r
             JOIN users u ON u.id = r.user_id
            WHERE r.series_id = ?
              AND r.moderation_status = 'VISIBLE'
            ORDER BY ${orderBy}
            LIMIT 100`,
        )
          .bind(actor?.id ?? "", actor?.id ?? "", seriesRecord.id)
          .all<{
            id: string;
            rating: number;
            body: string;
            spoiler: number;
            moderationStatus: string;
            createdAt: string;
            updatedAt: string;
            displayName: string;
            role: string;
            ownedByViewer: number;
          }>(),
        env.DB.prepare(
          `SELECT rating, COUNT(*) AS count
             FROM reviews
            WHERE series_id = ?
              AND moderation_status = 'VISIBLE'
            GROUP BY rating`,
        )
          .bind(seriesRecord.id)
          .all<{ rating: number; count: number }>(),
      ]);
      const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      for (const row of distributionRows.results) {
        if (row.rating >= 1 && row.rating <= 5) {
          distribution[row.rating as keyof typeof distribution] =
            Number(row.count);
        }
      }
      const total = Object.values(distribution).reduce(
        (sum, value) => sum + value,
        0,
      );
      const weighted = Object.entries(distribution).reduce(
        (sum, [rating, count]) => sum + Number(rating) * count,
        0,
      );
      const data = reviewRows.results.map((review) => ({
        ...review,
        spoiler: Boolean(review.spoiler),
        ownedByViewer: Boolean(review.ownedByViewer),
      }));
      return json(id, {
        data,
        aggregate: {
          average: total ? Math.round((weighted / total) * 10) / 10 : 0,
          total,
          distribution,
        },
        viewerReview: data.find((review) => review.ownedByViewer) ?? null,
      });
    }

    if (path === "editor-picks") {
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Editor's Picks are temporarily unavailable.",
        );
      }
      const rows = await env.DB.prepare(
        `SELECT ep.id,
                ep.category_label AS categoryLabel,
                ep.short_description AS shortDescription,
                ep.sort_order AS sortOrder,
                s.id AS seriesId,
                s.slug,
                s.title,
                s.native_title AS nativeTitle,
                s.type,
                s.status,
                s.synopsis,
                s.cover_key AS coverKey,
                s.banner_key AS bannerKey,
                s.slider_key AS sliderKey,
                s.revision,
                s.rating_tenths AS ratingTenths,
                COALESCE((
                  SELECT COUNT(DISTINCT chapter_count.chapter_number)
                    FROM chapters chapter_count
                    LEFT JOIN content_visibility_overrides chapter_visibility
                      ON chapter_visibility.chapter_id = chapter_count.id
                   WHERE chapter_count.series_id = s.id
                     AND chapter_count.state = 'PUBLISHED'
                     AND chapter_count.visibility = 'PUBLIC'
                     AND chapter_count.published_at IS NOT NULL
                     AND datetime(chapter_count.published_at) <= datetime('now')
                     AND ${publicPaidChapterPredicate("chapter_count", "chapter_visibility")}
                ), 0) AS chapterCount,
                COALESCE((
                  SELECT COUNT(*)
                    FROM follows follower_count
                   WHERE follower_count.series_id = s.id
                ), 0) AS followerCount,
                COALESCE((
                  SELECT COUNT(*)
                    FROM discussion_comments comment_count
                   WHERE comment_count.series_slug = s.slug
                     AND comment_count.moderation_status = 'VISIBLE'
                     AND comment_count.deleted_at IS NULL
                ), 0) AS commentCount,
                (
                  SELECT c.slug
                    FROM chapters c
                    LEFT JOIN content_visibility_overrides visibility_override
                      ON visibility_override.chapter_id = c.id
                   WHERE c.series_id = s.id
                     AND c.state = 'PUBLISHED'
                     AND c.visibility = 'PUBLIC'
                     AND c.published_at IS NOT NULL
                     AND datetime(c.published_at) <= datetime('now')
                     AND ${publicPaidChapterPredicate("c", "visibility_override")}
                   ORDER BY datetime(c.published_at) DESC,
                            datetime(c.created_at) DESC,
                            c.id DESC
                   LIMIT 1
                ) AS latestChapterSlug,
                COALESCE((
                  SELECT GROUP_CONCAT(g.name, '||')
                    FROM series_genres sg
                    JOIN genres g ON g.id = sg.genre_id
                   WHERE sg.series_id = s.id
                ), '') AS genres,
                COALESCE((
                  SELECT GROUP_CONCAT(sa.alias, '||')
                    FROM series_aliases sa
                   WHERE sa.series_id = s.id
                ), '') AS alternativeTitles
           FROM editor_picks ep
           JOIN series s ON s.id = ep.series_id
          WHERE ep.is_published = 1
            AND ${publicSeriesPredicate("s")}
          ORDER BY ep.sort_order ASC, ep.created_at ASC
          LIMIT 12`,
      ).all<{
        id: string;
        categoryLabel: string;
        shortDescription: string;
        sortOrder: number;
        seriesId: string;
        slug: string;
        title: string;
        nativeTitle: string | null;
        type: string;
        status: string;
        synopsis: string;
        coverKey: string | null;
        bannerKey: string | null;
        sliderKey: string | null;
        revision: number;
        ratingTenths: number;
        chapterCount: number;
        followerCount: number;
        commentCount: number;
        latestChapterSlug: string | null;
        genres: string;
        alternativeTitles: string;
      }>();
      return json(
        id,
        {
          data: rows.results.map((row) => ({
            ...row,
            chapterCount: Number(row.chapterCount ?? 0),
            followerCount: Number(row.followerCount ?? 0),
            commentCount: Number(row.commentCount ?? 0),
            genres: row.genres ? row.genres.split("||").filter(Boolean) : [],
            alternativeTitles: row.alternativeTitles
              ? row.alternativeTitles.split("||").filter(Boolean)
              : [],
            cover: publicSeriesCover(row.slug, row.coverKey),
            banner: publicSeriesBanner(
              row.seriesId,
              row.bannerKey,
              Number(row.revision),
            ),
            slider: publicSeriesSlider(
              row.seriesId,
              row.sliderKey,
              Number(row.revision),
            ),
          })),
        },
        { headers: { "cache-control": "no-store" } },
      );
    }

    if (path === "store-preview") {
      if (!env.DB || !env.BUCKET) {
        throw new ApiError(
          503,
          "MEDIA_UNAVAILABLE",
          "Store previews are temporarily unavailable.",
        );
      }
      const itemId = z
        .string()
        .trim()
        .min(3)
        .max(120)
        .parse(url.searchParams.get("id"));
      const item = await env.DB.prepare(
        `SELECT si.preview_key AS previewKey,
                si.updated_at AS updatedAt
           FROM store_items si
           JOIN store_collections sc ON sc.id = si.collection_id
          WHERE si.id = ?
            AND si.is_published = 1
            AND si.is_hidden = 0
            AND sc.enabled = 1
          LIMIT 1`,
      )
        .bind(itemId)
        .first<{ previewKey: string | null; updatedAt: string }>();
      if (!item?.previewKey) {
        throw new ApiError(
          404,
          "STORE_PREVIEW_NOT_FOUND",
          "This preview image is not available.",
        );
      }
      const object = await env.BUCKET.get(item.previewKey);
      if (!object) {
        throw new ApiError(
          404,
          "STORE_PREVIEW_NOT_FOUND",
          "This preview image is not available.",
        );
      }
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("content-disposition", "inline");
      headers.set(
        "cache-control",
        "public, max-age=3600, stale-while-revalidate=86400",
      );
      headers.set("etag", object.httpEtag);
      if (request.headers.get("if-none-match") === object.httpEtag) {
        return new Response(null, { status: 304, headers });
      }
      return new Response(object.body, { headers });
    }

    if (path === "store/products") {
      return storeProductsResponse(request);
    }

    if (path === "store/inventory") {
      const actor = await requireActor();
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Store inventory is temporarily unavailable.",
        );
      }
      const [items, loadout] = await Promise.all([
        env.DB.prepare(
          `SELECT usi.item_id AS itemId,
                  usi.created_at AS purchasedAt,
                  si.name,
                  si.category
             FROM user_store_items usi
             JOIN store_items si ON si.id = usi.item_id
            WHERE usi.user_id = ?
            ORDER BY usi.created_at DESC`,
        )
          .bind(actor.id)
          .all(),
        env.DB.prepare(
          `SELECT category, item_id AS itemId, updated_at AS updatedAt
             FROM user_cosmetic_loadouts
            WHERE user_id = ?
            ORDER BY category`,
        )
          .bind(actor.id)
          .all(),
      ]);
      return json(
        id,
        { data: items.results, loadout: loadout.results },
        { headers: { "cache-control": "private, no-store", vary: "cookie" } },
      );
    }

    if (path === "discussion-comments") {
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Discussion storage is unavailable.",
        );
      }
      const seriesSlug = (url.searchParams.get("series") ?? "").trim();
      const chapterSlug = (url.searchParams.get("chapter") ?? "").trim() || null;
      const sort = z
        .enum(["top", "newest", "oldest"])
        .catch("top")
        .parse(url.searchParams.get("sort"));
      await validateSeriesSlug(seriesSlug);

      let viewerId = "";
      let viewerActor: Awaited<ReturnType<typeof getActor>> = null;
      try {
        viewerActor = await getActor();
        viewerId = viewerActor?.id ?? "";
      } catch {
        viewerId = "";
      }
      if (chapterSlug) {
        const access = await resolveChapterAccess(
          viewerActor,
          seriesSlug,
          chapterSlug,
        );
        if (!access.canRead) {
          throw new ApiError(
            access.reason === "UNAVAILABLE" ? 404 : 403,
            access.reason === "UNAVAILABLE"
              ? "CHAPTER_NOT_FOUND"
              : "CHAPTER_ACCESS_REQUIRED",
            access.reason === "UNAVAILABLE"
              ? "This chapter discussion is not available."
              : "Unlock this chapter before opening its discussion.",
          );
        }
      }

      type CommentRow = {
        id: string;
        chapterSlug: string | null;
        chapterNumber: string | null;
        parentId: string | null;
        depth: number;
        body: string;
        spoiler: number;
        moderationStatus: string;
        pinnedAt: string | null;
        editedAt: string | null;
        deletionReason: string | null;
        createdAt: string;
        updatedAt: string;
        displayName: string;
        role: string;
        avatarKey: string | null;
        avatarUsername: string | null;
        avatarRevision: number | null;
        cosmeticItemId: string | null;
        cosmeticName: string | null;
        cosmeticCategory: string | null;
        cosmeticPreviewKey: string | null;
        cosmeticRevision: number | null;
        cosmeticConfigJson: string | null;
        affiliationTeamId: string | null;
        affiliationTeamName: string | null;
        affiliationBadgeKey: string | null;
        affiliationTeamRevision: number | null;
        commentEffectType: string | null;
        commentEffectEnabled: number | null;
        commentEffectConfigJson: string | null;
        voteScore: number;
        viewerVote: number;
        ownedByViewer: number;
      };
      type ReactionRow = {
        commentId: string;
        reaction: string;
        label: string | null;
        emojiFallback: string | null;
        reactionId: string | null;
        reactionRevision: number | null;
        assetKey: string | null;
        count: number;
        reactedByViewer: number;
      };
      type MediaRow = {
        id: string;
        commentId: string;
        filename: string;
        contentType: string;
        byteSize: number;
        kind: string;
        altText: string;
      };
      type CommentGifRow = {
        commentId: string;
        gifId: string;
        name: string;
        accessibleLabel: string;
        revision: number;
      };

      const commentsResult = await env.DB.prepare(
        `SELECT dc.id,
                dc.chapter_slug AS chapterSlug,
                (
                  SELECT chapter_source.chapter_number
                    FROM chapters chapter_source
                    JOIN series chapter_series
                      ON chapter_series.id = chapter_source.series_id
                   WHERE chapter_series.slug = dc.series_slug
                     AND chapter_source.slug = dc.chapter_slug
                     AND chapter_source.state = 'PUBLISHED'
                     AND chapter_source.visibility = 'PUBLIC'
                     AND chapter_source.published_at IS NOT NULL
                     AND datetime(chapter_source.published_at) <= datetime('now')
                   LIMIT 1
                ) AS chapterNumber,
                dc.parent_id AS parentId,
                dc.depth,
                dc.body,
                dc.spoiler,
                dc.moderation_status AS moderationStatus,
                dc.pinned_at AS pinnedAt,
                dc.edited_at AS editedAt,
                dc.deletion_reason AS deletionReason,
                dc.created_at AS createdAt,
                dc.updated_at AS updatedAt,
                u.display_name AS displayName,
                u.primary_role AS role,
                CASE
                  WHEN up.avatar_key IS NOT NULL
                   AND (up.profile_visibility = 'PUBLIC' OR dc.user_id = ?)
                  THEN up.avatar_key ELSE NULL
                END AS avatarKey,
                CASE
                  WHEN up.avatar_key IS NOT NULL
                   AND (up.profile_visibility = 'PUBLIC' OR dc.user_id = ?)
                  THEN up.username ELSE NULL
                END AS avatarUsername,
                CASE
                  WHEN up.avatar_key IS NOT NULL
                   AND (up.profile_visibility = 'PUBLIC' OR dc.user_id = ?)
                  THEN up.revision ELSE NULL
                END AS avatarRevision,
                si.id AS cosmeticItemId,
                si.name AS cosmeticName,
                si.category AS cosmeticCategory,
                si.preview_key AS cosmeticPreviewKey,
                si.revision AS cosmeticRevision,
                si.preview_config_json AS cosmeticConfigJson,
                CASE WHEN tm.user_id IS NOT NULL THEN t.id ELSE NULL END
                  AS affiliationTeamId,
                CASE WHEN tm.user_id IS NOT NULL THEN t.name ELSE NULL END
                  AS affiliationTeamName,
                CASE WHEN tm.user_id IS NOT NULL THEN t.staff_badge_key
                  ELSE NULL END AS affiliationBadgeKey,
                CASE WHEN tm.user_id IS NOT NULL THEN t.revision ELSE NULL END
                  AS affiliationTeamRevision,
                CASE WHEN tm.user_id IS NOT NULL
                  THEN t.comment_effect_type ELSE NULL END
                  AS commentEffectType,
                CASE WHEN tm.user_id IS NOT NULL
                  THEN t.comment_effect_enabled ELSE NULL END
                  AS commentEffectEnabled,
                CASE WHEN tm.user_id IS NOT NULL
                  THEN t.comment_effect_config_json ELSE NULL END
                  AS commentEffectConfigJson,
                COALESCE((
                  SELECT SUM(dv.value)
                    FROM discussion_votes dv
                   WHERE dv.comment_id = dc.id
                ), 0) AS voteScore,
                COALESCE((
                  SELECT COUNT(*)
                    FROM discussion_votes dv
                   WHERE dv.comment_id = dc.id
                     AND dv.value > 0
                ), 0) AS upvoteCount,
                COALESCE((
                  SELECT COUNT(*)
                    FROM discussion_votes dv
                   WHERE dv.comment_id = dc.id
                     AND dv.value < 0
                ), 0) AS downvoteCount,
                COALESCE((
                  SELECT own_vote.value
                    FROM discussion_votes own_vote
                   WHERE own_vote.comment_id = dc.id
                     AND own_vote.user_id = ?
                   LIMIT 1
                ), 0) AS viewerVote,
                CASE WHEN ? <> '' AND dc.user_id = ?
                  THEN 1 ELSE 0 END AS ownedByViewer
         FROM discussion_comments dc
         JOIN users u ON u.id = dc.user_id
         LEFT JOIN user_profiles up ON up.user_id = dc.user_id
         LEFT JOIN store_items si
           ON si.id = dc.cosmetic_item_id
         LEFT JOIN teams t
           ON t.id = dc.affiliation_team_id
          AND t.is_archived = 0
          AND t.verification_status <> 'SUSPENDED'
         LEFT JOIN team_memberships tm
           ON tm.team_id = t.id
          AND tm.user_id = dc.user_id
          AND tm.status = 'ACTIVE'
         WHERE dc.series_slug = ?
           AND (? IS NULL OR dc.chapter_slug = ?)
           AND (
             dc.chapter_slug IS NULL
             OR EXISTS (
               SELECT 1
                 FROM chapters public_chapter
                 JOIN series public_series
                   ON public_series.id = public_chapter.series_id
                WHERE public_series.slug = dc.series_slug
                  AND public_chapter.slug = dc.chapter_slug
                  AND public_chapter.state = 'PUBLISHED'
                  AND public_chapter.visibility = 'PUBLIC'
                  AND public_chapter.published_at IS NOT NULL
                  AND datetime(public_chapter.published_at) <= datetime('now')
             )
           )
           AND dc.moderation_status IN ('VISIBLE', 'DELETED')
         ORDER BY dc.created_at ASC
         LIMIT 250`,
      )
        .bind(
          viewerId,
          viewerId,
          viewerId,
          viewerId,
          viewerId,
          viewerId,
          seriesSlug,
          chapterSlug,
          chapterSlug,
        )
        .all<CommentRow>();

      const reactionsResult = await env.DB.prepare(
        `SELECT dr.comment_id AS commentId,
                dr.reaction,
                cr.accessible_label AS label,
                cr.emoji_fallback AS emojiFallback,
                cr.id AS reactionId,
                cr.revision AS reactionRevision,
                cr.asset_key AS assetKey,
                COUNT(*) AS count,
                MAX(CASE WHEN dr.user_id = ? THEN 1 ELSE 0 END) AS reactedByViewer
         FROM discussion_reactions dr
         JOIN discussion_comments dc ON dc.id = dr.comment_id
         LEFT JOIN custom_reactions cr ON cr.slug = dr.reaction
         WHERE dc.series_slug = ?
           AND (? IS NULL OR dc.chapter_slug = ?)
           AND dc.moderation_status = 'VISIBLE'
         GROUP BY dr.comment_id, dr.reaction`,
      )
        .bind(viewerId, seriesSlug, chapterSlug, chapterSlug)
        .all<ReactionRow>();

      const mediaResult = await env.DB.prepare(
        `SELECT dm.id,
                dm.comment_id AS commentId,
                dm.filename,
                dm.content_type AS contentType,
                dm.byte_size AS byteSize,
                dm.kind,
                dm.alt_text AS altText
         FROM discussion_media dm
         JOIN discussion_comments dc ON dc.id = dm.comment_id
         WHERE dc.series_slug = ?
           AND (? IS NULL OR dc.chapter_slug = ?)
           AND dc.moderation_status = 'VISIBLE'
           AND dm.moderation_status = 'READY'
         ORDER BY dm.created_at ASC`,
      )
        .bind(seriesSlug, chapterSlug, chapterSlug)
        .all<MediaRow>();
      const commentGifsResult = await env.DB.prepare(
        `SELECT dcg.comment_id AS commentId,
                cr.id AS gifId,
                cr.name,
                cr.accessible_label AS accessibleLabel,
                cr.revision
           FROM discussion_comment_gifs dcg
           JOIN discussion_comments dc ON dc.id = dcg.comment_id
           JOIN custom_reactions cr ON cr.id = dcg.gif_id
          WHERE dc.series_slug = ?
            AND (? IS NULL OR dc.chapter_slug = ?)
            AND dc.moderation_status = 'VISIBLE'
          ORDER BY dcg.display_order, dcg.created_at`,
      )
        .bind(seriesSlug, chapterSlug, chapterSlug)
        .all<CommentGifRow>();

      const reactionsByComment = new Map<string, ReactionRow[]>();
      for (const reaction of reactionsResult.results) {
        reactionsByComment.set(reaction.commentId, [
          ...(reactionsByComment.get(reaction.commentId) ?? []),
          reaction,
        ]);
      }
      const mediaByComment = new Map<string, MediaRow[]>();
      for (const media of mediaResult.results) {
        mediaByComment.set(media.commentId, [
          ...(mediaByComment.get(media.commentId) ?? []),
          media,
        ]);
      }
      const gifsByComment = new Map<string, CommentGifRow[]>();
      for (const gif of commentGifsResult.results) {
        gifsByComment.set(gif.commentId, [
          ...(gifsByComment.get(gif.commentId) ?? []),
          gif,
        ]);
      }
      const data = commentsResult.results.map((comment) => ({
        ...comment,
        chapterNumber: comment.chapterNumber
          ? normalizeChapterNumber(comment.chapterNumber)
          : null,
        avatarKey: undefined,
        cosmeticPreviewKey: undefined,
        cosmeticConfigJson: undefined,
        avatarUrl:
          comment.avatarKey && comment.avatarUsername
            ? `/api/v1/profile-media?username=${encodeURIComponent(comment.avatarUsername)}&slot=avatar&v=${comment.avatarRevision ?? 1}`
            : null,
        commentCosmetic: comment.cosmeticItemId
          ? {
              id: comment.cosmeticItemId,
              name: comment.cosmeticName,
              category: comment.cosmeticCategory,
              previewUrl: comment.cosmeticPreviewKey
                ? `/api/v1/store-preview?id=${encodeURIComponent(comment.cosmeticItemId)}&v=${comment.cosmeticRevision ?? 1}`
                : null,
              config: safeJsonRecord(comment.cosmeticConfigJson ?? "{}"),
            }
          : null,
        voteScore: Number(comment.voteScore ?? 0),
        viewerVote: Number(comment.viewerVote ?? 0),
        reactions: (reactionsByComment.get(comment.id) ?? []).map(
          (reaction) => ({
            key: reaction.reaction,
            label: reaction.label ?? reaction.reaction,
            emoji: reaction.emojiFallback ?? "",
            assetUrl:
              reaction.assetKey && reaction.reactionId
                ? `/api/v1/reaction-asset?id=${encodeURIComponent(reaction.reactionId)}&v=${reaction.reactionRevision ?? 1}`
                : null,
            count: Number(reaction.count),
            reactedByViewer: Boolean(reaction.reactedByViewer),
          }),
        ),
        media: (mediaByComment.get(comment.id) ?? []).map((media) => ({
          ...media,
          url: `/api/v1/discussion-media?id=${encodeURIComponent(media.id)}`,
        })),
        gifs: (gifsByComment.get(comment.id) ?? []).map((gif) => ({
          id: gif.gifId,
          name: gif.name,
          altText: gif.accessibleLabel,
          url: `/api/v1/reaction-asset?id=${encodeURIComponent(gif.gifId)}&v=${gif.revision}`,
        })),
        teamAffiliation: comment.affiliationTeamId
          ? {
              id: comment.affiliationTeamId,
              name: comment.affiliationTeamName,
              badgeUrl: comment.affiliationBadgeKey
                ? `/api/v1/team-media?id=${encodeURIComponent(comment.affiliationTeamId)}&slot=badge&v=${comment.affiliationTeamRevision ?? 1}`
                : null,
              effect:
                comment.commentEffectEnabled &&
                comment.commentEffectType &&
                comment.commentEffectType !== "NONE"
                  ? {
                      type: comment.commentEffectType,
                      config: safeJsonRecord(
                        comment.commentEffectConfigJson ?? "{}",
                      ),
                    }
                  : null,
            }
          : null,
      }));
      const childrenByParent = new Map<string, typeof data>();
      const roots: typeof data = [];
      for (const comment of data) {
        if (!comment.parentId) {
          roots.push(comment);
          continue;
        }
        childrenByParent.set(comment.parentId, [
          ...(childrenByParent.get(comment.parentId) ?? []),
          comment,
        ]);
      }
      const byCreatedAt = (left: (typeof data)[number], right: (typeof data)[number]) =>
        new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      roots.sort((left, right) => {
        if (sort === "top") {
          const scoreDifference =
            Number(right.voteScore) - Number(left.voteScore);
          if (scoreDifference !== 0) return scoreDifference;
        }
        const createdDifference = byCreatedAt(left, right);
        return sort === "oldest" ? createdDifference : -createdDifference;
      });
      for (const replies of childrenByParent.values()) {
        replies.sort(byCreatedAt);
      }
      const orderedData: typeof data = [];
      const visited = new Set<string>();
      const appendThread = (comment: (typeof data)[number]) => {
        if (visited.has(comment.id)) return;
        visited.add(comment.id);
        orderedData.push(comment);
        for (const reply of childrenByParent.get(comment.id) ?? []) {
          appendThread(reply);
        }
      };
      for (const root of roots) appendThread(root);
      for (const comment of data) appendThread(comment);
      const count = await env.DB.prepare(
        `SELECT COUNT(*) AS count
         FROM discussion_comments
         WHERE series_slug = ?
           AND (? IS NULL OR chapter_slug = ?)
           AND moderation_status = 'VISIBLE'`,
      )
        .bind(seriesSlug, chapterSlug, chapterSlug)
        .first<{ count: number }>();
      const discussionSettings = await getDiscussionSettingsDocument();
      const reactionLibrary = await env.DB.prepare(
        `SELECT id, slug AS key, accessible_label AS label,
                emoji_fallback AS emoji, asset_key AS assetKey,
                is_animated AS animated, revision,
                availability_json AS availabilityJson
         FROM custom_reactions
         WHERE is_active = 1 AND is_archived = 0
           AND usage_kind = 'REACTION'
         ORDER BY display_order, name COLLATE NOCASE`,
      ).all<{
        id: string;
        key: string;
        label: string;
        emoji: string;
        assetKey: string | null;
        animated: number;
        revision: number;
        availabilityJson: string;
      }>();
      const eligibleReactions = reactionLibrary.results.filter((reaction) => {
        const availability = safeJsonRecord(reaction.availabilityJson);
        if (availability.scope === "SIGNED_IN") return Boolean(viewerActor);
        if (availability.scope !== "TEAM") return true;
        const teamIds = Array.isArray(availability.teamIds)
          ? availability.teamIds.filter(
              (teamId): teamId is string => typeof teamId === "string",
            )
          : [];
        return Boolean(
          viewerActor &&
            teamIds.some((teamId) => viewerActor!.teamIds.includes(teamId)),
        );
      });
      const commentGifLibrary = discussionSettings.settings.allowGifs
        ? await env.DB.prepare(
            `SELECT id, name, accessible_label AS label,
                    category, revision, availability_json AS availabilityJson
               FROM custom_reactions
              WHERE is_active = 1
                AND is_archived = 0
                AND usage_kind = 'COMMENT_GIF'
                AND asset_key IS NOT NULL
                AND is_animated = 1
              ORDER BY category COLLATE NOCASE, display_order,
                       name COLLATE NOCASE`,
          ).all<{
            id: string;
            name: string;
            label: string;
            category: string | null;
            revision: number;
            availabilityJson: string;
          }>()
        : { results: [] };
      const eligibleCommentGifs = commentGifLibrary.results.filter((gif) => {
        const availability = safeJsonRecord(gif.availabilityJson);
        if (availability.scope === "SIGNED_IN") return Boolean(viewerActor);
        if (availability.scope !== "TEAM") return true;
        const teamIds = Array.isArray(availability.teamIds)
          ? availability.teamIds.filter(
              (teamId): teamId is string => typeof teamId === "string",
            )
          : [];
        return Boolean(
          viewerActor &&
            teamIds.some((teamId) => viewerActor!.teamIds.includes(teamId)),
        );
      });
      const eligibleAffiliations = viewerActor
        ? await env.DB.prepare(
            `SELECT t.id, t.name
             FROM series s
             JOIN team_memberships tm ON tm.user_id = ?
             JOIN teams t ON t.id = tm.team_id
             WHERE s.slug = ?
               AND tm.status = 'ACTIVE'
               AND t.is_archived = 0
               AND t.verification_status = 'VERIFIED'
               AND EXISTS (
                 SELECT 1
                   FROM chapters team_release
                  WHERE team_release.series_id = s.id
                    AND team_release.team_id = t.id
                    AND team_release.state = 'PUBLISHED'
                    AND team_release.visibility = 'PUBLIC'
                    AND team_release.published_at IS NOT NULL
                    AND datetime(team_release.published_at) <= datetime('now')
               )
             ORDER BY tm.is_primary DESC, t.name COLLATE NOCASE`,
          )
            .bind(viewerActor.id, seriesSlug)
            .all<{ id: string; name: string }>()
        : { results: [] };
      const viewerProfile = viewerActor
        ? await env.DB.prepare(
            `SELECT username, avatar_key AS avatarKey, revision
               FROM user_profiles
              WHERE user_id = ?
              LIMIT 1`,
          )
            .bind(viewerActor.id)
            .first<{
              username: string;
              avatarKey: string | null;
              revision: number;
            }>()
        : null;

      return json(id, {
        data: orderedData,
        count: Number(count?.count ?? 0),
        scope: { seriesSlug, chapterSlug },
        sort,
        eligibleAffiliations: eligibleAffiliations.results,
        viewer: viewerActor
          ? {
              avatarUrl:
                viewerProfile?.avatarKey && viewerProfile.username
                  ? `/api/v1/profile-media?username=${encodeURIComponent(viewerProfile.username)}&slot=avatar&v=${viewerProfile.revision}`
                  : null,
            }
          : null,
        settings: {
          ...discussionSettings.settings,
          reactions: eligibleReactions.map((reaction) => ({
            key: reaction.key,
            label: reaction.label,
            emoji: reaction.emoji,
            enabled: true,
            assetUrl: reaction.assetKey
              ? `/api/v1/reaction-asset?id=${encodeURIComponent(reaction.id)}&v=${reaction.revision}`
              : null,
            animated: Boolean(reaction.animated),
          })),
          gifs: eligibleCommentGifs.map((gif) => ({
            id: gif.id,
            name: gif.name,
            label: gif.label,
            category: gif.category || "General",
            url: `/api/v1/reaction-asset?id=${encodeURIComponent(gif.id)}&v=${gif.revision}`,
          })),
        },
      });
    }

    if (path === "community-highlights") {
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Community highlights are unavailable.",
        );
      }
      const result = await env.DB.prepare(
        `SELECT dc.id,
                dc.series_slug AS seriesSlug,
                dc.chapter_slug AS chapterSlug,
                dc.body,
                dc.created_at AS createdAt,
                u.display_name AS displayName,
                s.title AS seriesTitle,
                s.cover_key AS coverKey,
                COALESCE(c.chapter_number, '') AS chapterNumber,
                COALESCE(c.title, '') AS chapterTitle,
                COALESCE((
                  SELECT SUM(dv.value)
                    FROM discussion_votes dv
                   WHERE dv.comment_id = dc.id
                ), 0) AS voteScore,
                COALESCE((
                  SELECT COUNT(*)
                    FROM discussion_votes dv
                   WHERE dv.comment_id = dc.id
                     AND dv.value > 0
                ), 0) AS upvoteCount,
                COALESCE((
                  SELECT COUNT(*)
                    FROM discussion_votes dv
                   WHERE dv.comment_id = dc.id
                     AND dv.value < 0
                ), 0) AS downvoteCount,
                COALESCE((
                  SELECT COUNT(*)
                    FROM discussion_comments replies
                   WHERE replies.parent_id = dc.id
                     AND replies.moderation_status = 'VISIBLE'
                ), 0) AS replyCount
           FROM discussion_comments dc
           JOIN users u ON u.id = dc.user_id
           JOIN series s ON s.slug = dc.series_slug
           LEFT JOIN chapters c
             ON c.series_id = s.id
            AND c.slug = dc.chapter_slug
           LEFT JOIN content_visibility_overrides visibility_override
             ON visibility_override.chapter_id = c.id
          WHERE dc.moderation_status = 'VISIBLE'
            AND ${publicSeriesPredicate("s")}
            AND dc.deleted_at IS NULL
            AND dc.chapter_slug IS NOT NULL
            AND c.state = 'PUBLISHED'
            AND c.visibility = 'PUBLIC'
            AND c.published_at IS NOT NULL
            AND datetime(c.published_at) <= datetime('now')
            AND ${publicPaidChapterPredicate("c", "visibility_override")}
            AND dc.spoiler = 0
            AND dc.created_at >= datetime('now', '-72 hours')
          ORDER BY
            CASE
              WHEN dc.created_at >= datetime('now', '-8 hours') THEN 0
              ELSE 1
            END,
            voteScore DESC,
            replyCount DESC,
            dc.created_at DESC
          LIMIT 10`,
      ).all<{
        id: string;
        seriesSlug: string;
        chapterSlug: string;
        body: string;
        createdAt: string;
        displayName: string;
        seriesTitle: string;
        chapterNumber: string;
        chapterTitle: string;
        coverKey: string | null;
        voteScore: number;
        upvoteCount: number;
        downvoteCount: number;
        replyCount: number;
      }>();
      return json(
        id,
        {
          data: result.results.map((entry) => ({
            ...entry,
            voteScore: Number(entry.voteScore ?? 0),
            upvoteCount: Number(entry.upvoteCount ?? 0),
            downvoteCount: Number(entry.downvoteCount ?? 0),
            replyCount: Number(entry.replyCount ?? 0),
            cover: publicSeriesCover(entry.seriesSlug, entry.coverKey),
          })),
          windowHours: 8,
          fallbackHours: 72,
          refreshAfterSeconds: 20,
        },
        { headers: { "cache-control": "no-store" } },
      );
    }

    if (path === "discussion-media") {
      if (!env.DB || !env.BUCKET) {
        throw new ApiError(
          503,
          "MEDIA_UNAVAILABLE",
          "Discussion media is unavailable.",
        );
      }
      const mediaId = discussionMediaIdSchema.parse(url.searchParams.get("id"));
      const media = await env.DB.prepare(
        `SELECT dm.user_id AS userId,
                dm.comment_id AS commentId,
                dm.object_key AS objectKey,
                dm.filename,
                dm.content_type AS contentType,
                dm.byte_size AS byteSize,
                dm.moderation_status AS moderationStatus,
                dc.moderation_status AS commentStatus,
                dc.chapter_slug AS chapterSlug,
                s.is_published AS seriesPublished,
                s.archived_at AS seriesArchivedAt,
                s.rights_status AS seriesRightsStatus,
                c.state AS chapterState,
                c.published_at AS chapterPublishedAt
         FROM discussion_media dm
         LEFT JOIN discussion_comments dc ON dc.id = dm.comment_id
         LEFT JOIN series s ON s.slug = dc.series_slug
         LEFT JOIN chapters c
           ON c.series_id = s.id AND c.slug = dc.chapter_slug
         LEFT JOIN content_visibility_overrides visibility_override
           ON visibility_override.chapter_id = c.id
         WHERE dm.id = ?
           AND (
             dm.comment_id IS NULL
             OR (
               ${publicPaidSeriesPredicate("s")}
               AND (
                 dc.chapter_slug IS NULL
                 OR ${publicPaidChapterPredicate("c", "visibility_override")}
               )
             )
           )
         LIMIT 1`,
      )
        .bind(mediaId)
        .first<{
          userId: string;
          commentId: string | null;
          objectKey: string;
          filename: string;
          contentType: string;
          byteSize: number;
          moderationStatus: string;
          commentStatus: string | null;
          chapterSlug: string | null;
          seriesPublished: number | null;
          seriesArchivedAt: string | null;
          seriesRightsStatus: string | null;
          chapterState: string | null;
          chapterPublishedAt: string | null;
        }>();
      if (!media || media.moderationStatus !== "READY") {
        throw new ApiError(
          404,
          "MEDIA_NOT_FOUND",
          "This attachment is no longer available.",
        );
      }
      let publiclyCacheable = false;
      if (!media.commentId) {
        const actor = await requireActor("comment.create");
        if (
          media.userId !== actor.id &&
          !isAdminActor(actor)
        ) {
          throw new ApiError(
            403,
            "MEDIA_OWNER_REQUIRED",
            "This attachment belongs to another reader.",
          );
        }
      } else if (media.commentStatus !== "VISIBLE") {
        throw new ApiError(
          404,
          "MEDIA_NOT_FOUND",
          "This attachment is no longer available.",
        );
      } else {
        const chapterPublishedAt = media.chapterPublishedAt
          ? Date.parse(
              media.chapterPublishedAt.includes("T")
                ? media.chapterPublishedAt
                : `${media.chapterPublishedAt.replace(" ", "T")}Z`,
            )
          : Number.NaN;
        const publicCommentSeries =
          Boolean(media.seriesPublished) &&
          !media.seriesArchivedAt &&
          ["LICENSED", "AUTHORIZED", "DEMO_ORIGINAL", "TEST_ORIGINAL"].includes(
            media.seriesRightsStatus ?? "",
          ) &&
          (media.chapterSlug === null ||
            (media.chapterState === "PUBLISHED" &&
              Number.isFinite(chapterPublishedAt) &&
              chapterPublishedAt <= Date.now()));
        if (!publicCommentSeries) {
          const actor = await getActor().catch(() => null);
          if (!actor || !isGlobalModerator(actor)) {
            throw new ApiError(
              404,
              "MEDIA_NOT_FOUND",
              "This attachment is no longer available.",
            );
          }
        } else {
          publiclyCacheable = true;
        }
      }
      const object = await env.BUCKET.get(media.objectKey);
      if (!object) {
        throw new ApiError(
          404,
          "MEDIA_NOT_FOUND",
          "This attachment is no longer available.",
        );
      }
      const headers = new Headers({
        "content-type": media.contentType,
        "content-length": String(media.byteSize),
        "content-disposition": `inline; filename="${media.filename.replaceAll('"', "")}"`,
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      });
      if (!publiclyCacheable) headers.set("vary", "cookie");
      return new Response(object.body, { headers });
    }

    if (path === "library") {
      const actor = await requireActor("library.manage.own");
      if (!env.DB) throw new ApiError(503, "DATABASE_UNAVAILABLE", "Library storage is unavailable.");
      const result = await env.DB.prepare(
        `SELECT l.series_id, l.list_type, l.is_favorite, l.updated_at,
                s.slug, s.title, s.cover_key
         FROM library_entries l
         JOIN series s ON s.id = l.series_id
         WHERE l.user_id = ?
           AND ${publicSeriesPredicate("s")}
         ORDER BY l.updated_at DESC`,
      )
        .bind(actor.id)
        .all();
      return json(id, { data: result.results });
    }

    if (path === "reader/progress") {
      const actor = await requireActor("reader.progress.own");
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Reading progress is unavailable.",
        );
      }
      const chapterId = z
        .string()
        .min(3)
        .max(120)
        .parse(url.searchParams.get("chapterId"));
      await requireReadableChapter(actor, chapterId);
      const progress = await env.DB.prepare(
        `SELECT page_index AS pageIndex,
                scroll_offset AS scrollOffset,
                progress_basis_points AS progressBasisPoints,
                completed_at AS completedAt,
                updated_at AS updatedAt
           FROM reading_progress
          WHERE user_id = ?
            AND chapter_id = ?
          LIMIT 1`,
      )
        .bind(actor.id, chapterId)
        .first();
      return json(
        id,
        { data: progress ?? null },
        {
          headers: {
            "cache-control": "private, no-store",
            vary: "cookie",
          },
        },
      );
    }

    if (path === "account-settings") {
      const actor = await requireActor();
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Account settings are unavailable.",
        );
      }
      await env.DB.prepare(
        `INSERT OR IGNORE INTO user_preferences
         (user_id, theme, content_language, reader_mode, mature_content,
          settings_json)
         VALUES (?, 'SYSTEM', 'en', 'VERTICAL', 0, '{}')`,
      )
        .bind(actor.id)
        .run();
      const record = await env.DB.prepare(
        `SELECT u.display_name AS displayName,
                up.theme,
                up.content_language AS contentLanguage,
                up.reader_mode AS readerMode,
                up.mature_content AS matureContent,
                up.settings_json AS settingsJson
           FROM users u
           JOIN user_preferences up ON up.user_id = u.id
          WHERE u.id = ?
          LIMIT 1`,
      )
        .bind(actor.id)
        .first<{
          displayName: string;
          theme: string;
          contentLanguage: string;
          readerMode: string;
          matureContent: number;
          settingsJson: string;
        }>();
      let settings: Record<string, unknown> = {};
      try {
        settings = JSON.parse(record?.settingsJson ?? "{}") as Record<
          string,
          unknown
        >;
      } catch {
        settings = {};
      }
      return json(id, {
        data: {
          displayName: record?.displayName ?? actor.displayName,
          theme: record?.theme ?? "SYSTEM",
          contentLanguage: record?.contentLanguage ?? "en",
          readerMode: record?.readerMode ?? "VERTICAL",
          matureContent: Boolean(record?.matureContent),
          readingDirection: settings.readingDirection ?? "AUTO",
          brightness: settings.brightness ?? 100,
          readerTypeDefaults: settings.readerTypeDefaults ?? { manga: "SYSTEM", vertical: "SYSTEM" },
          commentReplyBadge: settings.commentReplyBadge ?? true,
          readerSettings: settings.readerSettings ?? {
            mode: "vertical",
            imageFit: "smart",
            imageSpacing: 8,
            topMargin: 76,
            bottomMargin: 86,
            brightness: 100,
            backgroundColor: "#090b09",
            readerTheme: "dark",
            tapZones: true,
            readingDirection: "ltr",
            volumeNavigation: false,
            keepAwake: false,
            autoMarkRead: true,
            preloadNextChapter: true,
            saveReadingProgress: true,
            rememberSettings: true,
          },
          notifications: settings.notifications ?? {},
          privacy: settings.privacy ?? {},
        },
      });
    }

    if (path === "account-export") {
      const actor = await requireActor();
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Account export is unavailable.",
        );
      }
      const [profile, preferences, library, progress, reviews, comments, orders] =
        await env.DB.batch([
          env.DB.prepare(
            `SELECT id, email, display_name AS displayName,
                    primary_role AS role, status, created_at AS createdAt,
                    updated_at AS updatedAt
               FROM users WHERE id = ?`,
          ).bind(actor.id),
          env.DB.prepare(
            "SELECT * FROM user_preferences WHERE user_id = ?",
          ).bind(actor.id),
          env.DB.prepare(
            "SELECT * FROM library_entries WHERE user_id = ? ORDER BY created_at",
          ).bind(actor.id),
          env.DB.prepare(
            "SELECT * FROM reading_progress WHERE user_id = ? ORDER BY updated_at",
          ).bind(actor.id),
          env.DB.prepare(
            "SELECT * FROM reviews WHERE user_id = ? ORDER BY created_at",
          ).bind(actor.id),
          env.DB.prepare(
            `SELECT id, series_slug, chapter_slug, parent_id, body, spoiler,
                    moderation_status, created_at, updated_at
               FROM discussion_comments
              WHERE user_id = ?
              ORDER BY created_at`,
          ).bind(actor.id),
          env.DB.prepare(
            `SELECT id, status, total_minor, billing_currency, provider,
                    provider_reference, created_at, updated_at
               FROM orders
              WHERE user_id = ?
              ORDER BY created_at`,
          ).bind(actor.id),
        ]);
      return new Response(
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            profile: profile.results[0] ?? null,
            preferences: preferences.results[0] ?? null,
            library: library.results,
            readingProgress: progress.results,
            reviews: reviews.results,
            comments: comments.results,
            orders: orders.results,
          },
          null,
          2,
        ),
        {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "content-disposition": `attachment; filename="nyascans-account-${actor.id.slice(-12)}.json"`,
            "cache-control": "private, no-store",
            "x-request-id": id,
          },
        },
      );
    }

    if (path === "wallet") {
      const actor = await requireActor("wallet.read.own");
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Wallet storage is unavailable.",
        );
      }
      const featureStates = await getFeatureStates(env.DB);
      if (!featureStates.premium_unlocks.effective) {
        return json(
          id,
          {
            ...(await currencyWalletSnapshot(env.DB, actor.id, "SHARDS")),
            premiumEconomyPublic: false,
          },
          {
            headers: {
              "cache-control": "private, no-store",
              vary: "cookie",
            },
          },
        );
      }
      return json(id, await walletSnapshot(actor.id), {
        headers: {
          "cache-control": "private, no-store",
          vary: "cookie",
        },
      });
    }

    if (path === "orders") {
      const actor = await requireActor("orders.read.own");
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Purchase history is unavailable.",
        );
      }
      const featureStates = await getFeatureStates(env.DB);
      if (!featureStates.premium_unlocks.effective) {
        return json(
          id,
          { data: [], premiumEconomyPublic: false },
          {
            headers: {
              "cache-control": "private, no-store",
              vary: "cookie",
            },
          },
        );
      }
      const result = await env.DB.prepare(
        `SELECT id, status,
                total_minor AS totalMinor,
                billing_currency AS billingCurrency,
                provider,
                provider_reference AS providerReference,
                created_at AS createdAt
         FROM orders
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 50`,
      )
        .bind(actor.id)
        .all();
      return json(id, { data: result.results }, {
        headers: {
          "cache-control": "private, no-store",
          vary: "cookie",
        },
      });
    }

    if (path === "notifications") {
      const actor = await requireActor();
      if (!env.DB) throw new ApiError(503, "DATABASE_UNAVAILABLE", "Notification storage is unavailable.");
      const featureStates = await getFeatureStates(env.DB);
      const result = await env.DB.prepare(
         `SELECT id, kind, title, body, read_at, created_at
         FROM notifications
         WHERE user_id = ?
           AND (? = 1 OR kind <> 'TEAM_SUPPORT')
         ORDER BY created_at DESC LIMIT 40`,
      )
        .bind(
          actor.id,
          featureStates.premium_unlocks.effective ? 1 : 0,
        )
        .all();
      return json(id, { data: result.results }, {
        headers: {
          "cache-control": "private, no-store",
          vary: "cookie",
        },
      });
    }

    if (path === "uploads") {
      throw new ApiError(
        410,
        "LEGACY_UPLOAD_ENDPOINT_RETIRED",
        "This upload endpoint has been retired. Use the Upload Center history and draft routes.",
      );
    }


    if (path.startsWith("workspace/")) {
      const section = path.slice("workspace/".length);
      const actor =
        section === "comments"
          ? await requireActor()
          : section === "analytics"
            ? await requireActor("analytics.team.read")
          : await requireActor("upload.create");
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "The publishing workspace is temporarily unavailable.",
        );
      }
      const isAdmin = isAdminActor(actor);
      const teamIds = actor.teamIds;
      const teamPlaceholders = teamIds.map(() => "?").join(", ");
      const managedTeamIds = actor.managedTeamIds;
      const managedTeamPlaceholders = managedTeamIds
        .map(() => "?")
        .join(", ");

      if (section === "settings") {
        await env.DB.prepare(
          `INSERT OR IGNORE INTO user_preferences
           (user_id, theme, content_language, reader_mode, mature_content,
            settings_json)
           VALUES (?, 'SYSTEM', 'en', 'VERTICAL', 0, '{}')`,
        )
          .bind(actor.id)
          .run();
        const row = await env.DB.prepare(
          `SELECT content_language AS contentLanguage,
                  settings_json AS settingsJson
             FROM user_preferences
            WHERE user_id = ?
            LIMIT 1`,
        )
          .bind(actor.id)
          .first<{ contentLanguage: string; settingsJson: string }>();
        const settings = safeJsonRecord(row?.settingsJson);
        const workspace =
          settings.workspace &&
          typeof settings.workspace === "object" &&
          !Array.isArray(settings.workspace)
            ? (settings.workspace as Record<string, unknown>)
            : {};
        const teams = isAdmin
          ? await env.DB.prepare(
              `SELECT id, name, slug
                 FROM teams
                WHERE verification_status <> 'SUSPENDED'
                ORDER BY name COLLATE NOCASE`,
            ).all()
          : teamIds.length
            ? await env.DB.prepare(
                `SELECT id, name, slug
                   FROM teams
                  WHERE id IN (${teamPlaceholders})
                    AND verification_status <> 'SUSPENDED'
                  ORDER BY name COLLATE NOCASE`,
              )
                .bind(...teamIds)
                .all()
            : { results: [] };
        return json(id, {
          data: {
            defaultTeamId:
              typeof workspace.defaultTeamId === "string"
                ? workspace.defaultTeamId
                : teams.results[0]?.id ?? null,
            defaultLanguage:
              typeof workspace.defaultLanguage === "string"
                ? workspace.defaultLanguage
                : row?.contentLanguage ?? "en",
            reviewNotifications: workspace.reviewNotifications !== false,
            uploadNotifications: workspace.uploadNotifications !== false,
          },
          teams: teams.results,
        });
      }

      if (section === "series" || section === "rights") {
        const managedTeams =
          actor.roles.includes("TEAM_LEADER")
            ? await env.DB.prepare(
                `SELECT t.id, t.slug, t.name
                   FROM teams t
                   JOIN team_memberships tm ON tm.team_id = t.id
                  WHERE tm.user_id = ?
                    AND tm.status = 'ACTIVE'
                    AND UPPER(tm.membership_role) IN
                      ('OWNER', 'MANAGER', 'TEAM_LEADER')
                    AND t.verification_status <> 'SUSPENDED'
                  ORDER BY t.name COLLATE NOCASE`,
              )
                .bind(actor.id)
                .all()
            : { results: [] };
        const rows = isAdmin
          ? await env.DB.prepare(
              `SELECT s.id,
                      s.slug,
                      s.title,
                      s.type,
                      s.status,
                      s.rights_status AS rightsStatus,
                      s.is_published AS isPublished,
                      s.updated_at AS updatedAt,
                      GROUP_CONCAT(DISTINCT t.name) AS teams
                 FROM series s
                 LEFT JOIN series_team_assignments sta ON sta.series_id = s.id
                 LEFT JOIN teams t ON t.id = sta.team_id
                GROUP BY s.id
                ORDER BY s.updated_at DESC
                LIMIT 120`,
            ).all()
          : teamIds.length
            ? await env.DB.prepare(
                `SELECT s.id,
                        s.slug,
                        s.title,
                        s.type,
                        s.status,
                        s.rights_status AS rightsStatus,
                        s.is_published AS isPublished,
                        s.updated_at AS updatedAt,
                        GROUP_CONCAT(DISTINCT t.name) AS teams
                   FROM series s
                   JOIN series_team_assignments own
                     ON own.series_id = s.id
                    AND own.team_id IN (${teamPlaceholders})
                   LEFT JOIN series_team_assignments sta ON sta.series_id = s.id
                   LEFT JOIN teams t ON t.id = sta.team_id
                  GROUP BY s.id
                  ORDER BY s.updated_at DESC
                  LIMIT 120`,
              )
                .bind(...teamIds)
                .all()
            : { results: [] };
        return json(id, {
          data: rows.results.map((row) => ({
            ...row,
            isPublished: Boolean(row.isPublished),
          })),
          managedTeams: managedTeams.results,
          canCreateSeries:
            actor.roles.includes("TEAM_LEADER") &&
            managedTeams.results.length > 0,
          section,
        });
      }

      if (section === "comments") {
        const seriesOptions = isGlobalModerator(actor)
          ? await env.DB.prepare(
              `SELECT id, slug, title
                 FROM series
                ORDER BY title COLLATE NOCASE`,
            ).all()
          : managedTeamIds.length
            ? await env.DB.prepare(
                `SELECT DISTINCT s.id, s.slug, s.title
                   FROM series s
                   JOIN series_team_assignments sta ON sta.series_id = s.id
                  WHERE sta.team_id IN (${managedTeamPlaceholders})
                  ORDER BY s.title COLLATE NOCASE`,
              )
                .bind(...managedTeamIds)
                .all()
            : { results: [] };
        const selectedSeries = (url.searchParams.get("series") ?? "").trim();
        const page = z.coerce
          .number()
          .int()
          .min(1)
          .max(100_000)
          .catch(1)
          .parse(url.searchParams.get("page"));
        const pageSize = 30;
        if (!selectedSeries) {
          return json(id, {
            data: [],
            series: seriesOptions.results,
            selectedSeries: null,
            canModerate:
              isGlobalModerator(actor) ||
              actor.roles.includes("TEAM_LEADER"),
            canSuspendUsers: isAdminActor(actor),
            pagination: {
              page: 1,
              pageSize,
              total: 0,
              pageCount: 1,
              hasPrevious: false,
              hasNext: false,
            },
          });
        }
        slugSchema.parse(selectedSeries);
        const allowed = seriesOptions.results.some(
          (seriesRecord) => String(seriesRecord.slug) === selectedSeries,
        );
        if (!allowed) {
          throw new ApiError(
            403,
            "SERIES_SCOPE_REQUIRED",
            "Choose a series available in this workspace.",
          );
        }
        const [rows, totalRow] = await Promise.all([
          env.DB.prepare(
            `SELECT dc.id,
                    dc.user_id AS userId,
                    dc.series_slug AS seriesSlug,
                    dc.chapter_slug AS chapterSlug,
                    dc.parent_id AS parentId,
                    dc.body,
                    dc.spoiler,
                    dc.moderation_status AS moderationStatus,
                    dc.pinned_at AS pinnedAt,
                    dc.edited_at AS editedAt,
                    dc.revision,
                    dc.updated_at AS updatedAt,
                    dc.created_at AS createdAt,
                    u.display_name AS displayName,
                    u.status AS userStatus,
                    s.title AS seriesTitle,
                    EXISTS (
                      SELECT 1
                        FROM discussion_user_restrictions dur
                       WHERE dur.series_slug = dc.series_slug
                         AND dur.user_id = dc.user_id
                    ) AS bannedFromSeries,
                    (
                      SELECT COUNT(*)
                        FROM discussion_reactions dr
                       WHERE dr.comment_id = dc.id
                    ) AS reactionCount,
                    (
                      SELECT COUNT(*)
                        FROM discussion_comments replies
                       WHERE replies.parent_id = dc.id
                         AND replies.moderation_status <> 'DELETED'
                    ) AS replyCount,
                    (
                      SELECT COUNT(*)
                        FROM reports r
                       WHERE r.target_type = 'COMMENT'
                         AND r.target_id = dc.id
                         AND r.status = 'OPEN'
                    ) AS reportCount
               FROM discussion_comments dc
               JOIN users u ON u.id = dc.user_id
               JOIN series s ON s.slug = dc.series_slug
              WHERE dc.series_slug = ?
              ORDER BY datetime(dc.created_at) DESC, dc.id DESC
              LIMIT ? OFFSET ?`,
          )
            .bind(selectedSeries, pageSize, (page - 1) * pageSize)
            .all(),
          env.DB.prepare(
            `SELECT COUNT(*) AS count
               FROM discussion_comments
              WHERE series_slug = ?`,
          )
            .bind(selectedSeries)
            .first<{ count: number }>(),
        ]);
        const total = Number(totalRow?.count ?? 0);
        return json(id, {
          data: rows.results.map((row) => ({
            ...row,
            bannedFromSeries: Boolean(row.bannedFromSeries),
          })),
          series: seriesOptions.results,
          selectedSeries,
          canModerate:
            isGlobalModerator(actor) ||
            actor.roles.includes("TEAM_LEADER"),
          canSuspendUsers: isAdminActor(actor),
          pagination: {
            page,
            pageSize,
            total,
            pageCount: Math.max(1, Math.ceil(total / pageSize)),
            hasPrevious: page > 1,
            hasNext: page * pageSize < total,
          },
        });
      }

      if (section === "analytics") {
        const {
          range,
          startAt,
          endAt,
          bucketFormat,
        } = analyticsWindow(url);
        const scopeBindings = isAdmin ? [] : teamIds;
        const eventScope = isAdmin
          ? "1 = 1"
          : teamIds.length
            ? `ae.series_slug IN (
                 SELECT s.slug
                   FROM series s
                   JOIN series_team_assignments sta ON sta.series_id = s.id
                  WHERE sta.team_id IN (${teamPlaceholders})
               )`
            : "1 = 0";
        const commentScope = isAdmin
          ? "1 = 1"
          : teamIds.length
            ? `dc.series_slug IN (
                 SELECT s.slug
                   FROM series s
                   JOIN series_team_assignments sta ON sta.series_id = s.id
                  WHERE sta.team_id IN (${teamPlaceholders})
               )`
            : "1 = 0";
        const chapterScope = isAdmin
          ? "1 = 1"
          : teamIds.length
            ? `c.team_id IN (${teamPlaceholders})`
            : "1 = 0";
        const [timeline, eventSummary, discussionSummary, uploadSummary, topChapters, regions, purchaseSummary] =
          await env.DB.batch([
            env.DB.prepare(
              `SELECT strftime('${bucketFormat}', ae.created_at) AS day,
                      ae.event_type AS eventType,
                      COUNT(*) AS count
                 FROM analytics_events ae
                WHERE ae.created_at >= datetime(?)
                  AND ae.created_at < datetime(?)
                  AND ${eventScope}
                GROUP BY day, ae.event_type
                ORDER BY day ASC, eventType ASC`,
            ).bind(startAt, endAt, ...scopeBindings),
            env.DB.prepare(
              `SELECT COUNT(DISTINCT ae.session_id) AS uniqueViewers,
                      COALESCE(SUM(CASE
                        WHEN ae.event_type IN
                          ('HOME_VIEW', 'LATEST_VIEW', 'BROWSE_VIEW',
                           'SERIES_VIEW')
                        THEN 1 ELSE 0 END), 0) AS pageViews,
                      COALESCE(SUM(CASE
                        WHEN ae.event_type = 'CHAPTER_START'
                        THEN 1 ELSE 0 END), 0) AS chapterViews,
                      COALESCE(SUM(CASE
                        WHEN ae.event_type = 'CHAPTER_COMPLETE'
                        THEN 1 ELSE 0 END), 0) AS chapterCompletions
                 FROM analytics_events ae
                WHERE ae.created_at >= datetime(?)
                  AND ae.created_at < datetime(?)
                  AND ${eventScope}`,
            ).bind(startAt, endAt, ...scopeBindings),
            env.DB.prepare(
              `SELECT
                 (SELECT COUNT(*)
                    FROM discussion_comments dc
                   WHERE dc.created_at >= datetime(?)
                     AND dc.created_at < datetime(?)
                     AND ${commentScope}) AS comments,
                 (SELECT COUNT(*)
                    FROM discussion_reactions dr
                    JOIN discussion_comments dc ON dc.id = dr.comment_id
                   WHERE dr.created_at >= datetime(?)
                     AND dr.created_at < datetime(?)
                     AND ${commentScope}) AS reactions`,
            ).bind(
              startAt,
              endAt,
              ...scopeBindings,
              startAt,
              endAt,
              ...scopeBindings,
            ),
            env.DB.prepare(
              `SELECT
                 (SELECT COUNT(DISTINCT s.id)
                    FROM series s
                    LEFT JOIN series_team_assignments sta
                      ON sta.series_id = s.id
                   WHERE s.created_at >= datetime(?)
                     AND s.created_at < datetime(?)
                     AND ${
                       isAdmin
                         ? "1 = 1"
                         : teamIds.length
                           ? `sta.team_id IN (${teamPlaceholders})`
                           : "1 = 0"
                     }) AS newSeries,
                 (SELECT COUNT(*)
                    FROM chapters c
                   WHERE c.created_at >= datetime(?)
                     AND c.created_at < datetime(?)
                     AND ${chapterScope}) AS newChapters,
                 (SELECT COUNT(*)
                    FROM upload_sessions us
                   WHERE us.created_at >= datetime(?)
                     AND us.created_at < datetime(?)
                     AND ${
                       isAdmin
                         ? "1 = 1"
                         : teamIds.length
                           ? `us.team_id IN (${teamPlaceholders})`
                           : "1 = 0"
                     }) AS uploadSessions`,
            ).bind(
              startAt,
              endAt,
              ...scopeBindings,
              startAt,
              endAt,
              ...scopeBindings,
              startAt,
              endAt,
              ...scopeBindings,
            ),
            env.DB.prepare(
              `SELECT ae.series_slug AS seriesSlug,
                      COALESCE(s.title, ae.series_slug) AS seriesTitle,
                      ae.chapter_slug AS chapterSlug,
                      COALESCE(c.chapter_number, ae.chapter_slug)
                        AS chapterNumber,
                      COUNT(*) AS views,
                      COUNT(DISTINCT ae.session_id) AS uniqueViewers
                 FROM analytics_events ae
                 LEFT JOIN series s ON s.slug = ae.series_slug
                 LEFT JOIN chapters c
                   ON c.series_id = s.id
                  AND c.slug = ae.chapter_slug
                WHERE ae.event_type = 'CHAPTER_START'
                  AND ae.created_at >= datetime(?)
                  AND ae.created_at < datetime(?)
                  AND ${eventScope}
                GROUP BY ae.series_slug, ae.chapter_slug, s.title,
                         c.chapter_number
                ORDER BY views DESC, uniqueViewers DESC
                LIMIT 10`,
            ).bind(startAt, endAt, ...scopeBindings),
            env.DB.prepare(
              `SELECT COALESCE(NULLIF(ae.region_code, ''), 'Unknown')
                        AS regionCode,
                      COUNT(*) AS views,
                      COUNT(DISTINCT ae.session_id) AS uniqueViewers
                 FROM analytics_events ae
                WHERE ae.event_type IN
                  ('HOME_VIEW', 'LATEST_VIEW', 'BROWSE_VIEW', 'SERIES_VIEW',
                   'CHAPTER_START')
                  AND ae.created_at >= datetime(?)
                  AND ae.created_at < datetime(?)
                  AND ${eventScope}
                GROUP BY COALESCE(NULLIF(ae.region_code, ''), 'Unknown')
                ORDER BY views DESC
                LIMIT 12`,
            ).bind(startAt, endAt, ...scopeBindings),
            env.DB.prepare(
              `SELECT COUNT(DISTINCT lt.id) AS purchases,
                      COALESCE(SUM(CASE
                        WHEN la.owner_type = 'PLATFORM' AND le.amount > 0
                        THEN le.amount ELSE 0 END), 0) AS onyxSpent
                 FROM ledger_transactions lt
                 JOIN chapters c ON c.id = lt.reference_id
                 LEFT JOIN ledger_entries le ON le.transaction_id = lt.id
                 LEFT JOIN ledger_accounts la ON la.id = le.account_id
                WHERE lt.kind = 'CHAPTER_UNLOCK'
                  AND lt.created_at >= datetime(?)
                  AND lt.created_at < datetime(?)
                  AND ${chapterScope}`,
            ).bind(startAt, endAt, ...scopeBindings),
          ]);
        const events = (eventSummary.results?.[0] ?? {}) as Record<
          string,
          unknown
        >;
        const discussion = (discussionSummary.results?.[0] ?? {}) as Record<
          string,
          unknown
        >;
        const uploads = (uploadSummary.results?.[0] ?? {}) as Record<
          string,
          unknown
        >;
        const purchases = (purchaseSummary.results?.[0] ?? {}) as Record<
          string,
          unknown
        >;
        return json(id, {
          data: timeline.results,
          range,
          startAt,
          endAt,
          summary: {
            uniqueViewers: Number(events.uniqueViewers ?? 0),
            pageViews: Number(events.pageViews ?? 0),
            chapterViews: Number(events.chapterViews ?? 0),
            chapterCompletions: Number(events.chapterCompletions ?? 0),
            comments: Number(discussion.comments ?? 0),
            reactions: Number(discussion.reactions ?? 0),
            newSeries: Number(uploads.newSeries ?? 0),
            newChapters: Number(uploads.newChapters ?? 0),
            uploadSessions: Number(uploads.uploadSessions ?? 0),
            purchases: Number(purchases.purchases ?? 0),
            onyxSpent: Number(purchases.onyxSpent ?? 0),
          },
          topChapters: topChapters.results,
          regions: regions.results,
        });
      }

      if (section === "review-queue") {
        const rows = isAdmin
          ? await env.DB.prepare(
              `SELECT c.id,
                      c.slug,
                      c.chapter_number AS chapterNumber,
                      c.title,
                      c.language,
                      c.version,
                      c.revision,
                      c.state,
                      c.page_count AS pageCount,
                      c.created_at AS createdAt,
                      s.slug AS seriesSlug,
                      s.title AS seriesTitle,
                      t.name AS teamName,
                      uji.replacement_chapter_id AS replacementChapterId,
                      replacement.chapter_number AS replacementChapterNumber,
                      replacement.title AS replacementChapterTitle
                 FROM chapters c
                 JOIN series s ON s.id = c.series_id
                 LEFT JOIN teams t ON t.id = c.team_id
                 LEFT JOIN upload_job_items uji ON uji.chapter_id = c.id
                 LEFT JOIN chapters replacement
                   ON replacement.id = uji.replacement_chapter_id
                WHERE c.state IN ('DRAFT', 'READY_FOR_REVIEW')
                ORDER BY CASE WHEN c.state = 'READY_FOR_REVIEW' THEN 0 ELSE 1 END,
                         c.created_at DESC
                LIMIT 100`,
            ).all()
          : teamIds.length
            ? await env.DB.prepare(
                `SELECT c.id,
                        c.slug,
                        c.chapter_number AS chapterNumber,
                        c.title,
                        c.language,
                        c.version,
                        c.revision,
                        c.state,
                        c.page_count AS pageCount,
                        c.created_at AS createdAt,
                        s.slug AS seriesSlug,
                        s.title AS seriesTitle,
                        t.name AS teamName,
                        NULL AS replacementChapterId,
                        NULL AS replacementChapterNumber,
                        NULL AS replacementChapterTitle
                   FROM chapters c
                   JOIN series s ON s.id = c.series_id
                   LEFT JOIN teams t ON t.id = c.team_id
                  WHERE c.team_id IN (${teamPlaceholders})
                    AND c.state IN ('DRAFT', 'READY_FOR_REVIEW')
                    AND NOT EXISTS (
                      SELECT 1
                        FROM upload_job_items replacement_item
                       WHERE replacement_item.chapter_id = c.id
                         AND replacement_item.replacement_chapter_id IS NOT NULL
                    )
                  ORDER BY CASE WHEN c.state = 'READY_FOR_REVIEW' THEN 0 ELSE 1 END,
                           c.created_at DESC
                  LIMIT 100`,
              )
                .bind(...teamIds)
                .all()
            : { results: [] };
        return json(id, { data: rows.results });
      }

      if (section === "overview") {
        const chapterScope = isAdmin
          ? "1 = 1"
          : teamIds.length
            ? `c.team_id IN (${teamPlaceholders})`
            : "1 = 0";
        const bindings = isAdmin ? [] : teamIds;
        const [metrics, recent] = await Promise.all([
          env.DB.batch([
            env.DB.prepare(
              `SELECT COUNT(*) AS count
                 FROM chapters c
                WHERE ${chapterScope}`,
            ).bind(...bindings),
            env.DB.prepare(
              `SELECT COUNT(*) AS count
                 FROM chapters c
                WHERE ${chapterScope}
                  AND c.state = 'READY_FOR_REVIEW'`,
            ).bind(...bindings),
            env.DB.prepare(
              `SELECT COUNT(*) AS count
                 FROM chapters c
                WHERE ${chapterScope}
                  AND c.state = 'PUBLISHED'`,
            ).bind(...bindings),
            env.DB.prepare(
              `SELECT COALESCE(SUM(c.page_count), 0) AS count
                 FROM chapters c
                WHERE ${chapterScope}`,
            ).bind(...bindings),
          ]),
          env.DB.prepare(
            `SELECT c.id,
                    c.state,
                    c.chapter_number AS chapterNumber,
                    c.created_at AS createdAt,
                    s.slug AS seriesSlug,
                    s.title AS seriesTitle,
                    t.name AS teamName
               FROM chapters c
               JOIN series s ON s.id = c.series_id
               LEFT JOIN teams t ON t.id = c.team_id
              WHERE ${chapterScope}
              ORDER BY c.created_at DESC
              LIMIT 12`,
          )
            .bind(...bindings)
            .all(),
        ]);
        return json(id, {
          metrics: {
            chapters: countValue(metrics[0]),
            readyForReview: countValue(metrics[1]),
            published: countValue(metrics[2]),
            pages: countValue(metrics[3]),
          },
          recent: recent.results,
        });
      }

      throw new ApiError(
        404,
        "WORKSPACE_SECTION_NOT_FOUND",
        "This publishing workspace section does not exist.",
      );
    }

    if (path === "admin/summary") {
      const actor = await requireActor();
      requireAdminCapability(actor, capabilityForAdminPath(path));
      if (!env.DB) throw new ApiError(503, "DATABASE_UNAVAILABLE", "Operations storage is unavailable.");
      const counts = await env.DB.batch([
        env.DB.prepare("SELECT COUNT(*) AS count FROM users"),
        env.DB.prepare("SELECT COUNT(*) AS count FROM series"),
        env.DB.prepare("SELECT COUNT(*) AS count FROM teams"),
        env.DB.prepare("SELECT COUNT(*) AS count FROM chapters WHERE state = 'PUBLISHED'"),
        env.DB.prepare("SELECT COUNT(*) AS count FROM upload_sessions WHERE status NOT IN ('READY', 'FAILED')"),
        env.DB.prepare(
          "SELECT COUNT(*) AS count FROM reports WHERE status IN ('OPEN', 'IN_REVIEW')",
        ),
        env.DB.prepare("SELECT COUNT(*) AS count FROM chapters WHERE state = 'READY_FOR_REVIEW'"),
        env.DB.prepare(
          "SELECT COUNT(DISTINCT user_id) AS count FROM reading_progress WHERE updated_at > datetime('now', '-7 days')",
        ),
        env.DB.prepare(
          "SELECT COALESCE(SUM(byte_size), 0) AS count FROM upload_sessions",
        ),
        env.DB.prepare(
          "SELECT COUNT(*) AS count FROM discussion_comments WHERE moderation_status = 'VISIBLE'",
        ),
      ]);
      const activity =
        actor.roles.includes("OWNER")
          ? await env.DB.prepare(
              `SELECT al.id,
                      al.action,
                      al.target_type AS targetType,
                      al.target_id AS targetId,
                      al.created_at AS createdAt,
                      u.display_name AS actorName
                 FROM audit_logs al
                 LEFT JOIN users u ON u.id = al.actor_user_id
                ORDER BY al.created_at DESC
                LIMIT 8`,
            ).all()
          : { results: [] };
      return json(id, {
        metrics: {
          users: countValue(counts[0]),
          series: countValue(counts[1]),
          teams: countValue(counts[2]),
          publishedChapters: countValue(counts[3]),
          processingUploads: countValue(counts[4]),
          openReports: countValue(counts[5]),
          reviewQueue: countValue(counts[6]),
          activeReaders7d: countValue(counts[7]),
          storageBytes: countValue(counts[8]),
          visibleComments: countValue(counts[9]),
        },
        activity: activity.results,
        activityRestricted: !actor.roles.includes("OWNER"),
        generatedAt: new Date().toISOString(),
      });
    }

    if (path === "admin/analytics") {
      const actor = await requireActor();
      requireAdminCapability(actor, capabilityForAdminPath(path));
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Analytics storage is unavailable.",
        );
      }
      const {
        range,
        startAt,
        endAt,
        bucketFormat,
        buckets,
      } = analyticsWindow(url);
      const requestedRegion = (url.searchParams.get("region") ?? "ALL")
        .trim()
        .toUpperCase();
      const selectedRegion =
        requestedRegion === "UNKNOWN"
          ? "Unknown"
          : requestedRegion !== "ALL" && /^[A-Z]{2}$/.test(requestedRegion)
            ? requestedRegion
            : null;
      const regionClause = selectedRegion
        ? "AND COALESCE(NULLIF(region_code, ''), 'Unknown') = ?"
        : "";
      const regionClauseAe = selectedRegion
        ? "AND COALESCE(NULLIF(ae.region_code, ''), 'Unknown') = ?"
        : "";
      const regionBindings = selectedRegion ? [selectedRegion] : [];
      const previousStartAt = new Date(
        Date.parse(startAt) - Math.max(1, Date.parse(endAt) - Date.parse(startAt)),
      ).toISOString();
      const results = (await env.DB.batch([
        env.DB.prepare(
          `SELECT COUNT(DISTINCT CASE
                    WHEN created_at >= datetime('now', '-5 minutes')
                    THEN session_id END) AS activeSessions5m,
                  COUNT(DISTINCT session_id) AS uniqueSessions,
                  COUNT(DISTINCT visitor_id) AS uniqueVisitors,
                  COUNT(DISTINCT CASE
                    WHEN visitor_id IS NOT NULL
                     AND NOT EXISTS (
                       SELECT 1
                         FROM analytics_events prior
                        WHERE prior.visitor_id = analytics_events.visitor_id
                          AND prior.created_at < datetime(?)
                     )
                    THEN visitor_id END) AS newVisitors,
                  COALESCE(SUM(CASE
                    WHEN event_type IN
                      ('HOME_VIEW', 'LATEST_VIEW', 'BROWSE_VIEW', 'SERIES_VIEW')
                    THEN 1 ELSE 0 END), 0) AS views,
                  COALESCE(SUM(CASE
                    WHEN event_type = 'CHAPTER_START' THEN 1 ELSE 0 END), 0)
                    AS chapterStarts,
                  COALESCE(SUM(CASE
                    WHEN event_type = 'CHAPTER_COMPLETE' THEN 1 ELSE 0 END), 0)
                    AS chapterCompletions
             FROM analytics_events
            WHERE created_at >= datetime(?)
              AND created_at < datetime(?)
              ${regionClause}`,
        ).bind(startAt, startAt, endAt, ...regionBindings),
        env.DB.prepare(
          `SELECT strftime('${bucketFormat}', created_at) AS bucket,
                  COUNT(DISTINCT session_id) AS readers,
                  COALESCE(SUM(CASE
                    WHEN event_type IN
                      ('HOME_VIEW', 'LATEST_VIEW', 'BROWSE_VIEW', 'SERIES_VIEW')
                    THEN 1 ELSE 0 END), 0) AS views,
                  COALESCE(SUM(CASE
                    WHEN event_type = 'CHAPTER_START' THEN 1 ELSE 0 END), 0)
                    AS chapterStarts,
                  COALESCE(SUM(CASE
                    WHEN event_type = 'CHAPTER_COMPLETE' THEN 1 ELSE 0 END), 0)
                    AS chapterCompletions
             FROM analytics_events
            WHERE created_at >= datetime(?)
              AND created_at < datetime(?)
              ${regionClause}
            GROUP BY bucket
            ORDER BY bucket`,
        ).bind(startAt, endAt, ...regionBindings),
        env.DB.prepare(
          `SELECT COUNT(*) AS comments
            FROM discussion_comments
            WHERE moderation_status = 'VISIBLE'
              AND created_at >= datetime(?)
              AND created_at < datetime(?)`,
        ).bind(startAt, endAt),
        env.DB.prepare(
          `SELECT strftime('${bucketFormat}', created_at) AS bucket,
                  COUNT(*) AS comments
             FROM discussion_comments
            WHERE moderation_status = 'VISIBLE'
              AND created_at >= datetime(?)
              AND created_at < datetime(?)
            GROUP BY bucket
            ORDER BY bucket`,
        ).bind(startAt, endAt),
        env.DB.prepare(
          `SELECT COUNT(DISTINCT lt.id) AS unlocks,
                  COALESCE(SUM(CASE
                    WHEN la.owner_type = 'PLATFORM' AND le.amount > 0
                    THEN le.amount ELSE 0 END), 0) AS onyxSpent
             FROM ledger_transactions lt
             LEFT JOIN ledger_entries le ON le.transaction_id = lt.id
             LEFT JOIN ledger_accounts la ON la.id = le.account_id
            WHERE lt.kind = 'CHAPTER_UNLOCK'
              AND lt.created_at >= datetime(?)
              AND lt.created_at < datetime(?)`,
        ).bind(startAt, endAt),
        env.DB.prepare(
          `SELECT strftime('${bucketFormat}', lt.created_at) AS bucket,
                  COUNT(DISTINCT lt.id) AS unlocks,
                  COALESCE(SUM(CASE
                    WHEN la.owner_type = 'PLATFORM' AND le.amount > 0
                    THEN le.amount ELSE 0 END), 0) AS onyxSpent
             FROM ledger_transactions lt
             LEFT JOIN ledger_entries le ON le.transaction_id = lt.id
             LEFT JOIN ledger_accounts la ON la.id = le.account_id
            WHERE lt.kind = 'CHAPTER_UNLOCK'
              AND lt.created_at >= datetime(?)
              AND lt.created_at < datetime(?)
            GROUP BY bucket
            ORDER BY bucket`,
        ).bind(startAt, endAt),
        env.DB.prepare(
          `SELECT COUNT(*) AS paidOrders,
                  COALESCE(SUM(total_minor), 0) AS testCheckoutValueMinor
            FROM orders
            WHERE status = 'PAID'
              AND created_at >= datetime(?)
              AND created_at < datetime(?)`,
        ).bind(startAt, endAt),
        env.DB.prepare(
          `SELECT ae.series_slug AS slug,
                  s.title,
                  COALESCE(SUM(CASE
                    WHEN ae.event_type = 'SERIES_VIEW' THEN 1 ELSE 0 END), 0)
                    AS seriesViews,
                  COALESCE(SUM(CASE
                    WHEN ae.event_type = 'CHAPTER_START' THEN 1 ELSE 0 END), 0)
                    AS chapterStarts,
                  COALESCE(SUM(CASE
                    WHEN ae.event_type = 'CHAPTER_COMPLETE' THEN 1 ELSE 0 END), 0)
                    AS chapterCompletions
             FROM analytics_events ae
             LEFT JOIN series s ON s.slug = ae.series_slug
            WHERE ae.series_slug IS NOT NULL
              AND ae.created_at >= datetime(?)
              AND ae.created_at < datetime(?)
              ${regionClauseAe}
            GROUP BY ae.series_slug, s.title
            ORDER BY (seriesViews + chapterStarts) DESC
            LIMIT 8`,
        ).bind(startAt, endAt, ...regionBindings),
        env.DB.prepare(
          `SELECT event_type AS eventType,
                  series_slug AS seriesSlug,
                  chapter_slug AS chapterSlug,
                  created_at AS createdAt
             FROM analytics_events
            WHERE created_at >= datetime('now', '-10 minutes')
            ORDER BY created_at DESC
            LIMIT 12`,
        ),
        env.DB.prepare(
          `SELECT
             (SELECT COUNT(*)
                FROM users
               WHERE created_at >= datetime(?)
                 AND created_at < datetime(?)) AS newUsers,
             (SELECT COUNT(*)
                FROM discussion_reactions
               WHERE created_at >= datetime(?)
                 AND created_at < datetime(?)) AS reactions,
             (SELECT COUNT(*)
                FROM series
               WHERE created_at >= datetime(?)
                 AND created_at < datetime(?)) AS newSeries,
             (SELECT COUNT(*)
                FROM teams
               WHERE created_at >= datetime(?)
                 AND created_at < datetime(?)) AS newTeams,
             (SELECT COUNT(*)
                FROM chapters
               WHERE created_at >= datetime(?)
                 AND created_at < datetime(?)) AS newChapters,
             (SELECT COUNT(*)
                FROM upload_sessions
               WHERE created_at >= datetime(?)
                 AND created_at < datetime(?)) AS uploadSessions,
             (SELECT COUNT(*)
                FROM user_store_items
               WHERE created_at >= datetime(?)
                 AND created_at < datetime(?)) AS storePurchases`,
        ).bind(
          startAt,
          endAt,
          startAt,
          endAt,
          startAt,
          endAt,
          startAt,
          endAt,
          startAt,
          endAt,
          startAt,
          endAt,
          startAt,
          endAt,
        ),
        env.DB.prepare(
          `SELECT ae.series_slug AS seriesSlug,
                  COALESCE(s.title, ae.series_slug) AS seriesTitle,
                  ae.chapter_slug AS chapterSlug,
                  COALESCE(c.chapter_number, ae.chapter_slug) AS chapterNumber,
                  COUNT(*) AS views,
                  COUNT(DISTINCT ae.session_id) AS uniqueViewers
             FROM analytics_events ae
             LEFT JOIN series s ON s.slug = ae.series_slug
             LEFT JOIN chapters c
               ON c.series_id = s.id
              AND c.slug = ae.chapter_slug
            WHERE ae.event_type = 'CHAPTER_START'
              AND ae.series_slug IS NOT NULL
              AND ae.chapter_slug IS NOT NULL
              AND ae.created_at >= datetime(?)
              AND ae.created_at < datetime(?)
              ${regionClauseAe}
            GROUP BY ae.series_slug, ae.chapter_slug, s.title, c.chapter_number
            ORDER BY views DESC, uniqueViewers DESC
            LIMIT 10`,
        ).bind(startAt, endAt, ...regionBindings),
        env.DB.prepare(
          `SELECT COALESCE(NULLIF(region_code, ''), 'Unknown') AS regionCode,
                  COUNT(*) AS views,
                  COUNT(DISTINCT session_id) AS uniqueViewers
             FROM analytics_events
            WHERE event_type IN
              ('HOME_VIEW', 'LATEST_VIEW', 'BROWSE_VIEW', 'SERIES_VIEW',
               'CHAPTER_START')
              AND created_at >= datetime(?)
              AND created_at < datetime(?)
            GROUP BY COALESCE(NULLIF(region_code, ''), 'Unknown')
            ORDER BY views DESC
            LIMIT 12`,
        ).bind(startAt, endAt),
        env.DB.prepare(
          `SELECT billing_currency AS currency,
                  provider,
                  COUNT(*) AS orders,
                  COALESCE(SUM(total_minor), 0) AS totalMinor
             FROM orders
            WHERE status = 'PAID'
              AND created_at >= datetime(?)
              AND created_at < datetime(?)
            GROUP BY billing_currency, provider
            ORDER BY orders DESC, billing_currency`,
        ).bind(startAt, endAt),
        env.DB.prepare(
          `SELECT
             (SELECT COUNT(*) FROM users) AS registeredUsers,
             (SELECT COALESCE(SUM(le.amount), 0)
                FROM ledger_entries le
                JOIN ledger_accounts la ON la.id = le.account_id
                JOIN ledger_transactions lt ON lt.id = le.transaction_id
               WHERE la.owner_type = 'USER'
                 AND la.currency = 'SHARDS'
                 AND le.amount > 0
                 AND lt.kind IN (
                   'CHAPTER_REWARD',
                   'COMMENT_REWARD',
                   'COMMENT_UPVOTE_REWARD',
                   'ROULETTE_REWARD'
                 )
                 AND lt.created_at >= datetime(?)
                 AND lt.created_at < datetime(?)) AS shardsCollected,
             (SELECT COALESCE(SUM(-le.amount), 0)
                FROM ledger_entries le
                JOIN ledger_accounts la ON la.id = le.account_id
                JOIN ledger_transactions lt ON lt.id = le.transaction_id
               WHERE la.owner_type = 'USER'
                 AND la.currency = 'SHARDS'
                 AND le.amount < 0
                 AND lt.kind IN ('ROULETTE_SPIN_PURCHASE', 'STORE_PURCHASE')
                 AND lt.created_at >= datetime(?)
                 AND lt.created_at < datetime(?)) AS shardsSpent,
             (SELECT COALESCE(SUM(le.amount), 0)
                FROM ledger_entries le
                JOIN ledger_accounts la ON la.id = le.account_id
               WHERE la.owner_type = 'USER'
                 AND la.currency = 'SHARDS') AS shardsOutstanding`,
        ).bind(startAt, endAt, startAt, endAt),
        env.DB.prepare(
          `SELECT s.id, s.slug, s.title,
                  COUNT(DISTINCT lt.id) AS purchases,
                  COALESCE(SUM(CASE
                    WHEN la.owner_type = 'PLATFORM' AND le.amount > 0
                    THEN le.amount ELSE 0 END), 0) AS pawCoinsSpent
             FROM ledger_transactions lt
             JOIN chapters c
               ON lt.reference_type = 'CHAPTER'
              AND lt.reference_id = c.id
             JOIN series s ON s.id = c.series_id
             LEFT JOIN ledger_entries le ON le.transaction_id = lt.id
             LEFT JOIN ledger_accounts la ON la.id = le.account_id
            WHERE lt.kind = 'CHAPTER_UNLOCK'
              AND lt.created_at >= datetime(?)
              AND lt.created_at < datetime(?)
            GROUP BY s.id, s.slug, s.title
            ORDER BY purchases DESC, pawCoinsSpent DESC
            LIMIT 12`,
        ).bind(startAt, endAt),
        env.DB.prepare(
          `SELECT u.id, u.display_name AS displayName, u.email,
                  (SELECT COUNT(*) FROM discussion_comments dc
                    WHERE dc.user_id = u.id
                      AND dc.moderation_status = 'VISIBLE'
                      AND dc.created_at >= datetime(?)
                      AND dc.created_at < datetime(?)) AS comments,
                  (SELECT COUNT(*) FROM roulette_spins rs
                    WHERE rs.user_id = u.id
                      AND rs.spun_at >= datetime(?)
                      AND rs.spun_at < datetime(?)) AS spins,
                  (SELECT COUNT(DISTINCT lt.id)
                     FROM ledger_transactions lt
                     JOIN ledger_entries le ON le.transaction_id = lt.id
                     JOIN ledger_accounts la ON la.id = le.account_id
                    WHERE lt.kind = 'CHAPTER_UNLOCK'
                      AND la.owner_type = 'USER'
                      AND la.owner_id = u.id
                      AND le.amount < 0
                      AND lt.created_at >= datetime(?)
                      AND lt.created_at < datetime(?)) AS purchases
             FROM users u
            WHERE comments > 0 OR spins > 0 OR purchases > 0
            ORDER BY purchases DESC, spins DESC, comments DESC
            LIMIT 20`,
        ).bind(
          startAt,
          endAt,
          startAt,
          endAt,
          startAt,
          endAt,
        ),
        env.DB.prepare(
          `SELECT
             (SELECT COALESCE(SUM(CASE WHEN event_type IN ('HOME_VIEW','LATEST_VIEW','BROWSE_VIEW','SERIES_VIEW') THEN 1 ELSE 0 END), 0) FROM analytics_events WHERE created_at >= datetime(?) AND created_at < datetime(?) ${regionClause}) AS views,
             (SELECT COUNT(*) FROM users WHERE created_at >= datetime(?) AND created_at < datetime(?)) AS newUsers,
             (SELECT COUNT(*) FROM chapters WHERE created_at >= datetime(?) AND created_at < datetime(?)) AS newChapters,
             (SELECT COUNT(*) FROM teams WHERE created_at >= datetime(?) AND created_at < datetime(?)) AS newTeams,
             (SELECT COUNT(*) FROM discussion_comments WHERE moderation_status = 'VISIBLE' AND created_at >= datetime(?) AND created_at < datetime(?)) AS comments,
             (SELECT COUNT(*) FROM discussion_reactions WHERE created_at >= datetime(?) AND created_at < datetime(?)) AS reactions`,
        ).bind(
          previousStartAt, startAt, ...regionBindings,
          previousStartAt, startAt,
          previousStartAt, startAt,
          previousStartAt, startAt,
          previousStartAt, startAt,
          previousStartAt, startAt,
        ),
      ])) as Array<D1Result<Record<string, unknown>>>;
      const eventSummary = (results[0].results?.[0] ?? {}) as Record<
        string,
        unknown
      >;
      const commentSummary = (results[2].results?.[0] ?? {}) as Record<
        string,
        unknown
      >;
      const unlockSummary = (results[4].results?.[0] ?? {}) as Record<
        string,
        unknown
      >;
      const orderSummary = (results[6].results?.[0] ?? {}) as Record<
        string,
        unknown
      >;
      const platformSummary = (results[9].results?.[0] ?? {}) as Record<
        string,
        unknown
      >;
      const economySummary = (results[13].results?.[0] ?? {}) as Record<
        string,
        unknown
      >;
      const previousSummary = (results[15].results?.[0] ?? {}) as Record<
        string,
        unknown
      >;
      const timelineByBucket = new Map(
        buckets.map((bucket) => [bucket.bucket, bucket]),
      );
      for (const row of results[1].results ?? []) {
        const bucket = timelineByBucket.get(String(row.bucket));
        if (!bucket) continue;
        bucket.readers = Number(row.readers ?? 0);
        bucket.views = Number(row.views ?? 0);
        bucket.chapterStarts = Number(row.chapterStarts ?? 0);
        bucket.chapterCompletions = Number(row.chapterCompletions ?? 0);
      }
      for (const row of results[3].results ?? []) {
        const bucket = timelineByBucket.get(String(row.bucket));
        if (bucket) bucket.comments = Number(row.comments ?? 0);
      }
      for (const row of results[5].results ?? []) {
        const bucket = timelineByBucket.get(String(row.bucket));
        if (!bucket) continue;
        bucket.unlocks = Number(row.unlocks ?? 0);
        bucket.onyxSpent = Number(row.onyxSpent ?? 0);
      }
      const chapterStarts = Number(eventSummary.chapterStarts ?? 0);
      const chapterCompletions = Number(
        eventSummary.chapterCompletions ?? 0,
      );
      return json(
        id,
        {
          range,
          selectedRegion: selectedRegion ?? "ALL",
          startAt,
          endAt,
          generatedAt: new Date().toISOString(),
          refreshAfterSeconds: 15,
          summary: {
            activeSessions5m: Number(eventSummary.activeSessions5m ?? 0),
            uniqueSessions: Number(eventSummary.uniqueSessions ?? 0),
            uniqueVisitors: Number(eventSummary.uniqueVisitors ?? 0),
            views: Number(eventSummary.views ?? 0),
            chapterStarts,
            chapterCompletions,
            completionRatePct: chapterStarts
              ? Math.round((chapterCompletions / chapterStarts) * 1000) / 10
              : 0,
            comments: Number(commentSummary.comments ?? 0),
            unlocks: Number(unlockSummary.unlocks ?? 0),
            onyxSpent: Number(unlockSummary.onyxSpent ?? 0),
            paidOrders: Number(orderSummary.paidOrders ?? 0),
            testCheckoutValueMinor: Number(
              orderSummary.testCheckoutValueMinor ?? 0,
            ),
            newUsers: Number(platformSummary.newUsers ?? 0),
            registeredUsers: Number(economySummary.registeredUsers ?? 0),
            newVisitors: Number(eventSummary.newVisitors ?? 0),
            shardsCollected: Number(economySummary.shardsCollected ?? 0),
            shardsSpent: Number(economySummary.shardsSpent ?? 0),
            shardsOutstanding: Number(
              economySummary.shardsOutstanding ?? 0,
            ),
            reactions: Number(platformSummary.reactions ?? 0),
            newSeries: Number(platformSummary.newSeries ?? 0),
            newTeams: Number(platformSummary.newTeams ?? 0),
            newChapters: Number(platformSummary.newChapters ?? 0),
            uploadSessions: Number(platformSummary.uploadSessions ?? 0),
            storePurchases: Number(platformSummary.storePurchases ?? 0),
          },
          previousSummary: {
            views: Number(previousSummary.views ?? 0),
            newUsers: Number(previousSummary.newUsers ?? 0),
            newChapters: Number(previousSummary.newChapters ?? 0),
            newTeams: Number(previousSummary.newTeams ?? 0),
            comments: Number(previousSummary.comments ?? 0),
            reactions: Number(previousSummary.reactions ?? 0),
          },
          timeline: buckets,
          regionScope: selectedRegion
            ? {
                region: selectedRegion,
                metrics: [
                  "activeSessions5m",
                  "uniqueSessions",
                  "uniqueVisitors",
                  "newVisitors",
                  "views",
                  "chapterStarts",
                  "chapterCompletions",
                  "timeline",
                  "topSeries",
                  "topChapters",
                ],
              }
            : null,
          topSeries: (results[7].results ?? []).map((row) => {
            const slug = String(row.slug);
            return {
              slug,
              title:
                row.title ??
                demoSeries.find((series) => series.slug === slug)?.title ??
                slug.replaceAll("-", " "),
              seriesViews: Number(row.seriesViews ?? 0),
              chapterStarts: Number(row.chapterStarts ?? 0),
              chapterCompletions: Number(row.chapterCompletions ?? 0),
            };
          }),
          liveEvents: results[8].results ?? [],
          topChapters: (results[10].results ?? []).map((row) => ({
            ...row,
            views: Number(row.views ?? 0),
            uniqueViewers: Number(row.uniqueViewers ?? 0),
          })),
          regions: (results[11].results ?? []).map((row) => ({
            ...row,
            views: Number(row.views ?? 0),
            uniqueViewers: Number(row.uniqueViewers ?? 0),
          })),
          purchasesByCurrency: (results[12].results ?? []).map((row) => ({
            ...row,
            orders: Number(row.orders ?? 0),
            totalMinor: Number(row.totalMinor ?? 0),
            isTest: String(row.provider).toUpperCase() === "TEST",
          })),
          purchaseRankedSeries: (results[14].results ?? []).map((row) => ({
            ...row,
            purchases: Number(row.purchases ?? 0),
            pawCoinsSpent: Number(row.pawCoinsSpent ?? 0),
          })),
          topUsers: (results[15].results ?? []).map((row) => ({
            ...row,
            comments: Number(row.comments ?? 0),
            spins: Number(row.spins ?? 0),
            purchases: Number(row.purchases ?? 0),
          })),
        },
        { headers: { "cache-control": "private, no-store" } },
      );
    }

    if (path === "admin/series-cover") {
      const actor = await requireActor();
      requireAdminCapability(actor, capabilityForAdminPath(path));
      if (!env.DB || !env.BUCKET) {
        throw new ApiError(
          503,
          "MEDIA_UNAVAILABLE",
          "Series cover storage is unavailable.",
        );
      }
      const seriesId = z
        .string()
        .min(3)
        .max(120)
        .parse(url.searchParams.get("id"));
      const row = await env.DB.prepare(
        "SELECT cover_key AS coverKey FROM series WHERE id = ? LIMIT 1",
      )
        .bind(seriesId)
        .first<{ coverKey: string | null }>();
      if (!row?.coverKey) {
        throw new ApiError(
          404,
          "COVER_NOT_FOUND",
          "This series does not have a cover yet.",
        );
      }
      const object = await env.BUCKET.get(row.coverKey);
      if (!object) {
        throw new ApiError(
          404,
          "COVER_NOT_FOUND",
          "This series cover is unavailable.",
        );
      }
      const headers = new Headers({
        "content-type":
          object.httpMetadata?.contentType ?? "application/octet-stream",
        "cache-control": "private, max-age=300",
        "x-content-type-options": "nosniff",
      });
      return new Response(object.body, { headers });
    }

    if (path === "workspace/series-cover") {
      const actor = await requireActor("upload.create");
      if (!env.DB || !env.BUCKET) {
        throw new ApiError(
          503,
          "MEDIA_UNAVAILABLE",
          "Series cover storage is unavailable.",
        );
      }
      const seriesId = z
        .string()
        .min(3)
        .max(120)
        .parse(url.searchParams.get("id"));
      const row =
        isAdminActor(actor)
          ? await env.DB.prepare(
              "SELECT cover_key AS coverKey FROM series WHERE id = ? LIMIT 1",
            )
              .bind(seriesId)
              .first<{ coverKey: string | null }>()
          : await env.DB.prepare(
              `SELECT s.cover_key AS coverKey
                 FROM series s
                 JOIN series_team_assignments sta ON sta.series_id = s.id
                 JOIN teams t ON t.id = sta.team_id
                 JOIN team_memberships tm ON tm.team_id = sta.team_id
                WHERE s.id = ?
                  AND tm.user_id = ?
                  AND tm.status = 'ACTIVE'
                  AND UPPER(tm.membership_role) IN
                    ('OWNER', 'LEADER', 'TEAM_LEADER', 'MANAGER', 'UPLOADER')
                  AND sta.can_upload = 1
                  AND t.is_archived = 0
                  AND t.verification_status <> 'SUSPENDED'
                LIMIT 1`,
            )
              .bind(seriesId, actor.id)
              .first<{ coverKey: string | null }>();
      if (!row?.coverKey) {
        throw new ApiError(
          404,
          "COVER_NOT_FOUND",
          "This series does not have an accessible cover.",
        );
      }
      const object = await env.BUCKET.get(row.coverKey);
      if (!object) {
        throw new ApiError(
          404,
          "COVER_NOT_FOUND",
          "This series cover is unavailable.",
        );
      }
      const headers = new Headers({
        "content-type":
          object.httpMetadata?.contentType ?? "application/octet-stream",
        "cache-control": "private, max-age=300",
        "x-content-type-options": "nosniff",
        vary: "cookie",
      });
      return new Response(object.body, { headers });
    }

    if (path === "admin/series") {
      const actor = await requireActor();
      requireAdminCapability(actor, capabilityForAdminPath(path));
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Series management is unavailable.",
        );
      }
      const result = await env.DB.prepare(
        `SELECT s.id,
                s.slug,
                s.title,
                s.native_title AS nativeTitle,
                s.type,
                s.status,
                s.access_type AS accessType,
                s.origin_country AS originCountry,
                s.original_language AS originalLanguage,
                s.reading_direction AS readingDirection,
                s.cover_key AS coverKey,
                s.is_published AS isPublished,
                s.revision,
                s.created_at AS createdAt,
                s.updated_at AS updatedAt,
                (SELECT COUNT(*) FROM chapters c WHERE c.series_id = s.id) AS chapterCount
           FROM series s
          ORDER BY s.updated_at DESC
          LIMIT 100`,
      ).all<{
        id: string;
        slug: string;
        title: string;
        nativeTitle: string | null;
        type: string;
        status: string;
        accessType: string;
        originCountry: string;
        originalLanguage: string;
        readingDirection: string;
        coverKey: string | null;
        isPublished: number;
        revision: number;
        createdAt: string;
        updatedAt: string;
        chapterCount: number;
      }>();
      return json(id, {
        data: result.results.map((item) => ({
          ...item,
          coverUrl: item.coverKey
            ? `/api/v1/admin/series-cover?id=${encodeURIComponent(String(item.id))}`
            : null,
        })),
      });
    }

    if (path === "admin/chapter-detail") {
      const actor = await requireActor();
      requireAdminCapability(actor, capabilityForAdminPath(path));
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Chapter management is unavailable.",
        );
      }
      const chapterId = z
        .string()
        .min(3)
        .max(120)
        .parse(url.searchParams.get("id"));
      const chapter = await env.DB.prepare(
        `SELECT c.id,
                c.slug,
                s.slug AS seriesSlug
           FROM chapters c
           JOIN series s ON s.id = c.series_id
          WHERE c.id = ?
          LIMIT 1`,
      )
        .bind(chapterId)
        .first<{
          id: string;
          slug: string;
          seriesSlug: string;
        }>();
      if (!chapter) {
        throw new ApiError(
          404,
          "CHAPTER_NOT_FOUND",
          "This chapter no longer exists.",
        );
      }
      const [pages, comments] = await env.DB.batch([
        env.DB.prepare(
          `SELECT id,
                  page_index AS pageIndex,
                  width,
                  height,
                  processing_status AS processingStatus
             FROM chapter_pages
            WHERE chapter_id = ?
            ORDER BY page_index`,
        ).bind(chapterId),
        env.DB.prepare(
          `SELECT dc.id,
                  dc.body,
                  dc.pinned_at AS pinnedAt,
                  dc.created_at AS createdAt,
                  u.display_name AS authorName,
                  (SELECT COUNT(*)
                     FROM reports r
                    WHERE r.target_type = 'COMMENT'
                      AND r.target_id = dc.id
                      AND r.status = 'OPEN') AS openReports
             FROM discussion_comments dc
             JOIN users u ON u.id = dc.user_id
            WHERE dc.series_slug = ?
              AND dc.chapter_slug = ?
              AND dc.parent_id IS NULL
              AND dc.moderation_status = 'VISIBLE'
            ORDER BY dc.pinned_at IS NOT NULL DESC, dc.created_at DESC
            LIMIT 8`,
        ).bind(chapter.seriesSlug, chapter.slug),
      ]);
      return json(
        id,
        {
          data: {
            pages: pages.results,
            comments: comments.results,
          },
        },
        {
          headers: {
            "cache-control": "private, no-store",
            vary: "cookie",
          },
        },
      );
    }

    if (path === "admin/chapters") {
      const actor = await requireActor();
      requireAdminCapability(actor, capabilityForAdminPath(path));
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Chapter access management is unavailable.",
        );
      }
      const result = await env.DB.prepare(
        `SELECT c.id,
                c.slug,
                c.chapter_number AS chapterNumber,
                c.title,
                c.volume,
                c.language,
                c.format,
                c.version,
                c.release_notes AS releaseNotes,
                c.state,
                c.access_type AS accessType,
                c.access_type AS effectiveAccessType,
                c.price_onyx AS priceOnyx,
                c.published_at AS publishedAt,
                c.page_count AS pageCount,
                c.revision,
                c.updated_at AS updatedAt,
                s.id AS seriesId,
                s.slug AS seriesSlug,
                s.title AS seriesTitle,
                t.name AS teamName,
                (SELECT COUNT(*)
                   FROM entitlements e
                  WHERE e.chapter_id = c.id
                    AND e.revoked_at IS NULL
                    AND e.starts_at <= CURRENT_TIMESTAMP
                    AND (e.expires_at IS NULL OR e.expires_at > CURRENT_TIMESTAMP)
                ) AS entitlementCount
           FROM chapters c
           JOIN series s ON s.id = c.series_id
           LEFT JOIN teams t ON t.id = c.team_id
          ORDER BY s.title COLLATE NOCASE,
                   CAST(c.chapter_number AS REAL) DESC,
                   c.version DESC,
                   c.updated_at DESC,
                   c.id DESC
          LIMIT 200`,
      ).all();
      const metrics = await env.DB.prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(CASE
                  WHEN access_type = 'PAID'
                  THEN 1 ELSE 0 END), 0) AS paid,
                0 AS scheduled,
                (SELECT COUNT(*)
                   FROM entitlements
                  WHERE revoked_at IS NULL
                    AND starts_at <= CURRENT_TIMESTAMP
                    AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
                ) AS readerUnlocks
           FROM chapters`,
      ).first<{
        total: number;
        paid: number;
        scheduled: number;
        readerUnlocks: number;
      }>();
      return json(
        id,
        {
          data: result.results.map((chapter) => ({
            ...chapter,
            chapterNumber: normalizeChapterNumber(
              String(
                (chapter as { chapterNumber: string }).chapterNumber,
              ),
            ),
          })),
          metrics: {
            total: Number(metrics?.total ?? 0),
            paid: Number(metrics?.paid ?? 0),
            scheduled: Number(metrics?.scheduled ?? 0),
            readerUnlocks: Number(metrics?.readerUnlocks ?? 0),
          },
          generatedAt: new Date().toISOString(),
        },
        { headers: { "cache-control": "private, no-store" } },
      );
    }

    if (path === "admin/teams") {
      const actor = await requireActor();
      requireAdminCapability(actor, capabilityForAdminPath(path));
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Team management is unavailable.",
        );
      }
      const result = await env.DB.prepare(
        `SELECT t.id,
                t.slug,
                t.name,
                t.description,
                t.verification_status AS verificationStatus,
                t.revision,
                t.created_at AS createdAt,
                t.updated_at AS updatedAt,
                (SELECT COUNT(*) FROM team_memberships tm
                  WHERE tm.team_id = t.id AND tm.status = 'ACTIVE') AS memberCount
           FROM teams t
          ORDER BY t.updated_at DESC
          LIMIT 100`,
      ).all();
      return json(id, { data: result.results });
    }

    if (path === "admin/users") {
      const actor = await requireActor();
      requireAdminCapability(actor, capabilityForAdminPath(path));
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "User management is unavailable.",
        );
      }
      const [result, recentActivityResult, permissionRulesResult] = await Promise.all([
        env.DB.prepare(
          `SELECT u.id,
                  u.email,
                  u.display_name AS displayName,
                  u.primary_role AS primaryRole,
                  u.status,
                  u.access_revision AS accessRevision,
                  COALESCE((
                    SELECT GROUP_CONCAT(ur.role, ',')
                      FROM user_roles ur
                     WHERE ur.user_id = u.id
                  ), u.primary_role) AS rolesCsv,
                  u.email_verified_at AS emailVerifiedAt,
                  u.created_at AS createdAt,
                  u.updated_at AS updatedAt,
                  up.username AS avatarUsername,
                  up.revision AS avatarRevision,
                  CASE WHEN up.avatar_key IS NULL THEN 0 ELSE 1 END AS hasAvatar,
                  (SELECT COUNT(*) FROM team_memberships tm
                    WHERE tm.user_id = u.id AND tm.status = 'ACTIVE') AS teamCount,
                  (SELECT GROUP_CONCAT(t.name, '|||')
                     FROM team_memberships tm
                     JOIN teams t ON t.id = tm.team_id
                    WHERE tm.user_id = u.id AND tm.status = 'ACTIVE') AS teamNamesCsv
             FROM users u
             LEFT JOIN user_profiles up ON up.user_id = u.id
            ORDER BY u.updated_at DESC
            LIMIT 150`,
        ).all<Record<string, unknown>>(),
        env.DB.prepare(
          `SELECT al.id, al.actor_user_id AS userId, al.action,
                  al.target_type AS targetType, al.target_id AS targetId,
                  al.result, al.created_at AS createdAt,
                  s.title AS seriesTitle, c.chapter_number AS chapterNumber
             FROM audit_logs al
             LEFT JOIN chapters c
               ON al.target_type = 'CHAPTER' AND c.id = al.target_id
             LEFT JOIN series s ON s.id = c.series_id
            WHERE al.actor_user_id IS NOT NULL
            ORDER BY datetime(al.created_at) DESC, al.id DESC
            LIMIT 450`,
        ).all<Record<string, unknown>>(),
        env.DB.prepare(
          "SELECT role, capability, allowed FROM role_permission_rules",
        ).all<{ role: string; capability: string; allowed: number }>(),
      ]);
      const recentActivityByUser = new Map<
        string,
        Array<Record<string, unknown>>
      >();
      for (const activity of recentActivityResult.results) {
        const userId = String(activity.userId ?? "");
        if (!userId) continue;
        const current = recentActivityByUser.get(userId) ?? [];
        if (current.length >= 3) continue;
        current.push(activity);
        recentActivityByUser.set(userId, current);
      }
      return json(id, {
        data: result.results.map((entry) => {
          const row = entry as Record<string, unknown> & {
            avatarUsername?: string | null;
            avatarRevision?: number | null;
            hasAvatar?: number;
            rolesCsv?: string;
          };
          const roles = String(row.rolesCsv ?? row.primaryRole ?? "USER")
            .split(",")
            .filter(Boolean);
          const roleRules = permissionRulesResult.results.filter((rule) =>
            roles.includes(rule.role),
          );
          const effectivePermissionDetails = ADMIN_PERMISSION_REGISTRY.map(
            ([capability]) => {
              const matching = roleRules.filter(
                (rule) => rule.capability === capability,
              );
              const denied = matching.some((rule) => !rule.allowed);
              const allowed = roles.includes("OWNER") || (!denied && (
                matching.some((rule) => Boolean(rule.allowed)) ||
                canAny(roles, capability)
              ));
              return {
                capability,
                allowed,
                source: roles.includes("OWNER")
                  ? "OWNER"
                  : matching.length
                    ? denied ? "DENY_OVERRIDE" : "ALLOW_OVERRIDE"
                    : "ROLE_DEFAULT",
              };
            },
          );
          return {
            ...row,
            roles,
            effectivePermissions: effectivePermissionDetails
              .filter((permission) => permission.allowed)
              .map((permission) => permission.capability),
            effectivePermissionDetails,
            teamNames: String(row.teamNamesCsv ?? "")
              .split("|||")
              .map((teamName) => teamName.trim())
              .filter(Boolean),
            recentActivity: recentActivityByUser.get(String(row.id)) ?? [],
            avatarUrl:
              row.hasAvatar && row.avatarUsername
                ? `/api/v1/profile-media?username=${encodeURIComponent(row.avatarUsername)}&slot=avatar&v=${Number(row.avatarRevision ?? 1)}&admin=1`
                : null,
          };
        }),
        currentActorId: actor.id,
      });
    }

    if (path === "admin/payouts") {
      const actor = await requireActor();
      requireAdminCapability(actor, capabilityForAdminPath(path));
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Payout reporting is temporarily unavailable.",
        );
      }
      const query = (url.searchParams.get("query") ?? "").trim().slice(0, 160);
      const search = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
      const [summary, teamsResult, flag] = await Promise.all([
        env.DB.prepare(
          `WITH canonical_receipts AS (
             SELECT team_id AS teamId, amount, created_at AS createdAt
               FROM chapter_unlock_receipts
              WHERE team_id IS NOT NULL
                AND currency = 'ONYX'
             UNION ALL
             SELECT team_id, coin_amount, created_at
               FROM team_support_receipts
           ),
           posted_team_balances AS (
             SELECT la.owner_id AS teamId,
                    COALESCE(SUM(le.amount), 0) AS postedBalanceOnyx
               FROM ledger_accounts la
               LEFT JOIN ledger_entries le ON le.account_id = la.id
              WHERE la.owner_type = 'TEAM'
                AND la.currency = 'ONYX'
                AND la.account_type IN ('EARNED', 'SUPPORT')
              GROUP BY la.owner_id
           )
           SELECT COALESCE((SELECT SUM(amount) FROM canonical_receipts), 0)
                    AS totalReceivedOnyx,
                  COALESCE(SUM(posted_team_balances.postedBalanceOnyx), 0)
                    AS postedBalanceOnyx,
                  COUNT(DISTINCT CASE
                    WHEN posted_team_balances.postedBalanceOnyx <> 0
                    THEN posted_team_balances.teamId END) AS teamsWithBalances
             FROM posted_team_balances`,
        ).first<Record<string, unknown>>(),
        env.DB.prepare(
          `SELECT t.id, t.slug, t.name,
                  t.verification_status AS verificationStatus,
                  COALESCE((
                    SELECT SUM(cur.amount)
                      FROM chapter_unlock_receipts cur
                     WHERE cur.team_id = t.id
                       AND cur.currency = 'ONYX'
                  ), 0) + COALESCE((
                    SELECT SUM(support.coin_amount)
                      FROM team_support_receipts support
                     WHERE support.team_id = t.id
                  ), 0) AS totalReceivedOnyx,
                  COALESCE((
                    SELECT SUM(le.amount)
                      FROM ledger_accounts la
                      LEFT JOIN ledger_entries le ON le.account_id = la.id
                     WHERE la.owner_type = 'TEAM'
                       AND la.owner_id = t.id
                       AND la.currency = 'ONYX'
                       AND la.account_type IN ('EARNED', 'SUPPORT')
                  ), 0) AS postedBalanceOnyx,
                  (SELECT MAX(receipt.createdAt)
                     FROM (
                       SELECT created_at AS createdAt
                         FROM chapter_unlock_receipts
                        WHERE team_id = t.id
                          AND currency = 'ONYX'
                       UNION ALL
                       SELECT created_at
                         FROM team_support_receipts
                        WHERE team_id = t.id
                     ) receipt) AS lastEarnedAt
             FROM teams t
            WHERE t.is_archived = 0
              AND (? = '' OR t.name LIKE ? ESCAPE '\\'
                   OR t.slug LIKE ? ESCAPE '\\')
              AND (
                EXISTS (
                  SELECT 1 FROM chapter_unlock_receipts cur
                   WHERE cur.team_id = t.id AND cur.currency = 'ONYX'
                )
                OR EXISTS (
                  SELECT 1 FROM team_support_receipts support
                   WHERE support.team_id = t.id
                )
                OR EXISTS (
                  SELECT 1 FROM ledger_accounts la
                   WHERE la.owner_type = 'TEAM'
                     AND la.owner_id = t.id
                     AND la.currency = 'ONYX'
                     AND la.account_type IN ('EARNED', 'SUPPORT')
                )
              )
            ORDER BY totalReceivedOnyx DESC, t.name ASC
            LIMIT 100`,
        )
          .bind(query, search, search)
          .all<Record<string, unknown>>(),
        env.DB.prepare(
          "SELECT enabled FROM feature_flags WHERE key = 'team_payouts' LIMIT 1",
        ).first<{ enabled: number | boolean }>(),
      ]);
      return json(
        id,
        {
          summary: {
            totalReceivedOnyx: Number(summary?.totalReceivedOnyx ?? 0),
            postedBalanceOnyx: Number(summary?.postedBalanceOnyx ?? 0),
            pendingOnyx: null,
            withdrawnOnyx: null,
            teamsWithBalances: Number(summary?.teamsWithBalances ?? 0),
            payoutRecordCount: 0,
          },
          teams: teamsResult.results,
          records: [],
          payoutsEnabled: Boolean(flag?.enabled),
          payoutLifecycleAvailable: false,
        },
        { headers: { "cache-control": "private, no-store" } },
      );
    }

    if (path === "admin/user-control") {
      const actor = await requireActor();
      const view = z
        .enum(["overview", "activity", "purchases", "balances"])
        .default("overview")
        .parse(url.searchParams.get("view") ?? "overview");
      const viewCapability = {
        overview: "users.manage",
        activity: "admin.activity.read",
        purchases: "finance.transactions.read",
        balances: "finance.balances.manage",
      }[view];
      requireAdminCapability(actor, viewCapability);
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Users Control is temporarily unavailable.",
        );
      }
      const query = (url.searchParams.get("query") ?? "").trim().slice(0, 160);
      const activityPage = z.coerce
        .number()
        .int()
        .min(1)
        .max(100_000)
        .default(1)
        .parse(url.searchParams.get("page") ?? 1);
      const activityLimit = z.coerce
        .number()
        .int()
        .min(10)
        .max(100)
        .default(25)
        .parse(url.searchParams.get("limit") ?? 25);
      const activityResult = z
        .string()
        .trim()
        .min(1)
        .max(100)
        .default("ALL")
        .parse(url.searchParams.get("result") ?? "ALL");
      const historyUserId = z
        .string()
        .trim()
        .min(3)
        .max(160)
        .optional()
        .parse(url.searchParams.get("historyUserId") || undefined);
      const search = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
      const summaryResults = await env.DB.batch([
        env.DB.prepare("SELECT COUNT(*) AS count FROM users"),
        env.DB.prepare(
          "SELECT COUNT(*) AS count FROM users WHERE created_at >= datetime('now', '-30 days')",
        ),
        env.DB.prepare(
          "SELECT COUNT(*) AS count FROM users WHERE status = 'SUSPENDED'",
        ),
        env.DB.prepare(
          `SELECT COUNT(DISTINCT user_id) AS count
             FROM reading_progress
            WHERE updated_at >= datetime('now', '-30 days')`,
        ),
        env.DB.prepare(
          `SELECT COUNT(*) AS count
             FROM ledger_transactions
            WHERE kind = 'CHAPTER_UNLOCK'`,
        ),
      ]);
      const summary = {
        registeredUsers: countValue(summaryResults[0]),
        newUsers30d: countValue(summaryResults[1]),
        suspendedUsers: countValue(summaryResults[2]),
        activeReaders30d: countValue(summaryResults[3]),
        purchasedChapters: countValue(summaryResults[4]),
      };
      let rows: unknown[] = [];
      let balanceHistory: unknown[] = [];
      let balanceSummary: Record<string, number | null> | null = null;
      let pagination:
        | { page: number; limit: number; total: number; pages: number }
        | undefined;
      let activityResults: string[] | undefined;
      if (view === "balances") {
        const rowsPromise = env.DB.prepare(
          `SELECT u.id, u.display_name AS displayName, u.email, u.status,
                  u.primary_role AS primaryRole,
                  up.username, up.revision AS avatarRevision,
                  CASE WHEN up.avatar_key IS NULL THEN 0 ELSE 1 END AS hasAvatar,
                  COALESCE((
                    SELECT SUM(le.amount)
                      FROM ledger_entries le
                      JOIN ledger_accounts la ON la.id = le.account_id
                     WHERE la.owner_type = 'USER'
                       AND la.owner_id = u.id
                       AND la.currency = 'ONYX'
                       AND (
                         la.account_type = 'AVAILABLE'
                         OR la.account_type LIKE 'PAYMENT_DEBT:%'
                       )
                  ), 0) AS onyxBalance,
                  COALESCE((
                    SELECT SUM(le.amount)
                      FROM ledger_entries le
                      JOIN ledger_accounts la ON la.id = le.account_id
                     WHERE la.owner_type = 'USER'
                       AND la.owner_id = u.id
                       AND la.currency = 'SHARDS'
                       AND la.account_type = 'AVAILABLE'
                  ), 0) AS shardsBalance
             FROM users u
             LEFT JOIN user_profiles up ON up.user_id = u.id
            WHERE (? = '' OR u.display_name LIKE ? ESCAPE '\\'
                    OR u.email LIKE ? ESCAPE '\\')
            ORDER BY u.updated_at DESC
            LIMIT 100`,
        )
          .bind(query, search, search)
          .all<Record<string, unknown>>();
        const totalsPromise = env.DB.prepare(
          `WITH user_balances AS (
             SELECT la.owner_id AS ownerId, la.currency,
                    COALESCE(SUM(le.amount), 0) AS balance
              FROM ledger_accounts la
               LEFT JOIN ledger_entries le ON le.account_id = la.id
              WHERE la.owner_type = 'USER'
                AND (
                  la.account_type = 'AVAILABLE'
                  OR (la.currency = 'ONYX' AND la.account_type LIKE 'PAYMENT_DEBT:%')
                )
              GROUP BY la.owner_id, la.currency
           )
           SELECT COALESCE(SUM(CASE WHEN currency = 'ONYX' THEN balance ELSE 0 END), 0) AS onyxBalance,
                  COALESCE(SUM(CASE WHEN currency = 'SHARDS' THEN balance ELSE 0 END), 0) AS shardsBalance,
                  COUNT(DISTINCT CASE WHEN balance <> 0 THEN ownerId END) AS fundedAccounts
             FROM user_balances`,
        ).first<Record<string, unknown>>();
        const historyPromise = historyUserId
          ? env.DB.prepare(
              `SELECT lt.id, lt.memo AS reason, lt.created_at AS createdAt,
                      la.currency, le.amount AS delta
                 FROM ledger_transactions lt
                 JOIN ledger_entries le ON le.transaction_id = lt.id
                 JOIN ledger_accounts la ON la.id = le.account_id
                WHERE lt.kind = 'OWNER_BALANCE_ADJUSTMENT'
                  AND lt.reference_type = 'USER'
                  AND lt.reference_id = ?
                  AND la.owner_type = 'USER'
                  AND la.owner_id = ?
                ORDER BY datetime(lt.created_at) DESC, lt.id DESC
                LIMIT 25`,
            )
              .bind(historyUserId, historyUserId)
              .all()
          : Promise.resolve({ results: [] as unknown[] });
        const [result, totals, history] = await Promise.all([
          rowsPromise,
          totalsPromise,
          historyPromise,
        ]);
        rows = result.results.map((row) => ({
          ...row,
          avatarUrl:
            row.hasAvatar && row.username
              ? `/api/v1/profile-media?username=${encodeURIComponent(String(row.username))}&slot=avatar&v=${Number(row.avatarRevision ?? 1)}&admin=1`
              : null,
        }));
        balanceSummary = {
          onyxBalance: Number(totals?.onyxBalance ?? 0),
          shardsBalance: Number(totals?.shardsBalance ?? 0),
          pendingOnyx: null,
          pendingShards: null,
          withdrawnOnyx: null,
          withdrawnShards: null,
          fundedAccounts: Number(totals?.fundedAccounts ?? 0),
        };
        balanceHistory = history.results;
      } else if (view === "purchases") {
        const result = await env.DB.prepare(
          `SELECT o.id, 'ORDER' AS kind, u.display_name AS displayName,
                  u.email, o.status, o.total_minor AS amount,
                  o.billing_currency AS currency, o.created_at AS createdAt
             FROM orders o
             JOIN users u ON u.id = o.user_id
            WHERE (? = '' OR u.display_name LIKE ? ESCAPE '\\'
                    OR u.email LIKE ? ESCAPE '\\' OR o.id LIKE ? ESCAPE '\\')
           UNION ALL
           SELECT lt.id, 'CHAPTER_UNLOCK' AS kind,
                  u.display_name AS displayName, u.email,
                  'COMPLETED' AS status,
                  -buyer_entry.amount AS amount,
                  buyer_account.currency AS currency,
                  lt.created_at AS createdAt
             FROM ledger_transactions lt
             JOIN ledger_entries buyer_entry
               ON buyer_entry.transaction_id = lt.id
              AND buyer_entry.amount < 0
             JOIN ledger_accounts buyer_account
               ON buyer_account.id = buyer_entry.account_id
              AND buyer_account.owner_type = 'USER'
             JOIN users u ON u.id = buyer_account.owner_id
            WHERE lt.kind = 'CHAPTER_UNLOCK'
              AND (? = '' OR u.display_name LIKE ? ESCAPE '\\'
                    OR u.email LIKE ? ESCAPE '\\' OR lt.id LIKE ? ESCAPE '\\')
            ORDER BY createdAt DESC
            LIMIT 150`,
        )
          .bind(query, search, search, search, query, search, search, search)
          .all();
        rows = result.results;
      } else if (view === "activity") {
        const activityOffset = (activityPage - 1) * activityLimit;
        const [result, resultOptions] = await Promise.all([
          env.DB.prepare(
            `SELECT activity.*, COUNT(*) OVER() AS totalCount
               FROM (
                 SELECT al.id, al.action AS activityType,
                        al.target_type AS targetType,
                        al.target_id AS targetId, al.result,
                        al.created_at AS createdAt,
                        u.display_name AS displayName, u.email,
                        s.title AS seriesTitle,
                        c.chapter_number AS chapterNumber
                   FROM audit_logs al
                   LEFT JOIN users u ON u.id = al.actor_user_id
                   LEFT JOIN chapters c
                     ON al.target_type = 'CHAPTER' AND c.id = al.target_id
                   LEFT JOIN series s ON s.id = c.series_id
                 UNION ALL
                 SELECT 'read:' || rp.user_id || ':' || rp.chapter_id,
                        'CHAPTER_READ', 'CHAPTER', rp.chapter_id,
                        CASE WHEN rp.completed_at IS NULL
                          THEN 'IN_PROGRESS' ELSE 'COMPLETED' END,
                        rp.updated_at, u.display_name, u.email,
                        s.title, c.chapter_number
                   FROM reading_progress rp
                   JOIN users u ON u.id = rp.user_id
                   JOIN chapters c ON c.id = rp.chapter_id
                   JOIN series s ON s.id = c.series_id
                 UNION ALL
                 SELECT dc.id, 'COMMENT_CREATED', 'COMMENT', dc.id,
                        dc.moderation_status, dc.created_at,
                        u.display_name, u.email,
                        s.title, c.chapter_number
                   FROM discussion_comments dc
                   JOIN users u ON u.id = dc.user_id
                   LEFT JOIN series s ON s.slug = dc.series_slug
                   LEFT JOIN chapters c
                     ON c.series_id = s.id AND c.slug = dc.chapter_slug
                 UNION ALL
                 SELECT rs.id, 'ROULETTE_SPIN', 'ROULETTE_SPIN', rs.id,
                        rs.reward_type, rs.spun_at,
                        u.display_name, u.email,
                        NULL, NULL
                   FROM roulette_spins rs
                   JOIN users u ON u.id = rs.user_id
                 UNION ALL
                 SELECT lt.id, 'CHAPTER_UNLOCK', 'CHAPTER', lt.reference_id,
                        'COMPLETED', lt.created_at,
                        u.display_name, u.email,
                        s.title, c.chapter_number
                   FROM ledger_transactions lt
                   JOIN ledger_entries buyer_entry
                     ON buyer_entry.transaction_id = lt.id
                    AND buyer_entry.amount < 0
                   JOIN ledger_accounts buyer_account
                     ON buyer_account.id = buyer_entry.account_id
                    AND buyer_account.owner_type = 'USER'
                   JOIN users u ON u.id = buyer_account.owner_id
                   JOIN chapters c ON c.id = lt.reference_id
                   JOIN series s ON s.id = c.series_id
                  WHERE lt.kind = 'CHAPTER_UNLOCK'
               ) activity
              WHERE (? = '' OR activity.displayName LIKE ? ESCAPE '\\'
                      OR activity.email LIKE ? ESCAPE '\\'
                      OR activity.activityType LIKE ? ESCAPE '\\'
                      OR activity.seriesTitle LIKE ? ESCAPE '\\'
                      OR activity.chapterNumber LIKE ? ESCAPE '\\')
                AND (? = 'ALL' OR activity.result = ?)
              ORDER BY activity.createdAt DESC
              LIMIT ? OFFSET ?`,
          )
            .bind(
              query,
              search,
              search,
              search,
              search,
              search,
              activityResult,
              activityResult,
              activityLimit,
              activityOffset,
            )
            .all<Record<string, unknown>>(),
          env.DB.prepare(
            `SELECT result FROM (
               SELECT DISTINCT result FROM audit_logs WHERE result IS NOT NULL
               UNION SELECT 'IN_PROGRESS'
               UNION SELECT 'COMPLETED'
               UNION SELECT DISTINCT moderation_status FROM discussion_comments
               UNION SELECT DISTINCT reward_type FROM roulette_spins
             )
             WHERE result IS NOT NULL AND result <> ''
             ORDER BY result COLLATE NOCASE`,
          ).all<{ result: string }>(),
        ]);
        const total = Number(result.results[0]?.totalCount ?? 0);
        rows = result.results.map((row) => {
          const sanitized = { ...row };
          delete sanitized.totalCount;
          return sanitized;
        });
        pagination = {
          page: activityPage,
          limit: activityLimit,
          total,
          pages: Math.max(1, Math.ceil(total / activityLimit)),
        };
        activityResults = resultOptions.results.map((entry) => entry.result);
      } else {
        const result = await env.DB.prepare(
          `SELECT u.id, u.display_name AS displayName, u.email, u.status,
                  u.created_at AS createdAt,
                  COUNT(DISTINCT dc.id) AS comments,
                  COUNT(DISTINCT rs.id) AS spins,
                  COUNT(DISTINCT rp.chapter_id) AS chaptersRead,
                  (SELECT COUNT(DISTINCT lt.id)
                     FROM ledger_transactions lt
                     JOIN ledger_entries buyer_entry
                       ON buyer_entry.transaction_id = lt.id
                      AND buyer_entry.amount < 0
                     JOIN ledger_accounts buyer_account
                       ON buyer_account.id = buyer_entry.account_id
                      AND buyer_account.owner_type = 'USER'
                    WHERE lt.kind = 'CHAPTER_UNLOCK'
                      AND buyer_account.owner_id = u.id) AS purchases
             FROM users u
             LEFT JOIN discussion_comments dc ON dc.user_id = u.id
             LEFT JOIN roulette_spins rs ON rs.user_id = u.id
             LEFT JOIN reading_progress rp
               ON rp.user_id = u.id AND rp.completed_at IS NOT NULL
            GROUP BY u.id
            ORDER BY purchases DESC, chaptersRead DESC, comments DESC
            LIMIT 50`,
        ).all();
        rows = result.results;
      }
      return json(
        id,
        {
          view,
          summary,
          rows,
          balanceSummary,
          balanceHistory,
          pagination,
          activityResults,
          ownerCanAdjust: actor.roles.includes("OWNER"),
        },
        { headers: { "cache-control": "private, no-store" } },
      );
    }

    if (path === "admin/audit") {
      let actor: Awaited<ReturnType<typeof getActor>> = null;
      try {
        actor = await requireActor();
        requireOwner(actor);
      } catch (error) {
        if (actor) {
          await writeAudit(actor, id, {
            action: "audit.access.denied",
            category: "AUTHENTICATION_SECURITY",
            sourceArea: "AUDIT_LOG_LEGACY",
            result: "DENIED",
            targetType: "AUDIT_LOG",
            targetId: "global",
            targetLabel: "Platform audit log",
            reason: "The account did not have owner authorization.",
          }).catch(() => undefined);
        }
        throw error;
      }
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Audit history is unavailable.",
        );
      }
      const result = await env.DB.prepare(
        `SELECT al.id,
                al.action,
                al.target_type AS targetType,
                al.target_id AS targetId,
                al.reason,
                al.request_id AS requestId,
                al.created_at AS createdAt,
                u.display_name AS actorName,
                u.email AS actorEmail
           FROM audit_logs al
           LEFT JOIN users u ON u.id = al.actor_user_id
          ORDER BY al.created_at DESC
          LIMIT 120`,
      ).all();
      return json(id, { data: result.results }, {
        headers: { "cache-control": "private, no-store", vary: "cookie" },
      });
    }

    if (path === "admin/reports") {
      const actor = await requireActor();
      requireAdminCapability(actor, capabilityForAdminPath(path));
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Moderation reports are unavailable.",
        );
      }
      const result = await env.DB.prepare(
        `SELECT r.id,
                r.target_type AS targetType,
                r.target_id AS targetId,
                r.category,
                r.detail,
                r.status,
                r.created_at AS createdAt,
                u.display_name AS reporterName
           FROM reports r
           LEFT JOIN users u ON u.id = r.reporter_user_id
          ORDER BY CASE WHEN r.status = 'OPEN' THEN 0 ELSE 1 END,
                   r.created_at DESC
          LIMIT 100`,
      ).all();
      return json(id, { data: result.results });
    }

    if (path === "admin/store") {
      const actor = await requireActor();
      requireAdminCapability(actor, capabilityForAdminPath(path));
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Store Management is temporarily unavailable.",
        );
      }
      const categoryValues = (url.searchParams.get("categories") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter((value) =>
          [
            "PROFILE_BANNER",
            "PROFILE_FRAME",
            "USERNAME_DECORATION",
            "COMMENT_EFFECT",
            "COMMENT_GRADIENT",
            "SEASONAL_PROFILE",
            "LOGO_EFFECT",
          ].includes(value),
        );
      const itemQuery = z.string().trim().max(160).catch("").parse(
        url.searchParams.get("query") ?? "",
      );
      const itemStatus = z
        .enum(["ALL", "DRAFT", "PUBLISHED", "HIDDEN"])
        .catch("ALL")
        .parse(url.searchParams.get("status"));
      const page = z.coerce.number().int().min(1).max(10_000).catch(1).parse(
        url.searchParams.get("page"),
      );
      const limit = z.coerce.number().int().min(1).max(50).catch(24).parse(
        url.searchParams.get("limit"),
      );
      const categoryClause = categoryValues.length
        ? `AND si.category IN (${categoryValues.map(() => "?").join(",")})`
        : "";
      const searchClause = itemQuery
        ? "AND (LOWER(si.name) LIKE ? OR LOWER(si.description) LIKE ? OR LOWER(si.slug) LIKE ?)"
        : "";
      const statusClause =
        itemStatus === "DRAFT"
          ? "AND si.is_published = 0"
          : itemStatus === "PUBLISHED"
            ? "AND si.is_published = 1"
            : itemStatus === "HIDDEN"
              ? "AND si.is_hidden = 1"
              : "";
      const searchTerm = `%${itemQuery.toLocaleLowerCase("en-US")}%`;
      const itemBindings = [
        ...categoryValues,
        ...(itemQuery ? [searchTerm, searchTerm, searchTerm] : []),
      ];
      const [collections, items, itemCount] = await Promise.all([
        env.DB.prepare(
          `SELECT id,
                  slug,
                  name,
                  description,
                  theme_key AS themeKey,
                  is_seasonal AS isSeasonal,
                  enabled,
                  starts_at AS startsAt,
                  ends_at AS endsAt,
                  sort_order AS sortOrder,
                  revision,
                  created_at AS createdAt,
                  updated_at AS updatedAt
             FROM store_collections
            ORDER BY sort_order ASC, name COLLATE NOCASE`,
        ).all(),
        env.DB.prepare(
          `SELECT si.id,
                  si.slug,
                  si.collection_id AS collectionId,
                  sc.name AS collectionName,
                  si.name,
                  si.description,
                  si.category,
                  si.price_onyx AS priceOnyx,
                  si.price_currency AS priceCurrency,
                  si.preview_key AS previewKey,
                  si.preview_config_json AS previewConfigJson,
                  si.is_published AS isPublished,
                  si.is_hidden AS isHidden,
                  si.sort_order AS sortOrder,
                  si.revision,
                  si.created_at AS createdAt,
                  si.updated_at AS updatedAt,
                  (SELECT COUNT(*)
                     FROM user_store_items usi
                    WHERE usi.item_id = si.id) AS purchaseCount
             FROM store_items si
             JOIN store_collections sc ON sc.id = si.collection_id
            WHERE si.archived_at IS NULL
              ${categoryClause}
              ${searchClause}
              ${statusClause}
            ORDER BY sc.sort_order ASC, si.sort_order ASC, si.name COLLATE NOCASE
            LIMIT ? OFFSET ?`,
        )
          .bind(
            ...itemBindings,
            limit,
            (page - 1) * limit,
          )
          .all<{
          id: string;
          slug: string;
          collectionId: string;
          collectionName: string;
          name: string;
          description: string;
          category: string;
          priceOnyx: number;
          priceCurrency: "ONYX" | "SHARDS";
          previewKey: string | null;
          previewConfigJson: string;
          isPublished: number;
          isHidden: number;
          sortOrder: number;
          revision: number;
          createdAt: string;
          updatedAt: string;
          purchaseCount: number;
        }>(),
        env.DB.prepare(
          `SELECT COUNT(*) AS count
             FROM store_items si
            WHERE si.archived_at IS NULL
              ${categoryClause}
              ${searchClause}
              ${statusClause}`,
        )
          .bind(...itemBindings)
          .first<{ count: number }>(),
      ]);
      return json(
        id,
        {
          collections: collections.results.map((collection) => ({
            ...collection,
            isSeasonal: Boolean(collection.isSeasonal),
            enabled: Boolean(collection.enabled),
          })),
          items: items.results.map((item) => ({
            ...item,
            priceOnyx: Number(item.priceOnyx),
            purchaseCount: Number(item.purchaseCount),
            previewConfig: safeJsonRecord(item.previewConfigJson),
            previewUrl: storeItemPreviewUrl(
              item.id,
              item.previewKey,
              item.updatedAt,
            ),
            isPublished: Boolean(item.isPublished),
            isHidden: Boolean(item.isHidden),
          })),
          pagination: {
            page,
            limit,
            total: Number(itemCount?.count ?? 0),
          },
        },
        { headers: { "cache-control": "private, no-store" } },
      );
    }

    if (path === "admin/editor-picks") {
      const actor = await requireActor();
      requireAdminCapability(actor, capabilityForAdminPath(path));
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Editorial controls are temporarily unavailable.",
        );
      }
      const [seriesRows, pickRows] = await Promise.all([
        env.DB.prepare(
          `SELECT id, slug, title, type, cover_key AS coverKey, is_published AS isPublished
             FROM series
            ORDER BY title COLLATE NOCASE`,
        ).all<{
          id: string;
          slug: string;
          title: string;
          type: string;
          coverKey: string | null;
          isPublished: number;
        }>(),
        env.DB.prepare(
          `SELECT id,
                  series_id AS seriesId,
                  category_label AS categoryLabel,
                  short_description AS shortDescription,
                  sort_order AS sortOrder,
                  is_published AS isPublished,
                  updated_at AS updatedAt
             FROM editor_picks
            ORDER BY sort_order ASC`,
        ).all(),
      ]);
      return json(id, {
        series: seriesRows.results.map((seriesRecord) => ({
          ...seriesRecord,
          cover: publicSeriesCover(seriesRecord.slug, seriesRecord.coverKey),
          isPublished: Boolean(seriesRecord.isPublished),
        })),
        picks: pickRows.results.map((pick) => ({
          ...pick,
          isPublished: Boolean(pick.isPublished),
        })),
      });
    }

    if (path === "admin/team-access") {
      const actor = await requireActor();
      requireAdminCapability(actor, capabilityForAdminPath(path));
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Team access controls are temporarily unavailable.",
        );
      }
      const membershipPage = z.coerce
        .number()
        .int()
        .min(1)
        .max(10_000)
        .catch(1)
        .parse(url.searchParams.get("membershipPage"));
      const assignmentPage = z.coerce
        .number()
        .int()
        .min(1)
        .max(10_000)
        .catch(1)
        .parse(url.searchParams.get("assignmentPage"));
      const limit = z.coerce
        .number()
        .int()
        .min(1)
        .max(50)
        .catch(12)
        .parse(url.searchParams.get("limit"));
      const [memberships, assignments, membershipCount, assignmentCount] =
        await Promise.all([
        env.DB.prepare(
          `SELECT tm.team_id AS teamId,
                  tm.user_id AS userId,
                  tm.membership_role AS membershipRole,
                  tm.status,
                  tm.created_at AS joinedAt,
                  tm.updated_at AS updatedAt,
                  tm.revision,
                  tm.is_primary AS isPrimary,
                  t.name AS teamName,
                  u.email,
                  u.display_name AS displayName
             FROM team_memberships tm
             JOIN teams t ON t.id = tm.team_id
            JOIN users u ON u.id = tm.user_id
            ORDER BY t.name COLLATE NOCASE, u.display_name COLLATE NOCASE
            LIMIT ? OFFSET ?`,
        )
          .bind(limit, (membershipPage - 1) * limit)
          .all(),
        env.DB.prepare(
          `SELECT sta.series_id AS seriesId,
                  sta.team_id AS teamId,
                  sta.can_upload AS canUpload,
                  sta.can_publish AS canPublish,
                  sta.assigned_at AS assignedAt,
                  s.title AS seriesTitle,
                  t.name AS teamName
             FROM series_team_assignments sta
             JOIN series s ON s.id = sta.series_id
             JOIN teams t ON t.id = sta.team_id
            ORDER BY s.title COLLATE NOCASE, t.name COLLATE NOCASE
            LIMIT ? OFFSET ?`,
        )
          .bind(limit, (assignmentPage - 1) * limit)
          .all(),
        env.DB.prepare(
          "SELECT COUNT(*) AS count FROM team_memberships",
        ).first<{ count: number }>(),
        env.DB.prepare(
          "SELECT COUNT(*) AS count FROM series_team_assignments",
        ).first<{ count: number }>(),
      ]);
      return json(id, {
        memberships: memberships.results,
        assignments: assignments.results.map((assignment) => ({
          ...assignment,
          canUpload: Boolean(assignment.canUpload),
          canPublish: Boolean(assignment.canPublish),
        })),
        pagination: {
          memberships: {
            page: membershipPage,
            limit,
            total: Number(membershipCount?.count ?? 0),
          },
          assignments: {
            page: assignmentPage,
            limit,
            total: Number(assignmentCount?.count ?? 0),
          },
        },
      });
    }

    if (path === "admin/appearance") {
      const actor = await requireActor();
      requireAdminCapability(actor, capabilityForAdminPath(path));
      return json(id, await getSiteThemeDocument());
    }

    if (path === "admin/site-configuration") {
      const actor = await requireActor();
      requireAdminCapability(actor, capabilityForAdminPath(path));
      return json(id, await getSiteConfigurationDocument(), {
        headers: { "cache-control": "private, no-store" },
      });
    }

    if (path === "admin/commercial-settings") {
      const actor = await requireActor();
      requireAdminCapability(actor, capabilityForAdminPath(path));
      return json(id, await getCommercialSettingsDocument(), {
        headers: { "cache-control": "private, no-store" },
      });
    }

    if (path === "admin/discussion-settings") {
      const actor = await requireActor();
      requireAdminCapability(actor, capabilityForAdminPath(path));
      return json(id, await getDiscussionSettingsDocument());
    }

    if (path === "openapi") {
      return json(id, {
        openapi: "3.1.0",
        info: { title: "NyaScans API", version: "1.0.0" },
        servers: [{ url: "/api/v1" }],
        paths: {
          "/catalog": { get: { summary: "List public series" } },
          "/search": { get: { summary: "Search catalog" } },
          "/reviews": {
            get: { summary: "Read stored series ratings and reviews" },
            post: { summary: "Create or replace the current user's review" },
            patch: { summary: "Edit the current user's review" },
            delete: { summary: "Delete the current user's review" },
          },
          "/discussion-comments": {
            get: { summary: "Read a series or chapter discussion" },
            post: { summary: "Post a series or chapter comment" },
            patch: { summary: "Edit the current user's comment" },
            delete: { summary: "Remove the current user's comment" },
          },
          "/discussion-reactions": {
            post: { summary: "Set or clear an enabled emoji reaction" },
          },
          "/discussion-votes": {
            post: { summary: "Set an upvote, downvote, or neutral vote" },
          },
          "/discussion-media": {
            get: { summary: "Read a posted comment attachment" },
            post: { summary: "Upload a verified comment image or GIF" },
            delete: { summary: "Remove an unposted comment attachment" },
          },
          "/library": {
            get: { summary: "Read current user library" },
            post: { summary: "Update a library entry" },
          },
          "/reader/progress": {
            get: { summary: "Restore reader progress" },
            post: { summary: "Save reader progress" },
          },
          "/chapter-access-list": {
            get: { summary: "Read current access labels for a series" },
          },
          "/analytics-events": {
            post: { summary: "Record privacy-minimal reader activity" },
          },
          "/wallet": { get: { summary: "Read coin balance and ledger" } },
          "/orders": {
            get: { summary: "Read the current user's purchase history" },
            post: { summary: "Create a test-mode store order" },
          },
          "/admin/appearance": {
            get: { summary: "Read administrator appearance settings" },
            put: { summary: "Save administrator appearance settings" },
          },
          "/admin/commercial-settings": {
            get: {
              summary:
                "Read announcement, currency, package, membership, and unlock settings",
            },
            put: {
              summary:
                "Save announcement, currency, package, membership, and unlock settings",
            },
          },
          "/admin/discussion-settings": {
            get: { summary: "Read administrator discussion settings" },
            put: { summary: "Save reactions and discussion media policy" },
          },
          "/admin/summary": {
            get: { summary: "Read real platform and publishing counts" },
          },
          "/admin/analytics": {
            get: { summary: "Read near-real-time operational analytics" },
          },
          "/admin/chapter-detail": {
            get: {
              summary:
                "Read page order and moderation context for one chapter",
            },
          },
          "/admin/series": {
            get: { summary: "List managed series" },
            post: { summary: "Create a private series draft" },
          },
          "/admin/teams": {
            get: { summary: "List publishing teams" },
            post: { summary: "Create a pending publishing team" },
            put: { summary: "Change team verification status" },
          },
          "/admin/users": {
            get: { summary: "List user access records" },
            put: { summary: "Change an account role or status" },
          },
          "/admin/payouts": {
            get: {
              summary:
                "Read canonical team receipts and posted TEAM ledger balances; payout lifecycle values remain unavailable until persisted",
            },
          },
          "/admin/audit": {
            get: { summary: "Read the administrator audit log" },
          },
          "/unlocks": { post: { summary: "Atomically unlock a chapter" } },
          "/uploads": {
            get: {
              summary:
                "Retired legacy endpoint; use Upload Center history and drafts",
            },
            post: {
              summary:
                "Retired legacy endpoint; use Upload Center direct-image or folder jobs",
            },
          },
          "/health": { get: { summary: "Service liveness" } },
        },
      });
    }

    throw new ApiError(404, "NOT_FOUND", "The requested API resource does not exist.");
  } catch (error) {
    return errorResponse(id, error);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const id = requestId(request);
  try {
    const { resource } = await context.params;
    const path = pathOf(resource);

    if (path === "workspace/review") {
      assertSameOrigin(request);
      const actor = await requireActor("upload.create");
      const payload = workspaceReviewSchema.parse(await request.json());
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "The review workflow is temporarily unavailable.",
        );
      }
      const chapter = await env.DB.prepare(
        `SELECT c.id,
                c.series_id AS seriesId,
                c.team_id AS teamId,
                c.state,
                c.access_type AS accessType,
                c.revision,
                c.page_count AS pageCount,
                s.rights_status AS rightsStatus,
                uji.id AS uploadItemId,
                uji.job_id AS uploadJobId,
                uj.user_id AS uploaderUserId,
                COALESCE(ua.status, 'UNAPPROVED') AS uploaderApprovalStatus,
                ua.revision AS uploaderApprovalRevision,
                uji.replacement_chapter_id AS replacementChapterId,
                c.thumbnail_key AS proposedThumbnailKey,
                replacement.thumbnail_key AS replacementThumbnailKey,
                replacement.revision AS replacementChapterRevision,
                replacement.state AS replacementChapterState,
                replacement.page_count AS replacementPageCount,
                COALESCE((
                  SELECT sta.can_publish
                    FROM series_team_assignments sta
                   WHERE sta.series_id = c.series_id
                     AND sta.team_id = c.team_id
                   LIMIT 1
                ), 0) AS canPublish
           FROM chapters c
           JOIN series s ON s.id = c.series_id
           LEFT JOIN upload_job_items uji ON uji.chapter_id = c.id
           LEFT JOIN upload_jobs uj ON uj.id = uji.job_id
           LEFT JOIN uploader_approvals ua ON ua.user_id = uj.user_id
           LEFT JOIN chapters replacement
             ON replacement.id = uji.replacement_chapter_id
          WHERE c.id = ?
          LIMIT 1`,
      )
        .bind(payload.chapterId)
        .first<{
          id: string;
          seriesId: string;
          teamId: string | null;
          state: string;
          accessType: "FREE" | "PAID";
          revision: number;
          pageCount: number;
          rightsStatus: string;
          canPublish: number;
          uploadItemId: string | null;
          uploadJobId: string | null;
          uploaderUserId: string | null;
          uploaderApprovalStatus:
            | "UNAPPROVED"
            | "APPROVED"
            | "UNDER_SCOPE"
            | "REJECTED";
          uploaderApprovalRevision: number | null;
          replacementChapterId: string | null;
          proposedThumbnailKey: string | null;
          replacementThumbnailKey: string | null;
          replacementChapterRevision: number | null;
          replacementChapterState: string | null;
          replacementPageCount: number | null;
        }>();
      if (!chapter) {
        throw new ApiError(
          404,
          "CHAPTER_NOT_FOUND",
          "This chapter no longer exists.",
        );
      }
      if (Number(chapter.revision) !== payload.expectedRevision) {
        throw new ApiError(
          409,
          "STALE_VERSION",
          "This release changed. Reload the review queue before updating it.",
        );
      }
      const isAdmin = isAdminActor(actor);
      if (payload.approvalDecision && !isAdmin) {
        throw new ApiError(403, "UPLOADER_APPROVAL_ADMIN_REQUIRED", "Only an administrator can decide uploader approval.");
      }
      if (
        (payload.approvalDecision === "REJECT" && payload.action !== "RETURN") ||
        (["APPROVE", "UNDER_SCOPE"].includes(payload.approvalDecision ?? "") && payload.action !== "PUBLISH")
      ) {
        throw new ApiError(422, "UPLOADER_APPROVAL_INVALID", "The uploader decision does not match the chapter review action.");
      }
      if (
        payload.approvalDecision &&
        (!chapter.uploadJobId ||
          !chapter.uploadItemId ||
          !chapter.uploaderUserId)
      ) {
        throw new ApiError(
          409,
          "UPLOADER_APPROVAL_CONTEXT_MISSING",
          "This release is not linked to an uploader review. Reload the review queue.",
        );
      }
      const requiresUploaderDecision = Boolean(
        chapter.uploadJobId &&
          chapter.uploaderUserId &&
          chapter.uploaderApprovalStatus !== "APPROVED" &&
          payload.action !== "SUBMIT",
      );
      if (requiresUploaderDecision && !isAdmin) {
        throw new ApiError(
          403,
          "UPLOADER_APPROVAL_ADMIN_REQUIRED",
          "An administrator must review this uploader before publication.",
        );
      }
      if (requiresUploaderDecision && !payload.approvalDecision) {
        throw new ApiError(
          422,
          "UPLOADER_APPROVAL_DECISION_REQUIRED",
          "Choose approve, under scope, or reject for this uploader.",
        );
      }
      if (chapter.replacementChapterId && !isAdmin) {
        throw new ApiError(
          403,
          "REPLACEMENT_REVIEW_ADMIN_REQUIRED",
          "Only an administrator can approve or return a chapter replacement.",
        );
      }
      const requiredCapability =
        payload.action === "SUBMIT"
          ? "chapter.submit.assigned"
          : payload.action === "PUBLISH"
            ? "chapter.publish.assigned"
            : "chapter.review.own";
      if (!actorHasCapability(actor, requiredCapability)) {
        throw new ApiError(
          403,
          "REVIEW_ACTION_FORBIDDEN",
          "Your role cannot perform this review action.",
        );
      }
      const expectedState =
        payload.action === "SUBMIT" ? "DRAFT" : "READY_FOR_REVIEW";
      if (chapter.state !== expectedState) {
        throw new ApiError(
          409,
          "INVALID_REVIEW_TRANSITION",
          payload.action === "SUBMIT"
            ? "Only a draft release can be submitted for review."
            : "Only a release awaiting review can be published or returned.",
        );
      }
      const allowedMembershipRoles =
        payload.action === "SUBMIT"
          ? ["OWNER", "LEADER", "UPLOADER"]
          : ["OWNER", "LEADER"];
      const rolePlaceholders = allowedMembershipRoles.map(() => "?").join(", ");
      const assignmentColumn =
        payload.action === "PUBLISH" ? "can_publish" : "can_upload";
      if (!isAdmin) {
        const currentScope = await env.DB.prepare(
          `SELECT 1 AS allowed
             FROM series_team_assignments sta
             JOIN team_memberships tm
               ON tm.team_id = sta.team_id
             JOIN teams t
               ON t.id = sta.team_id
            WHERE sta.series_id = ?
              AND sta.team_id = ?
              AND sta.${assignmentColumn} = 1
              AND tm.user_id = ?
              AND tm.status = 'ACTIVE'
              AND UPPER(tm.membership_role) IN (${rolePlaceholders})
              AND t.is_archived = 0
              AND t.verification_status <> 'SUSPENDED'
            LIMIT 1`,
        )
          .bind(
            chapter.seriesId,
            chapter.teamId,
            actor.id,
            ...allowedMembershipRoles,
          )
          .first();
        if (!currentScope) {
          throw new ApiError(
            403,
            payload.action === "PUBLISH"
              ? "PUBLISH_PERMISSION_REQUIRED"
              : "CHAPTER_TEAM_ACCESS_REQUIRED",
            payload.action === "PUBLISH"
              ? "An active manager of the assigned team must publish this release."
              : "This action requires an active, eligible role in the assigned team.",
          );
        }
      }
      if (
        ["SUBMIT", "PUBLISH"].includes(payload.action) &&
        Number(chapter.pageCount) <= 0 &&
        !["DEMO_ORIGINAL", "TEST_ORIGINAL"].includes(chapter.rightsStatus)
      ) {
        throw new ApiError(
          409,
          "CHAPTER_PAGES_REQUIRED",
          "Process at least one ordered page before review or publication.",
        );
      }
      if (
        payload.action === "PUBLISH" &&
        ["EXPIRED", "REVOKED", "TAKEDOWN"].includes(chapter.rightsStatus)
      ) {
        throw new ApiError(
          409,
          "RIGHTS_BLOCK_PUBLICATION",
          "Publication is blocked by the current rights state.",
        );
      }
      const paidEconomyRevision =
        payload.action === "PUBLISH" && chapter.accessType === "PAID"
          ? (await requirePaidEconomyPublicDocument()).revision
          : null;
      if (
        chapter.replacementChapterId &&
        chapter.uploadItemId &&
        chapter.uploadJobId &&
        payload.action === "RETURN"
      ) {
        const guardCondition = `EXISTS (
          SELECT 1 FROM upload_publish_guards
           WHERE job_id = '${chapter.uploadJobId.replaceAll("'", "''")}'
             AND verified = 1
        )`;
        let returnResults;
        try {
          returnResults = await env.DB.batch([
            env.DB.prepare(
              "DELETE FROM upload_publish_guards WHERE job_id = ?",
            ).bind(chapter.uploadJobId),
            env.DB.prepare(
              `UPDATE chapters
                  SET state = 'DRAFT',
                      revision = revision + 1,
                      updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                  AND revision = ?
                  AND state = 'READY_FOR_REVIEW'`,
            ).bind(chapter.id, payload.expectedRevision),
            env.DB.prepare(
              `INSERT INTO upload_publish_guards (job_id, verified)
               VALUES (?, CASE WHEN changes() = 1 THEN 1 ELSE NULL END)`,
            ).bind(chapter.uploadJobId),
            ...(payload.approvalDecision
              ? uploaderReviewDecisionStatements(env.DB, {
                  decision: payload.approvalDecision,
                  jobId: chapter.uploadJobId,
                  uploaderUserId: chapter.uploaderUserId!,
                  expectedApprovalRevision:
                    chapter.uploaderApprovalRevision,
                  reviewerUserId: actor.id,
                  note: payload.reason,
                })
              : []),
            env.DB.prepare(
              `UPDATE upload_sessions
                  SET chapter_id = NULL,
                      updated_at = CURRENT_TIMESTAMP
                WHERE upload_job_item_id = ?
                  AND ${guardCondition}`,
            ).bind(chapter.uploadItemId),
            env.DB.prepare(
              `UPDATE upload_job_items
                  SET chapter_id = NULL,
                      replacement_chapter_id = NULL,
                      status = 'READY',
                      revision = revision + 1,
                      updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                  AND chapter_id = ?
                  AND ${guardCondition}`,
            ).bind(chapter.uploadItemId, chapter.id),
            env.DB.prepare(
              `DELETE FROM chapters
                WHERE id = ?
                  AND state = 'DRAFT'
                  AND ${guardCondition}`,
            ).bind(chapter.id),
            env.DB.prepare(
              `UPDATE upload_jobs
                  SET status = 'READY',
                      submitted_at = NULL,
                      completed_at = NULL,
                      revision = revision + 1,
                      updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                  AND ${guardCondition}`,
            ).bind(chapter.uploadJobId),
            auditStatement(
              env.DB,
              actor,
              id,
              {
                action: "upload.chapter_replacement.return",
                category: "UPLOADS_IMPORTS",
                sourceArea: "REVIEW_QUEUE",
                targetType: "UPLOAD_JOB",
                targetId: chapter.uploadJobId,
                reason: payload.reason,
                oldValue: {
                  proposedChapterId: chapter.id,
                  replacementChapterId: chapter.replacementChapterId,
                },
                newValue: {
                  status: "READY",
                  replacementChapterId: null,
                },
              },
              guardCondition,
            ),
            env.DB.prepare(
              "DELETE FROM upload_publish_guards WHERE job_id = ?",
            ).bind(chapter.uploadJobId),
          ]);
        } catch (error) {
          if (
            error instanceof Error &&
            /upload_publish_guards\.verified/i.test(error.message)
          ) {
            throw new ApiError(
              409,
              "REPLACEMENT_REVIEW_CHANGED",
              "The replacement request changed. Reload the review queue.",
            );
          }
          throw error;
        }
        if (!returnResults[1]?.meta.changes) {
          throw new ApiError(
            409,
            "REPLACEMENT_REVIEW_CHANGED",
            "The replacement request changed. Reload the review queue.",
          );
        }
        return json(id, {
          ok: true,
          chapterId: null,
          state: "READY",
          revision: payload.expectedRevision + 1,
          replacementReturned: true,
        });
      }
      if (
        chapter.replacementChapterId &&
        chapter.uploadItemId &&
        chapter.uploadJobId &&
        payload.action === "PUBLISH"
      ) {
        const [oldPages, replacementPages] = await Promise.all([
          env.DB.prepare(
            "SELECT object_key AS objectKey FROM chapter_pages WHERE chapter_id = ?",
          )
            .bind(chapter.replacementChapterId)
            .all<{ objectKey: string }>(),
          env.DB.prepare(
            "SELECT object_key AS objectKey FROM chapter_pages WHERE chapter_id = ?",
          )
            .bind(chapter.id)
            .all<{ objectKey: string }>(),
        ]);
        const guardCondition = `EXISTS (
          SELECT 1 FROM upload_publish_guards
           WHERE job_id = '${chapter.uploadJobId.replaceAll("'", "''")}'
             AND verified = 1
        )`;
        let replacementResults;
        try {
          replacementResults = await env.DB.batch([
            env.DB.prepare(
              "DELETE FROM upload_publish_guards WHERE job_id = ?",
            ).bind(chapter.uploadJobId),
            env.DB.prepare(
              `UPDATE chapters
                  SET uploader_user_id = (
                        SELECT uploader_user_id FROM chapters WHERE id = ?
                      ),
                      volume = (SELECT volume FROM chapters WHERE id = ?),
                      title = (SELECT title FROM chapters WHERE id = ?),
                      access_type = (
                        SELECT access_type FROM chapters WHERE id = ?
                      ),
                      price_onyx = (
                        SELECT price_onyx FROM chapters WHERE id = ?
                      ),
                      page_count = (
                        SELECT page_count FROM chapters WHERE id = ?
                      ),
                      release_notes = (
                        SELECT release_notes FROM chapters WHERE id = ?
                      ),
                      credits_json = (
                        SELECT credits_json FROM chapters WHERE id = ?
                      ),
                      visibility = (
                        SELECT visibility FROM chapters WHERE id = ?
                      ),
                      comments_enabled = (
                        SELECT comments_enabled FROM chapters WHERE id = ?
                      ),
                      thumbnail_key = (
                        SELECT thumbnail_key FROM chapters WHERE id = ?
                      ),
                      state = 'PUBLISHED',
                      published_at = COALESCE(published_at, CURRENT_TIMESTAMP),
                      free_at = CASE
                        WHEN EXISTS (
                          SELECT 1
                            FROM chapters proposed_policy
                           WHERE proposed_policy.id = ?
                             AND proposed_policy.access_type = 'PAID'
                             AND json_valid(proposed_policy.credits_json)
                             AND COALESCE(
                               json_extract(
                                 proposed_policy.credits_json,
                                 '$.useVisibilityDefault'
                               ),
                               0
                             ) = 1
                        )
                         AND EXISTS (
                           SELECT 1
                             FROM content_visibility_settings settings
                            WHERE settings.id = 'active'
                              AND settings.auto_free_after_days IS NOT NULL
                         )
                        THEN datetime(
                          CURRENT_TIMESTAMP,
                          '+' || (
                            SELECT auto_free_after_days
                              FROM content_visibility_settings
                             WHERE id = 'active'
                          ) || ' days'
                        )
                        ELSE NULL
                      END,
                      revision = revision + 1,
                      updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                  AND revision = ?
                  AND state = ?
                  AND page_count = ?
                  AND EXISTS (
                    SELECT 1
                      FROM chapters proposed
                     WHERE proposed.id = ?
                       AND proposed.revision = ?
                       AND proposed.state = 'READY_FOR_REVIEW'
                       AND proposed.series_id = chapters.series_id
                       AND LTRIM(proposed.chapter_number, '0') =
                           LTRIM(chapters.chapter_number, '0')
                       AND proposed.language = chapters.language
                       AND COALESCE(proposed.team_id, '') =
                           COALESCE(chapters.team_id, '')
                       AND proposed.version = chapters.version
                  )
                  AND ${
                    paidEconomyRevision === null
                      ? "1 = 1"
                      : paidEconomyRevisionGuardSql(paidEconomyRevision)
                  }`,
            ).bind(
              chapter.id,
              chapter.id,
              chapter.id,
              chapter.id,
              chapter.id,
              chapter.id,
              chapter.id,
              chapter.id,
              chapter.id,
              chapter.id,
              chapter.id,
              chapter.id,
              chapter.replacementChapterId,
              chapter.replacementChapterRevision,
              chapter.replacementChapterState,
              chapter.replacementPageCount,
              chapter.id,
              payload.expectedRevision,
            ),
            env.DB.prepare(
              `INSERT INTO upload_publish_guards (job_id, verified)
               VALUES (?, CASE WHEN changes() = 1 THEN 1 ELSE NULL END)`,
            ).bind(chapter.uploadJobId),
            ...(payload.approvalDecision
              ? uploaderReviewDecisionStatements(env.DB, {
                  decision: payload.approvalDecision,
                  jobId: chapter.uploadJobId,
                  uploaderUserId: chapter.uploaderUserId!,
                  expectedApprovalRevision:
                    chapter.uploaderApprovalRevision,
                  reviewerUserId: actor.id,
                  note: payload.reason,
                })
              : []),
            env.DB.prepare(
              `DELETE FROM chapter_pages
                WHERE chapter_id = ?
                  AND ${guardCondition}`,
            ).bind(chapter.replacementChapterId),
            env.DB.prepare(
              `UPDATE chapter_pages
                  SET chapter_id = ?
                WHERE chapter_id = ?
                  AND ${guardCondition}`,
            ).bind(chapter.replacementChapterId, chapter.id),
            env.DB.prepare(
              `UPDATE upload_sessions
                  SET chapter_id = ?,
                      updated_at = CURRENT_TIMESTAMP
                WHERE upload_job_item_id = ?
                  AND ${guardCondition}`,
            ).bind(chapter.replacementChapterId, chapter.uploadItemId),
            env.DB.prepare(
              `UPDATE upload_job_items
                  SET chapter_id = ?,
                      replacement_chapter_id = NULL,
                      status = 'PUBLISHED',
                      revision = revision + 1,
                      updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                  AND chapter_id = ?
                  AND ${guardCondition}`,
            ).bind(
              chapter.replacementChapterId,
              chapter.uploadItemId,
              chapter.id,
            ),
            env.DB.prepare(
              `DELETE FROM chapters
                WHERE id = ?
                  AND state = 'READY_FOR_REVIEW'
                  AND ${guardCondition}`,
            ).bind(chapter.id),
            env.DB.prepare(
              `UPDATE upload_jobs
                  SET status = CASE
                        WHEN NOT EXISTS (
                          SELECT 1
                            FROM upload_job_items
                           WHERE job_id = upload_jobs.id
                             AND status NOT IN ('PUBLISHED', 'SCHEDULED')
                        ) THEN 'PUBLISHED'
                        ELSE 'PENDING_REVIEW'
                      END,
                      completed_at = CASE
                        WHEN NOT EXISTS (
                          SELECT 1
                            FROM upload_job_items
                           WHERE job_id = upload_jobs.id
                             AND status NOT IN ('PUBLISHED', 'SCHEDULED')
                        ) THEN CURRENT_TIMESTAMP
                        ELSE completed_at
                      END,
                      updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                  AND ${guardCondition}`,
            ).bind(chapter.uploadJobId),
            auditStatement(
              env.DB,
              actor,
              id,
              {
                action: "upload.chapter_replacement.approve",
                category: "UPLOADS_IMPORTS",
                sourceArea: "REVIEW_QUEUE",
                targetType: "CHAPTER",
                targetId: chapter.replacementChapterId,
                reason: payload.reason,
                oldValue: { proposedChapterId: chapter.id },
                newValue: {
                  replacementChapterId: chapter.replacementChapterId,
                  pageCount: chapter.pageCount,
                },
              },
              guardCondition,
            ),
            env.DB.prepare(
              "DELETE FROM upload_publish_guards WHERE job_id = ?",
            ).bind(chapter.uploadJobId),
          ]);
        } catch (error) {
          if (
            error instanceof Error &&
            /upload_publish_guards\.verified/i.test(error.message)
          ) {
            if (paidEconomyRevision !== null) {
              await assertPaidEconomyRevisionFresh(paidEconomyRevision);
            }
            throw new ApiError(
              409,
              "REPLACEMENT_REVIEW_CHANGED",
              "The replacement target or proposed chapter changed. Reload the review queue.",
            );
          }
          throw error;
        }
        if (!replacementResults[1]?.meta.changes) {
          if (paidEconomyRevision !== null) {
            await assertPaidEconomyRevisionFresh(paidEconomyRevision);
          }
          throw new ApiError(
            409,
            "REPLACEMENT_REVIEW_CHANGED",
            "The replacement target or proposed chapter changed. Reload the review queue.",
          );
        }
        if (env.BUCKET) {
          const retainedKeys = new Set(
            replacementPages.results.map((page) => page.objectKey),
          );
          for (const page of oldPages.results) {
            if (retainedKeys.has(page.objectKey)) continue;
            await deleteMediaObject(env.DB, env.BUCKET, page.objectKey, {
              mediaKind: "CHAPTER_PAGE",
              targetType: "CHAPTER",
              targetId: chapter.replacementChapterId,
              reason: "Approved chapter replacement",
            });
          }
          if (
            chapter.replacementThumbnailKey &&
            chapter.replacementThumbnailKey !== chapter.proposedThumbnailKey
          ) {
            await deleteMediaObject(
              env.DB,
              env.BUCKET,
              chapter.replacementThumbnailKey,
              {
                mediaKind: "CHAPTER_THUMBNAIL",
                targetType: "CHAPTER",
                targetId: chapter.replacementChapterId,
                reason: "Approved chapter thumbnail replacement",
              },
            );
          }
        }
        return json(id, {
          ok: true,
          chapterId: chapter.replacementChapterId,
          state: "PUBLISHED",
          revision: Number(chapter.replacementChapterRevision) + 1,
          replacementApproved: true,
        });
      }
      const nextState =
        payload.action === "SUBMIT"
          ? "READY_FOR_REVIEW"
          : payload.action === "PUBLISH"
            ? "PUBLISHED"
            : "DRAFT";
      const reviewStatements: D1PreparedStatement[] = [];
      const uploadJobId = chapter.uploadJobId;
      const uploadItemId = chapter.uploadItemId;
      if (uploadJobId && uploadItemId) {
        reviewStatements.push(
          env.DB.prepare(
            "DELETE FROM upload_publish_guards WHERE job_id = ?",
          ).bind(uploadJobId),
        );
      }
      const chapterUpdateIndex = reviewStatements.length;
      reviewStatements.push(
        env.DB.prepare(
          `UPDATE chapters
              SET state = ?,
                  published_at = CASE
                    WHEN ? = 'PUBLISHED'
                      THEN COALESCE(published_at, CURRENT_TIMESTAMP)
                    ELSE published_at
                  END,
                  free_at = CASE
                    WHEN ? = 'PUBLISHED'
                     AND access_type = 'PAID'
                     AND EXISTS (
                       SELECT 1
                         FROM upload_job_items inherited_upload_item
                        WHERE inherited_upload_item.chapter_id = chapters.id
                          AND json_valid(inherited_upload_item.credits_json)
                          AND COALESCE(
                            json_extract(
                              inherited_upload_item.credits_json,
                              '$.useVisibilityDefault'
                            ),
                            0
                          ) = 1
                     )
                     AND EXISTS (
                       SELECT 1
                         FROM content_visibility_settings settings
                        WHERE settings.id = 'active'
                          AND settings.auto_free_after_days IS NOT NULL
                     )
                    THEN datetime(
                      COALESCE(published_at, CURRENT_TIMESTAMP),
                      '+' || (
                        SELECT auto_free_after_days
                          FROM content_visibility_settings
                         WHERE id = 'active'
                      ) || ' days'
                    )
                    ELSE free_at
                  END,
                  revision = revision + 1,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND revision = ?
              AND state = ?
              AND (
                ? = 1
                OR EXISTS (
                  SELECT 1
                    FROM series_team_assignments sta
                    JOIN team_memberships tm
                      ON tm.team_id = sta.team_id
                    JOIN teams t
                      ON t.id = sta.team_id
                   WHERE sta.series_id = chapters.series_id
                     AND sta.team_id = chapters.team_id
                     AND sta.${assignmentColumn} = 1
                     AND tm.user_id = ?
                     AND tm.status = 'ACTIVE'
                     AND UPPER(tm.membership_role) IN (${rolePlaceholders})
                     AND t.is_archived = 0
                     AND t.verification_status <> 'SUSPENDED'
                )
              )
              AND ${
                paidEconomyRevision === null
                  ? "1 = 1"
                  : paidEconomyRevisionGuardSql(paidEconomyRevision)
              }`,
        ).bind(
          nextState,
          nextState,
          nextState,
          chapter.id,
          payload.expectedRevision,
          expectedState,
          isAdmin ? 1 : 0,
          actor.id,
          ...allowedMembershipRoles,
        ),
        env.DB.prepare(
          `INSERT INTO audit_logs
           (id, actor_user_id, action, target_type, target_id, request_id,
            reason, old_value_json, new_value_json)
           SELECT ?, ?, 'workspace.review.transition', 'CHAPTER', ?, ?, ?, ?, ?
           WHERE changes() = 1`,
        ).bind(
          randomId(),
          actor.id,
          chapter.id,
          id,
          payload.reason,
          JSON.stringify({ state: chapter.state }),
          JSON.stringify({
            state: nextState,
            action: payload.action,
            revision: payload.expectedRevision + 1,
          }),
        ),
      );
      if (uploadJobId && uploadItemId) {
        const guardCondition = `EXISTS (
          SELECT 1 FROM upload_publish_guards
           WHERE job_id = '${uploadJobId.replaceAll("'", "''")}'
             AND verified = 1
        )`;
        const transitionGuardStatement = env.DB.prepare(
          `INSERT INTO upload_publish_guards (job_id, verified)
           VALUES (?, CASE WHEN changes() = 1 THEN 1 ELSE NULL END)`,
        ).bind(uploadJobId);
        const uploaderDecisionStatements = payload.approvalDecision
          ? uploaderReviewDecisionStatements(env.DB, {
              decision: payload.approvalDecision,
              jobId: uploadJobId,
              uploaderUserId: chapter.uploaderUserId!,
              expectedApprovalRevision: chapter.uploaderApprovalRevision,
              reviewerUserId: actor.id,
              note: payload.reason,
            })
          : [];
        reviewStatements.push(
          transitionGuardStatement,
          ...uploaderDecisionStatements,
          env.DB.prepare(
            `UPDATE upload_job_items
                SET status = ?,
                    revision = revision + 1,
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
                AND chapter_id = ?
                AND ${guardCondition}`,
          ).bind(
            payload.action === "PUBLISH"
              ? "PUBLISHED"
              : payload.action === "RETURN"
                ? "REJECTED"
                : "PENDING_REVIEW",
            uploadItemId,
            chapter.id,
          ),
          env.DB.prepare(
            `UPDATE upload_jobs
                SET status = CASE
                      WHEN ? = 'RETURN' THEN 'REJECTED'
                      WHEN ? = 'SUBMIT' THEN 'PENDING_REVIEW'
                      WHEN NOT EXISTS (
                        SELECT 1
                          FROM upload_job_items
                         WHERE job_id = upload_jobs.id
                           AND status NOT IN ('PUBLISHED', 'SCHEDULED')
                      ) THEN 'PUBLISHED'
                      ELSE 'PENDING_REVIEW'
                    END,
                    completed_at = CASE
                      WHEN ? = 'PUBLISH'
                       AND NOT EXISTS (
                         SELECT 1
                           FROM upload_job_items
                          WHERE job_id = upload_jobs.id
                            AND status NOT IN ('PUBLISHED', 'SCHEDULED')
                       ) THEN CURRENT_TIMESTAMP
                      ELSE completed_at
                    END,
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
                AND ${guardCondition}`,
          ).bind(
            payload.action,
            payload.action,
            payload.action,
            uploadJobId,
          ),
          env.DB.prepare(
            "DELETE FROM upload_publish_guards WHERE job_id = ?",
          ).bind(uploadJobId),
        );
      }
      let reviewResults;
      try {
        reviewResults = await env.DB.batch(reviewStatements);
      } catch (error) {
        if (
          error instanceof Error &&
          /upload_publish_guards\.verified/i.test(error.message)
        ) {
          if (paidEconomyRevision !== null) {
            await assertPaidEconomyRevisionFresh(paidEconomyRevision);
          }
          throw new ApiError(
            409,
            "STALE_VERSION",
            "This release changed. Reload the review queue before updating it.",
          );
        }
        throw error;
      }
      if (!reviewResults[chapterUpdateIndex]?.meta.changes) {
        if (paidEconomyRevision !== null) {
          await assertPaidEconomyRevisionFresh(paidEconomyRevision);
        }
        throw new ApiError(
          409,
          "STALE_VERSION",
          "This release changed. Reload the review queue before updating it.",
        );
      }
      return json(id, {
        ok: true,
        chapterId: chapter.id,
        state: nextState,
        revision: payload.expectedRevision + 1,
      });
    }

    if (path === "workspace/settings") {
      assertSameOrigin(request);
      const actor = await requireActor("upload.create");
      const payload = workspaceSettingsSchema.parse(await request.json());
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Workspace settings are temporarily unavailable.",
        );
      }
      if (
        payload.defaultTeamId &&
        !isAdminActor(actor) &&
        !actor.teamIds.includes(payload.defaultTeamId)
      ) {
        throw new ApiError(
          403,
          "TEAM_ACCESS_REQUIRED",
          "Choose a team assigned to your account.",
        );
      }
      await env.DB.prepare(
        `INSERT INTO user_preferences
         (user_id, theme, content_language, reader_mode, mature_content,
          settings_json)
         VALUES (?, 'SYSTEM', ?, 'VERTICAL', 0,
                 json_object('workspace', json(?)))
         ON CONFLICT(user_id) DO UPDATE SET
           content_language = excluded.content_language,
           settings_json = json_set(
             CASE
               WHEN json_valid(user_preferences.settings_json)
                 THEN user_preferences.settings_json
               ELSE '{}'
             END,
             '$.workspace',
             json(?)
           ),
           updated_at = CURRENT_TIMESTAMP`,
      )
        .bind(
          actor.id,
          payload.defaultLanguage,
          JSON.stringify(payload),
          JSON.stringify(payload),
        )
        .run();
      return json(id, { ok: true, data: payload });
    }

    if (
      path !== "admin/appearance" &&
      path !== "admin/site-configuration" &&
      path !== "admin/commercial-settings" &&
      path !== "admin/discussion-settings" &&
      path !== "admin/chapters" &&
      path !== "admin/teams" &&
      path !== "admin/users" &&
      path !== "admin/store-items" &&
      path !== "admin/store-collections" &&
      path !== "admin/editor-picks"
    ) {
      throw new ApiError(
        404,
        "NOT_FOUND",
        "The requested API resource does not exist.",
      );
    }
    assertSameOrigin(request);
    const actor = await requireActor();
    requireAdminCapability(actor, capabilityForAdminPath(path));
    if (path === "admin/store-items") {
      const payload = storeItemInputSchema.parse(await request.json());
      if (!payload.id || payload.expectedRevision === undefined || !env.DB) {
        throw new ApiError(
          !env.DB ? 503 : 422,
          !env.DB
            ? "DATABASE_UNAVAILABLE"
            : !payload.id
              ? "STORE_ITEM_ID_REQUIRED"
              : "STORE_ITEM_REVISION_REQUIRED",
          !env.DB
            ? "Store Management is temporarily unavailable."
            : !payload.id
              ? "Choose a Store item to update."
              : "Reload this Store item before saving it.",
        );
      }
      const current = await env.DB.prepare(
        `SELECT id,
                preview_key AS previewKey,
                revision,
                slug,
                collection_id AS collectionId,
                name,
                description,
                category,
                price_onyx AS priceOnyx,
                price_currency AS priceCurrency,
                preview_config_json AS previewConfigJson,
                is_published AS isPublished,
                is_hidden AS isHidden,
                sort_order AS sortOrder,
                (SELECT COUNT(*)
                   FROM user_store_items owned
                  WHERE owned.item_id = store_items.id) AS purchaseCount,
                (SELECT COUNT(*)
                   FROM user_cosmetic_loadouts equipped
                  WHERE equipped.item_id = store_items.id) AS equippedCount
           FROM store_items
          WHERE id = ?
          LIMIT 1`,
      )
        .bind(payload.id)
        .first<{
          id: string;
          previewKey: string | null;
          revision: number;
          slug: string;
          collectionId: string;
          name: string;
          description: string;
          category: string;
          priceOnyx: number;
          priceCurrency: "ONYX" | "SHARDS";
          previewConfigJson: string;
          isPublished: number;
          isHidden: number;
          sortOrder: number;
          purchaseCount: number;
          equippedCount: number;
        }>();
      if (!current) {
        throw new ApiError(
          404,
          "STORE_ITEM_NOT_FOUND",
          "This Store item no longer exists.",
        );
      }
      if (Number(current.revision) !== payload.expectedRevision) {
        throw new ApiError(
          409,
          "STORE_ITEM_CHANGED",
          "Another administrator changed this Store item. Reload it before saving.",
        );
      }
      if (
        payload.category !== current.category &&
        (Number(current.purchaseCount) > 0 ||
          Number(current.equippedCount) > 0)
      ) {
        throw new ApiError(
          409,
          "STORE_CATEGORY_IMMUTABLE",
          "A purchased or equipped cosmetic cannot move to another category. Archive it and create a replacement instead.",
        );
      }
      const nextRevision = payload.expectedRevision + 1;
      const updateResults = await env.DB.batch([
        env.DB.prepare(
          `UPDATE store_items
            SET slug = ?,
                collection_id = ?,
                name = ?,
                description = ?,
                category = ?,
                price_onyx = ?,
                price_currency = ?,
                preview_config_json = ?,
                is_published = ?,
                is_hidden = ?,
                sort_order = ?,
                revision = revision + 1,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND revision = ?
            AND (
              ? = 0
              OR (
                NOT EXISTS (
                  SELECT 1 FROM user_store_items ownership
                   WHERE ownership.item_id = store_items.id
                )
                AND NOT EXISTS (
                  SELECT 1 FROM user_cosmetic_loadouts loadout
                   WHERE loadout.item_id = store_items.id
                )
              )
            )`,
        ).bind(
          payload.slug,
          payload.collectionId,
          payload.name,
          payload.description,
          payload.category,
          payload.priceOnyx,
          payload.priceCurrency,
          JSON.stringify(payload.previewConfig),
          payload.isPublished ? 1 : 0,
          payload.isHidden ? 1 : 0,
          payload.sortOrder,
          payload.id,
          payload.expectedRevision,
          payload.category === current.category ? 0 : 1,
        ),
        auditStatement(
          env.DB,
          actor,
          id,
          {
            action: "store.item.update",
            category: "COMMERCE_STORE",
            sourceArea: "STORE_MANAGEMENT",
            targetType: "STORE_ITEM",
            targetId: payload.id,
            targetLabel: payload.name,
            oldValue: current,
            newValue: { ...payload, revision: nextRevision },
          },
          "changes() = 1",
        ),
      ]);
      if (Number(updateResults[0]?.meta.changes ?? 0) !== 1) {
        if (payload.category !== current.category) {
          const references = await env.DB.prepare(
            `SELECT
               (SELECT COUNT(*) FROM user_store_items
                 WHERE item_id = ?) AS purchaseCount,
               (SELECT COUNT(*) FROM user_cosmetic_loadouts
                 WHERE item_id = ?) AS equippedCount`,
          )
            .bind(payload.id, payload.id)
            .first<{ purchaseCount: number; equippedCount: number }>();
          if (
            Number(references?.purchaseCount ?? 0) > 0 ||
            Number(references?.equippedCount ?? 0) > 0
          ) {
            throw new ApiError(
              409,
              "STORE_CATEGORY_IMMUTABLE",
              "A purchased or equipped cosmetic cannot move to another category. Archive it and create a replacement instead.",
            );
          }
        }
        throw new ApiError(
          409,
          "STORE_ITEM_CHANGED",
          "Another administrator changed this Store item. Reload it before saving.",
        );
      }
      return json(id, { ok: true, ...payload, revision: nextRevision });
    }
    if (path === "admin/store-collections") {
      const payload = storeCollectionInputSchema.parse(await request.json());
      if (!payload.id || payload.expectedRevision === undefined || !env.DB) {
        throw new ApiError(
          !env.DB ? 503 : 422,
          !env.DB
            ? "DATABASE_UNAVAILABLE"
            : !payload.id
              ? "STORE_COLLECTION_ID_REQUIRED"
              : "STORE_COLLECTION_REVISION_REQUIRED",
          !env.DB
            ? "Store Management is temporarily unavailable."
            : !payload.id
              ? "Choose a Store collection to update."
              : "Reload this Store collection before saving it.",
        );
      }
      const current = await env.DB.prepare(
        `SELECT id, slug, name, description, theme_key AS themeKey,
                is_seasonal AS isSeasonal, enabled, starts_at AS startsAt,
                ends_at AS endsAt, sort_order AS sortOrder, revision
           FROM store_collections
          WHERE id = ?
          LIMIT 1`,
      )
        .bind(payload.id)
        .first<Record<string, unknown> & { revision: number }>();
      if (!current) {
        throw new ApiError(
          404,
          "STORE_COLLECTION_NOT_FOUND",
          "This Store collection no longer exists.",
        );
      }
      if (Number(current.revision) !== payload.expectedRevision) {
        throw new ApiError(
          409,
          "STORE_COLLECTION_CHANGED",
          "Another administrator changed this collection. Reload it before saving.",
        );
      }
      const nextRevision = payload.expectedRevision + 1;
      const updateResults = await env.DB.batch([
        env.DB.prepare(
          `UPDATE store_collections
            SET slug = ?,
                name = ?,
                description = ?,
                theme_key = ?,
                is_seasonal = ?,
                enabled = ?,
                starts_at = ?,
                ends_at = ?,
                sort_order = ?,
                revision = revision + 1,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND revision = ?`,
        ).bind(
          payload.slug,
          payload.name,
          payload.description,
          payload.themeKey,
          payload.isSeasonal ? 1 : 0,
          payload.enabled ? 1 : 0,
          payload.startsAt,
          payload.endsAt,
          payload.sortOrder,
          payload.id,
          payload.expectedRevision,
        ),
        auditStatement(
          env.DB,
          actor,
          id,
          {
            action: "store.collection.update",
            category: "COMMERCE_STORE",
            sourceArea: "STORE_MANAGEMENT",
            targetType: "STORE_COLLECTION",
            targetId: payload.id,
            targetLabel: payload.name,
            oldValue: current,
            newValue: { ...payload, revision: nextRevision },
          },
          "changes() = 1",
        ),
      ]);
      if (Number(updateResults[0]?.meta.changes ?? 0) !== 1) {
        throw new ApiError(
          409,
          "STORE_COLLECTION_CHANGED",
          "Another administrator changed this collection. Reload it before saving.",
        );
      }
      return json(id, { ok: true, ...payload, revision: nextRevision });
    }
    if (path === "admin/editor-picks") {
      const payload = editorPickWriteSchema.parse(await request.json());
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Editorial controls are temporarily unavailable.",
        );
      }
      const uniqueSeries = new Set(payload.picks.map((pick) => pick.seriesId));
      if (uniqueSeries.size !== payload.picks.length) {
        throw new ApiError(
          422,
          "EDITOR_PICK_DUPLICATE",
          "Each series can appear only once in Editor's Picks.",
        );
      }
      const validSeries = payload.picks.length
        ? await env.DB.prepare(
            `SELECT id
               FROM series
              WHERE id IN (${payload.picks.map(() => "?").join(", ")})`,
          )
            .bind(...payload.picks.map((pick) => pick.seriesId))
            .all<{ id: string }>()
        : { results: [] };
      if (validSeries.results.length !== payload.picks.length) {
        throw new ApiError(
          422,
          "EDITOR_PICK_SERIES_INVALID",
          "One or more selected series no longer exist.",
        );
      }
      await env.DB.batch([
        env.DB.prepare("DELETE FROM editor_picks"),
        ...payload.picks.map((pick) =>
          env.DB!.prepare(
            `INSERT INTO editor_picks
             (id, series_id, category_label, short_description, sort_order,
              is_published)
             VALUES (?, ?, ?, ?, ?, ?)`,
          ).bind(
            `pick_${pick.seriesId}`.slice(0, 120),
            pick.seriesId,
            pick.categoryLabel,
            pick.shortDescription,
            pick.sortOrder,
            pick.isPublished ? 1 : 0,
          ),
        ),
        env.DB.prepare(
          `INSERT INTO audit_logs
           (id, actor_user_id, action, target_type, target_id, request_id,
            new_value_json)
           VALUES (?, ?, 'editor-picks.replace', 'EDITORIAL', 'homepage', ?, ?)`,
        ).bind(
          randomId(),
          actor.id,
          id,
          JSON.stringify({ picks: payload.picks }),
        ),
      ]);
      return json(id, { ok: true, picks: payload.picks });
    }
    if (path === "admin/appearance") {
      const body = await request.json();
      const wrapped = z
        .object({
          settings: siteThemeSchema,
          expectedRevision: z.coerce.number().int().min(0),
        })
        .parse(body);
      return json(
        id,
        await saveSiteTheme(
          wrapped.settings,
          actor.id,
          id,
          wrapped.expectedRevision,
        ),
      );
    }
    if (path === "admin/site-configuration") {
      const body = await request.json();
      const wrapped = z
        .object({
          settings: siteConfigurationSchema,
          expectedRevision: z.coerce.number().int().min(0),
        })
        .parse(body);
      return json(
        id,
        await saveSiteConfiguration(
          wrapped.settings,
          actor.id,
          id,
          false,
          wrapped.expectedRevision,
        ),
        { headers: { "cache-control": "private, no-store" } },
      );
    }
    if (path === "admin/commercial-settings") {
      const body = await request.json();
      const wrapped = z
        .object({
          settings: commercialSettingsSchema,
          expectedRevision: z.coerce.number().int().min(0),
        })
        .parse(body);
      const current = await getCommercialSettingsDocument();
      const sensitiveChanged =
        wrapped.settings.economy.coinName !==
          current.settings.economy.coinName ||
        wrapped.settings.economy.coinPlural !==
          current.settings.economy.coinPlural ||
        wrapped.settings.economy.coinIcon !==
          current.settings.economy.coinIcon ||
        wrapped.settings.economy.coinIconKey !==
          current.settings.economy.coinIconKey ||
        wrapped.settings.economy.premiumEconomyPublic !==
          current.settings.economy.premiumEconomyPublic;
      if (sensitiveChanged) requireOwner(actor);
      return json(
        id,
        await saveCommercialSettings(
          wrapped.settings,
          actor.id,
          id,
          wrapped.expectedRevision,
        ),
        { headers: { "cache-control": "private, no-store" } },
      );
    }
    if (path === "admin/chapters") {
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Chapter access management is unavailable.",
        );
      }
      const payload = adminChapterAccessSchema.parse(await request.json());
      const publishedAt = normalizeOptionalDate(
        payload.publishedAt,
        "Publication date",
      );
      const current = await env.DB.prepare(
        `SELECT c.id,
                c.series_id AS seriesId,
                c.team_id AS teamId,
                c.chapter_number AS chapterNumber,
                c.title,
                c.volume,
                c.language,
                c.format,
                c.version,
                c.release_notes AS releaseNotes,
                c.state,
                c.access_type AS accessType,
                c.price_onyx AS priceOnyx,
                c.published_at AS publishedAt,
                c.page_count AS pageCount,
                c.revision,
                s.rights_status AS rightsStatus
           FROM chapters c
           JOIN series s ON s.id = c.series_id
          WHERE c.id = ?
          LIMIT 1`,
      )
        .bind(payload.id)
        .first<{
          id: string;
          seriesId: string;
          teamId: string | null;
          chapterNumber: string;
          title: string;
          volume: string | null;
          language: string;
          format: string;
          version: number;
          releaseNotes: string;
          state: string;
          accessType: string;
          priceOnyx: number;
          publishedAt: string | null;
          pageCount: number;
          revision: number;
          rightsStatus: string;
        }>();
      if (!current) {
        throw new ApiError(
          404,
          "CHAPTER_NOT_FOUND",
          "This chapter no longer exists.",
        );
      }
      if (Number(current.revision) !== payload.expectedRevision) {
        throw new ApiError(
          409,
          "STALE_VERSION",
          "Another administrator changed this chapter. Reload it before saving.",
        );
      }
      const duplicate = await env.DB.prepare(
        `SELECT id
           FROM chapters
          WHERE series_id = ?
            AND id <> ?
            AND LTRIM(chapter_number, '0') = LTRIM(?, '0')
            AND language = ?
            AND COALESCE(team_id, '') = COALESCE(?, '')
            AND version = ?
            AND state IN ('DRAFT', 'READY_FOR_REVIEW', 'PUBLISHED')
          LIMIT 1`,
      )
        .bind(
          current.seriesId,
          payload.id,
          payload.chapterNumber,
          payload.language,
          current.teamId,
          payload.version,
        )
        .first();
      if (duplicate) {
        throw new ApiError(
          409,
          "DUPLICATE_RELEASE",
          "This team already has the same chapter, language, and version.",
        );
      }
      const priceOnyx =
        payload.accessType === "PAID" ? payload.priceOnyx : 0;
      const paidEconomyRevision =
        payload.accessType === "PAID"
          ? (await requirePaidEconomyPublicDocument()).revision
          : null;
      if (
        payload.state === "PUBLISHED" &&
        Number(current.pageCount) <= 0 &&
        current.rightsStatus !== "DEMO_ORIGINAL"
      ) {
        throw new ApiError(
          409,
          "CHAPTER_PAGES_REQUIRED",
          "Process and validate at least one chapter page before publishing.",
        );
      }
      const pages = await env.DB.prepare(
        `SELECT id
           FROM chapter_pages
          WHERE chapter_id = ?
          ORDER BY page_index`,
      )
        .bind(payload.id)
        .all<{ id: string }>();
      const storedPageIds = new Set(pages.results.map((page) => page.id));
      if (
        payload.pageOrder.length !== pages.results.length ||
        payload.pageOrder.some((pageId) => !storedPageIds.has(pageId))
      ) {
        throw new ApiError(
          409,
          "PAGE_ORDER_CHANGED",
          "The chapter page list changed. Reload before saving its order.",
        );
      }
      const nextRevision = payload.expectedRevision + 1;
      const mutationGuard = `EXISTS (
        SELECT 1 FROM chapters
        WHERE id = ? AND revision = ?
      )
      AND ${
        paidEconomyRevision === null
          ? "1 = 1"
          : paidEconomyRevisionGuardSql(paidEconomyRevision)
      }`;
      const pageStatements =
        payload.pageOrder.length > 0
          ? [
              env.DB.prepare(
                `UPDATE chapter_pages
                    SET page_index = page_index + 100000
                  WHERE chapter_id = ?
                    AND ${mutationGuard}`,
              ).bind(
                payload.id,
                payload.id,
                payload.expectedRevision,
              ),
              ...payload.pageOrder.map((pageId, index) =>
                env.DB!.prepare(
                  `UPDATE chapter_pages
                      SET page_index = ?
                    WHERE id = ?
                      AND chapter_id = ?
                      AND ${mutationGuard}`,
                ).bind(
                  index,
                  pageId,
                  payload.id,
                  payload.id,
                  payload.expectedRevision,
                ),
              ),
            ]
          : [];
      const chapterUpdate = env.DB.prepare(
        `UPDATE chapters
            SET chapter_number = ?,
                title = ?,
                volume = ?,
                language = ?,
                format = ?,
                version = ?,
                release_notes = ?,
                state = ?,
                access_type = ?,
                price_onyx = ?,
                free_at = NULL,
                published_at = CASE
                  WHEN ? = 'PUBLISHED'
                    THEN COALESCE(?, published_at, CURRENT_TIMESTAMP)
                  ELSE published_at
                END,
                revision = revision + 1,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND revision = ?
            AND ${
              paidEconomyRevision === null
                ? "1 = 1"
                : paidEconomyRevisionGuardSql(paidEconomyRevision)
            }`,
      ).bind(
        payload.chapterNumber,
        payload.title,
        payload.volume || null,
        payload.language,
        payload.format,
        payload.version,
        payload.releaseNotes,
        payload.state,
        payload.accessType,
        priceOnyx,
        payload.state,
        publishedAt,
        payload.id,
        payload.expectedRevision,
      );
      const results = await env.DB.batch([
        ...pageStatements,
        chapterUpdate,
        env.DB.prepare(
          `INSERT INTO audit_logs
           (id, actor_user_id, action, target_type, target_id, request_id,
            reason, old_value_json, new_value_json)
           SELECT ?, ?, 'chapter.access.update', 'CHAPTER', ?, ?, ?, ?, ?
           WHERE changes() = 1`,
        ).bind(
          randomId(),
          actor.id,
          payload.id,
          id,
          payload.reason,
          JSON.stringify(current),
          JSON.stringify({
            chapterNumber: payload.chapterNumber,
            title: payload.title,
            volume: payload.volume || null,
            language: payload.language,
            format: payload.format,
            version: payload.version,
            releaseNotes: payload.releaseNotes,
            state: payload.state,
            accessType: payload.accessType,
            priceOnyx,
            publishedAt,
            pageOrder: payload.pageOrder,
            revision: nextRevision,
          }),
        ),
      ]);
      const updateResult = results[pageStatements.length];
      if (!updateResult?.meta.changes) {
        if (paidEconomyRevision !== null) {
          await assertPaidEconomyRevisionFresh(paidEconomyRevision);
        }
        throw new ApiError(
          409,
          "STALE_VERSION",
          "Another administrator changed this chapter. Reload it before saving.",
        );
      }
      return json(
        id,
        {
          id: payload.id,
          state: payload.state,
          chapterNumber: payload.chapterNumber,
          title: payload.title,
          accessType: payload.accessType,
          priceOnyx,
          publishedAt,
          pageOrder: payload.pageOrder,
          revision: nextRevision,
        },
        { headers: { "cache-control": "private, no-store" } },
      );
    }
    if (path === "admin/teams") {
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Team management is unavailable.",
        );
      }
      const payload = adminTeamUpdateSchema.parse(await request.json());
      const current = await env.DB.prepare(
        `SELECT id,
                name,
                verification_status AS verificationStatus,
                revision
           FROM teams
          WHERE id = ?
          LIMIT 1`,
      )
        .bind(payload.id)
        .first<{
          id: string;
          name: string;
          verificationStatus: string;
          revision: number;
        }>();
      if (!current) {
        throw new ApiError(
          404,
          "TEAM_NOT_FOUND",
          "This team no longer exists.",
        );
      }
      if (Number(current.revision) !== payload.expectedRevision) {
        throw new ApiError(
          409,
          "STALE_VERSION",
          "Another administrator changed this team. Reload it before saving.",
        );
      }
      if (
        payload.verificationStatus === "VERIFIED" &&
        current.verificationStatus !== "VERIFIED"
      ) {
        if (current.verificationStatus === "PENDING") {
          throw new ApiError(
            409,
            "TEAM_OWNERSHIP_REVIEW_REQUIRED",
            "Approve the pending ownership claim from Team requests; that review activates the team atomically.",
          );
        }
        const validatedOwnership = await env.DB.prepare(
          `SELECT 1
             FROM team_ownership_claims claim
             JOIN team_links link
               ON link.team_id = claim.team_id
              AND link.url = claim.proof_value
             JOIN team_memberships owner
               ON owner.team_id = claim.team_id
              AND owner.user_id = claim.claimant_user_id
              AND owner.membership_role = 'OWNER'
              AND owner.status = 'ACTIVE'
            WHERE claim.team_id = ?
              AND claim.status = 'APPROVED'
            LIMIT 1`,
        ).bind(payload.id).first();
        if (!validatedOwnership) {
          throw new ApiError(
            409,
            "TEAM_OWNERSHIP_REVIEW_REQUIRED",
            "Verify a link-control ownership claim before activating this team.",
          );
        }
      }
      const teamResults = await env.DB.batch([
        env.DB.prepare(
          `UPDATE teams
              SET verification_status = ?,
                  revision = revision + 1,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND revision = ?
              AND (
                ? <> 'VERIFIED' OR verification_status = 'VERIFIED'
                OR (verification_status = 'SUSPENDED' AND EXISTS (
                  SELECT 1 FROM team_ownership_claims claim
                  JOIN team_links link ON link.team_id = claim.team_id AND link.url = claim.proof_value
                  JOIN team_memberships owner ON owner.team_id = claim.team_id
                   AND owner.user_id = claim.claimant_user_id
                   AND owner.membership_role = 'OWNER' AND owner.status = 'ACTIVE'
                 WHERE claim.team_id = teams.id AND claim.status = 'APPROVED'
                ))
              )`,
        ).bind(
          payload.verificationStatus,
          payload.id,
          payload.expectedRevision,
          payload.verificationStatus,
        ),
        auditStatement(
          env.DB,
          actor,
          id,
          {
            action: "team.status.update",
            category: "TEAMS_PERMISSIONS",
            sourceArea: "TEAM_MANAGEMENT",
            targetType: "TEAM",
            targetId: payload.id,
            targetLabel: current.name,
            oldValue: {
              verificationStatus: current.verificationStatus,
              revision: current.revision,
            },
            newValue: {
              verificationStatus: payload.verificationStatus,
              revision: payload.expectedRevision + 1,
            },
          },
          "changes() = 1",
        ),
      ]);
      if (!teamResults[0]?.meta.changes) {
        throw new ApiError(
          409,
          "STALE_VERSION",
          "Another administrator changed this team. Reload it before saving.",
        );
      }
      return json(id, {
        id: payload.id,
        verificationStatus: payload.verificationStatus,
        revision: payload.expectedRevision + 1,
      });
    }
    if (path === "admin/users") {
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "User management is unavailable.",
        );
      }
      const payload = adminUserUpdateSchema.parse(await request.json());
      if (payload.id === actor.id) {
        throw new ApiError(
          409,
          "SELF_ADMIN_CHANGE_BLOCKED",
          "Use a second administrator to change your own role or account status.",
        );
      }
      const current = await env.DB.prepare(
        `SELECT id,
                email,
                primary_role AS primaryRole,
                status,
                access_revision AS accessRevision
           FROM users
          WHERE id = ?
          LIMIT 1`,
      )
        .bind(payload.id)
        .first<{
          id: string;
          email: string;
          primaryRole: string;
          status: string;
          accessRevision: number;
        }>();
      if (!current) {
        throw new ApiError(
          404,
          "USER_NOT_FOUND",
          "This user no longer exists.",
        );
      }
      const currentRoleRows = await env.DB.prepare(
        `SELECT role FROM user_roles WHERE user_id = ? ORDER BY role`,
      )
        .bind(payload.id)
        .all<{ role: string }>();
      const currentRoles = [
        ...new Set(
          (currentRoleRows.results.length
            ? currentRoleRows.results.map((entry) => entry.role)
            : [current.primaryRole]),
        ),
      ];
      const nextRoles = [
        ...new Set(payload.roles ?? currentRoles),
      ];
      const nextRole = highestRole(nextRoles);
      const nextStatus = payload.status ?? current.status;
      if (
        payload.expectedAccessRevision !== Number(current.accessRevision) ||
        payload.expectedStatus !== current.status
      ) {
        throw new ApiError(
          409,
          "USER_ACCESS_CHANGED",
          "Another administrator changed this account. Reload before saving.",
        );
      }
      const privilegedRoles = new Set([
        "OWNER",
        "ADMINISTRATOR",
        "MANAGER",
      ]);
      if (
        !actor.roles.includes("OWNER") &&
        ([...currentRoles, ...nextRoles].some((role) =>
          privilegedRoles.has(role),
        ))
      ) {
        throw new ApiError(
          403,
          "OWNER_ROLE_REVIEW_REQUIRED",
          "Only the owner may change protected administrative roles or accounts.",
        );
      }
      if (
        currentRoles.includes("OWNER") &&
        (!nextRoles.includes("OWNER") || nextStatus !== "ACTIVE")
      ) {
        const otherOwners = await env.DB.prepare(
          `SELECT COUNT(*) AS count
             FROM user_roles ur
             JOIN users owner_user ON owner_user.id = ur.user_id
            WHERE ur.role = 'OWNER'
              AND owner_user.status = 'ACTIVE'
              AND ur.user_id <> ?`,
        )
          .bind(payload.id)
          .first<{ count: number }>();
        if (Number(otherOwners?.count ?? 0) === 0) {
          throw new ApiError(
            409,
            "FINAL_OWNER_PROTECTED",
            "Assign another active owner before changing the final owner account.",
          );
        }
      }
      const updateToken = `access-${randomId()}`;
      const nextRevision = Number(current.accessRevision) + 1;
      const results = await env.DB.batch([
        env.DB.prepare(
          `UPDATE users
              SET primary_role = ?,
                  status = ?,
                  access_revision = access_revision + 1,
                  access_update_token = ?,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND access_revision = ?
              AND status = ?
              AND (
                ? = 0
                OR EXISTS (
                  SELECT 1
                    FROM user_roles owner_role
                    JOIN users active_owner
                      ON active_owner.id = owner_role.user_id
                   WHERE owner_role.role = 'OWNER'
                     AND active_owner.status = 'ACTIVE'
                     AND owner_role.user_id <> ?
                )
              )`,
        ).bind(
          nextRole,
          nextStatus,
          updateToken,
          payload.id,
          payload.expectedAccessRevision,
          payload.expectedStatus,
          currentRoles.includes("OWNER") &&
            (!nextRoles.includes("OWNER") || nextStatus !== "ACTIVE")
            ? 1
            : 0,
          payload.id,
        ),
        env.DB.prepare(
          `DELETE FROM user_roles
            WHERE user_id = ?
              AND EXISTS (
                SELECT 1 FROM users
                 WHERE id = ?
                   AND access_update_token = ?
              )`,
        ).bind(payload.id, payload.id, updateToken),
        ...nextRoles.map((role) =>
          env.DB.prepare(
            `INSERT INTO user_roles
             (user_id, role, assigned_by_user_id)
             SELECT ?, ?, ?
              WHERE EXISTS (
                SELECT 1 FROM users
                 WHERE id = ?
                   AND access_update_token = ?
              )`,
          ).bind(payload.id, role, actor.id, payload.id, updateToken),
        ),
        env.DB.prepare(
          `UPDATE admin_mfa_sessions SET revoked_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND revoked_at IS NULL
              AND EXISTS (SELECT 1 FROM users WHERE id = ? AND access_update_token = ?)`,
        ).bind(payload.id, payload.id, updateToken),
        env.DB.prepare(
          `UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND revoked_at IS NULL
              AND EXISTS (SELECT 1 FROM users WHERE id = ? AND access_update_token = ?)`,
        ).bind(payload.id, payload.id, updateToken),
        env.DB.prepare(
          `UPDATE users
              SET access_update_token = NULL
            WHERE id = ?
              AND access_update_token = ?`,
        ).bind(payload.id, updateToken),
        env.DB.prepare(
          `INSERT INTO audit_logs
           (id, actor_user_id, action, target_type, target_id, request_id,
            old_value_json, new_value_json)
           SELECT ?, ?, 'user.access.update', 'USER', ?, ?, ?, ?
           WHERE changes() = 1`,
        ).bind(
          randomId(),
          actor.id,
          payload.id,
          id,
          JSON.stringify({
            roles: currentRoles,
            primaryRole: current.primaryRole,
            status: current.status,
            accessRevision: current.accessRevision,
          }),
          JSON.stringify({
            roles: nextRoles,
            primaryRole: nextRole,
            status: nextStatus,
            accessRevision: nextRevision,
          }),
        ),
      ]);
      if (!results[0]?.meta.changes) {
        if (
          currentRoles.includes("OWNER") &&
          (!nextRoles.includes("OWNER") || nextStatus !== "ACTIVE")
        ) {
          const activeOtherOwner = await env.DB.prepare(
            `SELECT 1
               FROM user_roles ur
               JOIN users owner_user ON owner_user.id = ur.user_id
              WHERE ur.role = 'OWNER'
                AND owner_user.status = 'ACTIVE'
                AND ur.user_id <> ?
              LIMIT 1`,
          )
            .bind(payload.id)
            .first();
          if (!activeOtherOwner) {
            throw new ApiError(
              409,
              "FINAL_OWNER_PROTECTED",
              "Assign another active owner before changing the final owner account.",
            );
          }
        }
        throw new ApiError(
          409,
          "USER_ACCESS_CHANGED",
          "Another administrator changed this account. Reload before saving.",
        );
      }
      return json(id, {
        id: payload.id,
        primaryRole: nextRole,
        roles: nextRoles,
        status: nextStatus,
        accessRevision: nextRevision,
      });
    }
    const wrapped = z
      .object({
        settings: discussionSettingsSchema,
        expectedRevision: z.coerce.number().int().min(0),
      })
      .parse(await request.json());
    return json(
      id,
      await saveDiscussionSettings(
        wrapped.settings,
        actor.id,
        id,
        wrapped.expectedRevision,
      ),
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        id,
        new ApiError(
          422,
          "VALIDATION_ERROR",
          "Please correct the highlighted settings.",
          error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        ),
      );
    }
    return errorResponse(id, error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const id = requestId(request);
  try {
    const { resource } = await context.params;
    const path = pathOf(resource);
    if (path === "workspace/comment-moderation") {
      assertSameOrigin(request);
      const actor = await requireActor();
      const payload = workspaceCommentModerationSchema.parse(
        await request.json(),
      );
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Discussion moderation is unavailable.",
        );
      }
      const comment = await env.DB.prepare(
        `SELECT dc.id,
                dc.user_id AS userId,
                dc.series_slug AS seriesSlug,
                dc.parent_id AS parentId,
                dc.body,
                dc.spoiler,
                dc.moderation_status AS moderationStatus,
                dc.pinned_at AS pinnedAt,
                dc.revision,
                dc.updated_at AS updatedAt,
                u.primary_role AS userRole,
                u.status AS userStatus,
                u.display_name AS userDisplayName
           FROM discussion_comments dc
           JOIN users u ON u.id = dc.user_id
          WHERE dc.id = ?
          LIMIT 1`,
      )
        .bind(payload.commentId)
        .first<{
          id: string;
          userId: string;
          seriesSlug: string;
          parentId: string | null;
          body: string;
          spoiler: number;
          moderationStatus: string;
          pinnedAt: string | null;
          revision: number;
          updatedAt: string;
          userRole: string;
          userStatus: string;
          userDisplayName: string;
        }>();
      if (!comment || comment.seriesSlug !== payload.seriesSlug) {
        throw new ApiError(
          404,
          "COMMENT_NOT_FOUND",
          "This comment is no longer available in the selected series.",
        );
      }
      if (Number(comment.revision) !== payload.expectedRevision) {
        throw new ApiError(
          409,
          "COMMENT_CHANGED",
          "Another moderator or the author changed this comment. Reload it before continuing.",
        );
      }
      const targetRoleRows = await env.DB.prepare(
        `SELECT role
           FROM user_roles
          WHERE user_id = ?
          ORDER BY role`,
      )
        .bind(comment.userId)
        .all<{ role: string }>();
      const targetRoles = [
        ...new Set(
          targetRoleRows.results.length
            ? targetRoleRows.results.map((entry) => entry.role)
            : [comment.userRole],
        ),
      ];
      await requireSeriesModerator(actor, payload.seriesSlug);
      if (
        payload.action === "SUSPEND_USER" &&
        !isAdminActor(actor)
      ) {
        throw new ApiError(
          403,
          "ADMINISTRATOR_REQUIRED",
          "Only an administrator can suspend an account platform-wide.",
        );
      }
      if (
        payload.action === "SUSPEND_USER" &&
        targetRoles.some((role) =>
          ["OWNER", "ADMINISTRATOR", "MANAGER", "MODERATOR"].includes(role),
        ) &&
        !actor.roles.includes("OWNER")
      ) {
        throw new ApiError(
          403,
          "PROTECTED_ACCOUNT_SUSPENSION_BLOCKED",
          "Only the owner may suspend another protected administrative account.",
        );
      }
      if (
        payload.action === "SUSPEND_USER" &&
        comment.userId === actor.id
      ) {
        throw new ApiError(
          409,
          "SELF_SUSPENSION_BLOCKED",
          "You cannot suspend your own account.",
        );
      }
      if (
        payload.action === "SUSPEND_USER" &&
        targetRoles.includes("OWNER")
      ) {
        const ownerCount = await env.DB.prepare(
          `SELECT COUNT(DISTINCT owner_user.id) AS count
             FROM users owner_user
             LEFT JOIN user_roles owner_role
               ON owner_role.user_id = owner_user.id
            WHERE owner_user.status = 'ACTIVE'
              AND (
                owner_user.primary_role = 'OWNER'
                OR owner_role.role = 'OWNER'
              )`,
        ).first<{ count: number }>();
        if (Number(ownerCount?.count ?? 0) <= 1) {
          throw new ApiError(
            409,
            "FINAL_OWNER_REQUIRED",
            "The final active owner cannot be suspended.",
          );
        }
      }

      const statements = [];
      let commentMutationStatementIndex = -1;
      let suspensionStatementIndex = -1;
      let suspensionAuditId: string | null = null;
      let deletedMedia: Array<{ id: string; objectKey: string }> = [];
      if (payload.action === "EDIT") {
        commentMutationStatementIndex = statements.length + 1;
        statements.push(
          env.DB.prepare(
            `INSERT INTO discussion_comment_edits
             (id, comment_id, editor_user_id, prior_body, prior_spoiler)
             SELECT ?, ?, ?, ?, ?
              WHERE EXISTS (
                SELECT 1 FROM discussion_comments
                 WHERE id = ? AND revision = ?
              )`,
          ).bind(
            randomId(),
            comment.id,
            actor.id,
            comment.body,
            comment.spoiler,
            comment.id,
            payload.expectedRevision,
          ),
          env.DB.prepare(
            `UPDATE discussion_comments
                SET body = ?,
                    edited_at = CURRENT_TIMESTAMP,
                    revision = revision + 1,
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = ? AND revision = ?`,
          ).bind(payload.body, comment.id, payload.expectedRevision),
        );
      } else if (payload.action === "HIDE") {
        commentMutationStatementIndex = statements.length;
        statements.push(
          env.DB.prepare(
            `UPDATE discussion_comments
                SET moderation_status = 'HIDDEN',
                    revision = revision + 1,
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = ? AND revision = ?
                AND moderation_status <> 'DELETED'`,
          ).bind(comment.id, payload.expectedRevision),
        );
      } else if (payload.action === "RESTORE") {
        commentMutationStatementIndex = statements.length;
        statements.push(
          env.DB.prepare(
            `UPDATE discussion_comments
                SET moderation_status = 'VISIBLE',
                    deleted_at = NULL,
                    deleted_by_user_id = NULL,
                    deletion_reason = NULL,
                    revision = revision + 1,
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = ? AND revision = ?
                AND moderation_status = 'HIDDEN'`,
          ).bind(comment.id, payload.expectedRevision),
        );
      } else if (payload.action === "DELETE") {
        if (env.BUCKET) {
          const media = await env.DB.prepare(
            `SELECT id, object_key AS objectKey
               FROM discussion_media
              WHERE comment_id = ?
                AND moderation_status <> 'DELETED'`,
          )
            .bind(comment.id)
            .all<{ id: string; objectKey: string }>();
          deletedMedia = media.results;
        }
        commentMutationStatementIndex = statements.length;
        statements.push(
          env.DB.prepare(
            `UPDATE discussion_comments
                SET body = '',
                    spoiler = 0,
                    moderation_status = 'DELETED',
                    deleted_at = CURRENT_TIMESTAMP,
                    deleted_by_user_id = ?,
                    deletion_reason = ?,
                    revision = revision + 1,
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = ? AND revision = ?
                AND moderation_status <> 'DELETED'`,
          ).bind(
            actor.id,
            payload.reason,
            comment.id,
            payload.expectedRevision,
          ),
          env.DB.prepare(
            `DELETE FROM discussion_reactions
              WHERE comment_id = ?
                AND EXISTS (
                  SELECT 1 FROM discussion_comments
                   WHERE id = ? AND revision = ?
                     AND moderation_status = 'DELETED'
                )`,
          ).bind(
            comment.id,
            comment.id,
            payload.expectedRevision + 1,
          ),
          env.DB.prepare(
            `DELETE FROM discussion_votes
              WHERE comment_id = ?
                AND EXISTS (
                  SELECT 1 FROM discussion_comments
                   WHERE id = ? AND revision = ?
                     AND moderation_status = 'DELETED'
                )`,
          ).bind(
            comment.id,
            comment.id,
            payload.expectedRevision + 1,
          ),
          env.DB.prepare(
            `UPDATE discussion_media
                SET moderation_status = 'DELETED',
                    updated_at = CURRENT_TIMESTAMP
              WHERE comment_id = ?
                AND EXISTS (
                  SELECT 1 FROM discussion_comments
                   WHERE id = ? AND revision = ?
                     AND moderation_status = 'DELETED'
                )`,
          ).bind(
            comment.id,
            comment.id,
            payload.expectedRevision + 1,
          ),
        );
      } else if (payload.action === "PIN" || payload.action === "UNPIN") {
        if (comment.parentId) {
          throw new ApiError(
            422,
            "TOP_LEVEL_COMMENT_REQUIRED",
            "Only a top-level comment can be pinned.",
          );
        }
        commentMutationStatementIndex = statements.length;
        statements.push(
          env.DB.prepare(
            `UPDATE discussion_comments
                SET pinned_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END,
                    pinned_by_user_id = CASE WHEN ? = 1 THEN ? ELSE NULL END,
                    revision = revision + 1,
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = ? AND revision = ?
                AND moderation_status <> 'DELETED'`,
          ).bind(
            payload.action === "PIN" ? 1 : 0,
            payload.action === "PIN" ? 1 : 0,
            actor.id,
            comment.id,
            payload.expectedRevision,
          ),
        );
      } else if (payload.action === "BAN_SERIES") {
        statements.push(
          env.DB.prepare(
            `INSERT INTO discussion_user_restrictions
             (series_slug, user_id, banned_by_user_id, reason)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(series_slug, user_id) DO UPDATE SET
               banned_by_user_id = excluded.banned_by_user_id,
               reason = excluded.reason,
               created_at = CURRENT_TIMESTAMP`,
          ).bind(
            payload.seriesSlug,
            comment.userId,
            actor.id,
            payload.reason,
          ),
        );
      } else if (payload.action === "UNBAN_SERIES") {
        statements.push(
          env.DB.prepare(
            `DELETE FROM discussion_user_restrictions
              WHERE series_slug = ?
                AND user_id = ?`,
          ).bind(payload.seriesSlug, comment.userId),
        );
      } else if (payload.action === "SUSPEND_USER") {
        suspensionStatementIndex = statements.length;
        suspensionAuditId = randomId();
        statements.push(
          env.DB.prepare(
            `UPDATE users
                SET status = 'SUSPENDED',
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
                AND primary_role = ?
                AND status = ?
                AND (
                  primary_role <> 'OWNER'
                  OR status <> 'ACTIVE'
                  OR EXISTS (
                    SELECT 1
                      FROM users active_owner
                     WHERE active_owner.primary_role = 'OWNER'
                       AND active_owner.status = 'ACTIVE'
                       AND active_owner.id <> users.id
                  )
                )`,
          ).bind(comment.userId, comment.userRole, comment.userStatus),
          env.DB.prepare(
            `INSERT INTO audit_logs
             (id, actor_user_id, actor_role, action, category, source_area,
              target_type, target_id, target_label, request_id, reason,
              old_value_json, new_value_json)
             SELECT ?, ?, ?, 'user.suspend', 'USERS_ROLES',
                    'COMMENT_MODERATION', 'USER', ?, ?, ?, ?, ?, ?
             WHERE changes() = 1`,
          ).bind(
            suspensionAuditId,
            actor.id,
            actor.primaryRole,
            comment.userId,
            comment.userDisplayName,
            id,
            payload.reason ?? null,
            JSON.stringify({
              primaryRole: comment.userRole,
              status: comment.userStatus,
            }),
            JSON.stringify({
              primaryRole: comment.userRole,
              status: "SUSPENDED",
            }),
          ),
        );
      }
      const commentAuditCondition =
        commentMutationStatementIndex >= 0
          ? `WHERE EXISTS (
               SELECT 1 FROM discussion_comments
                WHERE id = ? AND revision = ?
             )`
          : payload.action === "SUSPEND_USER"
            ? `WHERE EXISTS (
                 SELECT 1 FROM audit_logs
                  WHERE id = ?
               )`
            : "";
      const commentAudit = env.DB.prepare(
        `INSERT INTO audit_logs
         (id, actor_user_id, action, target_type, target_id, request_id,
          reason, old_value_json, new_value_json)
         SELECT ?, ?, ?, 'COMMENT', ?, ?, ?, ?, ?
         ${commentAuditCondition}`,
      ).bind(
        randomId(),
        actor.id,
        `workspace.comment.${payload.action.toLowerCase()}`,
        comment.id,
        id,
        payload.reason ?? null,
        JSON.stringify({
          bodyLength: comment.body.length,
          moderationStatus: comment.moderationStatus,
          pinned: Boolean(comment.pinnedAt),
          userStatus: comment.userStatus,
        }),
        JSON.stringify({
          action: payload.action,
          seriesSlug: payload.seriesSlug,
          targetUserId: comment.userId,
        }),
        ...(commentMutationStatementIndex >= 0
          ? [comment.id, payload.expectedRevision + 1]
          : payload.action === "SUSPEND_USER" && suspensionAuditId
            ? [suspensionAuditId]
            : []),
      );
      statements.push(commentAudit);
      const results = await env.DB.batch(statements);
      if (
        commentMutationStatementIndex >= 0 &&
        !results[commentMutationStatementIndex]?.meta.changes
      ) {
        throw new ApiError(
          409,
          "COMMENT_CHANGED",
          "Another moderator or the author changed this comment. Reload it before continuing.",
        );
      }
      if (
        suspensionStatementIndex >= 0 &&
        !results[suspensionStatementIndex]?.meta.changes
      ) {
        if (comment.userRole === "OWNER") {
          const activeOtherOwner = await env.DB.prepare(
            `SELECT 1
               FROM users
              WHERE primary_role = 'OWNER'
                AND status = 'ACTIVE'
                AND id <> ?
              LIMIT 1`,
          )
            .bind(comment.userId)
            .first();
          if (!activeOtherOwner) {
            throw new ApiError(
              409,
              "FINAL_OWNER_REQUIRED",
              "The final active owner cannot be suspended.",
            );
          }
        }
        throw new ApiError(
          409,
          "USER_ACCESS_CHANGED",
          "This account changed before suspension. Reload and review its current role.",
        );
      }
      if (deletedMedia.length > 0 && env.BUCKET) {
        await Promise.all(
          deletedMedia.map(async (media) => {
            const removed = await deleteMediaObject(
              env.DB!,
              env.BUCKET!,
              media.objectKey,
              {
                mediaKind: "DISCUSSION_ATTACHMENT",
                targetType: "DISCUSSION_MEDIA",
                targetId: media.id,
                reason: "Deleted moderated comment attachment",
              },
            );
            if (!removed) {
              await writeAudit(actor, id, {
                action: "discussion.media.cleanup.failed",
                category: "SYSTEM_MAINTENANCE",
                sourceArea: "COMMENT_MODERATION",
                result: "FAILURE",
                targetType: "DISCUSSION_MEDIA",
                targetId: media.id,
                reason: "The private media object could not be removed and requires a cleanup retry.",
              }).catch(() => undefined);
            }
          }),
        );
      }
      return json(id, {
        ok: true,
        commentId: comment.id,
        action: payload.action,
      });
    }
    if (path === "account-settings") {
      assertSameOrigin(request);
      const actor = await requireActor();
      const payload = accountSettingsSchema.parse(await request.json());
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Account settings are unavailable.",
        );
      }
      const current = await env.DB.prepare(
        `SELECT theme,
                content_language AS contentLanguage,
                reader_mode AS readerMode,
                mature_content AS matureContent,
                settings_json AS settingsJson
           FROM user_preferences
          WHERE user_id = ?
          LIMIT 1`,
      )
        .bind(actor.id)
        .first<{
          theme: string;
          contentLanguage: string;
          readerMode: string;
          matureContent: number;
          settingsJson: string;
        }>();
      let currentSettings: Record<string, unknown> = {};
      try {
        currentSettings = JSON.parse(current?.settingsJson ?? "{}") as Record<
          string,
          unknown
        >;
      } catch {
        currentSettings = {};
      }
      const nextSettings = {
        ...currentSettings,
        ...(payload.readingDirection
          ? { readingDirection: payload.readingDirection }
          : {}),
        ...(payload.brightness !== undefined
          ? { brightness: payload.brightness }
          : {}),
        ...(payload.readerTypeDefaults
          ? { readerTypeDefaults: payload.readerTypeDefaults }
          : {}),
        ...(payload.commentReplyBadge !== undefined
          ? { commentReplyBadge: payload.commentReplyBadge }
          : {}),
        ...(payload.readerSettings
          ? { readerSettings: payload.readerSettings }
          : {}),
        ...(payload.notifications
          ? { notifications: payload.notifications }
          : {}),
        ...(payload.privacy ? { privacy: payload.privacy } : {}),
      };
      const statements = [
        env.DB.prepare(
          `INSERT INTO user_preferences
           (user_id, theme, content_language, reader_mode, mature_content,
            settings_json, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(user_id) DO UPDATE SET
             content_language = excluded.content_language,
             reader_mode = excluded.reader_mode,
             mature_content = excluded.mature_content,
             settings_json = excluded.settings_json,
             updated_at = CURRENT_TIMESTAMP`,
        ).bind(
          actor.id,
          current?.theme ?? "SYSTEM",
          payload.contentLanguage ?? current?.contentLanguage ?? "en",
          payload.readerMode ?? current?.readerMode ?? "VERTICAL",
          (payload.matureContent ?? Boolean(current?.matureContent)) ? 1 : 0,
          JSON.stringify(nextSettings),
        ),
        env.DB.prepare(
          `INSERT INTO audit_logs
           (id, actor_user_id, action, target_type, target_id, request_id,
            new_value_json)
           VALUES (?, ?, 'account.settings.update', 'USER', ?, ?, ?)`,
        ).bind(
          randomId(),
          actor.id,
          actor.id,
          id,
          JSON.stringify({
            fields: Object.keys(payload),
          }),
        ),
      ];
      if (payload.displayName) {
        statements.unshift(
          env.DB.prepare(
            `UPDATE users
                SET display_name = ?, updated_at = CURRENT_TIMESTAMP
              WHERE id = ?`,
          ).bind(payload.displayName, actor.id),
        );
      }
      await env.DB.batch(statements);
      return json(id, {
        saved: true,
        displayName: payload.displayName ?? actor.displayName,
      });
    }
    if (path === "discussion-pin") {
      assertSameOrigin(request);
      const actor = await requireActor();
      requireAdminCapability(actor, "comments.moderate.global");
      const payload = discussionPinSchema.parse(await request.json());
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Discussion moderation is unavailable.",
        );
      }
      const comment = await env.DB.prepare(
        `SELECT id, series_slug AS seriesSlug, chapter_slug AS chapterSlug,
                pinned_at AS pinnedAt
           FROM discussion_comments
          WHERE id = ?
            AND parent_id IS NULL
            AND moderation_status = 'VISIBLE'
          LIMIT 1`,
      )
        .bind(payload.commentId)
        .first<{
          id: string;
          seriesSlug: string;
          chapterSlug: string | null;
          pinnedAt: string | null;
        }>();
      if (!comment) {
        throw new ApiError(
          404,
          "COMMENT_NOT_FOUND",
          "Only a visible top-level comment can be pinned.",
        );
      }
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE discussion_comments
              SET pinned_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END,
                  pinned_by_user_id = CASE WHEN ? = 1 THEN ? ELSE NULL END,
                  revision = revision + 1,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
        ).bind(
          payload.pinned ? 1 : 0,
          payload.pinned ? 1 : 0,
          actor.id,
          payload.commentId,
        ),
        env.DB.prepare(
          `INSERT INTO audit_logs
           (id, actor_user_id, action, target_type, target_id, request_id,
            old_value_json, new_value_json)
           VALUES (?, ?, ?, 'COMMENT', ?, ?, ?, ?)`,
        ).bind(
          randomId(),
          actor.id,
          payload.pinned ? "comment.pin" : "comment.unpin",
          payload.commentId,
          id,
          JSON.stringify({ pinned: Boolean(comment.pinnedAt) }),
          JSON.stringify({
            pinned: payload.pinned,
            seriesSlug: comment.seriesSlug,
            chapterSlug: comment.chapterSlug,
          }),
        ),
      ]);
      return json(id, {
        id: payload.commentId,
        pinned: payload.pinned,
      });
    }
    if (path === "reviews") {
      assertSameOrigin(request);
      const actor = await requireActor("review.create");
      const payload = reviewUpdateSchema.parse(await request.json());
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Review storage is unavailable.",
        );
      }
      const seriesRecord = await env.DB.prepare(
        `SELECT s.id FROM series s
          WHERE s.slug = ? AND ${publicSeriesPredicate("s")}
          LIMIT 1`,
      )
        .bind(payload.seriesSlug)
        .first<{ id: string }>();
      if (!seriesRecord) {
        throw new ApiError(
          404,
          "SERIES_NOT_FOUND",
          "This series is not available for reviews.",
        );
      }
      const result = await env.DB.prepare(
        `UPDATE reviews
            SET rating = ?,
                body = ?,
                spoiler = ?,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND user_id = ?
            AND series_id = ?
            AND moderation_status = 'VISIBLE'`,
      )
        .bind(
          payload.rating,
          payload.body,
          payload.spoiler ? 1 : 0,
          payload.reviewId,
          actor.id,
          seriesRecord.id,
        )
        .run();
      if (!result.meta.changes) {
        throw new ApiError(
          404,
          "REVIEW_NOT_FOUND",
          "Your review is no longer available.",
        );
      }
      return json(id, { id: payload.reviewId, updated: true });
    }
    if (path !== "discussion-comments") {
      throw new ApiError(
        404,
        "NOT_FOUND",
        "The requested API resource does not exist.",
      );
    }
    assertSameOrigin(request);
    // Deleting an existing comment is an ownership/moderation action. It must
    // remain available even when the actor is temporarily unable to create new
    // comments.
    const actor = await requireActor();
    const payload = discussionEditSchema.parse(await request.json());
    if (!env.DB) {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "Discussion storage is unavailable.",
      );
    }
    const comment = await env.DB.prepare(
      `SELECT user_id AS userId,
              body,
              spoiler,
              moderation_status AS moderationStatus
       FROM discussion_comments
       WHERE id = ?
       LIMIT 1`,
    )
      .bind(payload.commentId)
      .first<{
        userId: string;
        body: string;
        spoiler: number;
        moderationStatus: string;
      }>();
    if (!comment || comment.moderationStatus !== "VISIBLE") {
      throw new ApiError(
        404,
        "COMMENT_NOT_FOUND",
        "This comment is no longer available.",
      );
    }
    if (comment.userId !== actor.id) {
      throw new ApiError(
        403,
        "COMMENT_OWNER_REQUIRED",
        "You can only edit your own comments.",
      );
    }
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO discussion_comment_edits
         (id, comment_id, editor_user_id, prior_body, prior_spoiler)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(
        randomId(),
        payload.commentId,
        actor.id,
        comment.body,
        comment.spoiler,
      ),
      env.DB.prepare(
        `UPDATE discussion_comments
         SET body = ?,
             spoiler = ?,
             edited_at = CURRENT_TIMESTAMP,
             revision = revision + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      ).bind(payload.body, payload.spoiler ? 1 : 0, payload.commentId),
      env.DB.prepare(
        `INSERT INTO audit_logs
         (id, actor_user_id, action, target_type, target_id, request_id, old_value_json, new_value_json)
         VALUES (?, ?, 'comment.edit', 'COMMENT', ?, ?, ?, ?)`,
      ).bind(
        randomId(),
        actor.id,
        payload.commentId,
        id,
        JSON.stringify({
          bodyLength: comment.body.length,
          spoiler: Boolean(comment.spoiler),
        }),
        JSON.stringify({
          bodyLength: payload.body.length,
          spoiler: payload.spoiler,
        }),
      ),
    ]);
    return json(id, {
      id: payload.commentId,
      body: payload.body,
      spoiler: payload.spoiler,
      edited: true,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        id,
        new ApiError(
          422,
          "VALIDATION_ERROR",
          "Write between 2 and 2,500 characters.",
          error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        ),
      );
    }
    return errorResponse(id, error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const id = requestId(request);
  try {
    const { resource } = await context.params;
    const path = pathOf(resource);

    if (path === "workspace/series") {
      assertSameOrigin(request);
      const actor = await requireActor();
      if (!isAdminActor(actor)) {
        throw new ApiError(
          410,
          "SERIES_REQUEST_REQUIRED",
          "Create a private series draft in the Upload Center and submit it for administrator approval.",
        );
      }
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Series creation is temporarily unavailable.",
        );
      }
      const contentType = request.headers.get("content-type") ?? "";
      let cover: File | null = null;
      let raw: Record<string, unknown>;
      if (contentType.includes("multipart/form-data")) {
        const form = await request.formData();
        raw = Object.fromEntries(
          [...form.entries()]
            .filter(
              ([key, value]) => key !== "cover" && typeof value === "string",
            )
            .map(([key, value]) => [key, String(value)]),
        );
        const candidate = form.get("cover");
        cover =
          candidate instanceof File && candidate.size > 0 ? candidate : null;
      } else {
        raw = (await request.json()) as Record<string, unknown>;
      }
      const payload = adminSeriesSchema.parse(raw);
      if (!payload.teamId) {
        throw new ApiError(
          422,
          "TEAM_REQUIRED",
          "Choose a team you manage for this series draft.",
        );
      }
      const managedTeam =
        isAdminActor(actor)
          ? await env.DB.prepare(
              `SELECT id
                FROM teams
                WHERE id = ?
                  AND verification_status <> 'SUSPENDED'
                  AND is_archived = 0
                LIMIT 1`,
            )
              .bind(payload.teamId)
              .first()
          : await env.DB.prepare(
              `SELECT t.id
                 FROM teams t
                 JOIN team_memberships tm ON tm.team_id = t.id
                WHERE t.id = ?
                  AND tm.user_id = ?
                  AND tm.status = 'ACTIVE'
                  AND UPPER(tm.membership_role) IN
                    ('OWNER', 'MANAGER', 'TEAM_LEADER')
                  AND t.verification_status <> 'SUSPENDED'
                  AND t.is_archived = 0
                LIMIT 1`,
            )
              .bind(payload.teamId, actor.id)
              .first();
      if (!managedTeam) {
        throw new ApiError(
          403,
          "TEAM_MANAGER_REQUIRED",
          "Only an active team manager can create a series for this team.",
        );
      }
      const duplicate = await env.DB.prepare(
        "SELECT id FROM series WHERE slug = ? LIMIT 1",
      )
        .bind(payload.slug)
        .first();
      if (duplicate) {
        throw new ApiError(
          409,
          "SERIES_SLUG_EXISTS",
          "A series already uses this URL slug.",
        );
      }
      const seriesId = `ser_${randomId()}`;
      let coverKey: string | null = null;
      if (cover) {
        if (!env.BUCKET) {
          throw new ApiError(
            503,
            "MEDIA_UNAVAILABLE",
            "Series cover storage is unavailable.",
          );
        }
        if (cover.size > 5 * 1024 * 1024) {
          throw new ApiError(
            413,
            "COVER_TOO_LARGE",
            "Series covers must be 5 MB or smaller.",
          );
        }
        const bytes = new Uint8Array(await cover.arrayBuffer());
        const detected = detectedImageType(bytes);
        if (!detected || !chapterImageTypes.has(detected)) {
          throw new ApiError(
            415,
            "COVER_TYPE_INVALID",
            "Use a verified JPEG, PNG, or WebP cover.",
          );
        }
        const dimensions = imageDimensions(bytes, detected);
        if (
          !dimensions ||
          dimensions.width * 3 !== dimensions.height * 2 ||
          dimensions.width > 20_000 ||
          dimensions.height > 40_000 ||
          dimensions.width * dimensions.height > 80_000_000
        ) {
          throw new ApiError(
            422,
            "COVER_RATIO_INVALID",
            "Series covers must use the exact 2:3 ratio and safe image dimensions.",
          );
        }
        const extension =
          detected === "image/jpeg"
            ? "jpg"
            : detected === "image/png"
              ? "png"
              : "webp";
        coverKey = `private/series-covers/${seriesId}/${randomId()}.${extension}`;
        await env.BUCKET.put(coverKey, bytes, {
          httpMetadata: { contentType: detected },
          customMetadata: { actorId: actor.id, seriesId },
        });
      }
      try {
        const eligibilitySql = isAdminActor(actor)
          ? `EXISTS (
               SELECT 1 FROM teams t
                WHERE t.id = ?
                  AND t.verification_status <> 'SUSPENDED'
                  AND t.is_archived = 0
             )`
          : `EXISTS (
               SELECT 1
                 FROM teams t
                 JOIN team_memberships tm ON tm.team_id = t.id
                WHERE t.id = ?
                  AND tm.user_id = ?
                  AND tm.status = 'ACTIVE'
                  AND UPPER(tm.membership_role) IN
                    ('OWNER', 'MANAGER', 'TEAM_LEADER')
                  AND t.verification_status <> 'SUSPENDED'
                  AND t.is_archived = 0
             )`;
        const eligibilityBindings = isAdminActor(actor)
          ? [payload.teamId]
          : [payload.teamId, actor.id];
        const statements = [
          env.DB.prepare(
            `INSERT INTO series
             (id, slug, title, native_title, synopsis, type, status,
              origin_country, original_language, reading_direction, age_rating,
              access_type, cover_key, rights_status, is_published)
             SELECT ?, ?, ?, NULLIF(?, ''), ?, ?, ?, ?, ?, ?, 'TEEN', ?, ?,
                    'PENDING_REVIEW', 0
              WHERE ${eligibilitySql}`,
          ).bind(
            seriesId,
            payload.slug,
            payload.title,
            payload.nativeTitle,
            payload.synopsis,
            payload.type,
            payload.status,
            payload.originCountry,
            payload.originalLanguage,
            payload.readingDirection,
            payload.accessType,
            coverKey,
            ...eligibilityBindings,
          ),
        ];
        if (payload.nativeTitle) {
          statements.push(
            env.DB.prepare(
              `INSERT INTO series_aliases
               (series_id, alias, normalized_alias, language)
               SELECT ?, ?, ?, ?
                WHERE EXISTS (SELECT 1 FROM series WHERE id = ?)`,
            ).bind(
              seriesId,
              payload.nativeTitle,
              normalizedLookupKey(payload.nativeTitle),
              payload.originalLanguage,
              seriesId,
            ),
          );
        }
        statements.push(
          env.DB.prepare(
            `INSERT INTO series_team_assignments
             (series_id, team_id, can_upload, can_publish, is_primary,
              assigned_by_user_id)
             SELECT ?, ?, 1, 0, 1, ?
              WHERE EXISTS (SELECT 1 FROM series WHERE id = ?)`,
          ).bind(seriesId, payload.teamId, actor.id, seriesId),
          env.DB.prepare(
            `INSERT INTO audit_logs
             (id, actor_user_id, action, target_type, target_id, request_id,
              new_value_json)
             SELECT ?, ?, 'workspace.series.create', 'SERIES', ?, ?, ?
              WHERE EXISTS (SELECT 1 FROM series WHERE id = ?)`,
          ).bind(
            randomId(),
            actor.id,
            seriesId,
            id,
            JSON.stringify({
              slug: payload.slug,
              title: payload.title,
              teamId: payload.teamId,
              state: "DRAFT",
              hasCover: Boolean(coverKey),
            }),
            seriesId,
          ),
        );
        const createResults = await env.DB.batch(statements);
        if (!createResults[0]?.meta.changes) {
          throw new ApiError(
            409,
            "TEAM_SCOPE_CHANGED",
            "The team is no longer eligible for this series. Reload and choose an active team you manage.",
          );
        }
      } catch (error) {
        if (coverKey && env.BUCKET) {
          await deleteMediaObject(env.DB, env.BUCKET, coverKey, {
            mediaKind: "SERIES_COVER",
            targetType: "SERIES",
            targetId: seriesId,
            reason: "Failed workspace series creation",
          });
        }
        if (
          error instanceof Error &&
          /unique|series\.slug|series_slug_uidx/i.test(error.message)
        ) {
          throw new ApiError(
            409,
            "SERIES_SLUG_EXISTS",
            "A series already uses this URL slug.",
          );
        }
        throw error;
      }
      return json(
        id,
        {
          id: seriesId,
          slug: payload.slug,
          title: payload.title,
          state: "DRAFT",
          coverUrl: coverKey
            ? `/api/v1/workspace/series-cover?id=${encodeURIComponent(seriesId)}`
            : null,
        },
        { status: 201 },
      );
    }

    if (path === "admin/site-media") {
      assertSameOrigin(request);
      const actor = await requireActor();
      requireAdminCapability(actor, "appearance.manage");
      if (!env.DB || !env.BUCKET) {
        throw new ApiError(
          503,
          "MEDIA_UNAVAILABLE",
          "Site media storage is unavailable.",
        );
      }
      await retryPendingMediaCleanup(env.DB, env.BUCKET);
      const slot = z
        .enum(["logo", "compact", "app", "first", "last"])
        .parse(new URL(request.url).searchParams.get("slot"));
      const form = await request.formData();
      const expectedRevision = z.coerce
        .number()
        .int()
        .min(0)
        .parse(form.get("expectedRevision"));
      const candidate = form.get("file");
      if (!(candidate instanceof File) || candidate.size === 0) {
        throw new ApiError(
          422,
          "SITE_MEDIA_REQUIRED",
          "Choose a JPEG, PNG, or WebP image.",
        );
      }
      const brandSlot = ["logo", "compact", "app"].includes(slot);
      const limit = brandSlot ? 2 * 1024 * 1024 : 8 * 1024 * 1024;
      if (candidate.size > limit) {
        throw new ApiError(
          413,
          "SITE_MEDIA_TOO_LARGE",
          brandSlot
            ? "Brand images must be 2 MB or smaller."
            : "Fixed reader pages must be 8 MB or smaller.",
        );
      }
      const bytes = new Uint8Array(await candidate.arrayBuffer());
      const detected = detectedImageType(bytes);
      if (!detected || !chapterImageTypes.has(detected)) {
        throw new ApiError(
          415,
          "SITE_MEDIA_TYPE_INVALID",
          "Use a verified JPEG, PNG, or WebP image.",
        );
      }
      const dimensions = imageDimensions(bytes, detected);
      if (
        !dimensions ||
        dimensions.width > 20_000 ||
        dimensions.height > 40_000 ||
        dimensions.width * dimensions.height > 80_000_000
      ) {
        throw new ApiError(
          422,
          "SITE_MEDIA_DIMENSIONS_INVALID",
          "The image dimensions are invalid or exceed the safe processing limit.",
        );
      }
      const current = await getSiteConfigurationDocument();
      if (current.revision !== expectedRevision) {
        throw new ApiError(
          409,
          "STALE_VERSION",
          "Another administrator changed the site configuration. Reload before uploading.",
        );
      }
      const previous =
        slot === "logo"
          ? current.settings.brand.logo
          : slot === "compact"
            ? current.settings.brand.compactLogo
            : slot === "app"
              ? current.settings.brand.appIcon
          : slot === "first"
            ? current.settings.reader.firstPage
            : current.settings.reader.lastPage;
      const extension =
        detected === "image/jpeg"
          ? "jpg"
          : detected === "image/png"
            ? "png"
            : "webp";
      const objectKey = `public/site/${slot}/${randomId()}.${extension}`;
      await env.BUCKET.put(objectKey, bytes, {
        httpMetadata: { contentType: detected },
        customMetadata: { actorId: actor.id, slot },
      });
      const media = {
        enabled: true,
        key: objectKey,
        revision: previous.revision + 1,
        width: dimensions.width,
        height: dimensions.height,
      };
      const next: SiteConfiguration =
        brandSlot
          ? {
              ...current.settings,
              brand: {
                ...current.settings.brand,
                [slot === "logo"
                  ? "logo"
                  : slot === "compact"
                    ? "compactLogo"
                    : "appIcon"]: media,
              },
            }
          : {
              ...current.settings,
              reader: {
                ...current.settings.reader,
                [slot === "first" ? "firstPage" : "lastPage"]: media,
              },
            };
      try {
        const saved = await saveSiteConfiguration(
          next,
          actor.id,
          id,
          true,
          expectedRevision,
        );
        if (previous.key && previous.key !== objectKey) {
          await deleteMediaObject(env.DB, env.BUCKET, previous.key, {
            mediaKind: `SITE_${slot.toUpperCase()}`,
            targetType: "SITE_CONFIGURATION",
            targetId: "active",
            reason: "Replaced site media",
          });
        }
        return json(id, saved, {
          status: 201,
          headers: { "cache-control": "private, no-store" },
        });
      } catch (error) {
        await deleteMediaObject(env.DB, env.BUCKET, objectKey, {
          mediaKind: `SITE_${slot.toUpperCase()}`,
          targetType: "SITE_CONFIGURATION",
          targetId: "active",
          reason: "Uncommitted site media upload",
        });
        throw error;
      }
    }

    if (path === "store/purchases") {
      assertSameOrigin(request);
      const actor = await requireActor();
      const payload = storePurchaseSchema.parse(await request.json());
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Store purchases are temporarily unavailable.",
        );
      }
      const item = await env.DB.prepare(
        `SELECT si.id,
                si.name,
                si.price_onyx AS priceOnyx,
                si.category,
                si.is_published AS isPublished,
                si.is_hidden AS isHidden,
                sc.enabled AS collectionEnabled,
                sc.starts_at AS startsAt,
                sc.ends_at AS endsAt,
                si.revision
           FROM store_items si
           JOIN store_collections sc ON sc.id = si.collection_id
          WHERE si.id = ?
          LIMIT 1`,
      )
        .bind(payload.itemId)
        .first<{
          id: string;
          name: string;
          priceOnyx: number;
          category: string;
          isPublished: number;
          isHidden: number;
          collectionEnabled: number;
          startsAt: string | null;
          endsAt: string | null;
          revision: number;
        }>();
      if (
        !item ||
        !item.isPublished ||
        item.isHidden ||
        !item.collectionEnabled ||
        (item.startsAt &&
          new Date(item.startsAt).getTime() > Date.now()) ||
        (item.endsAt && new Date(item.endsAt).getTime() <= Date.now())
      ) {
        throw new ApiError(
          404,
          "STORE_ITEM_NOT_AVAILABLE",
          "This cosmetic is not currently available.",
        );
      }
      const priorOwnership = await env.DB.prepare(
        `SELECT created_at AS purchasedAt
           FROM user_store_items
          WHERE user_id = ?
            AND item_id = ?
          LIMIT 1`,
      )
        .bind(actor.id, item.id)
        .first<{ purchasedAt: string }>();
      if (priorOwnership) {
        const featureStates = await getFeatureStates(env.DB);
        const premiumEconomyPublic =
          featureStates.premium_unlocks.effective;
        return json(id, {
          ok: true,
          alreadyOwned: true,
          itemId: item.id,
          purchasedAt: priorOwnership.purchasedAt,
          wallet: premiumEconomyPublic
            ? await walletSnapshot(actor.id)
            : null,
        });
      }
      const commercial = await requirePaidEconomyPublicDocument();
      const paidEconomyRevision = commercial.revision;
      const priceOnyx = Number(item.priceOnyx);
      const wallet = await walletSnapshot(actor.id);
      if (wallet.balance < priceOnyx) {
        throw new ApiError(
          409,
          "INSUFFICIENT_ONYX",
          `Your ${commercial.settings.economy.coinPlural} balance is too low for this cosmetic.`,
        );
      }
      const platformAccountId = "la_platform_store_onyx";
      const transactionId = randomId();
      const idempotencyKey = `${actor.id}:store:${payload.idempotencyKey}`;
      const entries = [
        { accountId: wallet.accountId, amount: -priceOnyx },
        { accountId: platformAccountId, amount: priceOnyx },
      ];
      if (sumBalancedEntries(entries) !== 0) {
        throw new ApiError(
          500,
          "LEDGER_UNBALANCED",
          "The Store ledger transaction is not balanced.",
        );
      }
      const results = await env.DB.batch([
        env.DB.prepare(
          `INSERT OR IGNORE INTO ledger_accounts
           (id, owner_type, owner_id, currency, account_type)
           SELECT ?, 'PLATFORM', 'NYASCANS_STORE', 'ONYX', 'EARNED'
            WHERE ${paidEconomyRevisionGuardSql(paidEconomyRevision)}`,
        ).bind(platformAccountId),
        env.DB.prepare(
          `INSERT OR IGNORE INTO ledger_transactions
           (id, kind, reference_type, reference_id, idempotency_key, memo)
           SELECT ?, 'STORE_PURCHASE', 'STORE_ITEM', ?, ?, ?
            WHERE COALESCE((
                    SELECT SUM(amount)
                      FROM ledger_entries
                     WHERE account_id = ?
                  ), 0) >= ?
              AND EXISTS (
                    SELECT 1
                      FROM store_items current_item
                      JOIN store_collections current_collection
                        ON current_collection.id = current_item.collection_id
                     WHERE current_item.id = ?
                       AND current_item.revision = ?
                       AND current_item.price_onyx = ?
                       AND current_item.is_published = 1
                       AND current_item.is_hidden = 0
                       AND current_item.archived_at IS NULL
                       AND current_collection.enabled = 1
                       AND (
                         current_collection.starts_at IS NULL
                         OR datetime(current_collection.starts_at) <= datetime('now')
                       )
                       AND (
                         current_collection.ends_at IS NULL
                         OR datetime(current_collection.ends_at) > datetime('now')
                       )
                  )
              AND ${paidEconomyRevisionGuardSql(paidEconomyRevision)}
              AND NOT EXISTS (
                    SELECT 1
                      FROM user_store_items
                     WHERE user_id = ?
                       AND item_id = ?
                  )`,
        ).bind(
          transactionId,
          item.id,
          idempotencyKey,
          `Store purchase: ${item.name}`,
          wallet.accountId,
          priceOnyx,
          item.id,
          Number(item.revision),
          priceOnyx,
          actor.id,
          item.id,
        ),
        env.DB.prepare(
          `INSERT INTO ledger_entries
           (id, transaction_id, account_id, amount)
           SELECT ?, id, ?, ?
             FROM ledger_transactions
            WHERE id = ?`,
        ).bind(
          randomId(),
          wallet.accountId,
          -priceOnyx,
          transactionId,
        ),
        env.DB.prepare(
          `INSERT INTO ledger_entries
           (id, transaction_id, account_id, amount)
           SELECT ?, id, ?, ?
             FROM ledger_transactions
            WHERE id = ?`,
        ).bind(
          randomId(),
          platformAccountId,
          priceOnyx,
          transactionId,
        ),
        env.DB.prepare(
          `INSERT INTO user_store_items
           (user_id, item_id, transaction_id)
           SELECT ?, ?, id
             FROM ledger_transactions
            WHERE id = ?`,
        ).bind(actor.id, item.id, transactionId),
        env.DB.prepare(
          `INSERT INTO audit_logs
           (id, actor_user_id, action, target_type, target_id, request_id,
            new_value_json)
           SELECT ?, ?, 'store.item.purchase', 'STORE_ITEM', ?, ?, ?
             FROM ledger_transactions
            WHERE id = ?`,
        ).bind(
          randomId(),
          actor.id,
          item.id,
          id,
          JSON.stringify({ priceOnyx, category: item.category }),
          transactionId,
        ),
      ]);
      const created = Number(results[1]?.meta.changes ?? 0) > 0;
      if (!created) {
        const priorTransaction = await env.DB.prepare(
          `SELECT reference_id AS referenceId
             FROM ledger_transactions
            WHERE idempotency_key = ?
            LIMIT 1`,
        )
          .bind(idempotencyKey)
          .first<{ referenceId: string }>();
        if (priorTransaction && priorTransaction.referenceId !== item.id) {
          throw new ApiError(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "Use a new purchase identifier for a different cosmetic.",
          );
        }
        const ownership = await env.DB.prepare(
          `SELECT created_at AS purchasedAt
             FROM user_store_items
            WHERE user_id = ?
              AND item_id = ?
            LIMIT 1`,
        )
          .bind(actor.id, item.id)
          .first<{ purchasedAt: string }>();
        if (!ownership) {
          await assertPaidEconomyRevisionFresh(paidEconomyRevision);
          throw new ApiError(
            409,
            "STORE_PURCHASE_CONFLICT",
            "Your balance or this cosmetic changed. Refresh and try again.",
          );
        }
      }
      return json(
        id,
        {
          ok: true,
          alreadyOwned: !created,
          itemId: item.id,
          wallet: await walletSnapshot(actor.id),
        },
        {
          status: created ? 201 : 200,
          headers: { "cache-control": "private, no-store" },
        },
      );
    }

    if (path === "store/equip") {
      assertSameOrigin(request);
      const actor = await requireActor();
      const payload = storeEquipSchema.parse(await request.json());
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Cosmetic loadouts are temporarily unavailable.",
        );
      }
      if (payload.itemId) {
        const owned = await env.DB.prepare(
          `SELECT si.id
             FROM user_store_items usi
             JOIN store_items si ON si.id = usi.item_id
            WHERE usi.user_id = ?
              AND usi.item_id = ?
              AND si.category = ?
            LIMIT 1`,
        )
          .bind(actor.id, payload.itemId, payload.category)
          .first();
        if (!owned) {
          throw new ApiError(
            403,
            "STORE_ITEM_NOT_OWNED",
            "Purchase this cosmetic before equipping it.",
          );
        }
        await env.DB.prepare(
          `INSERT INTO user_cosmetic_loadouts
           (user_id, category, item_id)
           VALUES (?, ?, ?)
           ON CONFLICT(user_id, category) DO UPDATE SET
             item_id = excluded.item_id,
             updated_at = CURRENT_TIMESTAMP`,
        )
          .bind(actor.id, payload.category, payload.itemId)
          .run();
      } else {
        await env.DB.prepare(
          `DELETE FROM user_cosmetic_loadouts
            WHERE user_id = ?
              AND category = ?`,
        )
          .bind(actor.id, payload.category)
          .run();
      }
      return json(id, {
        ok: true,
        category: payload.category,
        itemId: payload.itemId,
      });
    }

    if (path === "admin/store-items") {
      assertSameOrigin(request);
      const actor = await requireActor();
      requireAdminCapability(actor, "store.manage");
      const payload = storeItemInputSchema.parse(await request.json());
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Store Management is temporarily unavailable.",
        );
      }
      const itemId = payload.id ?? `store_${randomId()}`;
      const collection = await env.DB.prepare(
        "SELECT id FROM store_collections WHERE id = ? LIMIT 1",
      )
        .bind(payload.collectionId)
        .first();
      if (!collection) {
        throw new ApiError(
          422,
          "STORE_COLLECTION_NOT_FOUND",
          "Choose an existing Store collection.",
        );
      }
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO store_items
           (id, slug, collection_id, name, description, category, price_onyx,
            price_currency, preview_config_json, is_published, is_hidden, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          itemId,
          payload.slug,
          payload.collectionId,
          payload.name,
          payload.description,
          payload.category,
          payload.priceOnyx,
          payload.priceCurrency,
          JSON.stringify(payload.previewConfig),
          payload.isPublished ? 1 : 0,
          payload.isHidden ? 1 : 0,
          payload.sortOrder,
        ),
        env.DB.prepare(
          `INSERT INTO audit_logs
           (id, actor_user_id, action, target_type, target_id, request_id,
            new_value_json)
           VALUES (?, ?, 'store.item.create', 'STORE_ITEM', ?, ?, ?)`,
        ).bind(
          randomId(),
          actor.id,
          itemId,
          id,
          JSON.stringify(payload),
        ),
      ]);
      return json(
        id,
        { id: itemId, ...payload, revision: 1 },
        { status: 201 },
      );
    }

    if (path === "admin/store-collections") {
      assertSameOrigin(request);
      const actor = await requireActor();
      requireAdminCapability(actor, "store.manage");
      const payload = storeCollectionInputSchema.parse(await request.json());
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Store Management is temporarily unavailable.",
        );
      }
      const collectionId = payload.id ?? `collection_${randomId()}`;
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO store_collections
           (id, slug, name, description, theme_key, is_seasonal, enabled,
            starts_at, ends_at, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          collectionId,
          payload.slug,
          payload.name,
          payload.description,
          payload.themeKey,
          payload.isSeasonal ? 1 : 0,
          payload.enabled ? 1 : 0,
          payload.startsAt,
          payload.endsAt,
          payload.sortOrder,
        ),
        env.DB.prepare(
          `INSERT INTO audit_logs
           (id, actor_user_id, action, target_type, target_id, request_id,
            new_value_json)
           VALUES (?, ?, 'store.collection.create', 'STORE_COLLECTION', ?, ?, ?)`,
        ).bind(
          randomId(),
          actor.id,
          collectionId,
          id,
          JSON.stringify(payload),
        ),
      ]);
      return json(
        id,
        { id: collectionId, ...payload, revision: 1 },
        { status: 201 },
      );
    }

    if (path === "admin/store-media") {
      assertSameOrigin(request);
      const actor = await requireActor();
      requireAdminCapability(actor, "store.manage");
      if (!env.DB || !env.BUCKET) {
        throw new ApiError(
          503,
          "MEDIA_UNAVAILABLE",
          "Store preview storage is temporarily unavailable.",
        );
      }
      await retryPendingMediaCleanup(env.DB, env.BUCKET);
      const form = await request.formData();
      const itemId = z
        .string()
        .trim()
        .min(3)
        .max(120)
        .parse(form.get("itemId"));
      const expectedRevision = z.coerce
        .number()
        .int()
        .min(1)
        .parse(form.get("expectedRevision"));
      const file = form.get("file");
      if (!(file instanceof File) || file.size <= 0) {
        throw new ApiError(
          422,
          "STORE_PREVIEW_REQUIRED",
          "Choose a preview image.",
        );
      }
      if (file.size > 5 * 1024 * 1024) {
        throw new ApiError(
          413,
          "STORE_PREVIEW_TOO_LARGE",
          "Store previews must be 5 MB or smaller.",
        );
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const contentType = detectedImageType(bytes);
      if (!contentType || !discussionImageTypes.has(contentType)) {
        throw new ApiError(
          415,
          "STORE_PREVIEW_INVALID",
          "Use a verified JPEG, PNG, WebP, or GIF preview.",
        );
      }
      const dimensions = imageDimensions(bytes, contentType);
      if (
        !dimensions ||
        dimensions.width < 64 ||
        dimensions.height < 64 ||
        dimensions.width > 8192 ||
        dimensions.height > 8192 ||
        dimensions.width * dimensions.height > 32_000_000
      ) {
        throw new ApiError(
          422,
          "STORE_PREVIEW_DIMENSIONS_INVALID",
          "Store previews must be between 64×64 and 8192×8192 pixels and no larger than 32 megapixels.",
        );
      }
      const current = await env.DB.prepare(
        `SELECT preview_key AS previewKey, revision
           FROM store_items
          WHERE id = ?
          LIMIT 1`,
      )
        .bind(itemId)
        .first<{ previewKey: string | null; revision: number }>();
      if (!current) {
        throw new ApiError(
          404,
          "STORE_ITEM_NOT_FOUND",
          "This Store item no longer exists.",
        );
      }
      if (Number(current.revision) !== expectedRevision) {
        throw new ApiError(
          409,
          "STORE_ITEM_CHANGED",
          "Another administrator changed this Store item. Reload it before replacing the preview.",
        );
      }
      const objectKey = `public/store/${itemId}/${randomId()}-${safeFilename(file.name)}`;
      await env.BUCKET.put(objectKey, bytes, {
        httpMetadata: { contentType },
        customMetadata: {
          actorId: actor.id,
          itemId,
          verified: "signature-and-dimensions",
          width: String(dimensions.width),
          height: String(dimensions.height),
        },
      });
      try {
        const mediaResults = await env.DB.batch([
          env.DB.prepare(
            `UPDATE store_items
              SET preview_key = ?,
                  revision = revision + 1,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND revision = ?`,
          ).bind(objectKey, itemId, expectedRevision),
          auditStatement(
            env.DB,
            actor,
            id,
            {
              action: "store.item.preview.replace",
              category: "COMMERCE_STORE",
              sourceArea: "STORE_MANAGEMENT",
              targetType: "STORE_ITEM",
              targetId: itemId,
              oldValue: { previewKey: current.previewKey },
              newValue: {
                previewKey: objectKey,
                width: dimensions.width,
                height: dimensions.height,
                revision: expectedRevision + 1,
              },
            },
            "changes() = 1",
          ),
        ]);
        if (Number(mediaResults[0]?.meta.changes ?? 0) !== 1) {
          throw new ApiError(
            409,
            "STORE_ITEM_CHANGED",
            "Another administrator changed this Store item. Reload it before replacing the preview.",
          );
        }
      } catch (error) {
        await deleteMediaObject(env.DB, env.BUCKET, objectKey, {
          mediaKind: "STORE_PREVIEW",
          targetType: "STORE_ITEM",
          targetId: itemId,
          reason: "Uncommitted Store preview upload",
        });
        throw error;
      }
      if (current.previewKey) {
        await deleteMediaObject(env.DB, env.BUCKET, current.previewKey, {
          mediaKind: "STORE_PREVIEW",
          targetType: "STORE_ITEM",
          targetId: itemId,
          reason: "Replaced Store preview",
        });
      }
      return json(id, {
        ok: true,
        itemId,
        previewUrl: storeItemPreviewUrl(itemId, objectKey, objectKey),
        revision: expectedRevision + 1,
        width: dimensions.width,
        height: dimensions.height,
      });
    }

    if (path === "admin/balance-adjustments") {
      assertSameOrigin(request);
      const actor = await requireActor();
      requireOwner(actor);
      const payload = balanceAdjustmentSchema.parse(await request.json());
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "The wallet ledger is temporarily unavailable.",
        );
      }
      const recipient = await env.DB.prepare(
        "SELECT id, display_name AS displayName FROM users WHERE id = ? LIMIT 1",
      )
        .bind(payload.userId)
        .first<{ id: string; displayName: string }>();
      if (!recipient) {
        throw new ApiError(404, "USER_NOT_FOUND", "This user no longer exists.");
      }
      const accountId = await ensureWalletAccount(
        env.DB,
        recipient.id,
        payload.currency,
      );
      const platformId = platformAccountId(
        "owner-adjustments",
        payload.currency,
      );
      const idempotencyKey = `balance-adjustment:${payload.idempotencyKey}`;
      const existing = await env.DB.prepare(
        `SELECT lt.id,
                lt.reference_id AS referenceId,
                lt.memo AS reason,
                COALESCE((
                  SELECT le.amount
                    FROM ledger_entries le
                   WHERE le.transaction_id = lt.id
                     AND le.account_id = ?
                   LIMIT 1
                ), 0) AS delta
           FROM ledger_transactions lt
          WHERE lt.idempotency_key = ?
          LIMIT 1`,
      )
        .bind(accountId, idempotencyKey)
        .first<{
          id: string;
          referenceId: string;
          reason: string;
          delta: number;
        }>();
      if (existing) {
        if (
          existing.referenceId !== recipient.id ||
          Number(existing.delta) !== payload.delta ||
          existing.reason !== payload.reason
        ) {
          throw new ApiError(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "Use a new request identifier for a different balance adjustment.",
          );
        }
        const balance = await env.DB.prepare(
          "SELECT COALESCE(SUM(amount), 0) AS balance FROM ledger_entries WHERE account_id = ?",
        )
          .bind(accountId)
          .first<{ balance: number }>();
        return json(id, {
          created: false,
          transactionId: existing.id,
          balance: Number(balance?.balance ?? 0),
          currency: payload.currency,
        });
      }
      const transactionId = randomId();
      const results = await env.DB.batch([
        env.DB.prepare(
          `INSERT OR IGNORE INTO ledger_accounts
           (id, owner_type, owner_id, currency, account_type)
           VALUES (?, 'PLATFORM', 'NYASCANS_OWNER_ADJUSTMENTS', ?, 'ADJUSTMENT')`,
        ).bind(platformId, payload.currency),
        env.DB.prepare(
          `INSERT OR IGNORE INTO ledger_transactions
           (id, kind, reference_type, reference_id, idempotency_key, memo)
           SELECT ?, 'OWNER_BALANCE_ADJUSTMENT', 'USER', ?, ?, ?
            WHERE ? > 0
               OR COALESCE((
                    SELECT SUM(amount) FROM ledger_entries
                     WHERE account_id = ?
                  ), 0) + ? >= 0`,
        ).bind(
          transactionId,
          recipient.id,
          idempotencyKey,
          payload.reason,
          payload.delta,
          accountId,
          payload.delta,
        ),
        env.DB.prepare(
          `INSERT INTO ledger_entries
           (id, transaction_id, account_id, amount)
           SELECT ?, ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM ledger_transactions WHERE id = ?)`,
        ).bind(
          randomId(),
          transactionId,
          platformId,
          -payload.delta,
          transactionId,
        ),
        env.DB.prepare(
          `INSERT INTO ledger_entries
           (id, transaction_id, account_id, amount)
           SELECT ?, ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM ledger_transactions WHERE id = ?)`,
        ).bind(
          randomId(),
          transactionId,
          accountId,
          payload.delta,
          transactionId,
        ),
        env.DB.prepare(
          `INSERT INTO audit_logs
           (id, actor_user_id, actor_role, action, category, source_area,
            target_type, target_id, target_label, reason, request_id,
            new_value_json)
           SELECT ?, ?, ?, 'wallet.balance.adjust',
                  'COMMERCE_STORE', 'USERS_CONTROL', 'USER', ?, ?, ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM ledger_transactions WHERE id = ?)`,
        ).bind(
          randomId(),
          actor.id,
          actor.primaryRole,
          recipient.id,
          recipient.displayName,
          payload.reason,
          id,
          JSON.stringify({
            currency: payload.currency,
            delta: payload.delta,
            transactionId,
          }),
          transactionId,
        ),
      ]);
      if (Number(results[1]?.meta.changes ?? 0) !== 1) {
        const replay = await env.DB.prepare(
          `SELECT lt.id,
                  lt.reference_id AS referenceId,
                  lt.memo AS reason,
                  COALESCE((
                    SELECT le.amount
                      FROM ledger_entries le
                     WHERE le.transaction_id = lt.id
                       AND le.account_id = ?
                     LIMIT 1
                  ), 0) AS delta
             FROM ledger_transactions lt
            WHERE lt.idempotency_key = ?
            LIMIT 1`,
        )
          .bind(accountId, idempotencyKey)
          .first<{
            id: string;
            referenceId: string;
            reason: string;
            delta: number;
          }>();
        if (replay) {
          if (
            replay.referenceId !== recipient.id ||
            Number(replay.delta) !== payload.delta ||
            replay.reason !== payload.reason
          ) {
            throw new ApiError(
              409,
              "IDEMPOTENCY_KEY_REUSED",
              "Use a new request identifier for a different balance adjustment.",
            );
          }
          const replayBalance = await env.DB.prepare(
            "SELECT COALESCE(SUM(amount), 0) AS balance FROM ledger_entries WHERE account_id = ?",
          )
            .bind(accountId)
            .first<{ balance: number }>();
          return json(id, {
            created: false,
            transactionId: replay.id,
            balance: Number(replayBalance?.balance ?? 0),
            currency: payload.currency,
          });
        }
        throw new ApiError(
          409,
          "INSUFFICIENT_BALANCE",
          "This adjustment would make the user balance negative.",
        );
      }
      const balance = await env.DB.prepare(
        "SELECT COALESCE(SUM(amount), 0) AS balance FROM ledger_entries WHERE account_id = ?",
      )
        .bind(accountId)
        .first<{ balance: number }>();
      return json(id, {
        created: true,
        transactionId,
        balance: Number(balance?.balance ?? 0),
        currency: payload.currency,
      });
    }

    if (path === "admin/test-coins") {
      assertSameOrigin(request);
      const actor = await requireActor();
      requireOwner(actor);
      const payload = testCoinGrantSchema.parse(await request.json());
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "The wallet ledger is temporarily unavailable.",
        );
      }
      const recipient = await env.DB.prepare(
        "SELECT id, email FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1",
      )
        .bind(payload.email)
        .first<{ id: string; email: string }>();
      if (!recipient) {
        throw new ApiError(
          404,
          "USER_NOT_FOUND",
          "No NyaScans account uses that email address.",
        );
      }
      const wallet = await walletSnapshot(recipient.id);
      const platformAccountId = "la_platform_promotional_onyx";
      const transactionId = randomId();
      await env.DB.batch([
        env.DB.prepare(
          `INSERT OR IGNORE INTO ledger_accounts
           (id, owner_type, owner_id, currency, account_type)
           VALUES (?, 'PLATFORM', 'NYASCANS_PROMOTIONS', 'ONYX', 'PROMOTIONAL')`,
        ).bind(platformAccountId),
        env.DB.prepare(
          `INSERT INTO ledger_transactions
           (id, kind, reference_type, reference_id, idempotency_key, memo)
           VALUES (?, 'ADMIN_GRANT', 'USER', ?, ?, ?)`,
        ).bind(
          transactionId,
          recipient.id,
          `admin-grant:${id}`,
          payload.reason,
        ),
        env.DB.prepare(
          `INSERT INTO ledger_entries
           (id, transaction_id, account_id, amount)
           VALUES (?, ?, ?, ?)`,
        ).bind(
          randomId(),
          transactionId,
          platformAccountId,
          -payload.amount,
        ),
        env.DB.prepare(
          `INSERT INTO ledger_entries
           (id, transaction_id, account_id, amount)
           VALUES (?, ?, ?, ?)`,
        ).bind(
          randomId(),
          transactionId,
          wallet.accountId,
          payload.amount,
        ),
        env.DB.prepare(
          `INSERT INTO audit_logs
           (id, actor_user_id, action, target_type, target_id, request_id,
            reason, new_value_json)
           VALUES (?, ?, 'wallet.test-coins.grant', 'USER', ?, ?, ?, ?)`,
        ).bind(
          randomId(),
          actor.id,
          recipient.id,
          id,
          payload.reason,
          JSON.stringify({ amount: payload.amount, email: recipient.email }),
        ),
      ]);
      return json(
        id,
        {
          ok: true,
          userId: recipient.id,
          wallet: await walletSnapshot(recipient.id),
        },
        { status: 201 },
      );
    }

    if (path === "admin/team-memberships") {
      assertSameOrigin(request);
      const actor = await requireActor();
      requireAdminCapability(actor, "content.teams.manage");
      const payload = teamMembershipWriteSchema.parse(await request.json());
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Team access controls are temporarily unavailable.",
        );
      }
      const currentMembership = await env.DB.prepare(
        `SELECT revision,
                membership_role AS membershipRole,
                status
           FROM team_memberships
         WHERE team_id = ? AND user_id = ? LIMIT 1`,
      )
        .bind(payload.teamId, payload.userId)
        .first<{
          revision: number;
          membershipRole: string;
          status: string;
        }>();
      if (currentMembership && payload.expectedRevision == null) {
        throw new ApiError(
          409,
          "MEMBERSHIP_VERSION_REQUIRED",
          "Reload this membership before changing it.",
        );
      }
      const removesActiveOwner = currentMembership?.membershipRole === "OWNER" && currentMembership.status === "ACTIVE" && (payload.membershipRole !== "OWNER" || payload.status !== "ACTIVE");
      if (removesActiveOwner) {
        const otherOwners = await env.DB.prepare("SELECT COUNT(*) AS count FROM team_memberships WHERE team_id = ? AND user_id <> ? AND membership_role = 'OWNER' AND status = 'ACTIVE'").bind(payload.teamId, payload.userId).first<{ count: number }>();
        if (Number(otherOwners?.count ?? 0) < 1) throw new ApiError(409, "FINAL_TEAM_OWNER_PROTECTED", "Assign another validated active owner before changing the final owner.");
      }
      const grantsNewOwnership = payload.membershipRole === "OWNER" && payload.status === "ACTIVE" && !(currentMembership?.membershipRole === "OWNER" && currentMembership.status === "ACTIVE");
      if (grantsNewOwnership) {
        const approvedOwnership = await env.DB.prepare(
          `SELECT 1
             FROM team_ownership_claims claim
             JOIN teams team ON team.id = claim.team_id AND team.verification_status = 'VERIFIED' AND team.is_archived = 0
             JOIN team_links link ON link.team_id = claim.team_id AND link.url = claim.proof_value
            WHERE claim.team_id = ? AND claim.claimant_user_id = ? AND claim.status = 'APPROVED'
            LIMIT 1`,
        ).bind(payload.teamId, payload.userId).first();
        if (!approvedOwnership) throw new ApiError(409, "TEAM_OWNERSHIP_REVIEW_REQUIRED", "Ownership can be granted only after an approved link-control claim.");
      }
      const membershipMutation = currentMembership
        ? env.DB.prepare(
            `UPDATE team_memberships
                SET membership_role = ?,
                    status = ?,
                    revision = revision + 1,
                    updated_at = CURRENT_TIMESTAMP
              WHERE team_id = ? AND user_id = ? AND revision = ?`,
          )
            .bind(
              payload.membershipRole,
              payload.status,
              payload.teamId,
              payload.userId,
              payload.expectedRevision,
            )
        : env.DB.prepare(
            `INSERT INTO team_memberships
             (team_id, user_id, membership_role, status, revision)
             VALUES (?, ?, ?, ?, 1)`,
          )
            .bind(
              payload.teamId,
              payload.userId,
              payload.membershipRole,
              payload.status,
            );
      const nextRevision = currentMembership
        ? Number(currentMembership.revision) + 1
        : 1;
      const membershipResults = await env.DB.batch([
        membershipMutation,
        auditStatement(
          env.DB,
          actor,
          id,
          {
            action: "team.membership.upsert",
            category: "TEAMS_PERMISSIONS",
            sourceArea: "TEAM_MANAGEMENT",
            targetType: "TEAM",
            targetId: payload.teamId,
            oldValue: currentMembership
              ? {
                  userId: payload.userId,
                  membershipRole: currentMembership.membershipRole,
                  status: currentMembership.status,
                  revision: currentMembership.revision,
                }
              : null,
            newValue: {
              userId: payload.userId,
              membershipRole: payload.membershipRole,
              status: payload.status,
              revision: nextRevision,
            },
          },
          "changes() = 1",
        ),
      ]);
      if (!membershipResults[0]?.meta.changes) {
        throw new ApiError(
          409,
          "STALE_VERSION",
          "Another administrator changed this membership. Reload it before saving.",
        );
      }
      return json(
        id,
        { ok: true, ...payload, revision: nextRevision },
        { status: 201 },
      );
    }

    if (path === "admin/series-team-assignments") {
      assertSameOrigin(request);
      const actor = await requireActor();
      requireAdminCapability(actor, "content.teams.manage");
      const payload = seriesTeamAssignmentWriteSchema.parse(
        await request.json(),
      );
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Series assignment controls are temporarily unavailable.",
        );
      }
      const assignmentResults = await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO series_team_assignments
           (series_id, team_id, can_upload, can_publish, assigned_by_user_id)
           SELECT ?, ?, ?, ?, ?
            WHERE EXISTS (
              SELECT 1 FROM series
               WHERE id = ? AND revision = ?
            )
              AND EXISTS (
                SELECT 1 FROM teams
                 WHERE id = ?
                   AND is_archived = 0
                   AND verification_status <> 'SUSPENDED'
              )
           ON CONFLICT(series_id, team_id) DO UPDATE SET
             can_upload = excluded.can_upload,
             can_publish = excluded.can_publish,
             assigned_by_user_id = excluded.assigned_by_user_id`,
        ).bind(
          payload.seriesId,
          payload.teamId,
          payload.canUpload ? 1 : 0,
          payload.canPublish ? 1 : 0,
          actor.id,
          payload.seriesId,
          payload.expectedSeriesRevision,
          payload.teamId,
        ),
        env.DB.prepare(
          `UPDATE series
              SET revision = revision + 1,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND revision = ?
              AND EXISTS (
                SELECT 1 FROM teams
                 WHERE id = ?
                   AND is_archived = 0
                   AND verification_status <> 'SUSPENDED'
              )`,
        ).bind(
          payload.seriesId,
          payload.expectedSeriesRevision,
          payload.teamId,
        ),
        env.DB.prepare(
          `INSERT INTO audit_logs
           (id, actor_user_id, action, target_type, target_id, request_id,
            new_value_json)
           SELECT ?, ?, 'series.team.assignment.upsert', 'SERIES', ?, ?, ?
            WHERE changes() = 1`,
        ).bind(
          randomId(),
          actor.id,
          payload.seriesId,
          id,
          JSON.stringify(payload),
        ),
      ]);
      if (!assignmentResults[1]?.meta.changes) {
        const team = await env.DB.prepare(
          `SELECT id FROM teams
            WHERE id = ? AND is_archived = 0
              AND verification_status <> 'SUSPENDED'
            LIMIT 1`,
        )
          .bind(payload.teamId)
          .first();
        if (!team) {
          throw new ApiError(
            422,
            "TEAM_NOT_AVAILABLE",
            "Choose an active publishing team.",
          );
        }
        throw new ApiError(
          409,
          "STALE_VERSION",
          "Another administrator changed this series. Reload it before assigning a team.",
        );
      }
      return json(
        id,
        {
          ok: true,
          ...payload,
          seriesRevision: payload.expectedSeriesRevision + 1,
        },
        { status: 201 },
      );
    }

    if (path === "reviews") {
      assertSameOrigin(request);
      const actor = await requireActor("review.create");
      const payload = reviewWriteSchema.parse(await request.json());
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Review storage is unavailable.",
        );
      }
      const seriesRecord = await env.DB.prepare(
        `SELECT s.id FROM series s
         WHERE s.slug = ? AND ${publicSeriesPredicate("s")} LIMIT 1`,
      )
        .bind(payload.seriesSlug)
        .first<{ id: string }>();
      if (!seriesRecord) {
        throw new ApiError(
          404,
          "SERIES_NOT_FOUND",
          "This series is not available for reviews.",
        );
      }
      const reviewId = randomId();
      const reviewResults = await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO reviews
           (id, user_id, series_id, rating, body, spoiler, moderation_status)
           VALUES (?, ?, ?, ?, ?, ?, 'VISIBLE')
           ON CONFLICT(user_id, series_id) DO UPDATE SET
             rating = excluded.rating,
             body = excluded.body,
             spoiler = excluded.spoiler,
             moderation_status = CASE
               WHEN reviews.moderation_status = 'HIDDEN' THEN 'HIDDEN'
               ELSE 'VISIBLE'
             END,
             updated_at = CURRENT_TIMESTAMP
           WHERE reviews.moderation_status <> 'HIDDEN'`,
        ).bind(
          reviewId,
          actor.id,
          seriesRecord.id,
          payload.rating,
          payload.body,
          payload.spoiler ? 1 : 0,
        ),
        auditStatement(
          env.DB,
          actor,
          id,
          {
            action: "review.upsert",
            category: "DISCUSSIONS_MODERATION",
            sourceArea: "SERIES_REVIEW",
            targetType: "SERIES",
            targetId: seriesRecord.id,
            newValue: { rating: payload.rating, spoiler: payload.spoiler },
          },
          "changes() = 1",
        ),
        env.DB.prepare(
          `UPDATE series
              SET rating_tenths = COALESCE((
                    SELECT CAST(ROUND(AVG(rating) * 10) AS INTEGER)
                      FROM reviews
                     WHERE series_id = ?
                       AND moderation_status = 'VISIBLE'
                  ), 0),
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND changes() = 1`,
        ).bind(seriesRecord.id, seriesRecord.id),
      ]);
      if (!reviewResults[0]?.meta.changes) {
        throw new ApiError(409, "REVIEW_MODERATION_LOCKED", "This review is hidden by moderation and cannot be republished until it is restored.");
      }
      const storedReview = await env.DB.prepare(
        `SELECT id FROM reviews WHERE user_id = ? AND series_id = ? LIMIT 1`,
      )
        .bind(actor.id, seriesRecord.id)
        .first<{ id: string }>();
      return json(
        id,
        { id: storedReview?.id ?? reviewId, saved: true },
        { status: 201 },
      );
    }

    if (path === "analytics-events") {
      assertSameOrigin(request);
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Analytics storage is unavailable.",
        );
      }
      const payload = analyticsEventSchema.parse(await request.json());
      if (payload.seriesSlug) {
        const storedScope = payload.chapterSlug
          ? await env.DB.prepare(
              `SELECT c.id
                 FROM chapters c
                 JOIN series s ON s.id = c.series_id
                WHERE s.slug = ?
                  AND c.slug = ?
                  AND ${publicSeriesPredicate("s")}
                  AND c.state = 'PUBLISHED'
                  AND c.visibility = 'PUBLIC'
                  AND c.published_at IS NOT NULL
                  AND datetime(c.published_at) <= CURRENT_TIMESTAMP
                LIMIT 1`,
            )
              .bind(payload.seriesSlug, payload.chapterSlug)
              .first()
          : await env.DB.prepare(
              `SELECT s.id
                 FROM series s
                WHERE s.slug = ?
                  AND ${publicSeriesPredicate("s")}
                LIMIT 1`,
            )
              .bind(payload.seriesSlug)
              .first();
        if (!storedScope) {
          throw new ApiError(
            422,
            "ANALYTICS_SCOPE_INVALID",
            "This activity scope is not part of the published catalogue.",
          );
        }
      }
      const countryFromEdge = (
        request as Request & { cf?: { country?: unknown } }
      ).cf?.country;
      const regionCode =
        typeof countryFromEdge === "string" &&
        /^[A-Za-z]{2}$/.test(countryFromEdge)
          ? countryFromEdge.toUpperCase()
          : null;
      const result = await env.DB.prepare(
        `INSERT OR IGNORE INTO analytics_events
         (id, session_id, visitor_id, event_type, series_slug, chapter_slug,
          region_code)
         SELECT ?, ?, ?, ?, ?, ?, ?
          WHERE NOT EXISTS (
            SELECT 1
              FROM analytics_events
             WHERE session_id = ?
               AND event_type = ?
               AND COALESCE(series_slug, '') = COALESCE(?, '')
               AND COALESCE(chapter_slug, '') = COALESCE(?, '')
               AND created_at >= datetime('now', '-30 seconds')
          )
            AND (
              SELECT COUNT(*)
                FROM analytics_events
               WHERE session_id = ?
                 AND created_at >= datetime('now', '-1 minute')
            ) < 40`,
      )
        .bind(
          payload.eventId,
          payload.sessionId,
          payload.visitorId,
          payload.eventType,
          payload.seriesSlug ?? null,
          payload.chapterSlug ?? null,
          regionCode,
          payload.sessionId,
          payload.eventType,
          payload.seriesSlug ?? null,
          payload.chapterSlug ?? null,
          payload.sessionId,
        )
        .run();
      return json(
        id,
        { accepted: Number(result.meta.changes ?? 0) > 0 },
        {
          status: 202,
          headers: { "cache-control": "private, no-store" },
        },
      );
    }

    if (path === "admin/series") {
      assertSameOrigin(request);
      const actor = await requireActor();
      requireAdminCapability(actor, "series.create");
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Series management is unavailable.",
        );
      }

      const contentType = request.headers.get("content-type") ?? "";
      let cover: File | null = null;
      let raw: Record<string, unknown>;
      if (contentType.includes("multipart/form-data")) {
        const form = await request.formData();
        raw = Object.fromEntries(
          [...form.entries()]
            .filter(([key, value]) => key !== "cover" && typeof value === "string")
            .map(([key, value]) => [key, String(value)]),
        );
        const candidate = form.get("cover");
        cover = candidate instanceof File && candidate.size > 0 ? candidate : null;
      } else {
        raw = (await request.json()) as Record<string, unknown>;
      }
      const payload = adminSeriesSchema.parse(raw);
      const duplicate = await env.DB.prepare(
        "SELECT id FROM series WHERE slug = ? LIMIT 1",
      )
        .bind(payload.slug)
        .first();
      if (duplicate) {
        throw new ApiError(
          409,
          "SERIES_SLUG_EXISTS",
          "A series already uses this URL slug.",
        );
      }

      const seriesId = `ser_${randomId()}`;
      if (payload.teamId) {
        const team = await env.DB.prepare(
          "SELECT id FROM teams WHERE id = ? AND verification_status <> 'SUSPENDED' LIMIT 1",
        )
          .bind(payload.teamId)
          .first();
        if (!team) {
          throw new ApiError(
            422,
            "TEAM_NOT_AVAILABLE",
            "Choose an active publishing team.",
          );
        }
      }
      let coverKey: string | null = null;
      if (cover) {
        if (!env.BUCKET) {
          throw new ApiError(
            503,
            "MEDIA_UNAVAILABLE",
            "Series cover storage is unavailable.",
          );
        }
        if (cover.size > 5 * 1024 * 1024) {
          throw new ApiError(
            413,
            "COVER_TOO_LARGE",
            "Series covers must be 5 MB or smaller.",
          );
        }
        const bytes = new Uint8Array(await cover.arrayBuffer());
        const detected = detectedImageType(bytes);
        if (!detected || !chapterImageTypes.has(detected)) {
          throw new ApiError(
            415,
            "COVER_TYPE_INVALID",
            "Use a verified JPEG, PNG, or WebP cover.",
          );
        }
        coverKey = `private/series-covers/${seriesId}/${safeFilename(cover.name)}`;
        await env.BUCKET.put(coverKey, bytes, {
          httpMetadata: { contentType: detected },
          customMetadata: { actorId: actor.id, seriesId },
        });
      }

      try {
        const statements = [
          env.DB.prepare(
            `INSERT INTO series
             (id, slug, title, native_title, synopsis, type, status,
              origin_country, original_language, reading_direction, age_rating,
              access_type, cover_key, rights_status, is_published)
             VALUES (?, ?, ?, NULLIF(?, ''), ?, ?, ?, ?, ?, ?, 'TEEN', ?, ?,
                     'PENDING_REVIEW', 0)`,
          ).bind(
            seriesId,
            payload.slug,
            payload.title,
            payload.nativeTitle,
            payload.synopsis,
            payload.type,
            payload.status,
            payload.originCountry,
            payload.originalLanguage,
            payload.readingDirection,
            payload.accessType,
            coverKey,
          ),
          env.DB.prepare(
            `INSERT INTO audit_logs
             (id, actor_user_id, action, target_type, target_id, request_id, new_value_json)
             VALUES (?, ?, 'series.create', 'SERIES', ?, ?, ?)`,
          ).bind(
            randomId(),
            actor.id,
            seriesId,
            id,
            JSON.stringify({
              slug: payload.slug,
              title: payload.title,
              state: "DRAFT",
              hasCover: Boolean(coverKey),
            }),
          ),
        ];
        if (payload.nativeTitle) {
          statements.push(
            env.DB.prepare(
              `INSERT INTO series_aliases
               (series_id, alias, normalized_alias, language)
               VALUES (?, ?, ?, ?)`,
            ).bind(
              seriesId,
              payload.nativeTitle,
              normalizedLookupKey(payload.nativeTitle),
              payload.originalLanguage,
            ),
          );
        }
        if (payload.teamId) {
          statements.push(
            env.DB.prepare(
              `INSERT INTO series_team_assignments
               (series_id, team_id, can_upload, can_publish, is_primary,
                assigned_by_user_id)
               VALUES (?, ?, 1, 0, 1, ?)`,
            ).bind(seriesId, payload.teamId, actor.id),
          );
        }
        await env.DB.batch(statements);
      } catch (error) {
        if (coverKey && env.BUCKET) {
          await deleteMediaObject(env.DB, env.BUCKET, coverKey, {
            mediaKind: "SERIES_COVER",
            targetType: "SERIES",
            targetId: seriesId,
            reason: "Failed administrator series creation",
          });
        }
        throw error;
      }
      return json(
        id,
        {
          id: seriesId,
          slug: payload.slug,
          title: payload.title,
          state: "DRAFT",
          coverUrl: coverKey
            ? `/api/v1/admin/series-cover?id=${encodeURIComponent(seriesId)}`
            : null,
        },
        { status: 201 },
      );
    }

    if (path === "admin/teams") {
      assertSameOrigin(request);
      const actor = await requireActor();
      requireAdminCapability(actor, "content.teams.manage");
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Team management is unavailable.",
        );
      }
      adminTeamSchema.parse(await request.json());
      throw new ApiError(
        409,
        "TEAM_COMMUNITY_WORKFLOW_REQUIRED",
        "Create teams through the community form so links and ownership proof can be reviewed.",
      );
    }

    if (path === "discussion-comments") {
      assertSameOrigin(request);
      const actor = await requireActor("comment.create");
      const payload = discussionCommentSchema.parse(await request.json());
      await validateSeriesSlug(payload.seriesSlug);
      await assertDiscussionAllowed(actor.id, payload.seriesSlug);
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Discussion storage is unavailable.",
        );
      }
      if (payload.chapterSlug) {
        const chapterDiscussion = await env.DB.prepare(
          `SELECT c.comments_enabled AS commentsEnabled
             FROM chapters c
             JOIN series s ON s.id = c.series_id
            WHERE s.slug = ?
              AND c.slug = ?
            LIMIT 1`,
        )
          .bind(payload.seriesSlug, payload.chapterSlug)
          .first<{ commentsEnabled: number }>();
        if (!chapterDiscussion) {
          throw new ApiError(
            404,
            "CHAPTER_NOT_FOUND",
            "This chapter discussion is not available.",
          );
        }
        if (!Boolean(chapterDiscussion.commentsEnabled)) {
          throw new ApiError(
            403,
            "CHAPTER_COMMENTS_DISABLED",
            "Comments are disabled for this chapter release.",
          );
        }
      }
      const discussionSettings = (
        await getDiscussionSettingsDocument()
      ).settings;
      if (
        payload.mediaIds.length + payload.gifIds.length >
        discussionSettings.maxAttachments
      ) {
        throw new ApiError(
          422,
          "TOO_MANY_ATTACHMENTS",
          `Add no more than ${discussionSettings.maxAttachments} attachments.`,
        );
      }

      const recent = await env.DB.prepare(
        `SELECT COUNT(*) AS count
         FROM discussion_comments
         WHERE user_id = ?
           AND created_at > datetime('now', '-8 seconds')`,
      )
        .bind(actor.id)
        .first<{ count: number }>();
      if (Number(recent?.count ?? 0) > 0) {
        throw new ApiError(
          429,
          "COMMENT_RATE_LIMITED",
          "Please wait a few seconds before posting again.",
        );
      }
      const affiliationTeamId = await resolveCommentAffiliation(
        actor,
        payload.seriesSlug,
        payload.chapterSlug ?? null,
        payload.affiliationTeamId ?? null,
      );

      let parentId: string | null = null;
      let depth = 0;
      if (payload.parentId) {
        const parent = await env.DB.prepare(
          `SELECT id, depth
           FROM discussion_comments
           WHERE id = ?
             AND series_slug = ?
             AND ((? IS NULL AND chapter_slug IS NULL) OR chapter_slug = ?)
             AND moderation_status = 'VISIBLE'
           LIMIT 1`,
        )
          .bind(
            payload.parentId,
            payload.seriesSlug,
            payload.chapterSlug ?? null,
            payload.chapterSlug ?? null,
          )
          .first<{ id: string; depth: number }>();
        if (!parent) {
          throw new ApiError(
            422,
            "PARENT_COMMENT_NOT_FOUND",
            "The comment you are replying to is no longer available.",
          );
        }
        depth = Number(parent.depth ?? 0) + 1;
        if (depth > discussionSettings.maxReplyDepth) {
          throw new ApiError(
            422,
            "REPLY_DEPTH_EXCEEDED",
            "This thread has reached its reply depth limit.",
          );
        }
        parentId = parent.id;
      }

      type PendingMedia = {
        id: string;
        contentType: string;
        kind: string;
      };
      let pendingMedia: PendingMedia[] = [];
      let pendingGifs: Array<{ id: string; availabilityJson: string }> = [];
      if (payload.mediaIds.length > 0) {
        const placeholders = payload.mediaIds.map(() => "?").join(",");
        const mediaResult = await env.DB.prepare(
          `SELECT id, content_type AS contentType, kind
           FROM discussion_media
           WHERE id IN (${placeholders})
             AND user_id = ?
             AND comment_id IS NULL
             AND moderation_status = 'READY'`,
        )
          .bind(...payload.mediaIds, actor.id)
          .all<PendingMedia>();
        pendingMedia = mediaResult.results;
        if (pendingMedia.length !== payload.mediaIds.length) {
          throw new ApiError(
            422,
            "ATTACHMENT_UNAVAILABLE",
            "One or more attachments are unavailable or belong to another reader.",
          );
        }
        if (
          pendingMedia.some(
            (media) =>
              (media.kind === "GIF" && !discussionSettings.allowGifs) ||
              (media.kind === "IMAGE" && !discussionSettings.allowImages),
          )
        ) {
          throw new ApiError(
            422,
            "ATTACHMENT_TYPE_DISABLED",
            "An administrator has disabled this attachment type.",
          );
        }
      }
      if (payload.gifIds.length > 0) {
        if (!discussionSettings.allowGifs) {
          throw new ApiError(
            422,
            "GIF_LIBRARY_DISABLED",
            "GIFs are currently disabled in comments.",
          );
        }
        const placeholders = payload.gifIds.map(() => "?").join(",");
        const gifResult = await env.DB.prepare(
          `SELECT id, availability_json AS availabilityJson
             FROM custom_reactions
            WHERE id IN (${placeholders})
              AND usage_kind = 'COMMENT_GIF'
              AND is_active = 1
              AND is_archived = 0
              AND asset_key IS NOT NULL
              AND is_animated = 1`,
        )
          .bind(...payload.gifIds)
          .all<{ id: string; availabilityJson: string }>();
        pendingGifs = gifResult.results;
        if (pendingGifs.length !== payload.gifIds.length) {
          throw new ApiError(
            422,
            "GIF_UNAVAILABLE",
            "One or more selected GIFs are no longer available.",
          );
        }
        const restrictedGif = pendingGifs.find((gif) => {
          const availability = safeJsonRecord(gif.availabilityJson);
          if (availability.scope !== "TEAM") return false;
          const teamIds = Array.isArray(availability.teamIds)
            ? availability.teamIds.filter(
                (teamId): teamId is string => typeof teamId === "string",
              )
            : [];
          return !teamIds.some((teamId) => actor.teamIds.includes(teamId));
        });
        if (restrictedGif) {
          throw new ApiError(
            403,
            "GIF_RESTRICTED",
            "One or more selected GIFs are limited to eligible team members.",
          );
        }
      }

      const equippedCommentCosmetic = await env.DB.prepare(
        `SELECT selected_loadout.item_id AS itemId
           FROM user_cosmetic_loadouts selected_loadout
           JOIN user_store_items owned
             ON owned.user_id = selected_loadout.user_id
            AND owned.item_id = selected_loadout.item_id
           JOIN store_items selected_item
             ON selected_item.id = selected_loadout.item_id
          WHERE selected_loadout.user_id = ?
            AND selected_loadout.category IN
              ('COMMENT_GRADIENT', 'COMMENT_EFFECT')
            AND selected_item.is_published = 1
            AND selected_item.is_hidden = 0
            AND selected_item.archived_at IS NULL
          ORDER BY CASE selected_loadout.category
            WHEN 'COMMENT_GRADIENT' THEN 0 ELSE 1 END
          LIMIT 1`,
      )
        .bind(actor.id)
        .first<{ itemId: string }>();
      const commentId = randomId();
      const attachmentGate = pendingMedia.length
        ? `WHERE (
             SELECT COUNT(*)
               FROM discussion_media claimable
              WHERE claimable.id IN (${pendingMedia.map(() => "?").join(",")})
                AND claimable.user_id = ?
                AND claimable.comment_id IS NULL
                AND claimable.moderation_status = 'READY'
           ) = ?`
        : "";
      const statements = [
        env.DB.prepare(
          `INSERT INTO discussion_comments
           (id, user_id, series_slug, chapter_slug, affiliation_team_id,
            cosmetic_item_id, parent_id, depth, body, spoiler)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           ${attachmentGate}`,
        ).bind(
          commentId,
          actor.id,
          payload.seriesSlug,
          payload.chapterSlug ?? null,
          affiliationTeamId,
          equippedCommentCosmetic?.itemId ?? null,
          parentId,
          depth,
          payload.body,
          payload.spoiler ? 1 : 0,
          ...pendingMedia.map((media) => media.id),
          ...(pendingMedia.length ? [actor.id, pendingMedia.length] : []),
        ),
        env.DB.prepare(
          `INSERT INTO audit_logs
           (id, actor_user_id, action, target_type, target_id, request_id, new_value_json)
           SELECT ?, ?, 'comment.create', 'COMMENT', ?, ?, ?
            WHERE EXISTS (
              SELECT 1 FROM discussion_comments WHERE id = ?
            )`,
        ).bind(
          randomId(),
          actor.id,
          commentId,
          id,
          JSON.stringify({
            seriesSlug: payload.seriesSlug,
            chapterSlug: payload.chapterSlug ?? null,
            affiliationTeamId,
            cosmeticItemId: equippedCommentCosmetic?.itemId ?? null,
            parentId,
            depth,
            spoiler: payload.spoiler,
            mediaCount: pendingMedia.length,
            gifCount: pendingGifs.length,
          }),
          commentId,
        ),
        ...pendingMedia.map((media) =>
          env.DB.prepare(
            `UPDATE discussion_media
             SET comment_id = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?
               AND user_id = ?
               AND comment_id IS NULL
               AND moderation_status = 'READY'
               AND EXISTS (
                 SELECT 1 FROM discussion_comments WHERE id = ?
               )`,
          ).bind(commentId, media.id, actor.id, commentId),
        ),
        ...pendingGifs.map((gif, index) =>
          env.DB.prepare(
            `INSERT INTO discussion_comment_gifs
             (comment_id, gif_id, display_order)
             SELECT ?, ?, ?
              WHERE EXISTS (
                SELECT 1 FROM discussion_comments WHERE id = ?
              )`,
          ).bind(commentId, gif.id, index, commentId),
        ),
      ];
      const commentResults = await env.DB.batch(statements);
      if (!commentResults[0]?.meta.changes) {
        throw new ApiError(
          409,
          "ATTACHMENT_UNAVAILABLE",
          "One or more attachments changed while the comment was being posted. Review the attachments and try again.",
        );
      }
      let rewardAmount = 0;
      try {
        const rewardSettings = (await getRewardSettingsDocument()).settings;
        const reward = await grantCurrencyReward(env.DB, {
          userId: actor.id,
          currency: "SHARDS",
          amount: rewardSettings.commentCreatedShards,
          kind: "COMMENT_REWARD",
          referenceType: "COMMENT",
          referenceId: commentId,
          idempotencyKey: `reward:comment:${actor.id}:${commentId}`,
          memo: `Comment reward · ${rewardSettings.commentCreatedShards} ${rewardSettings.shardPlural}`,
        });
        if (reward.transactionId) {
          await env.DB.prepare(
            `INSERT OR IGNORE INTO community_reward_claims
             (beneficiary_user_id, reward_type, source_id, amount, transaction_id)
             VALUES (?, 'COMMENT_CREATED', ?, ?, ?)`,
          )
            .bind(
              actor.id,
              commentId,
              rewardSettings.commentCreatedShards,
              reward.transactionId,
            )
            .run();
        }
        if (reward.created) {
          rewardAmount = rewardSettings.commentCreatedShards;
        }
      } catch {
        // The durable claim endpoint can safely retry without duplicating a reward.
      }
      return json(
        id,
        { id: commentId, status: "VISIBLE", rewardAmount },
        { status: 201 },
      );
    }

    if (path === "discussion-reactions") {
      assertSameOrigin(request);
      const actor = await requireActor("comment.create");
      const payload = discussionReactionSchema.parse(await request.json());
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Discussion storage is unavailable.",
        );
      }
      const availableReaction = await env.DB.prepare(
        `SELECT id, availability_json AS availabilityJson
         FROM custom_reactions
         WHERE slug = ? AND is_active = 1 AND is_archived = 0
           AND usage_kind = 'REACTION'
         LIMIT 1`,
      )
        .bind(payload.reaction)
        .first<{ id: string; availabilityJson: string }>();
      if (!availableReaction) {
        throw new ApiError(
          422,
          "REACTION_DISABLED",
          "This reaction is not currently available.",
        );
      }
      const availability = safeJsonRecord(availableReaction.availabilityJson);
      if (availability.scope === "TEAM") {
        const teamIds = Array.isArray(availability.teamIds)
          ? availability.teamIds.filter(
              (teamId): teamId is string => typeof teamId === "string",
            )
          : [];
        if (!teamIds.some((teamId) => actor.teamIds.includes(teamId))) {
          throw new ApiError(
            403,
            "REACTION_RESTRICTED",
            "This reaction is limited to eligible team members.",
          );
        }
      }
      const comment = await env.DB.prepare(
        `SELECT id, series_slug AS seriesSlug, user_id AS authorUserId
         FROM discussion_comments
         WHERE id = ? AND moderation_status = 'VISIBLE'
         LIMIT 1`,
      )
        .bind(payload.commentId)
        .first<{ id: string; seriesSlug: string; authorUserId: string }>();
      if (!comment) {
        throw new ApiError(
          404,
          "COMMENT_NOT_FOUND",
          "This comment is no longer available.",
        );
      }
      await assertDiscussionAllowed(actor.id, comment.seriesSlug);
      const existing = await env.DB.prepare(
        `SELECT reaction
         FROM discussion_reactions
         WHERE user_id = ? AND comment_id = ?
         LIMIT 1`,
      )
        .bind(actor.id, payload.commentId)
        .first<{ reaction: string }>();
      let selectedReaction: string | null = payload.reaction;
      const reactionEventId = randomId();
      const reactionAction =
        existing?.reaction === payload.reaction
          ? "REMOVE"
          : existing
            ? "CHANGE"
            : "ADD";
      const eventStatement = env.DB.prepare(
        `INSERT INTO discussion_reaction_events
         (id, user_id, comment_id, action, reaction)
         SELECT ?, ?, ?, ?, ?
          WHERE (
            SELECT COUNT(*)
              FROM discussion_reaction_events
             WHERE user_id = ?
               AND created_at >= datetime('now', '-1 minute')
          ) < 30`,
      ).bind(
        reactionEventId,
        actor.id,
        payload.commentId,
        reactionAction,
        payload.reaction,
        actor.id,
      );
      let reactionResults: D1Result<unknown>[];
      if (existing?.reaction === payload.reaction) {
        reactionResults = await env.DB.batch([
          eventStatement,
          env.DB.prepare(
            `DELETE FROM discussion_reactions
              WHERE user_id = ?
                AND comment_id = ?
                AND EXISTS (
                  SELECT 1 FROM discussion_reaction_events WHERE id = ?
                )`,
          ).bind(actor.id, payload.commentId, reactionEventId),
        ]);
        selectedReaction = null;
      } else {
        reactionResults = await env.DB.batch([
          eventStatement,
          env.DB.prepare(
            `INSERT INTO discussion_reactions
             (user_id, comment_id, reaction)
             SELECT ?, ?, ?
              WHERE EXISTS (
                SELECT 1 FROM discussion_reaction_events WHERE id = ?
              )
             ON CONFLICT(user_id, comment_id) DO UPDATE SET
               reaction = excluded.reaction,
               created_at = CURRENT_TIMESTAMP`,
          ).bind(
            actor.id,
            payload.commentId,
            payload.reaction,
            reactionEventId,
          ),
        ]);
      }
      if (!reactionResults[0]?.meta.changes) {
        throw new ApiError(
          429,
          "REACTION_RATE_LIMITED",
          "Please wait before changing more reactions.",
        );
      }
      const counts = await env.DB.prepare(
        `SELECT reaction, COUNT(*) AS count
         FROM discussion_reactions
         WHERE comment_id = ?
         GROUP BY reaction`,
      )
        .bind(payload.commentId)
        .all<{ reaction: string; count: number }>();
      return json(id, {
        selectedReaction,
        reactions: counts.results.map((entry) => ({
          key: entry.reaction,
          count: Number(entry.count),
          reactedByViewer: entry.reaction === selectedReaction,
        })),
      });
    }

    if (path === "discussion-votes") {
      assertSameOrigin(request);
      const actor = await requireActor("comment.create");
      const payload = discussionVoteSchema.parse(await request.json());
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Discussion storage is unavailable.",
        );
      }
      const comment = await env.DB.prepare(
        `SELECT id, series_slug AS seriesSlug, user_id AS authorUserId
         FROM discussion_comments
         WHERE id = ? AND moderation_status = 'VISIBLE'
         LIMIT 1`,
      )
        .bind(payload.commentId)
        .first<{ id: string; seriesSlug: string; authorUserId: string }>();
      if (!comment) {
        throw new ApiError(
          404,
          "COMMENT_NOT_FOUND",
          "This comment is no longer available.",
        );
      }
      if (comment.authorUserId === actor.id) {
        throw new ApiError(
          409,
          "SELF_VOTE_NOT_ALLOWED",
          "You cannot vote on your own comment.",
        );
      }
      await assertDiscussionAllowed(actor.id, comment.seriesSlug);
      if (payload.value === 0) {
        await env.DB.prepare(
          "DELETE FROM discussion_votes WHERE user_id = ? AND comment_id = ?",
        )
          .bind(actor.id, payload.commentId)
          .run();
      } else {
        await env.DB.prepare(
          `INSERT INTO discussion_votes
           (user_id, comment_id, value)
           VALUES (?, ?, ?)
           ON CONFLICT(user_id, comment_id) DO UPDATE SET
             value = excluded.value,
             updated_at = CURRENT_TIMESTAMP`,
        )
          .bind(actor.id, payload.commentId, payload.value)
          .run();
      }
      const score = await env.DB.prepare(
        `SELECT COALESCE(SUM(value), 0) AS score
         FROM discussion_votes
         WHERE comment_id = ?`,
      )
        .bind(payload.commentId)
        .first<{ score: number }>();
      if (payload.value === 1 && comment.authorUserId !== actor.id) {
        try {
          const rewardSettings = (await getRewardSettingsDocument()).settings;
          const sourceId = `${payload.commentId}:${actor.id}`;
          const reward = await grantCurrencyReward(env.DB, {
            userId: comment.authorUserId,
            currency: "SHARDS",
            amount: rewardSettings.upvoteReceivedShards,
            kind: "COMMENT_UPVOTE_REWARD",
            referenceType: "COMMENT_UPVOTE",
            referenceId: sourceId,
            idempotencyKey: `reward:upvote:${sourceId}`,
            memo: `Comment upvote reward · ${rewardSettings.upvoteReceivedShards} ${rewardSettings.shardPlural}`,
          });
          if (reward.transactionId) {
            await env.DB.prepare(
              `INSERT OR IGNORE INTO community_reward_claims
               (beneficiary_user_id, reward_type, source_id, amount, transaction_id)
               VALUES (?, 'COMMENT_UPVOTE', ?, ?, ?)`,
            )
              .bind(
                comment.authorUserId,
                sourceId,
                rewardSettings.upvoteReceivedShards,
                reward.transactionId,
              )
              .run();
          }
        } catch {
          // A verified reward claim may retry independently of the saved vote.
        }
      }
      return json(id, {
        viewerVote: payload.value,
        voteScore: Number(score?.score ?? 0),
      });
    }

    if (path === "discussion-media") {
      assertSameOrigin(request);
      const actor = await requireActor("comment.create");
      if (!env.DB || !env.BUCKET) {
        throw new ApiError(
          503,
          "MEDIA_UNAVAILABLE",
          "Discussion media is unavailable.",
        );
      }
      await retryPendingMediaCleanup(env.DB, env.BUCKET);
      const settings = (await getDiscussionSettingsDocument()).settings;
      const form = await request.formData();
      const file = form.get("file");
      const altText = String(form.get("altText") ?? "").trim().slice(0, 240);
      if (!(file instanceof File)) {
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "Choose an image or GIF.",
        );
      }
      if (
        file.type === "image/gif" ||
        file.name.toLowerCase().endsWith(".gif")
      ) {
        throw new ApiError(
          422,
          "DIRECT_GIF_UPLOAD_DISABLED",
          "Choose a GIF from the NyaScans GIF library in the comment composer.",
        );
      }
      const validated = await validateImageFile(file, {
        label: "comment attachment",
        maxBytes: 8 * 1024 * 1024,
        minWidth: 1,
        minHeight: 1,
        maxWidth: 4096,
        maxHeight: 4096,
        maxPixels: 16_000_000,
        allowAnimation: false,
        allowedTypes: new Set(["image/jpeg", "image/png", "image/webp"]),
      });
      const {
        bytes,
        contentType: verifiedType,
        dimensions,
        animated,
      } = validated;
      const kind = animated ? "GIF" : "IMAGE";
      if (
        (kind === "GIF" && !settings.allowGifs) ||
        (kind === "IMAGE" && !settings.allowImages)
      ) {
        throw new ApiError(
          422,
          "ATTACHMENT_TYPE_DISABLED",
          "An administrator has disabled this attachment type.",
        );
      }
      const uploadCount = await env.DB.prepare(
        `SELECT COUNT(*) AS count
         FROM discussion_media
         WHERE user_id = ?
           AND created_at > datetime('now', '-1 hour')`,
      )
        .bind(actor.id)
        .first<{ count: number }>();
      if (Number(uploadCount?.count ?? 0) >= 12) {
        throw new ApiError(
          429,
          "MEDIA_RATE_LIMITED",
          "Remove unused attachments or try again later.",
        );
      }
      const mediaId = randomId();
      const safeFilename =
        file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) ||
        `${mediaId}.${verifiedType.split("/")[1]}`;
      const objectKey = `private/discussion/${actor.id}/${mediaId}/${safeFilename}`;
      await env.BUCKET.put(objectKey, bytes, {
        httpMetadata: { contentType: verifiedType },
        customMetadata: {
          actorId: actor.id,
          kind,
          verified: "signature-dimensions-and-animation",
          width: String(dimensions.width),
          height: String(dimensions.height),
        },
      });
      try {
        await env.DB.prepare(
          `INSERT INTO discussion_media
           (id, user_id, object_key, filename, content_type, byte_size, kind, alt_text)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            mediaId,
            actor.id,
            objectKey,
            safeFilename,
            verifiedType,
            bytes.byteLength,
            kind,
            altText,
          )
          .run();
      } catch (error) {
        await deleteMediaObject(env.DB, env.BUCKET, objectKey, {
          mediaKind: "DISCUSSION_ATTACHMENT",
          targetType: "DISCUSSION_MEDIA",
          targetId: mediaId,
          reason: "Uncommitted discussion media upload",
        });
        throw error;
      }
      return json(
        id,
        {
          id: mediaId,
          filename: safeFilename,
          contentType: verifiedType,
          byteSize: bytes.byteLength,
          kind,
          altText,
          url: `/api/v1/discussion-media?id=${encodeURIComponent(mediaId)}`,
        },
        { status: 201 },
      );
    }

    if (path === "library") {
      assertSameOrigin(request);
      const actor = await requireActor("library.manage.own");
      const payload = librarySchema.parse(await request.json());
      if (!env.DB) throw new ApiError(503, "DATABASE_UNAVAILABLE", "Library storage is unavailable.");
      const saved = await env.DB.prepare(
        `INSERT INTO library_entries
         (user_id, series_id, list_type, is_favorite, notifications_enabled)
         SELECT ?, s.id, ?, ?, 1
           FROM series s
          WHERE s.id = ?
            AND ${publicSeriesPredicate("s")}
         ON CONFLICT(user_id, series_id) DO UPDATE SET
           list_type = excluded.list_type,
           is_favorite = excluded.is_favorite,
           updated_at = CURRENT_TIMESTAMP`,
      )
        .bind(
          actor.id,
          payload.listType,
          payload.favorite ? 1 : 0,
          payload.seriesId,
        )
        .run();
      if (Number(saved.meta.changes ?? 0) === 0) {
        throw new ApiError(
          404,
          "SERIES_NOT_FOUND",
          "This series is not available for your Library.",
        );
      }
      return json(id, { ok: true }, { status: 201 });
    }

    if (path === "reader/progress") {
      assertSameOrigin(request);
      const actor = await requireActor("reader.progress.own");
      const payload = progressSchema.parse(await request.json());
      if (!env.DB) throw new ApiError(503, "DATABASE_UNAVAILABLE", "Progress storage is unavailable.");
      await requireReadableChapter(actor, payload.chapterId);
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO reading_progress
           (user_id, chapter_id, page_index, scroll_offset, progress_basis_points,
            completed_at, onsite_activity_at)
           VALUES (?, ?, ?, ?, ?,
             CASE WHEN ? >= 9200 THEN CURRENT_TIMESTAMP ELSE NULL END,
             CURRENT_TIMESTAMP)
           ON CONFLICT(user_id, chapter_id) DO UPDATE SET
             page_index = excluded.page_index,
             scroll_offset = excluded.scroll_offset,
             progress_basis_points = excluded.progress_basis_points,
             completed_at = CASE
               WHEN excluded.completed_at IS NOT NULL THEN excluded.completed_at
               ELSE reading_progress.completed_at
             END,
             onsite_activity_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP`,
        ).bind(
          actor.id,
          payload.chapterId,
          payload.pageIndex,
          payload.scrollOffset,
          payload.progressBasisPoints,
          payload.markCompleted ? payload.progressBasisPoints : 0,
        ),
        env.DB.prepare(
          `INSERT INTO library_entries
           (user_id, series_id, list_type, is_favorite, notifications_enabled)
           SELECT ?, c.series_id, 'READING', 0, 1
             FROM chapters c
            WHERE c.id = ?
           ON CONFLICT(user_id, series_id) DO UPDATE SET
             list_type = CASE
               WHEN library_entries.list_type = 'PLANNING' THEN 'READING'
               ELSE library_entries.list_type
             END,
             updated_at = CURRENT_TIMESTAMP`,
        ).bind(actor.id, payload.chapterId),
      ]);
      return json(id, { ok: true, savedAt: new Date().toISOString() });
    }

    if (path === "orders") {
      assertSameOrigin(request);
      const actor = await requireActor();
      const payload = orderSchema.parse(await request.json());
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Checkout storage is unavailable.",
        );
      }
      return json(id, await createHostedCheckout(env.DB, actor, payload), {
        status: 201,
        headers: { "cache-control": "private, no-store" },
      });
    }

    if (path === "unlocks") {
      assertSameOrigin(request);
      const actor = await requireActor("chapter.unlock.own");
      const payload = unlockSchema.parse(await request.json());
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Wallet storage is unavailable.",
        );
      }
      await requireFeature("premium_unlocks", env.DB);

      const access = await resolveChapterAccess(
        actor,
        payload.seriesSlug,
        payload.chapterSlug,
      );
      if (access.canRead) {
        return json(
          id,
          {
            ok: true,
            alreadyUnlocked:
              access.isUnlocked ||
              access.reason === "FREE" ||
              access.reason === "ADMINISTRATOR_PREVIEW",
            access: chapterAccessContract(access),
          },
          { headers: { "cache-control": "private, no-store" } },
        );
      }
      if (access.accessLevel === "PREMIUM") {
        throw new ApiError(
          409,
          "MEMBERSHIP_REQUIRED",
          "This chapter is included with an active membership and cannot be purchased with Onyx.",
        );
      }
      if (access.accessType !== "PAID" || access.priceOnyx <= 0) {
        throw new ApiError(
          409,
          "CHAPTER_NOT_PURCHASABLE",
          "This chapter cannot be purchased.",
        );
      }

      const commercial = await requirePaidEconomyPublicDocument();
      const paidEconomyRevision = commercial.revision;
      const wallet = await walletSnapshot(actor.id);
      if (wallet.balance < access.priceOnyx) {
        throw new ApiError(
          409,
          "INSUFFICIENT_ONYX",
          `Your ${commercial.settings.economy.coinPlural} balance is too low for this unlock.`,
        );
      }
      const creditAccountId = access.teamId
        ? `la_team_${access.teamId}_earned_onyx`
        : "la_platform_earned_onyx";
      const creditOwnerType = access.teamId ? "TEAM" : "PLATFORM";
      const creditOwnerId = access.teamId ?? "NYASCANS";
      const transactionId = randomId();
      const entitlementId = randomId();
      const unlockIdempotencyKey = `${actor.id}:${payload.idempotencyKey}`;
      const entitlementExpiresAt =
        commercial.settings.economy.permanentChapterUnlocks
          ? null
          : new Date(
              Date.now() +
                commercial.settings.economy.temporaryChapterUnlockHours *
                  60 *
                  60 *
                  1000,
            ).toISOString();
      const unlockMemo = entitlementExpiresAt
        ? `Chapter unlock through ${entitlementExpiresAt}`
        : "Permanent chapter unlock";
      const entries = [
        { accountId: wallet.accountId, amount: -access.priceOnyx },
        { accountId: creditAccountId, amount: access.priceOnyx },
      ];
      if (sumBalancedEntries(entries) !== 0) {
        throw new ApiError(500, "LEDGER_UNBALANCED", "The ledger transaction is not balanced.");
      }
      if (access.discountId && !access.discountRevision) {
        throw new ApiError(
          409,
          "DISCOUNT_CHANGED",
          "The discount changed before the unlock could be completed.",
        );
      }
      const discountGuard = access.discountId
        ? `AND ${activeChapterDiscountGuardSql()}`
        : `AND ${noActiveChapterDiscountGuardSql()}`;
      const discountGuardBindings = access.discountId
        ? [
            access.discountId,
            access.discountRevision,
            access.priceOnyx,
            access.priceOnyx,
          ]
        : [];

      const unlockResults = await env.DB.batch([
        env.DB.prepare(
          `INSERT OR IGNORE INTO ledger_accounts
           (id, owner_type, owner_id, currency, account_type)
           SELECT ?, ?, ?, 'ONYX', 'EARNED'
            WHERE ${paidEconomyRevisionGuardSql(paidEconomyRevision)}`,
        ).bind(creditAccountId, creditOwnerType, creditOwnerId),
        env.DB.prepare(
          `INSERT OR IGNORE INTO ledger_transactions
           (id, kind, reference_type, reference_id, idempotency_key, memo)
           SELECT ?, 'CHAPTER_UNLOCK', 'CHAPTER', ?, ?, ?
            WHERE COALESCE((
                    SELECT SUM(amount)
                      FROM ledger_entries
                     WHERE account_id = ?
                  ), 0) >= ?
              AND EXISTS (
                    SELECT 1
                      FROM chapters current_chapter
                      JOIN series current_series
                        ON current_series.id = current_chapter.series_id
                     WHERE current_chapter.id = ?
                       AND current_chapter.access_type = 'PAID'
                       AND current_chapter.price_onyx = ?
                       AND (
                         current_chapter.free_at IS NULL
                         OR datetime(current_chapter.free_at) > datetime('now')
                         OR EXISTS (
                           SELECT 1
                             FROM content_visibility_overrides live_visibility
                            WHERE live_visibility.chapter_id = current_chapter.id
                              AND live_visibility.auto_free_exempt = 1
                         )
                       )
                       AND NOT EXISTS (
                         SELECT 1
                           FROM content_visibility_overrides live_visibility
                          WHERE live_visibility.chapter_id = current_chapter.id
                            AND live_visibility.access_type = 'PREMIUM'
                       )
                       AND (
                         current_chapter.team_id = ?
                         OR (? IS NULL AND current_chapter.team_id IS NULL)
                       )
                       ${discountGuard}
                       AND current_chapter.state = 'PUBLISHED'
                       AND current_chapter.visibility <> 'HIDDEN'
                       AND current_chapter.published_at IS NOT NULL
                       AND datetime(current_chapter.published_at) <= datetime('now')
                       AND current_series.is_published = 1
                       AND current_series.archived_at IS NULL
                       AND current_series.rights_status IN
                         ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
                  )
              AND ${paidEconomyRevisionGuardSql(paidEconomyRevision)}
              AND NOT EXISTS (
                    SELECT 1
                      FROM entitlements
                     WHERE user_id = ?
                       AND chapter_id = ?
                       AND revoked_at IS NULL
                       AND starts_at <= CURRENT_TIMESTAMP
                       AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
                  )`,
        ).bind(
          transactionId,
          access.chapterId,
          unlockIdempotencyKey,
          unlockMemo,
          wallet.accountId,
          access.priceOnyx,
          access.chapterId,
          access.basePriceOnyx,
          access.teamId,
          access.teamId,
          ...discountGuardBindings,
          actor.id,
          access.chapterId,
        ),
        env.DB.prepare(
          `INSERT INTO ledger_entries
           (id, transaction_id, account_id, amount)
           SELECT ?, id, ?, ?
             FROM ledger_transactions
            WHERE id = ?`,
        ).bind(
          randomId(),
          wallet.accountId,
          -access.priceOnyx,
          transactionId,
        ),
        env.DB.prepare(
          `INSERT INTO ledger_entries
           (id, transaction_id, account_id, amount)
           SELECT ?, id, ?, ?
             FROM ledger_transactions
            WHERE id = ?`,
        ).bind(
          randomId(),
          creditAccountId,
          access.priceOnyx,
          transactionId,
        ),
        env.DB.prepare(
          `INSERT INTO entitlements
           (id, user_id, chapter_id, source_type, source_id, expires_at)
           SELECT ?, ?, ?, 'ONYX_UNLOCK', id, ?
             FROM ledger_transactions
            WHERE id = ?
           ON CONFLICT(user_id, chapter_id) DO UPDATE SET
             source_type = excluded.source_type,
             source_id = excluded.source_id,
             starts_at = CURRENT_TIMESTAMP,
             expires_at = excluded.expires_at,
             revoked_at = NULL`,
        ).bind(
          entitlementId,
          actor.id,
          access.chapterId,
          entitlementExpiresAt,
          transactionId,
        ),
        env.DB.prepare(
          `INSERT INTO chapter_unlock_receipts
           (id, transaction_id, entitlement_id, buyer_user_id,
            chapter_id, team_id, amount, currency)
           SELECT ?, lt.id, e.id, ?, ?, ?, ?, 'ONYX'
             FROM ledger_transactions lt
             JOIN entitlements e
               ON e.user_id = ?
              AND e.chapter_id = ?
            WHERE lt.id = ?`,
        ).bind(
          randomId(),
          actor.id,
          access.chapterId,
          access.teamId,
          access.priceOnyx,
          actor.id,
          access.chapterId,
          transactionId,
        ),
        env.DB.prepare(
          `INSERT INTO audit_logs
           (id, actor_user_id, action, target_type, target_id, request_id, new_value_json)
           SELECT ?, ?, 'chapter.unlock', 'CHAPTER', ?, ?, ?
             FROM ledger_transactions
            WHERE id = ?`,
        ).bind(
          randomId(),
          actor.id,
          access.chapterId,
          id,
          JSON.stringify({
            priceOnyx: access.priceOnyx,
            basePriceOnyx: access.basePriceOnyx,
            discountId: access.discountId,
            discountPercentage: access.discountPercentage,
            accessType: access.accessType,
            teamId: access.teamId,
            entitlementExpiresAt,
          }),
          transactionId,
        ),
      ]);
      const transactionCreated =
        Number(unlockResults[1]?.meta.changes ?? 0) > 0;
      if (!transactionCreated) {
        const priorTransaction = await env.DB.prepare(
          `SELECT reference_id AS referenceId
             FROM ledger_transactions
            WHERE idempotency_key = ?
            LIMIT 1`,
        )
          .bind(unlockIdempotencyKey)
          .first<{ referenceId: string }>();
        if (
          priorTransaction &&
          priorTransaction.referenceId !== access.chapterId
        ) {
          throw new ApiError(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "Use a new unlock request identifier for a different chapter.",
          );
        }
        const refreshedAccess = await resolveChapterAccess(
          actor,
          payload.seriesSlug,
          payload.chapterSlug,
        );
        if (refreshedAccess.canRead) {
          return json(
            id,
            {
              ok: true,
              alreadyUnlocked: true,
              access: chapterAccessContract(refreshedAccess),
            },
            { headers: { "cache-control": "private, no-store" } },
          );
        }
        await assertPaidEconomyRevisionFresh(paidEconomyRevision);
        const refreshedWallet = await walletSnapshot(actor.id);
        if (refreshedWallet.balance < access.priceOnyx) {
          throw new ApiError(
            409,
            "INSUFFICIENT_ONYX",
            "Your coin balance changed before the unlock completed.",
          );
        }
        throw new ApiError(
          409,
          "UNLOCK_CONFLICT",
          "The chapter access state changed. Refresh and try again.",
        );
      }
      const unlockReceipt = await env.DB.prepare(
        `SELECT entitlement_id AS entitlementId
           FROM chapter_unlock_receipts
          WHERE transaction_id = ?
          LIMIT 1`,
      )
        .bind(transactionId)
        .first<{ entitlementId: string }>();
      const updatedWallet = await walletSnapshot(actor.id);

      return json(
        id,
        {
          ok: true,
          entitlementId: unlockReceipt?.entitlementId ?? entitlementId,
          entitlementExpiresAt,
          balance: updatedWallet.balance,
          access: chapterAccessContract({
            ...access,
            canRead: true,
            isUnlocked: true,
            reason: "UNLOCKED",
          }),
        },
        {
          status: 201,
          headers: { "cache-control": "private, no-store" },
        },
      );
    }

    if (path === "uploads") {
      throw new ApiError(
        410,
        "LEGACY_UPLOAD_ENDPOINT_RETIRED",
        "This upload endpoint has been retired. Start or resume uploads through the Upload Center.",
      );
    }


    if (path === "reports") {
      assertSameOrigin(request);
      const actor = await requireActor("report.create");
      const payload = z
        .object({
          targetType: z.literal("COMMENT"),
          targetId: z.string().min(3).max(120),
          category: z.enum([
            "Spoilers without a warning",
            "Harassment or hate",
            "Spam or promotion",
            "Illegal content",
          ]),
          detail: z.string().min(12).max(2000),
        })
        .parse(await request.json());
      if (!env.DB) throw new ApiError(503, "DATABASE_UNAVAILABLE", "Report storage is unavailable.");
      const target = await env.DB.prepare(
        `SELECT id
           FROM discussion_comments
           WHERE id = ? AND moderation_status = 'VISIBLE'
           LIMIT 1`,
      )
        .bind(payload.targetId)
        .first();
      if (!target) {
        throw new ApiError(
          404,
          "COMMENT_NOT_FOUND",
          "This comment is no longer available.",
        );
      }
      const reportId = randomId();
      await env.DB.prepare(
        `INSERT INTO reports
         (id, reporter_user_id, target_type, target_id, category, detail)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          reportId,
          actor.id,
          payload.targetType,
          payload.targetId,
          payload.category,
          payload.detail,
        )
        .run();
      return json(id, { reportId, status: "OPEN" }, { status: 201 });
    }

    throw new ApiError(404, "NOT_FOUND", "The requested API resource does not exist.");
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("discussion_vote_target_unavailable")
    ) {
      return errorResponse(
        id,
        new ApiError(
          409,
          "VOTE_TARGET_CHANGED",
          "That discussion comment is no longer available.",
        ),
      );
    }
    if (error instanceof z.ZodError) {
      return errorResponse(
        id,
        new ApiError(
          422,
          "VALIDATION_ERROR",
          "Please correct the highlighted fields.",
          error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        ),
      );
    }
    return errorResponse(id, error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const id = requestId(request);
  try {
    const { resource } = await context.params;
    const path = pathOf(resource);
    if (path === "admin/site-media") {
      assertSameOrigin(request);
      const actor = await requireActor();
      requireAdminCapability(actor, "appearance.manage");
      if (!env.DB || !env.BUCKET) {
        throw new ApiError(
          503,
          "MEDIA_UNAVAILABLE",
          "Site media storage is unavailable.",
        );
      }
      await retryPendingMediaCleanup(env.DB, env.BUCKET);
      const slot = z
        .enum(["logo", "compact", "app", "first", "last"])
        .parse(new URL(request.url).searchParams.get("slot"));
      const expectedRevision = z.coerce
        .number()
        .int()
        .min(0)
        .parse(new URL(request.url).searchParams.get("expectedRevision"));
      const current = await getSiteConfigurationDocument();
      if (current.revision !== expectedRevision) {
        throw new ApiError(
          409,
          "STALE_VERSION",
          "Another administrator changed the site configuration. Reload before removing media.",
        );
      }
      const previous =
        slot === "logo"
          ? current.settings.brand.logo
          : slot === "compact"
            ? current.settings.brand.compactLogo
            : slot === "app"
              ? current.settings.brand.appIcon
              : slot === "first"
                ? current.settings.reader.firstPage
                : current.settings.reader.lastPage;
      const cleared = {
        ...previous,
        enabled: false,
        key: null,
        revision: previous.revision + 1,
      };
      const next: SiteConfiguration =
        slot === "logo" || slot === "compact" || slot === "app"
          ? {
              ...current.settings,
              brand: {
                ...current.settings.brand,
                [slot === "logo"
                  ? "logo"
                  : slot === "compact"
                    ? "compactLogo"
                    : "appIcon"]: cleared,
              },
            }
          : {
              ...current.settings,
              reader: {
                ...current.settings.reader,
                [slot === "first" ? "firstPage" : "lastPage"]: cleared,
              },
            };
      const saved = await saveSiteConfiguration(
        next,
        actor.id,
        id,
        true,
        expectedRevision,
      );
      if (previous.key) {
        await deleteMediaObject(env.DB, env.BUCKET, previous.key, {
          mediaKind: `SITE_${slot.toUpperCase()}`,
          targetType: "SITE_CONFIGURATION",
          targetId: "active",
          reason: "Removed site media",
        });
      }
      return json(id, saved, {
        headers: { "cache-control": "private, no-store" },
      });
    }
    if (path === "admin/store-media") {
      assertSameOrigin(request);
      const actor = await requireActor();
      requireAdminCapability(actor, "store.manage");
      if (!env.DB || !env.BUCKET) {
        throw new ApiError(
          503,
          "MEDIA_UNAVAILABLE",
          "Store preview storage is temporarily unavailable.",
        );
      }
      await retryPendingMediaCleanup(env.DB, env.BUCKET);
      const url = new URL(request.url);
      const itemId = z
        .string()
        .trim()
        .min(3)
        .max(120)
        .parse(url.searchParams.get("itemId"));
      const expectedRevision = z.coerce
        .number()
        .int()
        .min(1)
        .parse(url.searchParams.get("expectedRevision"));
      const current = await env.DB.prepare(
        `SELECT preview_key AS previewKey, revision
           FROM store_items
          WHERE id = ?
          LIMIT 1`,
      )
        .bind(itemId)
        .first<{ previewKey: string | null; revision: number }>();
      if (!current) {
        throw new ApiError(
          404,
          "STORE_ITEM_NOT_FOUND",
          "This Store item no longer exists.",
        );
      }
      if (Number(current.revision) !== expectedRevision) {
        throw new ApiError(
          409,
          "STORE_ITEM_CHANGED",
          "Another administrator changed this Store item. Reload it before removing the preview.",
        );
      }
      if (!current.previewKey) {
        return json(id, {
          ok: true,
          itemId,
          previewUrl: null,
          revision: expectedRevision,
        });
      }
      const mediaResults = await env.DB.batch([
        env.DB.prepare(
          `UPDATE store_items
            SET preview_key = NULL,
                revision = revision + 1,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND revision = ?`,
        ).bind(itemId, expectedRevision),
        auditStatement(
          env.DB,
          actor,
          id,
          {
            action: "store.item.preview.remove",
            category: "COMMERCE_STORE",
            sourceArea: "STORE_MANAGEMENT",
            targetType: "STORE_ITEM",
            targetId: itemId,
            oldValue: { previewKey: current.previewKey },
            newValue: {
              previewKey: null,
              revision: expectedRevision + 1,
            },
          },
          "changes() = 1",
        ),
      ]);
      if (Number(mediaResults[0]?.meta.changes ?? 0) !== 1) {
        throw new ApiError(
          409,
          "STORE_ITEM_CHANGED",
          "Another administrator changed this Store item. Reload it before removing the preview.",
        );
      }
      await deleteMediaObject(env.DB, env.BUCKET, current.previewKey, {
        mediaKind: "STORE_PREVIEW",
        targetType: "STORE_ITEM",
        targetId: itemId,
        reason: "Removed Store preview",
      });
      return json(id, {
        ok: true,
        itemId,
        previewUrl: null,
        revision: expectedRevision + 1,
      });
    }
    if (path === "admin/store-items") {
      assertSameOrigin(request);
      const actor = await requireActor();
      requireAdminCapability(actor, "store.manage");
      const itemId = z
        .string()
        .trim()
        .min(3)
        .max(120)
        .parse(new URL(request.url).searchParams.get("id"));
      const expectedRevision = z.coerce
        .number()
        .int()
        .min(1)
        .parse(
          new URL(request.url).searchParams.get("expectedRevision"),
        );
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Store Management is temporarily unavailable.",
        );
      }
      const current = await env.DB.prepare(
        `SELECT si.preview_key AS previewKey,
                si.revision,
                (SELECT COUNT(*)
                   FROM user_store_items usi
                  WHERE usi.item_id = si.id) AS purchaseCount,
                (SELECT COUNT(*)
                   FROM user_cosmetic_loadouts loadout
                  WHERE loadout.item_id = si.id) AS equippedCount
           FROM store_items si
          WHERE si.id = ?
          LIMIT 1`,
      )
        .bind(itemId)
        .first<{
          previewKey: string | null;
          purchaseCount: number;
          equippedCount: number;
          revision: number;
        }>();
      if (!current) {
        throw new ApiError(
          404,
          "STORE_ITEM_NOT_FOUND",
          "This Store item no longer exists.",
        );
      }
      if (Number(current.revision) !== expectedRevision) {
        throw new ApiError(
          409,
          "STORE_ITEM_CHANGED",
          "Another administrator changed this Store item. Reload it before removing it.",
        );
      }
      const hasOwners =
        Number(current.purchaseCount) > 0 ||
        Number(current.equippedCount) > 0;
      const mutation = hasOwners
        ? env.DB.prepare(
            `UPDATE store_items
                SET is_published = 0,
                    is_hidden = 1,
                    archived_at = CURRENT_TIMESTAMP,
                    revision = revision + 1,
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
                AND revision = ?`,
          ).bind(itemId, expectedRevision)
        : env.DB.prepare(
            "DELETE FROM store_items WHERE id = ? AND revision = ?",
          ).bind(itemId, expectedRevision);
      const deletionResults = await env.DB.batch([
        mutation,
        auditStatement(
          env.DB,
          actor,
          id,
          {
            action: hasOwners ? "store.item.archive" : "store.item.delete",
            category: "COMMERCE_STORE",
            sourceArea: "STORE_MANAGEMENT",
            targetType: "STORE_ITEM",
            targetId: itemId,
            newValue: {
              purchaseCount: Number(current.purchaseCount),
              equippedCount: Number(current.equippedCount),
              revision: hasOwners ? expectedRevision + 1 : null,
            },
          },
          "changes() = 1",
        ),
      ]);
      if (Number(deletionResults[0]?.meta.changes ?? 0) !== 1) {
        throw new ApiError(
          409,
          "STORE_ITEM_CHANGED",
          "Another administrator changed this Store item. Reload it before removing it.",
        );
      }
      if (!hasOwners && current.previewKey && env.BUCKET) {
        await deleteMediaObject(env.DB, env.BUCKET, current.previewKey, {
          mediaKind: "STORE_PREVIEW",
          targetType: "STORE_ITEM",
          targetId: itemId,
          reason: "Deleted Store item preview",
        });
      }
      return json(id, {
        id: itemId,
        deleted: !hasOwners,
        archived: hasOwners,
        revision: hasOwners ? expectedRevision + 1 : null,
      });
    }
    if (path === "reviews") {
      assertSameOrigin(request);
      const actor = await requireActor("review.create");
      const reviewId = z
        .string()
        .uuid()
        .parse(new URL(request.url).searchParams.get("id"));
      if (!env.DB) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Review storage is unavailable.",
        );
      }
      const review = await env.DB.prepare(
        `SELECT r.series_id AS seriesId,
                r.moderation_status AS moderationStatus
           FROM reviews r
           JOIN series s ON s.id = r.series_id
          WHERE r.id = ?
            AND r.user_id = ?
            AND ${publicSeriesPredicate("s")}
          LIMIT 1`,
      )
        .bind(reviewId, actor.id)
        .first<{ seriesId: string; moderationStatus: string }>();
      if (!review) {
        throw new ApiError(
          404,
          "REVIEW_NOT_FOUND",
          "Your review is no longer available.",
        );
      }
      await env.DB.batch([
        review.moderationStatus === "HIDDEN"
          ? env.DB.prepare(
              "UPDATE reviews SET body = '', spoiler = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND moderation_status = 'HIDDEN'",
            ).bind(reviewId, actor.id)
          : env.DB.prepare(
              "DELETE FROM reviews WHERE id = ? AND user_id = ?",
            ).bind(reviewId, actor.id),
        env.DB.prepare(
          `UPDATE series
              SET rating_tenths = COALESCE((
                    SELECT CAST(ROUND(AVG(rating) * 10) AS INTEGER)
                      FROM reviews
                     WHERE series_id = ?
                       AND moderation_status = 'VISIBLE'
                  ), 0),
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
        ).bind(review.seriesId, review.seriesId),
        env.DB.prepare(
          `INSERT INTO audit_logs
           (id, actor_user_id, action, target_type, target_id, request_id)
           VALUES (?, ?, 'review.delete', 'REVIEW', ?, ?)`,
        ).bind(randomId(), actor.id, reviewId, id),
      ]);
      return json(id, { id: reviewId, deleted: true });
    }
    if (path === "discussion-media") {
      assertSameOrigin(request);
      const actor = await requireActor("comment.create");
      const mediaId = discussionMediaIdSchema.parse(
        new URL(request.url).searchParams.get("id"),
      );
      if (!env.DB || !env.BUCKET) {
        throw new ApiError(
          503,
          "MEDIA_UNAVAILABLE",
          "Discussion media is unavailable.",
        );
      }
      await retryPendingMediaCleanup(env.DB, env.BUCKET);
      const media = await env.DB.prepare(
        `SELECT user_id AS userId,
                comment_id AS commentId,
                object_key AS objectKey
         FROM discussion_media
         WHERE id = ? AND moderation_status = 'READY'
         LIMIT 1`,
      )
        .bind(mediaId)
        .first<{
          userId: string;
          commentId: string | null;
          objectKey: string;
        }>();
      if (!media) {
        throw new ApiError(
          404,
          "MEDIA_NOT_FOUND",
          "This attachment is no longer available.",
        );
      }
      if (
        media.userId !== actor.id &&
        !isAdminActor(actor)
      ) {
        throw new ApiError(
          403,
          "MEDIA_OWNER_REQUIRED",
          "This attachment belongs to another reader.",
        );
      }
      if (media.commentId && !isAdminActor(actor)) {
        throw new ApiError(
          409,
          "MEDIA_ALREADY_POSTED",
          "Posted attachments must be removed with their comment.",
        );
      }
      await env.DB.prepare(
        `UPDATE discussion_media
         SET moderation_status = 'DELETED',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
        .bind(mediaId)
        .run();
      await deleteMediaObject(env.DB, env.BUCKET, media.objectKey, {
        mediaKind: "DISCUSSION_ATTACHMENT",
        targetType: "DISCUSSION_MEDIA",
        targetId: mediaId,
        reason: "Removed discussion attachment",
      });
      return json(id, { id: mediaId, status: "DELETED" });
    }
    if (path !== "discussion-comments") {
      throw new ApiError(
        404,
        "NOT_FOUND",
        "The requested API resource does not exist.",
      );
    }
    assertSameOrigin(request);
    // Deletion is an ownership/moderation operation and must not depend on the
    // actor still being allowed to create new comments.
    const actor = await requireActor();
    const commentId = z
      .string()
      .trim()
      .min(1)
      .max(160)
      .parse(new URL(request.url).searchParams.get("id"));
    if (!env.DB) {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "Discussion storage is unavailable.",
      );
    }
    const comment = await env.DB.prepare(
      `SELECT user_id AS userId, moderation_status AS moderationStatus
       FROM discussion_comments
       WHERE id = ?
       LIMIT 1`,
    )
      .bind(commentId)
      .first<{ userId: string; moderationStatus: string }>();
    if (!comment) {
      throw new ApiError(
        404,
        "COMMENT_NOT_FOUND",
        "This comment is no longer available.",
      );
    }
    if (comment.moderationStatus === "DELETED") {
      return json(id, {
        id: commentId,
        status: "DELETED",
        deletionReason: comment.userId === actor.id ? "AUTHOR" : "MODERATION",
        alreadyDeleted: true,
      });
    }
    if (
      comment.userId !== actor.id &&
      !isGlobalModerator(actor) &&
      !isAdminActor(actor)
    ) {
      throw new ApiError(
        403,
        "COMMENT_OWNER_REQUIRED",
        "You can only remove your own comments.",
      );
    }
    const moderated = comment.userId !== actor.id;
    // This deliberately uses only the baseline columns that every deployed
    // discussion schema owns. Some databases applied the original 0012
    // migration before `revision` was added to that already-numbered file.
    // Tombstone the visible comment first; richer metadata and cleanup remain
    // best-effort so they can never turn a successful removal into a 500.
    const deletion = await env.DB.prepare(
      `UPDATE discussion_comments
       SET body = '',
           spoiler = 0,
           moderation_status = 'DELETED',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND moderation_status <> 'DELETED'`,
    )
      .bind(commentId)
      .run();
    if (Number(deletion.meta.changes ?? 0) === 0) {
      return json(id, {
        id: commentId,
        status: "DELETED",
        deletionReason: moderated ? "MODERATION" : "AUTHOR",
        alreadyDeleted: true,
      });
    }

    let media: Array<{ id: string; objectKey: string }> = [];
    try {
      const mediaResult = await env.DB.prepare(
        `SELECT id, object_key AS objectKey
         FROM discussion_media
         WHERE comment_id = ? AND moderation_status = 'READY'`,
      )
        .bind(commentId)
        .all<{ id: string; objectKey: string }>();
      media = mediaResult.results;
    } catch {
      // Older deployments may not have the optional attachment table yet.
    }
    await Promise.allSettled([
      env.DB.prepare(
        `UPDATE discussion_comments
         SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP),
             deleted_by_user_id = ?,
             deletion_reason = ?,
             revision = revision + 1
         WHERE id = ?`,
      )
        .bind(actor.id, moderated ? "MODERATION" : "AUTHOR", commentId)
        .run(),
      env.DB.prepare(
        "DELETE FROM discussion_reactions WHERE comment_id = ?",
      )
        .bind(commentId)
        .run(),
      env.DB.prepare(
        "DELETE FROM discussion_votes WHERE comment_id = ?",
      )
        .bind(commentId)
        .run(),
      env.DB.prepare(
        `UPDATE discussion_media
         SET moderation_status = 'DELETED',
             updated_at = CURRENT_TIMESTAMP
         WHERE comment_id = ?`,
      )
        .bind(commentId)
        .run(),
      env.DB.prepare(
        `INSERT INTO audit_logs
         (id, actor_user_id, action, target_type, target_id, request_id, new_value_json)
         VALUES (?, ?, 'comment.delete', 'COMMENT', ?, ?, ?)`,
      )
        .bind(
          randomId(),
          actor.id,
          commentId,
          id,
          JSON.stringify({
            deletionReason: moderated ? "MODERATION" : "AUTHOR",
          }),
        )
        .run(),
    ]);
    if (env.BUCKET) {
      await Promise.allSettled(
        media.map((entry) =>
          deleteMediaObject(env.DB!, env.BUCKET!, entry.objectKey, {
            mediaKind: "DISCUSSION_ATTACHMENT",
            targetType: "DISCUSSION_MEDIA",
            targetId: entry.id,
            reason: "Deleted comment attachment",
          }),
        ),
      );
    }
    return json(id, {
      id: commentId,
      status: "DELETED",
      deletionReason: moderated ? "MODERATION" : "AUTHOR",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        id,
        new ApiError(
          422,
          "VALIDATION_ERROR",
          "Choose a valid comment.",
        ),
      );
    }
    return errorResponse(id, error);
  }
}
