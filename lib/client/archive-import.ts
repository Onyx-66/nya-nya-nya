import { Unzip, UnzipInflate, UnzipPassThrough } from "fflate";
import {
  normalizeUploadPath,
  pathLeaf,
  UPLOAD_LIMITS,
  type UploadJobKind,
} from "@/lib/uploads";

export type ExtractedArchivePage = {
  file: File;
  path: string;
};

const extensionTypes: Record<string, string> = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function imageType(path: string) {
  return extensionTypes[path.split(".").at(-1)?.toLowerCase() ?? ""] ?? null;
}

function hasExpectedMagic(bytes: Uint8Array, contentType: string) {
  if (contentType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === "image/png") {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    );
  }
  return (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

export async function extractZipPages(
  archive: File,
  kind: UploadJobKind,
): Promise<ExtractedArchivePage[]> {
  if (archive.size <= 0 || archive.size > 750 * 1024 * 1024) {
    throw new Error("ZIP / CBZ archives must be 750 MB or smaller.");
  }
  const maxFiles =
    kind === "BATCH"
      ? UPLOAD_LIMITS.maxChaptersPerJob * UPLOAD_LIMITS.maxPagesPerChapter
      : UPLOAD_LIMITS.maxPagesPerChapter;
  const maxExtractedBytes =
    kind === "BATCH"
      ? Math.min(UPLOAD_LIMITS.maxJobBytes, 1_000_000_000)
      : UPLOAD_LIMITS.maxChapterBytes;
  const extracted: ExtractedArchivePage[] = [];
  let extractedBytes = 0;
  let failure: Error | null = null;
  const unzip = new Unzip((entry) => {
    if (failure || entry.name.endsWith("/")) return;
    const normalized = normalizeUploadPath(entry.name);
    if (!normalized) {
      failure = new Error(
        "The archive contains an unsafe, hidden, or system path.",
      );
      entry.terminate();
      return;
    }
    const contentType = imageType(normalized);
    if (!contentType) return;
    if (extracted.length >= maxFiles) {
      failure = new Error(
        `The archive exceeds the ${maxFiles.toLocaleString()} page safety limit.`,
      );
      entry.terminate();
      return;
    }
    if (
      entry.originalSize !== undefined &&
      entry.originalSize > UPLOAD_LIMITS.maxPageBytes
    ) {
      failure = new Error(`${normalized} is larger than 25 MB.`);
      entry.terminate();
      return;
    }
    if (
      entry.originalSize !== undefined &&
      entry.size !== undefined &&
      entry.originalSize > 2_000_000 &&
      entry.originalSize / Math.max(1, entry.size) > 200
    ) {
      failure = new Error(
        `${normalized} has an unsafe archive compression ratio.`,
      );
      entry.terminate();
      return;
    }
    const chunks: Uint8Array[] = [];
    let pageBytes = 0;
    entry.ondata = (error, chunk, final) => {
      if (failure) return;
      if (error) {
        failure = new Error(`Could not extract ${normalized}.`);
        return;
      }
      pageBytes += chunk.byteLength;
      extractedBytes += chunk.byteLength;
      if (
        pageBytes > UPLOAD_LIMITS.maxPageBytes ||
        extractedBytes > maxExtractedBytes
      ) {
        failure = new Error(
          pageBytes > UPLOAD_LIMITS.maxPageBytes
            ? `${normalized} is larger than 25 MB.`
            : "The extracted archive exceeds the upload size limit.",
        );
        entry.terminate();
        return;
      }
      chunks.push(chunk);
      if (!final) return;
      const bytes = new Uint8Array(pageBytes);
      let offset = 0;
      for (const part of chunks) {
        bytes.set(part, offset);
        offset += part.byteLength;
      }
      if (!hasExpectedMagic(bytes, contentType)) {
        failure = new Error(
          `${normalized} does not match its image file extension.`,
        );
        return;
      }
      const file = new File([bytes], pathLeaf(normalized), { type: contentType });
      Object.defineProperty(file, "webkitRelativePath", {
        configurable: true,
        value: normalized,
      });
      extracted.push({ file, path: normalized });
    };
    entry.start();
  });
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough);
  const reader = archive.stream().getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (failure) throw failure;
      unzip.push(value, false);
    }
    unzip.push(new Uint8Array(0), true);
    if (failure) throw failure;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error instanceof Error
      ? error
      : new Error("The ZIP / CBZ archive could not be extracted.");
  }
  if (!extracted.length) {
    throw new Error(
      "No valid JPEG, PNG, or WebP chapter pages were found in the archive.",
    );
  }
  return extracted;
}
