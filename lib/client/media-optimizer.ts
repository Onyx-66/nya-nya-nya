"use client";

export type StaticMediaProfile = {
  maxWidth: number;
  maxHeight: number;
  maxBytes: number;
  quality?: number;
};

export type CropMediaProfile = {
  aspect: number;
  outputWidth: number;
  outputHeight: number;
  maxBytes: number;
};

export function computeCropRect(
  width: number,
  height: number,
  aspect: number,
  placement: { zoom: number; x: number; y: number },
) {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const sourceAspect = safeWidth / safeHeight;
  const baseCropWidth =
    sourceAspect > aspect ? safeHeight * aspect : safeWidth;
  const baseCropHeight =
    sourceAspect > aspect ? safeHeight : safeWidth / aspect;
  const zoom = Math.min(3, Math.max(1, placement.zoom));
  const cropWidth = baseCropWidth / zoom;
  const cropHeight = baseCropHeight / zoom;
  const availableX = Math.max(0, safeWidth - cropWidth);
  const availableY = Math.max(0, safeHeight - cropHeight);
  return {
    sourceX:
      availableX * Math.min(1, Math.max(0, placement.x)),
    sourceY:
      availableY * Math.min(1, Math.max(0, placement.y)),
    cropWidth,
    cropHeight,
  };
}

async function decode(file: File) {
  const declaredType = file.type.trim().toLowerCase();
  if (
    declaredType === "image/svg+xml" ||
    (declaredType &&
      declaredType !== "application/octet-stream" &&
      declaredType !== "binary/octet-stream" &&
      !declaredType.startsWith("image/"))
  ) {
    throw new Error("Choose a JPEG, PNG, or WebP image.");
  }
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("This image could not be decoded. Choose a valid JPEG, PNG, or WebP file.");
  }
}

async function canvasFile(
  canvas: HTMLCanvasElement,
  originalName: string,
  maxBytes: number,
  initialQuality = 0.88,
) {
  let quality = initialQuality;
  let blob: Blob | null = null;
  for (let pass = 0; pass < 8; pass += 1) {
    blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", quality),
    );
    if (!blob) throw new Error("The image could not be processed.");
    if (blob.size <= maxBytes || quality <= 0.48) break;
    quality -= 0.07;
  }
  if (!blob || blob.size > maxBytes) {
    throw new Error(
      "The image is still too large after optimization. Choose a simpler image.",
    );
  }
  const outputType = blob.type.trim().toLowerCase();
  const extension =
    outputType === "image/webp"
      ? "webp"
      : outputType === "image/png"
        ? "png"
        : outputType === "image/jpeg"
          ? "jpg"
          : "";
  if (!extension) {
    throw new Error("This browser returned an unsupported image format.");
  }
  const base = originalName.replace(/\.[^.]+$/, "") || "image";
  return new File([blob], `${base}.${extension}`, {
    type: outputType,
    lastModified: Date.now(),
  });
}

export async function optimizeStaticMedia(
  file: File,
  profile: StaticMediaProfile,
) {
  if (file.type === "image/gif") return file;
  const bitmap = await decode(file);
  try {
    const scale = Math.min(
      1,
      profile.maxWidth / bitmap.width,
      profile.maxHeight / bitmap.height,
    );
    if (scale === 1 && file.size <= profile.maxBytes && file.type === "image/webp") {
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Image processing is unavailable.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await canvasFile(
      canvas,
      file.name,
      profile.maxBytes,
      profile.quality ?? 0.88,
    );
  } finally {
    bitmap.close();
  }
}

export async function cropStaticMedia(
  file: File,
  profile: CropMediaProfile,
  placement: { zoom: number; x: number; y: number },
) {
  const bitmap = await decode(file);
  try {
    const { sourceX, sourceY, cropWidth, cropHeight } = computeCropRect(
      bitmap.width,
      bitmap.height,
      profile.aspect,
      placement,
    );
    const canvas = document.createElement("canvas");
    canvas.width = profile.outputWidth;
    canvas.height = profile.outputHeight;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Image processing is unavailable.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      bitmap,
      sourceX,
      sourceY,
      cropWidth,
      cropHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    return await canvasFile(canvas, file.name, profile.maxBytes, 0.9);
  } finally {
    bitmap.close();
  }
}
