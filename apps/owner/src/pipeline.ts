import type { Manifest } from '@despawn/bundle';
import {
  buildWatermarkText,
  composeSheet,
  encodeCanvas,
  type ColorMode,
  type LayoutKind,
  type PaperSize,
  type SourceImage,
  type StampStyle,
} from '@despawn/compose';
import type { Source } from '@despawn/render';

export interface PrepareOptions {
  paper: PaperSize;
  landscape: boolean;
  layout: LayoutKind;
  mode: ColorMode;
  purpose: string;
  style: StampStyle;
  density: number;
  opacity: number;
  autoCrop: boolean;
  include: boolean[];
}

export const MAX_SHEETS = 50;
export const MAX_CARD_SOURCES = 4;

export function defaultOptions(
  pageCount: number,
  firstIsLandscape: boolean,
  purpose: string,
): PrepareOptions {
  return {
    paper: 'A4',
    landscape: firstIsLandscape,
    layout: 'full',
    mode: 'color',
    purpose,
    style: 'selfattested',
    density: 0.5,
    opacity: 0.16,
    autoCrop: false,
    include: new Array<boolean>(pageCount).fill(true),
  };
}

/** Short reference printed on the copy and kept on the receipt. */
export function makeRef(): string {
  const b = crypto.getRandomValues(new Uint8Array(2));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Groups included page indexes into sheets: one sheet per page, or all cards on one sheet. */
export function groupSheets(o: PrepareOptions): number[][] {
  const idx = o.include.map((on, i) => (on ? i : -1)).filter((i) => i >= 0);
  return o.layout === 'idcard' ? (idx.length > 0 ? [idx] : []) : idx.map((i) => [i]);
}

export function validateSelection(
  o: PrepareOptions,
): 'OK' | 'EMPTY' | 'TOO_MANY_SHEETS' | 'TOO_MANY_CARDS' {
  const g = groupSheets(o);
  if (g.length === 0) return 'EMPTY';
  if (g.length > MAX_SHEETS) return 'TOO_MANY_SHEETS';
  if (o.layout === 'idcard' && (g[0]?.length ?? 0) > MAX_CARD_SOURCES) return 'TOO_MANY_CARDS';
  return 'OK';
}

function release(c: HTMLCanvasElement): void {
  c.width = 0;
  c.height = 0;
}

async function sheetFor(
  source: Source,
  group: number[],
  o: PrepareOptions,
  ref: string,
  renderDpi: number,
  sheetDpi: number,
): Promise<HTMLCanvasElement> {
  const rendered = [];
  const imgs: SourceImage[] = [];
  for (const i of group) {
    const r = await source.renderPage(i, renderDpi);
    rendered.push(r);
    imgs.push({ image: r.canvas, width: r.width, height: r.height });
  }
  const sheet = composeSheet(imgs, {
    paper: o.paper,
    landscape: o.landscape,
    dpi: sheetDpi,
    layout: o.layout,
    mode: o.mode,
    watermark: buildWatermarkText({ purpose: o.purpose, date: todayISO(), ref, style: o.style }),
    density: o.density,
    opacity: o.opacity,
    autoCrop: o.autoCrop,
  });
  rendered.forEach((r) => release(r.canvas));
  return sheet;
}

/** Low-resolution preview of the first sheet, drawn exactly like the final one. */
export async function renderPreview(
  source: Source,
  o: PrepareOptions,
  ref: string,
): Promise<HTMLCanvasElement | null> {
  const group = groupSheets(o)[0];
  if (group === undefined) return null;
  return sheetFor(source, group, o, ref, 100, 70);
}

export interface BuiltSheets {
  pages: Uint8Array[];
  manifest: Manifest;
}

/** Renders, composes and encodes every sheet one at a time so memory stays bounded. */
export async function buildSheets(
  source: Source,
  o: PrepareOptions,
  ref: string,
  onProgress: (done: number, total: number) => void,
): Promise<BuiltSheets> {
  const groups = groupSheets(o);
  const dpi = o.layout === 'idcard' ? 300 : 200;
  const mime = o.mode === 'bw' ? 'image/png' : 'image/jpeg';
  const pages: Uint8Array[] = [];
  const infos: Manifest['pages'][number][] = [];
  for (let n = 0; n < groups.length; n++) {
    onProgress(n, groups.length);
    const sheet = await sheetFor(source, groups[n] ?? [], o, ref, dpi, dpi);
    const bytes = await encodeCanvas(sheet, mime, 0.88);
    infos.push({ width: sheet.width, height: sheet.height, mime, byteLength: bytes.length });
    pages.push(bytes);
    release(sheet);
  }
  onProgress(groups.length, groups.length);
  const wm = buildWatermarkText({ purpose: o.purpose, date: todayISO(), ref, style: o.style });
  return {
    pages,
    manifest: {
      v: 1,
      paper: o.paper,
      orientation: o.landscape ? 'landscape' : 'portrait',
      dpi,
      purposeLabel: o.purpose.slice(0, 60),
      watermark: wm.tile.slice(0, 200),
      pages: infos,
    },
  };
}
