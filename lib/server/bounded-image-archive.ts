import { Unzip, UnzipInflate } from "fflate";
import { ApiError } from "@/lib/server/api";

const MAX_ARCHIVE_BYTES = 250 * 1024 * 1024;
const MAX_IMAGE_FILES = 500;
const MAX_COMPRESSION_RATIO = 30;
const RATIO_GRACE_BYTES = 10 * 1024 * 1024;
const IMAGE_EXTENSION = /\.(?:jpe?g|png|webp)$/iu;

export type ExtractedImagePage = {
  bytes: Uint8Array;
  filename: string;
  normalizedPath: string;
};

function archiveError(code: string, message: string, status = 422) {
  return new ApiError(status, code, message);
}

function normalizedArchivePath(name: string) {
  const normalized = name.replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    normalized.split("/").includes("..") ||
    normalized.split("/").some((part) => part.startsWith("."))
  ) {
    throw archiveError(
      "SOURCE_ARCHIVE_PATH_INVALID",
      "The ZIP/CBZ source contains an unsafe page path.",
    );
  }
  return normalized;
}

function joinChunks(chunks: Uint8Array[], byteLength: number) {
  const joined = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

/**
 * Extracts supported image entries while enforcing output limits as bytes are
 * produced. Unsupported entries are never inflated, preventing archive bombs
 * from allocating their declared output before the guard runs.
 */
export function extractBoundedImageArchive(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw archiveError(
      "SOURCE_TOO_LARGE",
      "The ZIP/CBZ source exceeds the 250 MB upload limit.",
      413,
    );
  }

  const outputLimit = Math.min(
    MAX_ARCHIVE_BYTES,
    Math.max(bytes.byteLength * MAX_COMPRESSION_RATIO, RATIO_GRACE_BYTES),
  );
  const pages: ExtractedImagePage[] = [];
  let declaredBytes = 0;
  let producedBytes = 0;
  let failure: unknown = null;

  const unzip = new Unzip((entry) => {
    if (failure || !IMAGE_EXTENSION.test(entry.name)) return;
    try {
      const normalizedPath = normalizedArchivePath(entry.name);
      if (pages.length >= MAX_IMAGE_FILES) {
        throw archiveError(
          "SOURCE_ARCHIVE_FILE_LIMIT",
          `The ZIP/CBZ source contains more than ${MAX_IMAGE_FILES} image pages.`,
        );
      }
      if (typeof entry.originalSize === "number") {
        declaredBytes += entry.originalSize;
        if (declaredBytes > outputLimit) {
          throw archiveError(
            "SOURCE_ARCHIVE_RATIO_LIMIT",
            "The ZIP/CBZ compression ratio or extracted size exceeds the safe limit.",
            413,
          );
        }
      }

      const chunks: Uint8Array[] = [];
      let entryBytes = 0;
      entry.ondata = (error, chunk, final) => {
        if (failure) return;
        if (error) {
          failure = archiveError(
            "SOURCE_ARCHIVE_INVALID",
            "The ZIP/CBZ source could not be safely extracted.",
          );
          return;
        }
        entryBytes += chunk.byteLength;
        producedBytes += chunk.byteLength;
        if (producedBytes > outputLimit) {
          failure = archiveError(
            "SOURCE_ARCHIVE_RATIO_LIMIT",
            "The ZIP/CBZ compression ratio or extracted size exceeds the safe limit.",
            413,
          );
          entry.terminate();
          return;
        }
        chunks.push(chunk);
        if (final) {
          pages.push({
            bytes: joinChunks(chunks, entryBytes),
            filename: normalizedPath.split("/").at(-1) || `page-${pages.length + 1}`,
            normalizedPath,
          });
        }
      };
      entry.start();
    } catch (error) {
      failure = error;
      entry.terminate();
    }
  });
  unzip.register(UnzipInflate);

  try {
    unzip.push(bytes, true);
  } catch {
    if (!failure) {
      failure = archiveError(
        "SOURCE_ARCHIVE_INVALID",
        "The ZIP/CBZ source could not be safely extracted.",
      );
    }
  }
  if (failure) throw failure;
  if (!pages.length) {
    throw archiveError(
      "SOURCE_ARCHIVE_EMPTY",
      "The ZIP/CBZ source contains no supported image pages.",
    );
  }
  return pages.sort((left, right) =>
    left.normalizedPath.localeCompare(right.normalizedPath, undefined, {
      numeric: true,
    }),
  );
}
