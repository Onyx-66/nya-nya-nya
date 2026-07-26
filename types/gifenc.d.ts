declare module "gifenc" {
  export type Palette = Array<[number, number, number]> | Uint8Array;

  export function quantize(
    rgba: Uint8ClampedArray | Uint8Array,
    maxColors: number,
    options?: Record<string, unknown>,
  ): Palette;

  export function applyPalette(
    rgba: Uint8ClampedArray | Uint8Array,
    palette: Palette,
  ): Uint8Array;

  export function GIFEncoder(): {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options: {
        palette: Palette;
        delay?: number;
        dispose?: number;
        transparent?: boolean;
        transparentIndex?: number;
      },
    ): void;
    finish(): void;
    bytes(): Uint8Array;
  };
}
