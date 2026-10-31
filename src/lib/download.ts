import { zipSync } from 'fflate';

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Gives each name a " (2)", " (3)"… suffix when it was already used. */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const key = name.toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n === 1) return name;
    const dot = name.lastIndexOf('.');
    return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
  });
}

/** Images are already compressed, so files are stored without deflate (fast, same size). */
export async function zipFiles(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const names = uniqueNames(files.map((f) => f.name));
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (let i = 0; i < files.length; i++) {
    entries[names[i]] = [new Uint8Array(await files[i].blob.arrayBuffer()), { level: 0 }];
  }
  return new Blob([zipSync(entries)], { type: 'application/zip' });
}

export function baseName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/\.[^.]+$/, '')
    .replace(/[\/\:*?"<>|\u0000-\u001f]+/g, '_')
    .slice(0, 150);
  return cleaned || 'anh';
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
