import { z } from "zod";
import {
  countryCodeSchema,
  externalSourceSchema,
  languageCodeSchema,
  lookupEntitySchema,
  normalizedLookupKey,
} from "@/lib/admin-metadata";

export const SERIES_REQUEST_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "REJECTED",
  "WITHDRAWN",
] as const;

export type SeriesRequestStatus = (typeof SERIES_REQUEST_STATUSES)[number];

const teamIdSchema = z.string().trim().min(3).max(160);
const requestIdSchema = z.string().trim().min(3).max(160);

export const seriesRequestMetadataSchema = z
  .object({
    primaryTitle: z.string().trim().min(2).max(200),
    alternativeTitles: z
      .array(z.string().trim().min(1).max(240))
      .max(60)
      .default([]),
    description: z.string().trim().min(20).max(10_000),
    seriesType: z.enum(["MANGA", "MANHWA", "MANHUA"]),
    publicationStatus: z.enum([
      "ONGOING",
      "COMPLETED",
      "HIATUS",
      "UPCOMING",
    ]),
    publicationYear: z.number().int().min(1800).max(2200).nullable().default(null),
    authors: z.array(lookupEntitySchema).max(30).default([]),
    artists: z.array(lookupEntitySchema).max(30).default([]),
    publisherName: z.string().trim().max(180).default(""),
    countryCode: countryCodeSchema,
    languageCode: languageCodeSchema,
    readingDirection: z
      .enum(["VERTICAL", "RIGHT_TO_LEFT", "LEFT_TO_RIGHT"])
      .default("RIGHT_TO_LEFT"),
    genres: z.array(lookupEntitySchema).max(40).default([]),
    requestingTeamIds: z.array(teamIdSchema).min(1).max(30),
    externalSources: z.array(externalSourceSchema).max(2).default([]),
    submitterNotes: z.string().trim().max(4_000).default(""),
    duplicateConfirmation: z.boolean().default(false),
    duplicateExplanation: z.string().trim().max(2_000).default(""),
  })
  .superRefine((value, context) => {
    const duplicateSets: Array<
      [string, Array<{ name: string } | string>]
    > = [
      ["alternativeTitles", value.alternativeTitles],
      ["authors", value.authors],
      ["artists", value.artists],
      ["genres", value.genres],
    ];
    for (const [field, entries] of duplicateSets) {
      const seen = new Set<string>();
      entries.forEach((entry, index) => {
        const normalized = normalizedLookupKey(
          typeof entry === "string" ? entry : entry.name,
        );
        if (seen.has(normalized)) {
          context.addIssue({
            code: "custom",
            path: [field, index],
            message: "Remove the duplicate entry.",
          });
        }
        seen.add(normalized);
      });
    }
    const teamIds = new Set(value.requestingTeamIds);
    if (teamIds.size !== value.requestingTeamIds.length) {
      context.addIssue({
        code: "custom",
        path: ["requestingTeamIds"],
        message: "A requesting team can only be selected once.",
      });
    }
    if (
      value.duplicateConfirmation &&
      value.duplicateExplanation.trim().length < 12
    ) {
      context.addIssue({
        code: "custom",
        path: ["duplicateExplanation"],
        message:
          "Explain why the similar title is a distinct series in at least 12 characters.",
      });
    }
  });

export type SeriesRequestMetadata = z.infer<
  typeof seriesRequestMetadataSchema
>;

export const teamRequestQuerySchema = z.object({
  id: requestIdSchema.optional(),
  status: z.enum(["ALL", ...SERIES_REQUEST_STATUSES]).default("ALL"),
  teamId: teamIdSchema.optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const revisionMutationBase = z.object({
  requestId: requestIdSchema,
  expectedRevision: z.coerce.number().int().min(1),
});

export const teamRequestMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("CHECK_DUPLICATES"),
    requestId: requestIdSchema.optional(),
    teamId: teamIdSchema,
    data: seriesRequestMetadataSchema,
  }),
  z.object({
    action: z.literal("CREATE_DRAFT"),
    teamId: teamIdSchema,
    data: seriesRequestMetadataSchema,
  }),
  revisionMutationBase.extend({
    action: z.literal("SAVE_DRAFT"),
    data: seriesRequestMetadataSchema,
  }),
  revisionMutationBase.extend({
    action: z.literal("SUBMIT"),
    data: seriesRequestMetadataSchema,
  }),
  revisionMutationBase.extend({
    action: z.literal("RESUBMIT"),
    data: seriesRequestMetadataSchema,
  }),
  revisionMutationBase.extend({
    action: z.literal("WITHDRAW"),
    reason: z.string().trim().min(8).max(1_000),
  }),
  revisionMutationBase.extend({
    action: z.literal("DELETE_DRAFT"),
  }),
  revisionMutationBase.extend({
    action: z.literal("CLONE_TO_DRAFT"),
  }),
]);

