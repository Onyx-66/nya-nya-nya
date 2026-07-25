import { env } from "cloudflare:workers";
import { gifFrameCount } from "@/lib/gif";
import { ApiError } from "@/lib/server/api";
import type { Actor } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";
import {
  deleteMediaObject as deleteMediaObjectWithId,
  MEDIA_CLEANUP_MAX_ATTEMPTS,
  type MediaCleanupContext,
  retryPendingMediaCleanup as retryPendingMediaCleanupWithId,
} from "@/lib/server/media-cleanup";
export { MEDIA_CLEANUP_MAX_ATTEMPTS };

export function deleteMediaObject(
  db: D1Database,
  bucket: R2Bucket,
  objectKey: string,
  context: MediaCleanupContext,
) {
  return deleteMediaObjectWithId(db, bucket, objectKey, context, randomId);
}

export function retryPendingMediaCleanup(
  db: D1Database,
  bucket: R2Bucket,
  limit = 5,
) {
  return retryPendingMediaCleanupWithId(
    db,
    bucket,
    randomId,
    limit,
  );
}

const sensitiveKeyPattern =
  /(password|passcode|token|secret|authorization|cookie|session|oauth|api[_-]?key|card|cvv|credential|private[_-]?key|provider[_-]?(key|payload)|(^|[_-])(body|content|comment|message|text)($|[_-]))/i;

const auditStringLimit = 2_000;
const auditArrayLimit = 50;
const auditKeyLimit = 100;
const auditDepthLimit = 6;

export function requestIdFor(request: Request) {
  const supplied = request.headers.get("x-request-id")?.trim() ?? "";
  return /^[A-Za-z0-9._:-]{8,120}$/.test(supplied)
    ? supplied
    : randomId();
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expectedOrigin = new URL(request.url).origin;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (origin === expectedOrigin || (!origin && fetchSite === "same-origin")) {
    return;
  }
  throw new ApiError(
    403,
    "ORIGIN_MISMATCH",
    "This action must come from NyaScans.",
  );
}

export function redactSensitive(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (depth > auditDepthLimit) return "[TRUNCATED]";
  if (typeof value === "string") {
    return value.length > auditStringLimit
      ? `${value.slice(0, auditStringLimit)}…`
      : value;
  }
  if (typeof value === "bigint") return value.toString();
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "undefined"
  ) {
    return value;
  }
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value
      .slice(0, auditArrayLimit)
      .map((entry) => redactSensitive(entry, depth + 1, seen));
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, auditKeyLimit)
      .map(([key, entry]) => [
        key,
        sensitiveKeyPattern.test(key)
          ? "[REDACTED]"
          : redactSensitive(entry, depth + 1, seen),
      ]),
  );
}

export function safeJson(value: unknown) {
  const serialized = JSON.stringify(redactSensitive(value));
  return serialized.length > 32_000
    ? JSON.stringify({ truncated: true, preview: serialized.slice(0, 31_000) })
    : serialized;
}

export type AuditInput = {
  action: string;
  category:
    | "AUTHENTICATION_SECURITY"
    | "USERS_ROLES"
    | "SERIES_CHAPTERS"
    | "TEAMS_PERMISSIONS"
    | "DISCUSSIONS_MODERATION"
    | "COMMERCE_STORE"
    | "APPEARANCE_SETTINGS"
    | "UPLOADS_IMPORTS"
    | "SYSTEM_MAINTENANCE";
  sourceArea: string;
  result?: "SUCCESS" | "FAILURE" | "DENIED";
  targetType: string;
  targetId: string;
  targetLabel?: string | null;
  reason?: string | null;
  metadata?: unknown;
  oldValue?: unknown;
  newValue?: unknown;
};

