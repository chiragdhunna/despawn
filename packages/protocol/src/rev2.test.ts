import { describe, expect, it } from 'vitest';
import examples from '../../../docs/protocol-examples.json';
import {
  parseRelayToOwner,
  parseRelayToShop,
  parseShopToRelay,
  serializeRelayToOwner,
} from './index.js';

const hello = examples.shopToRelay.hello;
function helloWithBrowser(browser: string): string {
  return JSON.stringify({ ...hello, ua: { browser, os: 'Windows 7' } });
}
/** JSON text with a lone-surrogate escape, which JSON.stringify would not emit. */
function helloWithRawEscape(escape: string): string {
  return JSON.stringify({ ...hello, ua: { browser: 'XX', os: 'Windows 7' } }).replace('XX', escape);
}

describe('text field safety (PROTOCOL_SPEC section 1, revision 2)', () => {
  const rejected: Array<[string, string]> = [
    ['NUL', '\u0000'],
    ['US', '\u001f'],
    ['DEL', '\u007f'],
    ['LRM', '\u200e'],
    ['RLM', '\u200f'],
    ['LRE', '\u202a'],
    ['RLO', '\u202e'],
    ['LRI', '\u2066'],
    ['PDI', '\u2069'],
    ['line separator', '\u2028'],
    ['paragraph separator', '\u2029'],
    ['BOM', '\ufeff'],
  ];
  for (const [name, ch] of rejected) {
    it(`rejects ${name}`, () => {
      expect(parseShopToRelay(helloWithBrowser(`Chrome${ch}`)).ok).toBe(false);
    });
  }
  it('rejects lone and reversed surrogates', () => {
    expect(parseShopToRelay(helloWithRawEscape('\\ud800')).ok).toBe(false);
    expect(parseShopToRelay(helloWithRawEscape('\\udc00')).ok).toBe(false);
    expect(parseShopToRelay(helloWithRawEscape('\\udc00\\ud800')).ok).toBe(false);
    expect(parseShopToRelay(helloWithRawEscape('a\\ud800')).ok).toBe(false);
  });
  it('accepts valid pairs and non-Latin letters', () => {
    expect(parseShopToRelay(helloWithBrowser('Chrome \u{1F600}')).ok).toBe(true);
    expect(parseShopToRelay(helloWithBrowser('\u0915\u094d\u0930\u094b\u092e')).ok).toBe(true);
  });
  it('applies to the location region too', () => {
    const req = examples.relayToOwner.request;
    const bad = { ...req, approxLocation: { country: 'IN', region: 'Pune\u202e' } };
    expect(parseRelayToOwner(JSON.stringify(bad)).ok).toBe(false);
  });
});

describe('requestGone', () => {
  const gone = examples.relayToOwner.requestGone;
  it('parses only as relay to owner', () => {
    expect(parseRelayToOwner(JSON.stringify(gone)).ok).toBe(true);
    expect(parseRelayToShop(JSON.stringify(gone)).ok).toBe(false);
    expect(parseShopToRelay(JSON.stringify(gone)).ok).toBe(false);
  });
  it('rejects missing, short and extra fields', () => {
    expect(parseRelayToOwner(JSON.stringify({ v: 1, t: 'requestGone' })).ok).toBe(false);
    expect(parseRelayToOwner(JSON.stringify({ ...gone, reqId: 'abc' })).ok).toBe(false);
    expect(parseRelayToOwner(JSON.stringify({ ...gone, extra: 1 })).ok).toBe(false);
  });
  it('round-trips through the serializer', () => {
    const r = parseRelayToOwner(JSON.stringify(gone));
    expect(r.ok && serializeRelayToOwner(r.msg)).toBe(JSON.stringify(gone));
  });
});