export const adminRequestQuerySchema = z.object({
  id: requestIdSchema.optional(),
  query: z.string().trim().max(160).default(""),
  status: z.enum(["ALL", ...SERIES_REQUEST_STATUSES]).default("ALL"),
  teamId: teamIdSchema.optional(),
  reviewerId: z
    .union([z.literal("UNASSIGNED"), z.string().trim().min(3).max(160)])
    .optional(),
  type: z
    .enum(["ALL", "MANGA", "MANHWA", "MANHUA"])
    .default("ALL"),
  duplicateRisk: z.enum(["ALL", "NONE", "POSSIBLE"]).default("ALL"),
  source: z.enum(["ALL", "ANY", "NONE", "MANGADEX", "MANGAUPDATES"]).default(
    "ALL",
  ),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const adminMutationBase = z.object({
  requestId: requestIdSchema,
  expectedRevision: z.coerce.number().int().min(1),
});

const teamRightSchema = z
  .object({
    teamId: teamIdSchema,
    canUpload: z.boolean().default(true),
    canPublish: z.boolean().default(false),
    uploadRequiresReview: z.boolean().default(true),
    allowedLanguages: z
      .array(
        z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/),
      )
      .max(30)
      .default([]),
    isPrimary: z.boolean().default(false),
  })
  .superRefine((value, context) => {
    if (value.canPublish && !value.canUpload) {
      context.addIssue({
        code: "custom",
        path: ["canPublish"],
        message: "Publishing permission requires upload permission.",
      });
    }
    if (new Set(value.allowedLanguages).size !== value.allowedLanguages.length) {
      context.addIssue({
        code: "custom",
        path: ["allowedLanguages"],
        message: "Remove duplicate languages.",
      });
    }
  });

export type ApprovedTeamRight = z.infer<typeof teamRightSchema>;

export const adminRequestMutationSchema = z.discriminatedUnion("action", [
  adminMutationBase.extend({
    action: z.literal("START_REVIEW"),
  }),
  adminMutationBase.extend({
    action: z.literal("ASSIGN_REVIEWER"),
    reviewerUserId: z.string().trim().min(3).max(160).nullable(),
    reason: z.string().trim().min(8).max(1_000),
  }),
  adminMutationBase.extend({
    action: z.literal("ADD_FEEDBACK"),
    visibility: z.enum(["SUBMITTER", "INTERNAL"]),
    body: z.string().trim().min(2).max(4_000),
    fieldPath: z.string().trim().max(240).nullable().default(null),
  }),
  adminMutationBase.extend({
    action: z.literal("REQUEST_CHANGES"),
    reason: z.string().trim().min(10).max(4_000),
    fields: z
      .array(
        z.object({
          fieldPath: z.string().trim().min(1).max(240),
          comment: z.string().trim().min(2).max(2_000),
        }),
      )
      .min(1)
      .max(30),
  }),
  adminMutationBase.extend({
    action: z.literal("REJECT"),
    reason: z.string().trim().min(10).max(4_000),
  }),
  adminMutationBase.extend({
    action: z.literal("APPROVE"),
    reason: z.string().trim().min(8).max(4_000),
    teamRights: z.array(teamRightSchema).min(1).max(30),
  }),
  adminMutationBase.extend({
    action: z.literal("ATTACH_EXISTING"),
    seriesId: z.string().trim().min(3).max(160),
    reason: z.string().trim().min(8).max(4_000),
    teamRights: z.array(teamRightSchema).min(1).max(30),
  }),
]);

export const rightsQuerySchema = z.object({
  teamId: teamIdSchema.optional(),
  seriesId: z.string().trim().min(3).max(160).optional(),
  includeRevoked: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .default(false),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const rightsMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("GRANT"),
    seriesId: z.string().trim().min(3).max(160),
    right: teamRightSchema,
    reason: z.string().trim().min(8).max(2_000),
  }),
  z.object({
    action: z.literal("UPDATE"),
    seriesId: z.string().trim().min(3).max(160),
    expectedRevision: z.coerce.number().int().min(1),
    right: teamRightSchema,
    reason: z.string().trim().min(8).max(2_000),
  }),
  z.object({
    action: z.literal("REVOKE"),
    seriesId: z.string().trim().min(3).max(160),
    teamId: teamIdSchema,
    expectedRevision: z.coerce.number().int().min(1),
    reason: z.string().trim().min(8).max(2_000),
  }),
]);

export function normalizedSeriesRequestTitle(title: string) {
  return normalizedLookupKey(title);
}

export function externalSourceColumns(metadata: SeriesRequestMetadata) {
  const mangaDex = metadata.externalSources.find(
    (source) => source.source === "MANGADEX",
  );
  const mangaUpdates = metadata.externalSources.find(
    (source) => source.source === "MANGAUPDATES",
  );
  return {
    mangaDexId: mangaDex?.externalId ?? null,
    mangaDexUrl: mangaDex?.sourceUrl ?? null,
    mangaUpdatesId: mangaUpdates?.externalId ?? null,
    mangaUpdatesUrl: mangaUpdates?.sourceUrl ?? null,
    canonicalSourceUrl:
      mangaDex?.sourceUrl ?? mangaUpdates?.sourceUrl ?? null,
  };
}

export function requestSnapshot(
  metadata: SeriesRequestMetadata,
  requestId: string,
  revision: number,
) {
  return JSON.stringify({
    requestId,
    revision,
    ...metadata,
    externalSources: metadata.externalSources.map((source) => ({
      source: source.source,
      externalId: source.externalId,
      sourceUrl: source.sourceUrl,
      responseHash: source.responseHash ?? null,
    })),
  });
}