export async function writeAudit(
  actor: Actor | null,
  requestId: string,
  input: AuditInput,
) {
  if (!env.DB) return;
  await env.DB.prepare(
    `INSERT INTO audit_logs
     (id, actor_user_id, actor_role, action, category, source_area, result,
      target_type, target_id, target_label, reason, request_id, metadata_json,
      old_value_json, new_value_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      randomId(),
      actor?.id ?? null,
      actor?.primaryRole ?? null,
      input.action,
      input.category,
      input.sourceArea,
      input.result ?? "SUCCESS",
      input.targetType,
      input.targetId,
      input.targetLabel ?? null,
      input.reason ?? null,
      requestId,
      input.metadata === undefined ? null : safeJson(input.metadata),
      input.oldValue === undefined ? null : safeJson(input.oldValue),
      input.newValue === undefined ? null : safeJson(input.newValue),
    )
    .run();
}

export function auditStatement(
  db: D1Database,
  actor: Actor | null,
  requestId: string,
  input: AuditInput,
  condition = "1 = 1",
) {
  return db
    .prepare(
      `INSERT INTO audit_logs
       (id, actor_user_id, actor_role, action, category, source_area, result,
        target_type, target_id, target_label, reason, request_id, metadata_json,
        old_value_json, new_value_json)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE ${condition}`,
    )
    .bind(
      randomId(),
      actor?.id ?? null,
      actor?.primaryRole ?? null,
      input.action,
      input.category,
      input.sourceArea,
      input.result ?? "SUCCESS",
      input.targetType,
      input.targetId,
      input.targetLabel ?? null,
      input.reason ?? null,
      requestId,
      input.metadata === undefined ? null : safeJson(input.metadata),
      input.oldValue === undefined ? null : safeJson(input.oldValue),
      input.newValue === undefined ? null : safeJson(input.newValue),
    );
}

export const safeRasterTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export function detectedRasterType(bytes: Uint8Array) {
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

export function rasterDimensions(bytes: Uint8Array, contentType: string) {
  if (contentType === "image/png" && bytes.length >= 24) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (contentType === "image/gif" && bytes.length >= 10) {
    return {
      width: bytes[6]! | (bytes[7]! << 8),
      height: bytes[8]! | (bytes[9]! << 8),
    };
  }
  if (contentType === "image/jpeg" && bytes.length >= 10) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1]!;
      const length = (bytes[offset + 2]! << 8) + bytes[offset + 3]!;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb,
          0xcd, 0xce, 0xcf,
        ].includes(marker)
      ) {
        return {
          height: (bytes[offset + 5]! << 8) + bytes[offset + 6]!,
          width: (bytes[offset + 7]! << 8) + bytes[offset + 8]!,
        };
      }
      if (length < 2) break;
      offset += 2 + length;
    }
  }
  if (contentType === "image/webp" && bytes.length >= 30) {
    const chunk = String.fromCharCode(...bytes.slice(12, 16));
    if (chunk === "VP8X") {
      return {
        width: 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16),
        height: 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16),
      };
    }
    if (
      chunk === "VP8 " &&
      bytes[23] === 0x9d &&
      bytes[24] === 0x01 &&
      bytes[25] === 0x2a
    ) {
      return {
        width: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff,
        height: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff,
      };
    }
    if (chunk === "VP8L" && bytes[20] === 0x2f) {
      const bits =
        bytes[21]! |
        (bytes[22]! << 8) |
        (bytes[23]! << 16) |
        (bytes[24]! << 24);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
      };
    }
  }
  return null;
}

export function isAnimatedRaster(bytes: Uint8Array, contentType: string) {
  if (contentType === "image/gif") return gifFrameCount(bytes) > 1;
  if (contentType === "image/webp") {
    return new TextDecoder("latin1").decode(bytes).includes("ANIM");
  }
  return false;
}

export function safeFilename(value: string) {
  const leaf = value.replaceAll("\\", "/").split("/").at(-1) ?? "upload";
  return (
    leaf
      .normalize("NFKC")
      .replace(/[^a-zA-Z0-9._ -]/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 140) || "upload"
  );
}

export type ImageRule = {
  label: string;
  maxBytes: number;
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
  maxPixels?: number;
  allowAnimation?: boolean;
  maxGifFrames?: number;
  allowedTypes?: Set<string>;
};

export async function validateImageFile(file: File, rule: ImageRule) {
  if (file.size <= 0) {
    throw new ApiError(422, "IMAGE_REQUIRED", `Choose a ${rule.label} image.`);
  }
  if (file.size > rule.maxBytes) {
    throw new ApiError(
      413,
      "IMAGE_TOO_LARGE",
      `${rule.label} must be ${Math.floor(rule.maxBytes / 1024 / 1024)} MB or smaller.`,
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = detectedRasterType(bytes);
  const allowed = rule.allowedTypes ?? safeRasterTypes;
  if (!contentType || !allowed.has(contentType)) {
    throw new ApiError(
      415,
      "IMAGE_TYPE_INVALID",
      `Use a verified JPEG, PNG, WebP, or GIF ${rule.label}.`,
    );
  }
  if (file.type && file.type !== contentType) {
    throw new ApiError(
      415,
      "IMAGE_SIGNATURE_MISMATCH",
      `The ${rule.label} file signature does not match its declared type.`,
    );
  }
  const dimensions = rasterDimensions(bytes, contentType);
  if (
    !dimensions ||
    dimensions.width < rule.minWidth ||
    dimensions.height < rule.minHeight ||
    dimensions.width > rule.maxWidth ||
    dimensions.height > rule.maxHeight ||
    dimensions.width * dimensions.height >
      (rule.maxPixels ?? rule.maxWidth * rule.maxHeight)
  ) {
    throw new ApiError(
      422,
      "IMAGE_DIMENSIONS_INVALID",
      `${rule.label} dimensions must be between ${rule.minWidth}×${rule.minHeight} and ${rule.maxWidth}×${rule.maxHeight}px.`,
    );
  }
  const animated = isAnimatedRaster(bytes, contentType);
  if (animated && !rule.allowAnimation) {
    throw new ApiError(
      415,
      "ANIMATION_NOT_ALLOWED",
      `${rule.label} must be a static image.`,
    );
  }
  if (
    contentType === "image/gif" &&
    (rule.maxGifFrames ?? 120) < gifFrameCount(bytes)
  ) {
    throw new ApiError(
      422,
      "ANIMATION_TOO_LONG",
      `${rule.label} contains too many animation frames.`,
    );
  }
  return { bytes, contentType, dimensions, animated };
}

export async function sha256Hex(bytes: Uint8Array) {
  const ownedBytes = Uint8Array.from(bytes);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", ownedBytes.buffer),
  );
  return [...digest]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
