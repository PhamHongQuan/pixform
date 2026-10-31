// Minimal typings for the parts of untyped libraries this app uses.

declare module 'utif' {
  interface IFD {
    width: number;
    height: number;
  }
  const UTIF: {
    decode(buf: ArrayBuffer): IFD[];
    decodeImage(buf: ArrayBuffer, ifd: IFD): void;
    toRGBA8(ifd: IFD): Uint8Array<ArrayBuffer>;
    encodeImage(rgba: ArrayLike<number>, w: number, h: number): ArrayBuffer;
  };
  export default UTIF;
}

declare module 'gifenc' {
  type Format = 'rgb565' | 'rgb444' | 'rgba4444';
  type Palette = number[][];
  export function quantize(rgba: ArrayLike<number>, maxColors: number, opts?: { format?: Format; oneBitAlpha?: boolean | number }): Palette;
  export function applyPalette(rgba: ArrayLike<number>, palette: Palette, format?: Format): Uint8Array;
  export function GIFEncoder(): {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts?: { palette?: Palette; transparent?: boolean; transparentIndex?: number; delay?: number },
    ): void;
    finish(): void;
    bytes(): Uint8Array<ArrayBuffer>;
  };
}
