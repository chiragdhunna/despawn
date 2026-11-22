import { computePlacements, findContentBox, type LayoutKind } from './layout.js';
import { mmToPx, paperPx, type PaperSize } from './paper.js';
import { tileGeometry, type WatermarkText } from './watermark.js';

export type ColorMode = 'color' | 'gray' | 'bw';

export interface SourceImage {
  readonly image: CanvasImageSource;
  readonly width: number;
  readonly height: number;
}

export interface ComposeOptions {
  readonly paper: PaperSize;
  readonly landscape: boolean;
  readonly dpi: number;
  readonly layout: LayoutKind;
  readonly mode: ColorMode;
  readonly watermark: WatermarkText;
  readonly density: number;
  readonly opacity: number;
  /** Trim white margins from each source first (useful for ID cards on a full page PDF). */
  readonly autoCrop: boolean;
}

function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (ctx === null) {
    throw new Error('canvas unavailable');
  }
  return ctx;
}

/** Copies the part of the source that has content. Falls back to the whole source. */
export function trimSource(src: SourceImage): SourceImage {
  const probe = newCanvas(src.width, src.height);
  const pctx = ctx2d(probe);
  pctx.fillStyle = '#fff';
  pctx.fillRect(0, 0, probe.width, probe.height);
  pctx.drawImage(src.image, 0, 0, src.width, src.height);
  const data = pctx.getImageData(0, 0, probe.width, probe.height);
  const box = findContentBox(data.data, probe.width, probe.height);
  if (box === null) {
    return src;
  }
  const pad = Math.round(Math.min(src.width, src.height) * 0.004);
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  const w = Math.min(src.width - x, box.width + 2 * pad);
  const h = Math.min(src.height - y, box.height + 2 * pad);
  const out = newCanvas(w, h);
  ctx2d(out).drawImage(probe, x, y, w, h, 0, 0, w, h);
  return { image: out, width: w, height: h };
}

export function applyMode(c: HTMLCanvasElement, mode: ColorMode): void {
  if (mode === 'color') {
    return;
  }
  const ctx = ctx2d(c);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = Math.round(0.299 * (d[i] ?? 0) + 0.587 * (d[i + 1] ?? 0) + 0.114 * (d[i + 2] ?? 0));
    const v = mode === 'bw' ? (g > 150 ? 255 : 0) : g;
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
}

export function drawWatermark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpi: number,
  text: WatermarkText,
  density: number,
  opacity: number,
): void {
  const g = tileGeometry(dpi, density);
  ctx.save();
  ctx.globalAlpha = Math.min(1, Math.max(0, opacity));
  ctx.fillStyle = '#444';
  ctx.font = `${g.fontPx}px sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.translate(width / 2, height / 2);
  ctx.rotate(g.angle);
  const reach = Math.hypot(width, height);
  // space tiles by the real text width so neighbours never overlap
  const stepX = Math.max(g.stepX, Math.ceil(ctx.measureText(text.tile).width + g.fontPx * 3));
  let row = 0;
  for (let y = -reach; y < reach; y += g.stepY, row++) {
    const offset = row % 2 === 0 ? 0 : stepX / 2;
    for (let x = -reach + offset; x < reach; x += stepX) {
      ctx.fillText(text.tile, x, y);
    }
  }
  ctx.restore();

  // corner stamp: opaque box so it stays readable on any content
  ctx.save();
  const small = Math.round((dpi / 25.4) * 3);
  ctx.font = `${small}px sans-serif`;
  const w = ctx.measureText(text.stamp).width;
  const padX = Math.round(small * 0.8);
  const boxH = Math.round(small * 2);
  // 6 mm in from the edge: most printers cannot print the outer 3 to 5 mm
  const x = width - w - 2 * padX - mmToPx(6, dpi);
  const y = height - boxH - mmToPx(6, dpi);
  ctx.fillStyle = '#fff';
  ctx.fillRect(x, y, w + 2 * padX, boxH);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = Math.max(1, Math.round(dpi / 150));
  ctx.strokeRect(x, y, w + 2 * padX, boxH);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'middle';
  ctx.fillText(text.stamp, x + padX, y + boxH / 2);
  ctx.restore();
}

function drawCropMarks(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  dpi: number,
): void {
  const len = mmToPx(3, dpi);
  const off = mmToPx(1.5, dpi);
  ctx.save();
  ctx.strokeStyle = '#888';
  ctx.lineWidth = Math.max(1, Math.round(dpi / 200));
  ctx.beginPath();
  for (const [cx, cy, dx, dy] of [
    [x, y, -1, -1],
    [x + w, y, 1, -1],
    [x, y + h, -1, 1],
    [x + w, y + h, 1, 1],
  ] as const) {
    ctx.moveTo(cx + dx * off, cy);
    ctx.lineTo(cx + dx * (off + len), cy);
    ctx.moveTo(cx, cy + dy * off);
    ctx.lineTo(cx, cy + dy * (off + len));
  }
  ctx.stroke();
  ctx.restore();
}

/** Builds one printable sheet. Returns a canvas at the paper size for the given dpi. */
export function composeSheet(
  sources: readonly SourceImage[],
  o: ComposeOptions,
): HTMLCanvasElement {
  const size = paperPx(o.paper, o.dpi, o.landscape);
  const sheet = newCanvas(size.width, size.height);
  const ctx = ctx2d(sheet);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  const prepared = o.autoCrop || o.layout === 'idcard' ? sources.map(trimSource) : [...sources];
  const placements = computePlacements(o.layout, prepared, { ...size, dpi: o.dpi });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  for (const p of placements) {
    const src = prepared[p.source];
    if (src === undefined) {
      continue;
    }
    ctx.drawImage(src.image, p.x, p.y, p.width, p.height);
    if (o.layout === 'idcard') {
      drawCropMarks(ctx, p.x, p.y, p.width, p.height, o.dpi);
    }
  }
  applyMode(sheet, o.mode);
  drawWatermark(ctx, sheet.width, sheet.height, o.dpi, o.watermark, o.density, o.opacity);
  return sheet;
}

export async function encodeCanvas(
  c: HTMLCanvasElement,
  mime: 'image/jpeg' | 'image/png',
  quality = 0.88,
): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, mime, quality));
  if (blob === null) {
    throw new Error('encode failed');
  }
  return new Uint8Array(await blob.arrayBuffer());
}
