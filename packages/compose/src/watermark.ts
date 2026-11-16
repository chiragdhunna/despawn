export const PURPOSES = [
  'KYC',
  'SIM verification',
  'Bank account',
  'Job application',
  'College admission',
  'Government form',
] as const;

export type StampStyle = 'watermark' | 'selfattested';

export interface WatermarkText {
  /** Repeated diagonally across the page. */
  readonly tile: string;
  /** Small box in the bottom-right corner. */
  readonly stamp: string;
}

function cleanPurpose(p: string): string {
  let out = '';
  for (const ch of p) {
    const c = ch.charCodeAt(0);
    if (c >= 0x20 && c !== 0x7f) {
      out += ch;
    }
  }
  return out.trim().slice(0, 60);
}

/** The text baked into every page before encryption. */
export function buildWatermarkText(o: {
  purpose: string;
  date: string;
  ref: string;
  style: StampStyle;
}): WatermarkText {
  const purpose = cleanPurpose(o.purpose) || 'the stated purpose';
  const tile =
    o.style === 'selfattested'
      ? `Self-attested copy for ${purpose} only`
      : `Copy for ${purpose} only`;
  return { tile: `${tile}  ${o.date}`, stamp: `${purpose} / ${o.date} / Ref ${o.ref}` };
}

/** Parameters for the diagonal tiling, derived from density 0..1 so they can be unit tested. */
export function tileGeometry(
  dpi: number,
  density: number,
): { fontPx: number; stepX: number; stepY: number; angle: number } {
  const d = Math.min(1, Math.max(0, density));
  const fontPx = Math.round((dpi / 25.4) * 4.2);
  const stepY = Math.round(fontPx * (6.5 - 4 * d));
  const stepX = Math.round(fontPx * (22 - 6 * d));
  return { fontPx, stepX, stepY, angle: (-30 * Math.PI) / 180 };
}
