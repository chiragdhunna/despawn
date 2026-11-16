import { describe, expect, it } from 'vitest';
import {
  CARD_MM,
  PAPER_MM,
  buildWatermarkText,
  computePlacements,
  findContentBox,
  mmToPx,
  paperPx,
  tileGeometry,
} from './index.js';

describe('paper', () => {
  it('converts millimetres to pixels', () => {
    expect(mmToPx(25.4, 200)).toBe(200);
    expect(paperPx('A4', 200, false)).toEqual({ width: 1654, height: 2339 });
    expect(paperPx('A4', 200, true)).toEqual({ width: 2339, height: 1654 });
    expect(PAPER_MM.Letter[0]).toBeCloseTo(215.9);
  });
});

describe('computePlacements', () => {
  const sheet = { ...paperPx('A4', 200, false), dpi: 200 };
  it('full keeps aspect ratio and touches the sheet on one axis', () => {
    const [p] = computePlacements('full', [{ width: 1000, height: 500 }], sheet);
    expect(p!.width).toBe(sheet.width);
    expect(p!.height).toBe(Math.round(sheet.width / 2));
    expect(p!.y).toBeGreaterThan(0);
  });
  it('fit leaves a 10 mm margin', () => {
    const [p] = computePlacements('fit', [{ width: 2000, height: 3000 }], sheet);
    expect(p!.x).toBeGreaterThanOrEqual(mmToPx(10, 200) - 1);
    expect(p!.x + p!.width).toBeLessThanOrEqual(sheet.width - mmToPx(10, 200) + 1);
  });
  it('idcard places each card at 85.6 mm wide, centred, stacked without overlap', () => {
    const ps = computePlacements(
      'idcard',
      [
        { width: 1011, height: 638 },
        { width: 1011, height: 638 },
      ],
      sheet,
    );
    expect(ps).toHaveLength(2);
    const cardPx = mmToPx(CARD_MM.width, 200);
    for (const p of ps) {
      expect(p.width).toBe(cardPx);
      expect(Math.abs(p.x - (sheet.width - p.width) / 2)).toBeLessThanOrEqual(1);
      expect(p.x + p.width).toBeLessThanOrEqual(sheet.width);
    }
    expect(ps[1]!.y).toBeGreaterThanOrEqual(ps[0]!.y + ps[0]!.height);
    expect(ps[0]!.height / ps[0]!.width).toBeCloseTo(638 / 1011, 2);
  });
  it('idcard shrinks uniformly when sources would not fit on the sheet', () => {
    const tall = [1, 2, 3, 4, 5].map(() => ({ width: 100, height: 400 }));
    const ps = computePlacements('idcard', tall, sheet);
    const last = ps[ps.length - 1]!;
    expect(last.y + last.height).toBeLessThanOrEqual(sheet.height);
    expect(new Set(ps.map((p) => p.width)).size).toBe(1);
  });
  it('never places anything outside the sheet for random inputs', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 300; i++) {
      const kinds = ['full', 'fit', 'idcard'] as const;
      const n = 1 + Math.floor(rnd() * 4);
      const srcs = Array.from({ length: n }, () => ({
        width: 50 + Math.floor(rnd() * 5000),
        height: 50 + Math.floor(rnd() * 5000),
      }));
      const sh = {
        ...paperPx(rnd() < 0.5 ? 'A4' : 'A5', 150 + Math.floor(rnd() * 150), rnd() < 0.3),
        dpi: 200,
      };
      for (const p of computePlacements(kinds[Math.floor(rnd() * 3)]!, srcs, sh)) {
        expect(p.x).toBeGreaterThanOrEqual(-1);
        expect(p.y).toBeGreaterThanOrEqual(-1);
        expect(p.x + p.width).toBeLessThanOrEqual(sh.width + 1);
        expect(p.y + p.height).toBeLessThanOrEqual(sh.height + 1);
      }
    }
  });
  it('returns nothing for no sources', () => {
    expect(computePlacements('full', [], sheet)).toEqual([]);
  });
});

describe('findContentBox', () => {
  function image(
    w: number,
    h: number,
    paint: (x: number, y: number) => boolean,
  ): Uint8ClampedArray {
    const d = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (paint(x, y)) {
          const i = (y * w + x) * 4;
          d[i] = 10;
          d[i + 1] = 10;
          d[i + 2] = 10;
        }
    return d;
  }
  it('finds the box around dark pixels', () => {
    expect(
      findContentBox(
        image(100, 80, (x, y) => x >= 20 && x < 60 && y >= 10 && y < 30),
        100,
        80,
      ),
    ).toEqual({ x: 20, y: 10, width: 40, height: 20 });
  });
  it('returns null for a blank page', () => {
    expect(
      findContentBox(
        image(10, 10, () => false),
        10,
        10,
      ),
    ).toBeNull();
  });
});

describe('watermark text', () => {
  it('names the purpose, date and reference', () => {
    const w = buildWatermarkText({
      purpose: 'SIM verification',
      date: '2026-11-15',
      ref: '7F3A',
      style: 'selfattested',
    });
    expect(w.tile).toBe('Self-attested copy for SIM verification only  2026-11-15');
    expect(w.stamp).toBe('SIM verification / 2026-11-15 / Ref 7F3A');
  });
  it('strips control characters and caps length, and has a fallback for empty purposes', () => {
    const w = buildWatermarkText({
      purpose: '\u0000\u0007Bank\n' + 'x'.repeat(200),
      date: 'd',
      ref: 'r',
      style: 'watermark',
    });
    expect(w.tile.includes('\u0000')).toBe(false);
    expect(w.tile.length).toBeLessThan(120);
    expect(
      buildWatermarkText({ purpose: '  ', date: 'd', ref: 'r', style: 'watermark' }).tile,
    ).toContain('the stated purpose');
  });
  it('density makes the tiling tighter', () => {
    const lo = tileGeometry(200, 0);
    const hi = tileGeometry(200, 1);
    expect(hi.stepY).toBeLessThan(lo.stepY);
    expect(hi.stepX).toBeLessThan(lo.stepX);
    expect(tileGeometry(200, 5)).toEqual(hi);
  });
});
