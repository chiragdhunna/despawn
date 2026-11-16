import { CARD_MM, mmToPx } from './paper.js';

export type LayoutKind = 'full' | 'fit' | 'idcard';

export interface SourceSize {
  readonly width: number;
  readonly height: number;
}

export interface Placement {
  readonly source: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SheetSize {
  readonly width: number;
  readonly height: number;
  readonly dpi: number;
}

function contain(src: SourceSize, boxW: number, boxH: number): { w: number; h: number } {
  const s = Math.min(boxW / src.width, boxH / src.height);
  return { w: Math.round(src.width * s), h: Math.round(src.height * s) };
}

/**
 * Where each source goes on one sheet.
 * - full: the single source fills the sheet (aspect ratio kept, no margin)
 * - fit: the single source fits inside a 10 mm margin
 * - idcard: every source is scaled to card width (85.6 mm), stacked and centred, at actual size
 */
export function computePlacements(
  kind: LayoutKind,
  sources: readonly SourceSize[],
  sheet: SheetSize,
): Placement[] {
  if (sources.length === 0) {
    return [];
  }
  if (kind === 'full' || kind === 'fit') {
    const src = sources[0];
    if (src === undefined) {
      return [];
    }
    const margin = kind === 'fit' ? mmToPx(10, sheet.dpi) : 0;
    const box = contain(src, sheet.width - 2 * margin, sheet.height - 2 * margin);
    return [
      {
        source: 0,
        x: Math.round((sheet.width - box.w) / 2),
        y: Math.round((sheet.height - box.h) / 2),
        width: box.w,
        height: box.h,
      },
    ];
  }
  // idcard
  const gap = mmToPx(10, sheet.dpi);
  const top = mmToPx(25, sheet.dpi);
  const cardW = mmToPx(CARD_MM.width, sheet.dpi);
  const maxTotal = sheet.height - top - mmToPx(15, sheet.dpi);
  let sizes = sources.map((s) => ({ w: cardW, h: Math.round((cardW * s.height) / s.width) }));
  const cardsTotal = sizes.reduce((a, s) => a + s.h, 0);
  const gaps = gap * (sizes.length - 1);
  const available = Math.max(1, maxTotal - gaps);
  const scale = cardsTotal > available ? available / cardsTotal : 1;
  if (scale < 1) {
    sizes = sizes.map((s) => ({
      w: Math.max(1, Math.floor(s.w * scale)),
      h: Math.max(1, Math.floor(s.h * scale)),
    }));
  }
  const out: Placement[] = [];
  let y = top;
  sizes.forEach((s, i) => {
    out.push({
      source: i,
      x: Math.round((sheet.width - s.w) / 2),
      y,
      width: s.w,
      height: s.h,
    });
    y += s.h + gap;
  });
  return out;
}

/** Bounding box of non-background pixels, or null for a blank image. Pure so it can be tested. */
export function findContentBox(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  threshold = 245,
): { x: number; y: number; width: number; height: number } | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = rgba[i + 3] ?? 0;
      const darkest = Math.min(rgba[i] ?? 255, rgba[i + 1] ?? 255, rgba[i + 2] ?? 255);
      if (a > 16 && darkest < threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) {
    return null;
  }
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
