export type PaperSize = 'A4' | 'A5' | 'Letter';

/** Sheet sizes in millimetres, portrait. */
export const PAPER_MM: Record<PaperSize, readonly [number, number]> = {
  A4: [210, 297],
  A5: [148, 210],
  Letter: [215.9, 279.4],
};

/** CR80 card (Aadhaar, PAN, driving licence, bank cards): 85.6 x 54 mm. */
export const CARD_MM = { width: 85.6, height: 54 } as const;

export const MM_PER_INCH = 25.4;

export function mmToPx(mm: number, dpi: number): number {
  return Math.round((mm / MM_PER_INCH) * dpi);
}

export function paperPx(
  paper: PaperSize,
  dpi: number,
  landscape: boolean,
): { width: number; height: number } {
  const [w, h] = PAPER_MM[paper];
  const a = mmToPx(w, dpi);
  const b = mmToPx(h, dpi);
  return landscape ? { width: b, height: a } : { width: a, height: b };
}
