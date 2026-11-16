import { base64urlEncode, generateLinkSecret, generateSessionId } from '@despawn/crypto';
import { parseShopToRelay } from '@despawn/protocol';
import { describe, expect, it } from 'vitest';
import { allKeys, detectLang, t, tableFor } from './i18n.js';
import { parseLink } from './link.js';
import { describeBrowser } from './ua.js';

describe('describeBrowser', () => {
  const cases: Array<[string, string, string]> = [
    [
      'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
      'Chrome 109',
      'Windows 7',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
      'Edge 130',
      'Windows 10 or 11',
    ],
    [
      'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
      'Firefox 128',
      'Linux',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
      'Safari 17',
      'macOS',
    ],
    ['', 'Unknown browser', 'Unknown system'],
  ];
  for (const [ua, browser, os] of cases) {
    it(`describes ${browser}`, () => {
      expect(describeBrowser(ua)).toEqual({ browser, os });
    });
  }
  it('always produces values the protocol accepts, even for hostile user agents', () => {
    const hostile = [
      '\u202e'.repeat(100),
      'Chrome/' + '9'.repeat(500),
      '<script>alert(1)</script>',
      'x'.repeat(5000),
    ];
    for (const ua of hostile) {
      const d = describeBrowser(ua);
      const frame = JSON.stringify({ v: 1, t: 'hello', shopPub: 'x', mac: 'y', ua: d });
      expect(frame.length).toBeGreaterThan(0);
      expect(d.browser.length).toBeGreaterThan(0);
      expect(d.browser.length).toBeLessThanOrEqual(40);
      expect(d.os.length).toBeLessThanOrEqual(40);
      expect([...(d.browser + d.os)].some((c) => c.charCodeAt(0) < 0x20 || c === '\u202e')).toBe(
        false,
      );
    }
    expect(parseShopToRelay('{}').ok).toBe(false);
  });
});

describe('parseLink', () => {
  const id = base64urlEncode(generateSessionId());
  const secret = base64urlEncode(generateLinkSecret());
  it('accepts a well-formed link', () => {
    const l = parseLink(`/s/${id}`, `#${secret}`);
    expect(l?.sessionId).toBe(id);
    expect(l?.linkSecret.length).toBe(16);
    expect(parseLink(`/s/${id}/`, secret)?.sessionId).toBe(id);
  });
  it('rejects every malformed variant', () => {
    const bad: Array<[string, string]> = [
      ['/s/short', `#${secret}`],
      [`/x/${id}`, `#${secret}`],
      [`/s/${id}`, ''],
      [`/s/${id}`, '#'],
      [`/s/${id}`, '#AAAA'],
      [`/s/${id}`, `#${secret}A`],
      [`/s/${id}`, `#${secret.slice(0, -1)}x`],
      [`/s/${id}/extra`, `#${secret}`],
      ['/s/' + 'A'.repeat(23), `#${secret}`],
      [`/s/${id}`, '#' + '='.repeat(4)],
    ];
    for (const [p, h] of bad) expect(parseLink(p, h)).toBeNull();
  });
});

describe('i18n', () => {
  it('has a non-empty Hindi and English string for every key', () => {
    for (const k of allKeys()) {
      expect(t('en', k).length).toBeGreaterThan(0);
      expect(t('hi', k).length).toBeGreaterThan(0);
    }
    expect(Object.keys(tableFor('hi')).sort()).toEqual(Object.keys(tableFor('en')).sort());
  });
  it('has a reason string for every terminal reason the relay can send', () => {
    for (const r of [
      'PRINTED',
      'OWNER_KILLED',
      'LIVE_TIMEOUT',
      'HEARTBEAT_LOST',
      'LINK_EXPIRED',
      'CANCELLED',
      'SHOP_WIPED',
      'RELEASE_TIMEOUT',
    ]) {
      expect(allKeys()).toContain(`reason.${r}`);
    }
  });
  it('never claims more than it can promise', () => {
    for (const lang of ['en', 'hi'] as const) {
      const all = allKeys()
        .map((k) => t(lang, k).toLowerCase())
        .join(' ');
      expect(all.includes('nothing was saved')).toBe(false);
      expect(all.includes('guarantee')).toBe(false);
    }
  });
  it('detects the language from the browser list', () => {
    expect(detectLang(['hi-IN', 'en'])).toBe('hi');
    expect(detectLang(['en-US'])).toBe('en');
    expect(detectLang(['fr'])).toBe('en');
    expect(detectLang([])).toBe('en');
  });
});
