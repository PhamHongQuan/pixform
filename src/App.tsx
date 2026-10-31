import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './components/Icon';
import { decodeImage } from './lib/decode';
import { baseName, downloadBlob, formatBytes, uniqueNames, zipFiles } from './lib/download';
import { encodeImage } from './lib/encode';
import {
  ACCEPT,
  FORMATS,
  INPUT_FORMATS,
  OUTPUT_FORMATS,
  detectFormat,
  extensionMismatch,
  extensionOf,
  type FormatId,
} from './lib/formats';
import { useTheme } from './lib/theme';

interface Outcome {
  /** Settings the result was made with; it is only shown while they still apply. */
  sig: string;
  blob?: Blob;
  url?: string;
  name?: string;
  error?: string;
}

interface Item {
  id: string;
  file: File;
  format: FormatId;
  animated: boolean;
  mismatch: boolean;
  /** Preview of the original, for formats the browser can show. */
  thumb: string | null;
  width?: number;
  height?: number;
  /** Per-file target; null follows the global choice. */
  target: FormatId | null;
  working: boolean;
  outcome?: Outcome;
}

interface Settings {
  target: FormatId;
  quality: number;
  background: string;
}

interface Toast {
  id: number;
  kind: 'info' | 'error';
  text: string;
}

const CONCURRENCY = 2;
const BROWSER_PREVIEW: FormatId[] = ['png', 'jpeg', 'webp', 'avif', 'gif', 'bmp', 'ico', 'svg'];

let nextId = 0;

function signature(target: FormatId, s: Settings): string {
  const info = FORMATS[target];
  return [target, info.lossy ? s.quality : '', info.opaque ? s.background : ''].join('|');
}

function Logo() {
  return (
    <div className="logo">
      <span className="logo-mark">
        <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="8" fill="currentColor" />
          <rect x="7" y="8" width="18" height="16" rx="2.5" fill="#fff" />
          <path d="M7 21l5.5-5.5 4 4 3-3L25 22" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none" />
          <circle cx="20" cy="12.5" r="1.8" fill="currentColor" />
        </svg>
      </span>
      <span className="logo-text">Pixform</span>
    </div>
  );
}

function ThemeToggle() {
  const [theme, toggle] = useTheme();
  const label = theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối';
  return (
    <button className="icon-btn theme-toggle" onClick={toggle} title={label} aria-label={label}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  );
}

function Delta({ before, after }: { before: number; after: number }) {
  // A non-empty file never shrinks by a full 100%, even when rounding says so.
  const pct = Math.max(-99, Math.round(((after - before) / before) * 100));
  if (pct === 0) return <span className="delta">±0%</span>;
  return <span className={`delta ${pct < 0 ? 'down' : 'up'}`}>{pct > 0 ? `+${pct}` : pct}%</span>;
}

