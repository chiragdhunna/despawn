import { describe, expect, it } from 'vitest';
import { VERSION, sniff, sniffLoose } from './index.js';

const b = (...n: number[]) => Uint8Array.from(n);
const text = (s: string) => new TextEncoder().encode(s);

describe('sniff', () => {
  it('detects formats from content', () => {
    expect(sniff(text('%PDF-1.7\n'))).toBe('pdf');
    expect(sniff(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe('png');
    expect(sniff(b(0xff, 0xd8, 0xff, 0xe0))).toBe('jpeg');
    expect(sniff(text('GIF89a'))).toBe('gif');
    expect(sniff(b(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50))).toBe('webp');
    expect(sniff(text('BM\u0000'))).toBe('bmp');
    expect(sniff(text('  <svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('svg');
    expect(sniff(text('<?xml version="1.0"?><svg/>'))).toBe('svg');
  });
  it('does not trust file names or look-alikes', () => {
    expect(sniff(text('MZ\u0090\u0000'))).toBe('unknown');
    expect(sniff(text('<html><svg></svg></html>'))).toBe('unknown');
    expect(sniff(text('RIFF....WAVE'))).toBe('unknown');
    expect(sniff(new Uint8Array(0))).toBe('unknown');
  });
  it('accepts a PDF with leading junk like most readers do', () => {
    expect(sniffLoose(text('\n\n  junk %PDF-1.4'))).toBe('pdf');
    expect(sniffLoose(text('hello'))).toBe('unknown');
  });
  it('exports a version', () => expect(VERSION).toBeTypeOf('string'));
});
