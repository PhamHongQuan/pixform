import type { Decoded } from './decode';
import { FORMATS, type FormatId } from './formats';

export interface EncodeOptions {
  format: FormatId;
  /** 0–100, used by lossy formats. */
  quality: number;
  /** Fill color under transparent pixels for formats without alpha (JPEG, BMP). */
  background: string;
}

const ICO_SIZES = [16, 32, 48, 256];

function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Ảnh quá lớn để xử lý trên trình duyệt này');
  ctx.imageSmoothingQuality = 'high';
  return [canvas, ctx];
}

function render(img: Decoded, background: string | null): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const [canvas, ctx] = makeCanvas(img.width, img.height);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, img.width, img.height);
  }
  ctx.drawImage(img.source, 0, 0, img.width, img.height);
  return [canvas, ctx];
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Ảnh quá lớn để xử lý trên trình duyệt này'))), type, quality),
  );
}

/**
 * Uses the browser encoder when it supports the type; browsers that don't (e.g. Safari for WebP,
 * most browsers for AVIF) silently return PNG, so that case falls back to a WebAssembly encoder.
 */
async function encodeWithFallback(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  mime: string,
  quality: number,
  wasm: (data: ImageData) => Promise<ArrayBuffer>,
): Promise<Blob> {
  const native = await toBlob(canvas, mime, quality / 100);
  if (native.type === mime) return native;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return new Blob([await wasm(data)], { type: mime });
}

async function encodeGif(data: ImageData): Promise<Uint8Array<ArrayBuffer>> {
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
  const px = data.data;
  let hasAlpha = false;
  for (let i = 3; i < px.length; i += 4) {
    if (px[i] < 128) {
      hasAlpha = true;
      break;
    }
  }
  const format = hasAlpha ? 'rgba4444' : 'rgb565';
  const palette = quantize(px, 256, { format, oneBitAlpha: hasAlpha });
  const index = applyPalette(px, palette, format);
  const transparentIndex = hasAlpha ? palette.findIndex((c) => c[3] === 0) : -1;
  const gif = GIFEncoder();
  gif.writeFrame(index, data.width, data.height, {
    palette,
    transparent: transparentIndex >= 0,
    transparentIndex: Math.max(transparentIndex, 0),
  });
  gif.finish();
  return gif.bytes();
}

/** 24-bit bottom-up BMP (BITMAPINFOHEADER), readable everywhere. */
function encodeBmp(data: ImageData): Uint8Array<ArrayBuffer> {
  const { width: w, height: h, data: px } = data;
  const rowSize = (w * 3 + 3) & ~3;
  const offset = 14 + 40;
  const out = new Uint8Array(offset + rowSize * h);
  const v = new DataView(out.buffer);
  out[0] = 0x42;
  out[1] = 0x4d;
  v.setUint32(2, out.length, true);
  v.setUint32(10, offset, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, w, true);
  v.setInt32(22, h, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, 24, true);
  v.setUint32(34, rowSize * h, true);
  v.setInt32(38, 2835, true); // 72 DPI
  v.setInt32(42, 2835, true);
  for (let y = 0; y < h; y++) {
    let o = offset + (h - 1 - y) * rowSize;
    for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
      out[o++] = px[i + 2];
      out[o++] = px[i + 1];
      out[o++] = px[i];
    }
  }
  return out;
}

/** Multi-size ICO with PNG-compressed entries, each a square with the image centred. */
async function encodeIco(img: Decoded): Promise<Uint8Array<ArrayBuffer>> {
  const longest = Math.max(img.width, img.height);
  const sizes = ICO_SIZES.filter((s) => s <= longest);
  if (!sizes.length) sizes.push(longest);

  const entries: Uint8Array[] = [];
  for (const size of sizes) {
    const [canvas, ctx] = makeCanvas(size, size);
    const scale = size / longest;
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    ctx.drawImage(img.source, Math.floor((size - w) / 2), Math.floor((size - h) / 2), w, h);
    entries.push(new Uint8Array(await (await toBlob(canvas, 'image/png')).arrayBuffer()));
    canvas.width = 0;
  }

  const headerSize = 6 + 16 * entries.length;
  const out = new Uint8Array(headerSize + entries.reduce((n, e) => n + e.length, 0));
  const v = new DataView(out.buffer);
  v.setUint16(2, 1, true);
  v.setUint16(4, entries.length, true);
  let offset = headerSize;
  entries.forEach((png, i) => {
    const e = 6 + 16 * i;
    out[e] = sizes[i] >= 256 ? 0 : sizes[i];
    out[e + 1] = sizes[i] >= 256 ? 0 : sizes[i];
    v.setUint16(e + 4, 1, true);
    v.setUint16(e + 6, 32, true);
    v.setUint32(e + 8, png.length, true);
    v.setUint32(e + 12, offset, true);
    out.set(png, offset);
    offset += png.length;
  });
  return out;
}

async function encodeTiff(data: ImageData): Promise<ArrayBuffer> {
  const { default: UTIF } = await import('utif');
  return UTIF.encodeImage(data.data, data.width, data.height);
}

export async function encodeImage(img: Decoded, opts: EncodeOptions): Promise<Blob> {
  const info = FORMATS[opts.format];
  if (opts.format === 'ico') return new Blob([await encodeIco(img)], { type: info.mime });

  const [canvas, ctx] = render(img, info.opaque ? opts.background : null);
  const pixels = () => ctx.getImageData(0, 0, canvas.width, canvas.height);
  try {
    switch (opts.format) {
      case 'png':
        return await toBlob(canvas, info.mime);
      case 'jpeg':
        return await toBlob(canvas, info.mime, opts.quality / 100);
      case 'webp':
        return await encodeWithFallback(canvas, ctx, info.mime, opts.quality, async (data) => {
          const { default: encode } = await import('@jsquash/webp/encode');
          return encode(data, { quality: opts.quality });
        });
      case 'avif':
        return await encodeWithFallback(canvas, ctx, info.mime, opts.quality, async (data) => {
          const { default: encode } = await import('@jsquash/avif/encode');
          return encode(data, { quality: opts.quality, speed: 6 });
        });
      case 'gif':
        return new Blob([await encodeGif(pixels())], { type: info.mime });
      case 'bmp':
        return new Blob([encodeBmp(pixels())], { type: info.mime });
      case 'tiff':
        return new Blob([await encodeTiff(pixels())], { type: info.mime });
      default:
        throw new Error(`Không hỗ trợ xuất ${info.label}`);
    }
  } finally {
    canvas.width = 0;
  }
}
