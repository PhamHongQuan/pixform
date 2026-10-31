import type { FormatId } from './formats';

export interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  release(): void;
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Trình duyệt không đọc được ảnh này'));
    };
    img.src = url;
  });
}

/** Decodes with the browser's built-in codecs (PNG, JPEG, WebP, GIF, BMP, ICO, AVIF). */
async function decodeNative(blob: Blob): Promise<Decoded> {
  try {
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() };
  } catch {
    const img = await loadImage(blob);
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => {} };
  }
}

async function decodeHeic(file: File): Promise<Decoded> {
  const { default: heic2any } = await import('heic2any');
  let out: Blob | Blob[];
  try {
    out = await heic2any({ blob: file, toType: 'image/png' });
  } catch {
    throw new Error('Không giải mã được ảnh HEIC (file hỏng hoặc dùng codec chưa hỗ trợ)');
  }
  return decodeNative(Array.isArray(out) ? out[0] : out);
}

async function decodeTiff(file: File): Promise<Decoded> {
  const { default: UTIF } = await import('utif');
  const buf = await file.arrayBuffer();
  const ifds = UTIF.decode(buf);
  if (!ifds.length) throw new Error('File TIFF không có ảnh');
  const ifd = ifds[0];
  UTIF.decodeImage(buf, ifd);
  const rgba = UTIF.toRGBA8(ifd);
  const { width, height } = ifd;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Ảnh quá lớn để xử lý trên trình duyệt này');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), width, height), 0, 0);
  return { source: canvas, width, height, release: () => (canvas.width = 0) };
}

/** SVG size from width/height attributes, falling back to the viewBox. */
function svgSize(text: string): { width: number; height: number } | null {
  const root = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
  if (root.nodeName.toLowerCase() !== 'svg') return null;
  const px = (v: string | null) => (v && /^\s*[\d.]+(px)?\s*$/.test(v) ? parseFloat(v) : NaN);
  let width = px(root.getAttribute('width'));
  let height = px(root.getAttribute('height'));
  const vb = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (vb?.length === 4 && vb[2] > 0 && vb[3] > 0) {
    if (!width && !height) [width, height] = [vb[2], vb[3]];
    else if (!width) width = (height * vb[2]) / vb[3];
    else if (!height) height = (width * vb[3]) / vb[2];
  }
  return width > 0 && height > 0 ? { width: Math.round(width), height: Math.round(height) } : null;
}

async function decodeSvg(file: File): Promise<Decoded> {
  const img = await loadImage(new Blob([await file.arrayBuffer()], { type: 'image/svg+xml' }));
  const size = svgSize(await file.text()) ?? { width: img.naturalWidth || 512, height: img.naturalHeight || 512 };
  return { source: img, ...size, release: () => {} };
}

export function decodeImage(file: File, format: FormatId): Promise<Decoded> {
  switch (format) {
    case 'heic':
      return decodeHeic(file);
    case 'tiff':
      return decodeTiff(file);
    case 'svg':
      return decodeSvg(file);
    default:
      return decodeNative(file);
  }
}