export default function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [settings, setSettings] = useState<Settings>({ target: 'webp', quality: 85, background: '#ffffff' });
  const [busy, setBusy] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const dragDepth = useRef(0);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = ++nextId;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  const patch = useCallback((id: string, change: Partial<Item>) => {
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...change } : it)));
  }, []);

  const addFiles = useCallback(
    async (files: Iterable<File>) => {
      // Copy first: an input's FileList empties when its value is reset, a drop's when the event ends.
      const list = Array.from(files);
      const added: Item[] = [];
      const skipped: string[] = [];
      for (const file of list) {
        const d = await detectFormat(file);
        if (d.format === null) {
          skipped.push(`${file.name} (${d.label ? `${d.label} chưa hỗ trợ` : 'không phải ảnh'})`);
          continue;
        }
        added.push({
          id: crypto.randomUUID(),
          file,
          format: d.format,
          animated: d.animated,
          mismatch: extensionMismatch(file.name, d.format),
          thumb: BROWSER_PREVIEW.includes(d.format) ? URL.createObjectURL(file) : null,
          target: null,
          working: false,
        });
      }
      if (added.length) setItems((list) => [...list, ...added]);
      if (skipped.length) toast(`Đã bỏ qua ${skipped.length} file: ${skipped.join(', ')}`, 'error');
    },
    [toast],
  );

  const removeItem = (id: string) => {
    const it = itemsRef.current.find((x) => x.id === id);
    if (it?.thumb) URL.revokeObjectURL(it.thumb);
    if (it?.outcome?.url) URL.revokeObjectURL(it.outcome.url);
    setItems((list) => list.filter((x) => x.id !== id));
  };

  const clearAll = () => {
    for (const it of itemsRef.current) {
      if (it.thumb) URL.revokeObjectURL(it.thumb);
      if (it.outcome?.url) URL.revokeObjectURL(it.outcome.url);
    }
    setItems([]);
  };

  const targetOf = (it: Item) => it.target ?? settings.target;
  const validOutcome = (it: Item) => (it.outcome?.sig === signature(targetOf(it), settings) ? it.outcome : undefined);

  const pending = items.filter((it) => !it.working && !validOutcome(it));
  const ready = items.flatMap((it) => {
    const o = validOutcome(it);
    return o?.blob ? [{ name: o.name!, blob: o.blob }] : [];
  });
  const totalIn = items.reduce((n, it) => n + it.file.size, 0);
  const totalOut = ready.reduce((n, r) => n + r.blob.size, 0);

  const effectiveTargets = useMemo(
    () => new Set(items.length ? items.map((it) => it.target ?? settings.target) : [settings.target]),
    [items, settings.target],
  );
  const showQuality = [...effectiveTargets].some((f) => FORMATS[f].lossy);
  const showBackground = [...effectiveTargets].some((f) => FORMATS[f].opaque);

  const convert = async () => {
    const queue = pending.map((it) => it.id);
    const snapshot = settings;
    if (!queue.length) return;
    setBusy(true);

    const run = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        const item = itemsRef.current.find((x) => x.id === id);
        if (!item) continue;
        const target = item.target ?? snapshot.target;
        const sig = signature(target, snapshot);
        patch(id, { working: true });

        let outcome: Outcome;
        let size: Pick<Item, 'width' | 'height'> = {};
        try {
          const img = await decodeImage(item.file, item.format);
          try {
            size = { width: img.width, height: img.height };
            const blob = await encodeImage(img, { format: target, quality: snapshot.quality, background: snapshot.background });
            outcome = { sig, blob, url: URL.createObjectURL(blob), name: `${baseName(item.file.name)}.${FORMATS[target].ext}` };
          } finally {
            img.release();
          }
        } catch (e) {
          outcome = { sig, error: e instanceof Error ? e.message : String(e) };
        }

        const current = itemsRef.current.find((x) => x.id === id);
        if (current?.outcome?.url) URL.revokeObjectURL(current.outcome.url);
        if (!current) {
          if (outcome.url) URL.revokeObjectURL(outcome.url);
          continue;
        }
        patch(id, { working: false, outcome, ...size });
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, run));
    setBusy(false);
  };

  const downloadZip = async () => {
    if (ready.length === 1) return downloadBlob(ready[0].blob, ready[0].name);
    setZipping(true);
    try {
      downloadBlob(await zipFiles(ready), `pixform-${ready.length}-anh.zip`);
    } catch (e) {
      toast(`Không tạo được file ZIP: ${e instanceof Error ? e.message : e}`, 'error');
    } finally {
      setZipping(false);
    }
  };

  const downloadEach = async () => {
    const names = uniqueNames(ready.map((r) => r.name));
    for (let i = 0; i < ready.length; i++) {
      downloadBlob(ready[i].blob, names[i]);
      // Browsers drop rapid back-to-back downloads; space them out.
      if (i < ready.length - 1) await new Promise((r) => setTimeout(r, 350));
    }
    if (ready.length > 1) toast('Nếu trình duyệt hỏi, hãy cho phép tải nhiều file cùng lúc.');
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) {
        e.preventDefault();
        void addFiles(files);
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [addFiles]);

  const hasItems = items.length > 0;

  return (
    <div
      className="app"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        dragDepth.current++;
        setDragOver(true);
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragOver(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragOver(false);
        if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void addFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <header className="header">
        <Logo />
        <ThemeToggle />
      </header>

      {!hasItems ? (
        <main className="landing">
          <h1>Chuyển định dạng ảnh trong vài giây</h1>
          <p className="lead">Tải nhiều ảnh lên, app tự nhận định dạng thật của từng file. Chọn định dạng mới rồi tải về.</p>

          <button className={`dropzone${dragOver ? ' active' : ''}`} onClick={() => fileInput.current?.click()}>
            <span className="dropzone-icon">
              <Icon name="upload" size={28} />
            </span>
            <span className="dropzone-title">Chọn ảnh</span>
            <span className="muted">hoặc kéo thả, dán (Ctrl+V) vào đây · có thể chọn nhiều file</span>
          </button>

          <div className="format-list">
            <span className="muted">Đọc được:</span>
            {INPUT_FORMATS.map((f) => (
              <span key={f} className="badge">
                {FORMATS[f].label}
              </span>
            ))}
          </div>

          <ol className="steps">
            <li>
              <span className="step-no">1</span>
              <div>
                <strong>Tải ảnh lên</strong>
                <span>Tự nhận định dạng từ nội dung file</span>
              </div>
            </li>
            <li>
              <span className="step-no">2</span>
              <div>
                <strong>Chọn định dạng</strong>
                <span>WebP, PNG, JPG, AVIF, GIF, BMP, ICO, TIFF</span>
              </div>
            </li>
            <li>
              <span className="step-no">3</span>
              <div>
                <strong>Tải về</strong>
                <span>Từng file hoặc gộp thành ZIP</span>
              </div>
            </li>
          </ol>
        </main>
      ) : (
        <main className="workspace">
          <aside className="panel">
            <section>
              <h2>Chuyển sang</h2>
              <div className="format-grid" role="radiogroup" aria-label="Định dạng đích">
                {OUTPUT_FORMATS.map((f) => (
                  <button
                    key={f}
                    role="radio"
                    aria-checked={settings.target === f}
                    className={`format-option${settings.target === f ? ' selected' : ''}`}
                    onClick={() => setSettings((s) => ({ ...s, target: f }))}
                  >
                    <strong>{FORMATS[f].label}</strong>
                    <span>{FORMATS[f].note}</span>
                  </button>
                ))}
              </div>
              {settings.target === 'ico' && <p className="panel-hint">Tạo icon vuông nhiều cỡ: 16, 32, 48 và 256px.</p>}
              {settings.target === 'gif' && <p className="panel-hint">GIF chỉ lưu tối đa 256 màu, ảnh chụp có thể bị nhiễu màu.</p>}
              {settings.target === 'avif' && <p className="panel-hint">AVIF nén lâu hơn các định dạng khác với ảnh lớn.</p>}
            </section>

            {showQuality && (
              <section>
                <label className="field-label" htmlFor="quality">
                  Chất lượng <span className="value">{settings.quality}</span>
                </label>
                <input
                  id="quality"
                  type="range"
                  min={1}
                  max={100}
                  value={settings.quality}
                  onChange={(e) => setSettings((s) => ({ ...s, quality: Number(e.target.value) }))}
                />
                <div className="range-scale muted">
                  <span>File nhỏ</span>
                  <span>Đẹp nhất</span>
                </div>
              </section>
            )}

            {showBackground && (
              <section>
                <label className="field-label" htmlFor="bg">
                  Màu nền thay cho vùng trong suốt
                </label>
                <div className="color-field">
                  <input
                    id="bg"
                    type="color"
                    value={settings.background}
                    onChange={(e) => setSettings((s) => ({ ...s, background: e.target.value }))}
                  />
                  <code>{settings.background.toUpperCase()}</code>
                  <span className="muted">JPG, BMP không có độ trong suốt</span>
                </div>
              </section>
            )}

            <div className="panel-actions">
              <button className="btn primary block" onClick={convert} disabled={busy || !pending.length}>
                {busy ? <span className="spinner" /> : <Icon name="convert" size={16} />}
                {busy
                  ? 'Đang chuyển…'
                  : pending.length
                    ? `Chuyển đổi ${pending.length} ảnh`
                    : 'Đã chuyển xong'}
              </button>
              <div className="download-row">
                <button className="btn block" onClick={downloadZip} disabled={!ready.length || zipping || busy}>
                  {zipping ? <span className="spinner" /> : <Icon name={ready.length > 1 ? 'zip' : 'download'} size={16} />}
                  {ready.length > 1 ? `Tải ZIP (${ready.length})` : 'Tải về'}
                </button>
                {ready.length > 1 && (
                  <button className="btn block" onClick={downloadEach} disabled={busy}>
                    <Icon name="files" size={16} /> Tải từng file
                  </button>
                )}
              </div>
              {ready.length > 0 && (
                <p className="summary muted">
                  {formatBytes(items.filter(validOutcome).reduce((n, it) => n + it.file.size, 0))} → {formatBytes(totalOut)}
                </p>
              )}
            </div>
          </aside>

          <section className="files">
            <div className="files-head">
              <span>
                <strong>{items.length} ảnh</strong> <span className="muted">· {formatBytes(totalIn)}</span>
              </span>
              <div className="files-actions">
                <button className="btn ghost" onClick={() => fileInput.current?.click()}>
                  <Icon name="plus" size={16} /> Thêm ảnh
                </button>
                <button className="btn ghost" onClick={clearAll} disabled={busy} aria-label="Xóa tất cả" title="Xóa tất cả">
                  <Icon name="trash" size={16} /> <span className="label-optional">Xóa tất cả</span>
                </button>
              </div>
            </div>

            <ul className="file-list">
              {items.map((it) => {
                const target = targetOf(it);
                const outcome = validOutcome(it);
                const preview = it.thumb ?? (outcome?.url && BROWSER_PREVIEW.includes(target) ? outcome.url : null);
                return (
                  <li key={it.id} className="file-row">
                    <div className="thumb">
                      {preview ? (
                        <img
                          src={preview}
                          alt=""
                          onLoad={(e) => {
                            if (it.thumb && !it.width) {
                              const img = e.currentTarget;
                              if (img.naturalWidth) patch(it.id, { width: img.naturalWidth, height: img.naturalHeight });
                            }
                          }}
                        />
                      ) : (
                        <Icon name="image" size={22} />
                      )}
                    </div>

                    <div className="file-info">
                      <span className="file-name" title={it.file.name}>
                        {it.file.name}
                      </span>
                      <span className="file-meta">
                        <span className="badge detected" title="Định dạng nhận diện từ nội dung file">
                          {FORMATS[it.format].label}
                        </span>
                        {it.width && it.height && (
                          <span>
                            {it.width}×{it.height}
                          </span>
                        )}
                        <span>{formatBytes(it.file.size)}</span>
                      </span>
                      {(it.mismatch || it.animated) && (
                        <span className="file-notes">
                          {it.mismatch && (
                            <span className="note warn">
                              Đuôi .{extensionOf(it.file.name)} nhưng thực chất là {FORMATS[it.format].label}
                            </span>
                          )}
                          {it.animated && <span className="note">Ảnh động · chỉ giữ khung đầu</span>}
                        </span>
                      )}
                    </div>

                    <div className="file-target">
                      <Icon name="arrowRight" size={16} />
                      <select
                        value={it.target ?? ''}
                        onChange={(e) => patch(it.id, { target: (e.target.value || null) as FormatId | null })}
                        aria-label={`Định dạng đích cho ${it.file.name}`}
                        disabled={it.working}
                      >
                        <option value="">{FORMATS[settings.target].label} (chung)</option>
                        {OUTPUT_FORMATS.map((f) => (
                          <option key={f} value={f}>
                            {FORMATS[f].label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="file-status">
                      {it.working ? (
                        <span className="status muted">
                          <span className="spinner" /> Đang chuyển
                        </span>
                      ) : outcome?.blob ? (
                        <>
                          <span className="status ok">
                            <span>{formatBytes(outcome.blob.size)}</span>
                            <Delta before={it.file.size} after={outcome.blob.size} />
                          </span>
                          <button
                            className="btn small"
                            onClick={() => downloadBlob(outcome.blob!, outcome.name!)}
                            title={`Tải ${outcome.name}`}
                          >
                            <Icon name="download" size={15} /> {FORMATS[target].label}
                          </button>
                        </>
                      ) : outcome?.error ? (
                        <span className="status error" title={outcome.error}>
                          <Icon name="alert" size={15} /> {outcome.error}
                        </span>
                      ) : (
                        <span className="status muted">Chờ chuyển</span>
                      )}
                    </div>

                    <button
                      className="icon-btn remove"
                      onClick={() => removeItem(it.id)}
                      disabled={it.working}
                      aria-label={`Bỏ ${it.file.name}`}
                      title="Bỏ ảnh này"
                    >
                      <Icon name="close" size={16} />
                    </button>
                  </li>
                );
              })}
              <li className="add-row">
                <button onClick={() => fileInput.current?.click()}>
                  <Icon name="plus" size={18} /> Thêm ảnh · kéo thả hoặc Ctrl+V
                </button>
              </li>
            </ul>
          </section>
        </main>
      )}

      {dragOver && hasItems && (
        <div className="drop-overlay">
          <Icon name="upload" size={36} />
          Thả để thêm ảnh
        </div>
      )}

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span>{t.text}</span>
            <button onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))} aria-label="Đóng">
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>

      <footer className="footer muted">
        Ảnh không rời khỏi máy bạn — mọi xử lý chạy ngay trên trình duyệt, không có máy chủ lưu file.
      </footer>
    </div>
  );
}
