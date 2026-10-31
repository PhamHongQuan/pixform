export type FormatId = 'png' | 'jpeg' | 'webp' | 'avif' | 'gif' | 'bmp' | 'ico' | 'tiff' | 'heic' | 'svg';

export interface FormatInfo {
  id: FormatId;
  label: string;
  /** Extension used for converted files. */
  ext: string;
  /** Every extension a file of this format is commonly saved with. */
  exts: string[];
  mime: string;
  /** Has a quality setting when encoding. */
  lossy: boolean;
  /** Cannot store transparency: transparent pixels are painted over the background color. */
  opaque: boolean;
  note: string;
}

export const FORMATS: Record<FormatId, FormatInfo> = {
  webp: { id: 'webp', label: 'WebP', ext: 'webp', exts: ['webp'], mime: 'image/webp', lossy: true, opaque: false, note: 'Nhẹ, cho web' },
  png: { id: 'png', label: 'PNG', ext: 'png', exts: ['png', 'apng'], mime: 'image/png', lossy: false, opaque: false, note: 'Không mất dữ liệu' },
  jpeg: { id: 'jpeg', label: 'JPG', ext: 'jpg', exts: ['jpg', 'jpeg', 'jpe', 'jfif'], mime: 'image/jpeg', lossy: true, opaque: true, note: 'Ảnh chụp, phổ biến' },
  avif: { id: 'avif', label: 'AVIF', ext: 'avif', exts: ['avif'], mime: 'image/avif', lossy: true, opaque: false, note: 'Nén mạnh nhất' },
  gif: { id: 'gif', label: 'GIF', ext: 'gif', exts: ['gif'], mime: 'image/gif', lossy: false, opaque: false, note: 'Tối đa 256 màu' },
  bmp: { id: 'bmp', label: 'BMP', ext: 'bmp', exts: ['bmp', 'dib'], mime: 'image/bmp', lossy: false, opaque: true, note: 'Không nén' },
  ico: { id: 'ico', label: 'ICO', ext: 'ico', exts: ['ico', 'cur'], mime: 'image/x-icon', lossy: false, opaque: false, note: 'Favicon 16–256px' },
  tiff: { id: 'tiff', label: 'TIFF', ext: 'tiff', exts: ['tif', 'tiff'], mime: 'image/tiff', lossy: false, opaque: false, note: 'In ấn, lưu trữ' },
  heic: { id: 'heic', label: 'HEIC', ext: 'heic', exts: ['heic', 'heif'], mime: 'image/heic', lossy: true, opaque: false, note: 'Ảnh iPhone' },
  svg: { id: 'svg', label: 'SVG', ext: 'svg', exts: ['svg'], mime: 'image/svg+xml', lossy: false, opaque: false, note: 'Ảnh vector' },
};

export const OUTPUT_FORMATS: FormatId[] = ['webp', 'png', 'jpeg', 'avif', 'gif', 'bmp', 'ico', 'tiff'];
export const INPUT_FORMATS: FormatId[] = ['png', 'jpeg', 'webp', 'avif', 'gif', 'bmp', 'ico', 'tiff', 'heic', 'svg'];

export const ACCEPT = ['image/*', ...INPUT_FORMATS.flatMap((f) => FORMATS[f].exts.map((e) => `.${e}`))].join(',');

export type Detection =
  | { format: FormatId; animated: boolean }
  /** Recognised as an image we cannot read (label set), or not an image at all (label null). */
  | { format: null; label: string | null };

const ascii = (b: Uint8Array, start: number, end: number) => String.fromCharCode(...b.subarray(start, end));

const starts = (b: Uint8Array, sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);

const HEIF_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'];

/** ISO-BMFF `ftyp` box: major brand + compatible brands. */
function ftypBrands(b: Uint8Array): string[] {
  if (b.length < 16 || ascii(b, 4, 8) !== 'ftyp') return [];
  const size = Math.min(new DataView(b.buffer, b.byteOffset).getUint32(0), b.length);
  const brands = [ascii(b, 8, 12)];
  for (let i = 16; i + 4 <= size; i += 4) brands.push(ascii(b, i, i + 4));
  return brands;
}

/** Counts GIF image descriptors; more than one means the GIF is animated. */
function gifFrameCount(b: Uint8Array): number {
  let frames = 0;
  // Graphic Control Extension (21 F9 04) precedes every animation frame.
  for (let i = 13; i < b.length - 2 && frames < 2; i++) {
    if (b[i] === 0x21 && b[i + 1] === 0xf9 && b[i + 2] === 0x04) frames++;
  }
  return frames;
}

/** Identifies the real format from the file's bytes, ignoring its name and MIME type. */
export async function detectFormat(file: File): Promise<Detection> {
  const b = new Uint8Array(await file.slice(0, 4096).arrayBuffer());

  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { format: 'png', animated: false };
  if (starts(b, [0xff, 0xd8, 0xff])) return { format: 'jpeg', animated: false };
  if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') {
    const all = new Uint8Array(await file.arrayBuffer());
    return { format: 'gif', animated: gifFrameCount(all) > 1 };
  }
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') {
    // VP8X header: flag bit 1 marks an animation.
    const animated = ascii(b, 12, 16) === 'VP8X' && (b[20] & 0x02) !== 0;
    return { format: 'webp', animated };
  }
  if (ascii(b, 0, 2) === 'BM' && b.length > 26) return { format: 'bmp', animated: false };
  if (starts(b, [0, 0, 1, 0]) || starts(b, [0, 0, 2, 0])) return { format: 'ico', animated: false };
  if (starts(b, [0x49, 0x49, 0x2a, 0x00]) || starts(b, [0x4d, 0x4d, 0x00, 0x2a])) return { format: 'tiff', animated: false };

  const brands = ftypBrands(b);
  if (brands.includes('avif') || brands.includes('avis')) return { format: 'avif', animated: brands[0] === 'avis' };
  if (brands.some((x) => HEIF_BRANDS.includes(x))) return { format: 'heic', animated: false };

  if (ascii(b, 0, 4) === '8BPS') return { format: null, label: 'PSD' };
  if (starts(b, [0xff, 0x0a]) || ascii(b, 4, 8) === 'JXL ') return { format: null, label: 'JPEG XL' };
  if (ascii(b, 0, 4) === '%PDF') return { format: null, label: 'PDF' };

  const text = new TextDecoder().decode(b).replace(/^﻿/, '').trimStart();
  if (text.startsWith('<') && /<svg[\s>]/i.test(text)) return { format: 'svg', animated: false };

  return { format: null, label: null };
}

export function extensionOf(name: string): string {
  const m = /\.([^.]+)$/.exec(name);
  return m ? m[1].toLowerCase() : '';
}

/** True when the file's extension does not match the format found in its bytes. */
export function extensionMismatch(name: string, format: FormatId): boolean {
  const ext = extensionOf(name);
  return ext !== '' && !FORMATS[format].exts.includes(ext);
}
