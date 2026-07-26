import { decompressFrames, parseGIF } from "gifuct-js";
import { applyPalette, GIFEncoder, quantize } from "gifenc";

export const REACTION_ASSET_LIMIT = 1_250_000;
const OPTIMIZATION_TARGET = 1_220_000;
const MAX_DIMENSION = 512;

type OptimizedReactionAsset = {
  file: File;
  originalBytes: number;
  optimizedBytes: number;
  animated: boolean;
};

function extensionlessName(name: string) {
  return name.replace(/\.[^.]+$/, "") || "reaction";
}

function canvasBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("The browser could not encode this image.")),
      type,
      quality,
    );
  });
}

async function optimizeStatic(file: File): Promise<OptimizedReactionAsset> {
  const bitmap = await createImageBitmap(file);
  try {
    let scale = Math.min(
      1,
      MAX_DIMENSION / Math.max(bitmap.width, bitmap.height),
    );
    let latest: Blob | null = null;
    for (let attempt = 0; attempt < 18; attempt += 1) {
      const width = Math.max(24, Math.round(bitmap.width * scale));
      const height = Math.max(24, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) throw new Error("Image optimization is unavailable.");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, width, height);
      const quality = Math.max(0.46, 0.9 - attempt * 0.035);
      latest = await canvasBlob(canvas, "image/webp", quality);
      if (latest.size <= OPTIMIZATION_TARGET) {
        return {
          file: new File(
            [latest],
            `${extensionlessName(file.name)}.webp`,
            { type: "image/webp", lastModified: Date.now() },
          ),
          originalBytes: file.size,
          optimizedBytes: latest.size,
          animated: false,
        };
      }
      scale *= 0.84;
    }
    if (!latest || latest.size > REACTION_ASSET_LIMIT) {
      throw new Error("This image could not be reduced below 1.25 MB.");
    }
    return {
      file: new File([latest], `${extensionlessName(file.name)}.webp`, {
        type: "image/webp",
        lastModified: Date.now(),
      }),
      originalBytes: file.size,
      optimizedBytes: latest.size,
      animated: false,
    };
  } finally {
    bitmap.close();
  }
}

type GifFrame = ReturnType<typeof decompressFrames>[number];

function gifDimensions(frames: GifFrame[]) {
  return frames.reduce(
    (size, frame) => ({
      width: Math.max(size.width, frame.dims.left + frame.dims.width),
      height: Math.max(size.height, frame.dims.top + frame.dims.height),
    }),
    { width: 1, height: 1 },
  );
}

function encodeAnimatedGif(
  frames: GifFrame[],
  sourceWidth: number,
  sourceHeight: number,
  maxDimension: number,
  maxColors: number,
  maxFrames: number,
) {
  const scale = Math.min(
    1,
    maxDimension / Math.max(sourceWidth, sourceHeight),
  );
  const width = Math.max(24, Math.round(sourceWidth * scale));
  const height = Math.max(24, Math.round(sourceHeight * scale));
  const source = document.createElement("canvas");
  source.width = sourceWidth;
  source.height = sourceHeight;
  const sourceContext = source.getContext("2d", { alpha: true });
  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const outputContext = output.getContext("2d", {
    alpha: true,
    willReadFrequently: true,
  });
  if (!sourceContext || !outputContext) {
    throw new Error("GIF optimization is unavailable.");
  }

  const encoder = GIFEncoder();
  const frameStep = Math.max(1, Math.ceil(frames.length / maxFrames));
  let accumulatedDelay = 0;
  frames.forEach((frame, index) => {
    const previous =
      frame.disposalType === 3
        ? sourceContext.getImageData(0, 0, sourceWidth, sourceHeight)
        : null;
    const patch = new ImageData(
      new Uint8ClampedArray(frame.patch),
      frame.dims.width,
      frame.dims.height,
    );
    sourceContext.putImageData(patch, frame.dims.left, frame.dims.top);
    accumulatedDelay += Math.max(20, Number(frame.delay ?? 100));
    const shouldWrite =
      index % frameStep === 0 || index === frames.length - 1;
    if (shouldWrite) {
      outputContext.clearRect(0, 0, width, height);
      outputContext.imageSmoothingEnabled = true;
      outputContext.imageSmoothingQuality = "high";
      outputContext.drawImage(source, 0, 0, width, height);
      const rgba = outputContext.getImageData(0, 0, width, height).data;
      const palette = quantize(rgba, maxColors);
      encoder.writeFrame(applyPalette(rgba, palette), width, height, {
        palette,
        delay: accumulatedDelay,
        dispose: 1,
      });
      accumulatedDelay = 0;
    }
    if (frame.disposalType === 2) {
      sourceContext.clearRect(
        frame.dims.left,
        frame.dims.top,
        frame.dims.width,
        frame.dims.height,
      );
    } else if (frame.disposalType === 3 && previous) {
      sourceContext.putImageData(previous, 0, 0);
    }
  });
  encoder.finish();
  return encoder.bytes();
}

async function optimizeGif(file: File): Promise<OptimizedReactionAsset> {
  const parsed = parseGIF(await file.arrayBuffer());
  const frames = decompressFrames(parsed, true);
  if (!frames.length) throw new Error("This GIF contains no readable frames.");
  const size = gifDimensions(frames);
  const attempts = [
    [512, 128, 120],
    [448, 96, 100],
    [384, 96, 80],
    [320, 64, 64],
    [256, 64, 48],
    [224, 48, 36],
    [192, 48, 28],
    [160, 32, 20],
    [128, 24, 14],
    [96, 16, 10],
  ] as const;

  let latest: Uint8Array | null = null;
  for (const [dimension, colors, frameLimit] of attempts) {
    latest = encodeAnimatedGif(
      frames,
      size.width,
      size.height,
      dimension,
      colors,
      frameLimit,
    );
    if (latest.byteLength <= OPTIMIZATION_TARGET) {
      return {
        file: new File(
          [latest],
          `${extensionlessName(file.name)}.gif`,
          { type: "image/gif", lastModified: Date.now() },
        ),
        originalBytes: file.size,
        optimizedBytes: latest.byteLength,
        animated: frames.length > 1,
      };
    }
  }
  if (!latest || latest.byteLength > REACTION_ASSET_LIMIT) {
    throw new Error("This GIF could not be reduced below 1.25 MB.");
  }
  return {
    file: new File([latest], `${extensionlessName(file.name)}.gif`, {
      type: "image/gif",
      lastModified: Date.now(),
    }),
    originalBytes: file.size,
    optimizedBytes: latest.byteLength,
    animated: frames.length > 1,
  };
}

export async function optimizeReactionAsset(
  file: File,
): Promise<OptimizedReactionAsset> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose a PNG, WebP, GIF, or JPEG image.");
  }
  if (file.type === "image/gif") return optimizeGif(file);
  return optimizeStatic(file);
}
