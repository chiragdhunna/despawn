import { describe, expect, it } from 'vitest';
import * as zlib from 'node:zlib';
import * as path from 'node:path';
import * as esbuild from 'esbuild';
import { base64urlDecode, base64urlEncode } from '@despawn/crypto';

import examples from '../../../docs/protocol-examples.json' with { type: 'json' };

import {
  DEFAULT_RULES,
  ERROR_CODES,
  MAX_BLOB_BYTES,
  MAX_FRAME_BYTES,
  MAX_GRACE_MS,
  MAX_LINK_TTL_MS,
  MAX_LIVE_TTL_MS,
  MIN_GRACE_MS,
  MIN_LINK_TTL_MS,
  MIN_LIVE_TTL_MS,
  ProtocolError,
  RULE_LIMITS,
  SESSION_STATES,
  SHOP_VIEW_STATES,
  SHOP_WIPE_REASONS,
  TERMINAL_REASONS,
  TERMINAL_STATES,
  VERIFY_STATUSES,
  isSessionId,
  isTerminalState,
  isToken32,
  isVerifyId,
  parseCreateSessionRequest,
  parseCreateSessionResponse,
  parseErrorResponse,
  parseOwnerToRelay,
  parseRelayToOwner,
  parseRelayToShop,
  parseShopToRelay,
  parseVerifyResponse,
  serializeOwnerToRelay,
  serializeRelayToOwner,
  serializeRelayToShop,
  serializeShopToRelay,
  validateRules,
} from './index.js';

import type { ShopToRelay } from './index.js';

// Seeded PRNG for deterministic testing and reproducible fuzzing
function createPrng(seed: number) {
  let s = seed >>> 0 || 1;
  return function next(): number {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

describe('docs/PROTOCOL_SPEC.md Section 8 Test Suite', () => {
  // --------------------------------------------------------------------------
  // Item 1: Examples
  // --------------------------------------------------------------------------
  describe('Item 1: Examples', () => {
    it('parses every shopToRelay example and round-trips via serializer', () => {
      for (const [name, msg] of Object.entries(examples.shopToRelay)) {
        const frame = JSON.stringify(msg);
        const res = parseShopToRelay(frame);
        expect(res.ok, `shopToRelay.${name} should parse`).toBe(true);
        if (res.ok) {
          expect(res.msg).toEqual(msg);
          const serialized = serializeShopToRelay(res.msg);
          const res2 = parseShopToRelay(serialized);
          expect(res2.ok).toBe(true);
          if (res2.ok) {
            expect(res2.msg).toEqual(msg);
          }
        }
      }
    });

    it('parses every relayToShop example and round-trips via serializer', () => {
      for (const [name, msg] of Object.entries(examples.relayToShop)) {
        const frame = JSON.stringify(msg);
        const res = parseRelayToShop(frame);
        expect(res.ok, `relayToShop.${name} should parse`).toBe(true);
        if (res.ok) {
          expect(res.msg).toEqual(msg);
          const serialized = serializeRelayToShop(res.msg);
          const res2 = parseRelayToShop(serialized);
          expect(res2.ok).toBe(true);
          if (res2.ok) {
            expect(res2.msg).toEqual(msg);
          }
        }
      }
    });

    it('parses every ownerToRelay example and round-trips via serializer', () => {
      for (const [name, msg] of Object.entries(examples.ownerToRelay)) {
        const frame = JSON.stringify(msg);
        const res = parseOwnerToRelay(frame);
        expect(res.ok, `ownerToRelay.${name} should parse`).toBe(true);
        if (res.ok) {
          expect(res.msg).toEqual(msg);
          const serialized = serializeOwnerToRelay(res.msg);
          const res2 = parseOwnerToRelay(serialized);
          expect(res2.ok).toBe(true);
          if (res2.ok) {
            expect(res2.msg).toEqual(msg);
          }
        }
      }
    });

    it('parses every relayToOwner example and round-trips via serializer', () => {
      for (const [name, msg] of Object.entries(examples.relayToOwner)) {
        const frame = JSON.stringify(msg);
        const res = parseRelayToOwner(frame);
        expect(res.ok, `relayToOwner.${name} should parse`).toBe(true);
        if (res.ok) {
          expect(res.msg).toEqual(msg);
          const serialized = serializeRelayToOwner(res.msg);
          const res2 = parseRelayToOwner(serialized);
          expect(res2.ok).toBe(true);
          if (res2.ok) {
            expect(res2.msg).toEqual(msg);
          }
        }
      }
    });
  });

  // --------------------------------------------------------------------------
  // Item 2: Direction isolation
  // --------------------------------------------------------------------------
  describe('Item 2: Direction isolation', () => {
    it('shop-to-relay examples fail in other direction parsers', () => {
      for (const [name, msg] of Object.entries(examples.shopToRelay)) {
        const frame = JSON.stringify(msg);
        expect(parseOwnerToRelay(frame).ok, `shop.${name} in ownerToRelay`).toBe(false);
        expect(parseRelayToShop(frame).ok, `shop.${name} in relayToShop`).toBe(false);
        expect(parseRelayToOwner(frame).ok, `shop.${name} in relayToOwner`).toBe(false);
      }
    });

    it('owner-to-relay examples fail in other direction parsers', () => {
      for (const [name, msg] of Object.entries(examples.ownerToRelay)) {
        const frame = JSON.stringify(msg);
        expect(parseShopToRelay(frame).ok, `owner.${name} in shopToRelay`).toBe(false);
        expect(parseRelayToShop(frame).ok, `owner.${name} in relayToShop`).toBe(false);
        expect(parseRelayToOwner(frame).ok, `owner.${name} in relayToOwner`).toBe(false);
      }
    });

    it('relay-to-shop examples fail in client parsers and cross-relay parsers', () => {
      for (const [name, msg] of Object.entries(examples.relayToShop)) {
        const frame = JSON.stringify(msg);
        expect(parseShopToRelay(frame).ok, `relayShop.${name} in shopToRelay`).toBe(false);
        expect(parseOwnerToRelay(frame).ok, `relayShop.${name} in ownerToRelay`).toBe(false);
        if (msg.t !== 'error') {
          expect(parseRelayToOwner(frame).ok, `relayShop.${name} in relayToOwner`).toBe(false);
        }
      }
    });

    it('relay-to-owner examples fail in client parsers and cross-relay parsers', () => {
      for (const [name, msg] of Object.entries(examples.relayToOwner)) {
        const frame = JSON.stringify(msg);
        expect(parseShopToRelay(frame).ok, `relayOwner.${name} in shopToRelay`).toBe(false);
        expect(parseOwnerToRelay(frame).ok, `relayOwner.${name} in ownerToRelay`).toBe(false);
        if (msg.t !== 'error') {
          expect(parseRelayToShop(frame).ok, `relayOwner.${name} in relayToShop`).toBe(false);
        }
      }
    });

    it('differentiates shared tag hb by field differences', () => {
      const shopHb = JSON.stringify(examples.shopToRelay.hb);
      const ownerHb = JSON.stringify(examples.ownerToRelay.hb);

      // shop hb has state, owner hb does not
      expect(parseShopToRelay(shopHb).ok).toBe(true);
      expect(parseOwnerToRelay(shopHb).ok).toBe(false); // has extra state

      expect(parseOwnerToRelay(ownerHb).ok).toBe(true);
      expect(parseShopToRelay(ownerHb).ok).toBe(false); // missing state
    });

    it('differentiates shared tag kill by field differences', () => {
      const relayKill = JSON.stringify(examples.relayToShop.kill);
      const ownerKill = JSON.stringify(examples.ownerToRelay.kill);

      // relay kill has reason, owner kill has no extra fields
      expect(parseRelayToShop(relayKill).ok).toBe(true);
      expect(parseOwnerToRelay(relayKill).ok).toBe(false); // extra reason

      expect(parseOwnerToRelay(ownerKill).ok).toBe(true);
      expect(parseRelayToShop(ownerKill).ok).toBe(false); // missing reason
    });

    it('rejects error tag sent to client-to-relay parsers', () => {
      const relayError = JSON.stringify(examples.relayToShop.error);
      expect(parseShopToRelay(relayError).ok).toBe(false);
      expect(parseOwnerToRelay(relayError).ok).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Item 3: Per-field negatives (programmatically generated)
  // --------------------------------------------------------------------------
  describe('Item 3: Per-field negatives', () => {
    function testFieldMutations(
      parser: (frame: string) => { ok: boolean },
      baseMsg: Record<string, unknown>,
      msgName: string,
    ) {
      for (const key of Object.keys(baseMsg)) {
        // 1. Missing field
        const missing = { ...baseMsg };
        delete missing[key];
        expect(parser(JSON.stringify(missing)).ok, `${msgName}: missing ${key} must fail`).toBe(
          false,
        );

        // 2. Wrong type
        const val = baseMsg[key];
        const badTypes: unknown[] = [];
        if (typeof val === 'string') {
          badTypes.push(12345, true, [], {});
        } else if (typeof val === 'number') {
          badTypes.push('not-a-number', true, [], {});
        } else if (typeof val === 'boolean') {
          badTypes.push('true', 1, [], {});
        } else if (typeof val === 'object' && val !== null) {
          badTypes.push('string', 123, true, []);
        }

        for (const badVal of badTypes) {
          const mutated = { ...baseMsg, [key]: badVal };
          expect(
            parser(JSON.stringify(mutated)).ok,
            `${msgName}: wrong type for ${key} must fail`,
          ).toBe(false);
        }

        // 3. Null where not allowed
        const nullableFields = ['remainingMs', 'lastHbMs', 'approxLocation'];
        if (!nullableFields.includes(key)) {
          const withNull = { ...baseMsg, [key]: null };
          expect(parser(JSON.stringify(withNull)).ok, `${msgName}: null for ${key} must fail`).toBe(
            false,
          );
        }

        // 4. Nested object fields
        if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
          const subObj = val as Record<string, unknown>;
          for (const subKey of Object.keys(subObj)) {
            // Missing subfield (approxLocation fields are optional individually)
            if (key !== 'approxLocation') {
              const missingSub = { ...subObj };
              delete missingSub[subKey];
              expect(
                parser(JSON.stringify({ ...baseMsg, [key]: missingSub })).ok,
                `${msgName}.${key}: missing subfield ${subKey} must fail`,
              ).toBe(false);
            }

            // Null in subfield
            const nullSub = { ...subObj, [subKey]: null };
            expect(
              parser(JSON.stringify({ ...baseMsg, [key]: nullSub })).ok,
              `${msgName}.${key}: null in subfield ${subKey} must fail`,
            ).toBe(false);

            // Wrong type in subfield
            const subVal = subObj[subKey];
            const badSubVal = typeof subVal === 'string' ? 99999 : 'bad-type';
            const wrongTypeSub = { ...subObj, [subKey]: badSubVal };
            expect(
              parser(JSON.stringify({ ...baseMsg, [key]: wrongTypeSub })).ok,
              `${msgName}.${key}: wrong type in subfield ${subKey} must fail`,
            ).toBe(false);
          }
        }
      }
    }

    it('generates per-field negatives for shopToRelay messages', () => {
      for (const [name, msg] of Object.entries(examples.shopToRelay)) {
        testFieldMutations(parseShopToRelay, msg as Record<string, unknown>, `shopToRelay.${name}`);
      }
    });

    it('generates per-field negatives for relayToShop messages', () => {
      for (const [name, msg] of Object.entries(examples.relayToShop)) {
        testFieldMutations(parseRelayToShop, msg as Record<string, unknown>, `relayToShop.${name}`);
      }
    });

    it('generates per-field negatives for ownerToRelay messages', () => {
      for (const [name, msg] of Object.entries(examples.ownerToRelay)) {
        testFieldMutations(
          parseOwnerToRelay,
          msg as Record<string, unknown>,
          `ownerToRelay.${name}`,
        );
      }
    });

    it('generates per-field negatives for relayToOwner messages', () => {
      for (const [name, msg] of Object.entries(examples.relayToOwner)) {
        testFieldMutations(
          parseRelayToOwner,
          msg as Record<string, unknown>,
          `relayToOwner.${name}`,
        );
      }
    });
  });

  // --------------------------------------------------------------------------
  // Item 4: Binary fields
  // --------------------------------------------------------------------------
  describe('Item 4: Binary fields', () => {
    it('rejects non-canonical base64url encodings', () => {
      // 16-byte B16: 22 chars. The 22nd char encodes only 2 bits.
      // Valid example: "AAECAwQFBgcICQoLDA0ODw"
      // Change the trailing unused bits to non-zero -> non-canonical
      const valid = examples.ids.sessionId;
      const decoded = base64urlDecode(valid);
      expect(decoded.length).toBe(16);

      // Mutate last character to something with non-canonical unused bits
      const nonCanonical = valid.slice(0, -1) + 'x';
      expect(isSessionId(nonCanonical)).toBe(false);
    });

    it('rejects base64url with padding', () => {
      const valid = examples.ids.sessionId;
      expect(isSessionId(valid + '=')).toBe(false);
      expect(isSessionId(valid + '==')).toBe(false);
      expect(isToken32(examples.ids.reqId + '=')).toBe(false);
    });

    it('rejects binary fields with wrong decoded length', () => {
      // B16 expects 16 bytes. Test with 15 bytes and 17 bytes.
      const b15 = base64urlEncode(new Uint8Array(15));
      const b17 = base64urlEncode(new Uint8Array(17));
      expect(isSessionId(b15)).toBe(false);
      expect(isSessionId(b17)).toBe(false);

      // B12 expects 12 bytes. Test with 11 and 13 bytes.
      const b11 = base64urlEncode(new Uint8Array(11));
      const b13 = base64urlEncode(new Uint8Array(13));
      const nonceApprove = { ...examples.ownerToRelay.approve, nonce: b11 };
      expect(parseOwnerToRelay(JSON.stringify(nonceApprove)).ok).toBe(false);
      const nonceApprove2 = { ...examples.ownerToRelay.approve, nonce: b13 };
      expect(parseOwnerToRelay(JSON.stringify(nonceApprove2)).ok).toBe(false);

      // B32 expects 32 bytes. Test with 31 and 33 bytes.
      const b31 = base64urlEncode(new Uint8Array(31));
      const b33 = base64urlEncode(new Uint8Array(33));
      expect(isToken32(b31)).toBe(false);
      expect(isToken32(b33)).toBe(false);

      // B48 expects 48 bytes. Test with 47 and 49 bytes.
      const b47 = base64urlEncode(new Uint8Array(47));
      const b49 = base64urlEncode(new Uint8Array(49));
      const wrapApprove = { ...examples.ownerToRelay.approve, wrappedKey: b47 };
      expect(parseOwnerToRelay(JSON.stringify(wrapApprove)).ok).toBe(false);
      const wrapApprove2 = { ...examples.ownerToRelay.approve, wrappedKey: b49 };
      expect(parseOwnerToRelay(JSON.stringify(wrapApprove2)).ok).toBe(false);
    });

    it('rejects B65 whose first byte is not 0x04', () => {
      // 65 bytes starting with 0x02, 0x03, 0x00, 0x05
      const invalidFirstBytes = [0x00, 0x02, 0x03, 0x05, 0xff];
      for (const firstByte of invalidFirstBytes) {
        const raw = new Uint8Array(65);
        raw.fill(0xaa);
        raw[0] = firstByte;
        const b65Bad = base64urlEncode(raw);

        const hello = { ...examples.shopToRelay.hello, shopPub: b65Bad };
        expect(
          parseShopToRelay(JSON.stringify(hello)).ok,
          `first byte 0x${firstByte.toString(16)} must be rejected`,
        ).toBe(false);

        const approve = { ...examples.ownerToRelay.approve, ownerPub: b65Bad };
        expect(
          parseOwnerToRelay(JSON.stringify(approve)).ok,
          `ownerPub first byte 0x${firstByte.toString(16)} must be rejected`,
        ).toBe(false);
      }

      // Valid 65 bytes starting with 0x04
      const validRaw = new Uint8Array(65);
      validRaw.fill(0x11);
      validRaw[0] = 0x04;
      const b65Good = base64urlEncode(validRaw);
      const validHello = { ...examples.shopToRelay.hello, shopPub: b65Good };
      expect(parseShopToRelay(JSON.stringify(validHello)).ok).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Item 5: Strictness
  // --------------------------------------------------------------------------
  describe('Item 5: Strictness', () => {
    it('rejects extra unknown keys in strict objects', () => {
      for (const [name, msg] of Object.entries(examples.shopToRelay)) {
        const withExtra = { ...msg, unknownProperty: 'extra' };
        expect(
          parseShopToRelay(JSON.stringify(withExtra)).ok,
          `extra key in ${name} must fail`,
        ).toBe(false);
      }
    });

    it('rejects __proto__, constructor, and prototype keys', () => {
      const jsonProto = `{"v":1,"t":"hb","seq":1,"state":"READY","__proto__":{"polluted":true}}`;
      expect(parseShopToRelay(jsonProto).ok).toBe(false);

      const jsonCtor = `{"v":1,"t":"hb","seq":1,"state":"READY","constructor":{"polluted":true}}`;
      expect(parseShopToRelay(jsonCtor).ok).toBe(false);

      const jsonPrototype = `{"v":1,"t":"hb","seq":1,"state":"READY","prototype":{"polluted":true}}`;
      expect(parseShopToRelay(jsonPrototype).ok).toBe(false);
    });

    it('rejects top-level arrays and non-objects', () => {
      expect(parseShopToRelay(JSON.stringify([examples.shopToRelay.hb])).ok).toBe(false);
      expect(parseShopToRelay('null').ok).toBe(false);
      expect(parseShopToRelay('12345').ok).toBe(false);
      expect(parseShopToRelay('"hello"').ok).toBe(false);
      expect(parseShopToRelay('""').ok).toBe(false);
      expect(parseShopToRelay('true').ok).toBe(false);
      expect(parseShopToRelay('{}').ok).toBe(false);
    });

    it('rejects v of 2, "1", or missing', () => {
      const base = examples.shopToRelay.hb;
      expect(parseShopToRelay(JSON.stringify({ ...base, v: 2 })).ok).toBe(false);
      expect(parseShopToRelay(JSON.stringify({ ...base, v: '1' })).ok).toBe(false);
      const missingV = { ...base };
      // @ts-expect-error testing missing property
      delete missingV.v;
      expect(parseShopToRelay(JSON.stringify(missingV)).ok).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Item 6: Size
  // --------------------------------------------------------------------------
  describe('Item 6: Size', () => {
    it('rejects frames exceeding MAX_FRAME_BYTES with TOO_LARGE', () => {
      // 1. ASCII frame of MAX_FRAME_BYTES + 1
      const bigAscii = 'x'.repeat(MAX_FRAME_BYTES + 1);
      const res1 = parseShopToRelay(bigAscii);
      expect(res1).toEqual({ ok: false, code: 'TOO_LARGE' });

      // 2. Multi-byte characters where char count <= MAX_FRAME_BYTES but byte count > MAX_FRAME_BYTES
      // \u4e16 is 3 UTF-8 bytes. 2000 chars = 6000 bytes > 4096 bytes.
      const multiByteStr = '\u4e16'.repeat(2000);
      expect(multiByteStr.length).toBeLessThanOrEqual(MAX_FRAME_BYTES);
      const res2 = parseShopToRelay(multiByteStr);
      expect(res2).toEqual({ ok: false, code: 'TOO_LARGE' });
    });

    it('accepts frame of exactly MAX_FRAME_BYTES bytes if otherwise valid', () => {
      // Build a valid JSON frame and pad with whitespace between tokens to hit exactly 4096 bytes
      const baseObj = examples.shopToRelay.printStarted;
      const minJson = JSON.stringify(baseObj); // {"v":1,"t":"printStarted"}
      const spacesNeeded = MAX_FRAME_BYTES - minJson.length;
      expect(spacesNeeded).toBeGreaterThan(0);

      const exact4096 = `{"v":1,${' '.repeat(spacesNeeded)}"t":"printStarted"}`;
      const encoder = new TextEncoder();
      expect(encoder.encode(exact4096).length).toBe(MAX_FRAME_BYTES);

      const res = parseShopToRelay(exact4096);
      expect(res.ok).toBe(true);

      // Adding 1 more space brings byte count to 4097 -> must return TOO_LARGE
      const over4096 = `{"v":1,${' '.repeat(spacesNeeded + 1)}"t":"printStarted"}`;
      expect(encoder.encode(over4096).length).toBe(MAX_FRAME_BYTES + 1);
      const resOver = parseShopToRelay(over4096);
      expect(resOver).toEqual({ ok: false, code: 'TOO_LARGE' });
    });
  });

  // --------------------------------------------------------------------------
  // Item 7: Text
  // --------------------------------------------------------------------------
  describe('Item 7: Text', () => {
    it('rejects control characters U+0000, U+001F, U+007F in text fields', () => {
      const controls = ['\u0000', '\u001f', '\u007f'];
      for (const ctrl of controls) {
        // ShortText (ua.browser)
        const badUa = {
          ...examples.shopToRelay.hello,
          ua: { browser: `Chrome${ctrl}`, os: 'Win' },
        };
        expect(parseShopToRelay(JSON.stringify(badUa)).ok).toBe(false);

        // Region (approxLocation.region)
        const badRegion = {
          ...examples.relayToOwner.request,
          approxLocation: { country: 'IN', region: `Delhi${ctrl}` },
        };
        expect(parseRelayToOwner(JSON.stringify(badRegion)).ok).toBe(false);

        // purposeLabel
        const badVerify = {
          ...examples.http.verifyResponse,
          purposeLabel: `Verification${ctrl}`,
        };
        expect(parseVerifyResponse(badVerify).ok).toBe(false);

        // challengeToken
        const badChallenge = {
          ...examples.http.createSessionRequest,
          challengeToken: `tok${ctrl}`,
        };
        expect(parseCreateSessionRequest(badChallenge).ok).toBe(false);
      }
    });

    it('rejects empty string for ShortText, Region, challengeToken but allows for purposeLabel', () => {
      // ShortText: length 0 rejected, length 41 rejected
      const emptyShort = { ...examples.shopToRelay.hello, ua: { browser: '', os: 'Win' } };
      expect(parseShopToRelay(JSON.stringify(emptyShort)).ok).toBe(false);
      const longShort = {
        ...examples.shopToRelay.hello,
        ua: { browser: 'a'.repeat(41), os: 'Win' },
      };
      expect(parseShopToRelay(JSON.stringify(longShort)).ok).toBe(false);

      // Region: length 0 rejected, length 61 rejected
      const emptyRegion = {
        ...examples.relayToOwner.request,
        approxLocation: { country: 'IN', region: '' },
      };
      expect(parseRelayToOwner(JSON.stringify(emptyRegion)).ok).toBe(false);
      const longRegion = {
        ...examples.relayToOwner.request,
        approxLocation: { country: 'IN', region: 'a'.repeat(61) },
      };
      expect(parseRelayToOwner(JSON.stringify(longRegion)).ok).toBe(false);

      // challengeToken: length 0 rejected, length 2049 rejected
      const emptyChallenge = { ...examples.http.createSessionRequest, challengeToken: '' };
      expect(parseCreateSessionRequest(emptyChallenge).ok).toBe(false);
      const longChallenge = {
        ...examples.http.createSessionRequest,
        challengeToken: 'a'.repeat(2049),
      };
      expect(parseCreateSessionRequest(longChallenge).ok).toBe(false);

      // purposeLabel: length 0 is ALLOWED (0 to 60)
      const emptyPurpose = { ...examples.http.verifyResponse, purposeLabel: '' };
      expect(parseVerifyResponse(emptyPurpose).ok).toBe(true);
      const longPurpose = { ...examples.http.verifyResponse, purposeLabel: 'a'.repeat(61) };
      expect(parseVerifyResponse(longPurpose).ok).toBe(false);
    });

    it('enforces CountryCode rules (2 uppercase ASCII letters)', () => {
      const valid = { ...examples.relayToOwner.request, approxLocation: { country: 'US' } };
      expect(parseRelayToOwner(JSON.stringify(valid)).ok).toBe(true);

      const lowercase = { ...examples.relayToOwner.request, approxLocation: { country: 'us' } };
      expect(parseRelayToOwner(JSON.stringify(lowercase)).ok).toBe(false);

      const singleLetter = { ...examples.relayToOwner.request, approxLocation: { country: 'U' } };
      expect(parseRelayToOwner(JSON.stringify(singleLetter)).ok).toBe(false);

      const threeLetters = { ...examples.relayToOwner.request, approxLocation: { country: 'USA' } };
      expect(parseRelayToOwner(JSON.stringify(threeLetters)).ok).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Item 8: Integers
  // --------------------------------------------------------------------------
  describe('Item 8: Integers', () => {
    it('rejects NaN, Infinity, floats, strings, and 2**53 for integer fields', () => {
      const badNumbers = [NaN, Infinity, -Infinity, 1.5, '5', 2 ** 53];
      for (const bad of badNumbers) {
        // pageCount (1 to 50)
        const badPages = { ...examples.shopToRelay.rendered, pageCount: bad };
        expect(parseShopToRelay(JSON.stringify(badPages)).ok).toBe(false);

        // seq (0 to 2147483647)
        const badSeq = { ...examples.shopToRelay.hb, seq: bad };
        expect(parseShopToRelay(JSON.stringify(badSeq)).ok).toBe(false);

        // at (EpochMs)
        const badAt = { ...examples.relayToOwner.destroyed, at: bad };
        expect(parseRelayToOwner(JSON.stringify(badAt)).ok).toBe(false);
      }
    });

    it('enforces integer boundary values for all range-checked fields', () => {
      // pageCount (1..50)
      expect(
        parseShopToRelay(JSON.stringify({ ...examples.shopToRelay.rendered, pageCount: 0 })).ok,
      ).toBe(false);
      expect(
        parseShopToRelay(JSON.stringify({ ...examples.shopToRelay.rendered, pageCount: 1 })).ok,
      ).toBe(true);
      expect(
        parseShopToRelay(JSON.stringify({ ...examples.shopToRelay.rendered, pageCount: 50 })).ok,
      ).toBe(true);
      expect(
        parseShopToRelay(JSON.stringify({ ...examples.shopToRelay.rendered, pageCount: 51 })).ok,
      ).toBe(false);

      // seq (0..2147483647)
      expect(parseShopToRelay(JSON.stringify({ ...examples.shopToRelay.hb, seq: -1 })).ok).toBe(
        false,
      );
      expect(parseShopToRelay(JSON.stringify({ ...examples.shopToRelay.hb, seq: 0 })).ok).toBe(
        true,
      );
      expect(
        parseShopToRelay(JSON.stringify({ ...examples.shopToRelay.hb, seq: 2147483647 })).ok,
      ).toBe(true);
      expect(
        parseShopToRelay(JSON.stringify({ ...examples.shopToRelay.hb, seq: 2147483648 })).ok,
      ).toBe(false);

      // printsDone (0..1000)
      const baseStatus = examples.relayToOwner.status;
      expect(parseRelayToOwner(JSON.stringify({ ...baseStatus, printsDone: -1 })).ok).toBe(false);
      expect(parseRelayToOwner(JSON.stringify({ ...baseStatus, printsDone: 0 })).ok).toBe(true);
      expect(parseRelayToOwner(JSON.stringify({ ...baseStatus, printsDone: 1000 })).ok).toBe(true);
      expect(parseRelayToOwner(JSON.stringify({ ...baseStatus, printsDone: 1001 })).ok).toBe(false);

      // EpochMs (0..4102444800000)
      const baseDestroyed = examples.relayToOwner.destroyed;
      expect(parseRelayToOwner(JSON.stringify({ ...baseDestroyed, at: -1 })).ok).toBe(false);
      expect(parseRelayToOwner(JSON.stringify({ ...baseDestroyed, at: 0 })).ok).toBe(true);
      expect(parseRelayToOwner(JSON.stringify({ ...baseDestroyed, at: 4102444800000 })).ok).toBe(
        true,
      );
      expect(parseRelayToOwner(JSON.stringify({ ...baseDestroyed, at: 4102444800001 })).ok).toBe(
        false,
      );
    });
  });

  // --------------------------------------------------------------------------
  // Item 9: Enumerations
  // --------------------------------------------------------------------------
  describe('Item 9: Enumerations', () => {
    it('accepts every valid enum value and rejects lowercase or unknown values', () => {
      // SessionState
      for (const state of SESSION_STATES) {
        const msg = { ...examples.relayToOwner.status, state };
        expect(parseRelayToOwner(JSON.stringify(msg)).ok).toBe(true);
      }
      expect(
        parseRelayToOwner(JSON.stringify({ ...examples.relayToOwner.status, state: 'live' })).ok,
      ).toBe(false);
      expect(
        parseRelayToOwner(JSON.stringify({ ...examples.relayToOwner.status, state: 'UNKNOWN' })).ok,
      ).toBe(false);

      // ShopViewState
      for (const state of SHOP_VIEW_STATES) {
        const msg = { ...examples.shopToRelay.hb, state };
        expect(parseShopToRelay(JSON.stringify(msg)).ok).toBe(true);
      }
      expect(
        parseShopToRelay(JSON.stringify({ ...examples.shopToRelay.hb, state: 'ready' })).ok,
      ).toBe(false);

      // ShopWipeReason
      for (const reason of SHOP_WIPE_REASONS) {
        const msg = { ...examples.shopToRelay.wiped, reason };
        expect(parseShopToRelay(JSON.stringify(msg)).ok).toBe(true);
      }
      expect(
        parseShopToRelay(JSON.stringify({ ...examples.shopToRelay.wiped, reason: 'printed' })).ok,
      ).toBe(false);

      // TerminalReason
      for (const reason of TERMINAL_REASONS) {
        const msg = { ...examples.relayToShop.kill, reason };
        expect(parseRelayToShop(JSON.stringify(msg)).ok).toBe(true);
      }
      expect(
        parseRelayToShop(JSON.stringify({ ...examples.relayToShop.kill, reason: 'printed' })).ok,
      ).toBe(false);

      // ErrorCode
      for (const code of ERROR_CODES) {
        const msg = { ...examples.relayToShop.error, code };
        expect(parseRelayToShop(JSON.stringify(msg)).ok).toBe(true);
      }
      expect(
        parseRelayToShop(JSON.stringify({ ...examples.relayToShop.error, code: 'bad_message' })).ok,
      ).toBe(false);

      // VerifyStatus
      for (const status of VERIFY_STATUSES) {
        const msg = { ...examples.http.verifyResponse, status };
        expect(parseVerifyResponse(msg).ok).toBe(true);
      }
      expect(parseVerifyResponse({ ...examples.http.verifyResponse, status: 'valid' }).ok).toBe(
        false,
      );
    });

    it('implements isTerminalState correctly', () => {
      for (const term of TERMINAL_STATES) {
        expect(isTerminalState(term)).toBe(true);
      }
      const terminalList: readonly string[] = TERMINAL_STATES;
      const nonTerminal = SESSION_STATES.filter((s) => !terminalList.includes(s));
      for (const s of nonTerminal) {
        expect(isTerminalState(s)).toBe(false);
      }
    });
  });

  // --------------------------------------------------------------------------
  // Item 10: Rules
  // --------------------------------------------------------------------------
  describe('Item 10: Rules', () => {
    it('validates DEFAULT_RULES successfully', () => {
      const res = validateRules(DEFAULT_RULES);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.msg).toEqual(DEFAULT_RULES);
      }
    });

    it('enforces min <= default <= max for all rules', () => {
      for (const [ruleName, limits] of Object.entries(RULE_LIMITS)) {
        expect(limits.min, `${ruleName} min <= default`).toBeLessThanOrEqual(limits.default);
        expect(limits.default, `${ruleName} default <= max`).toBeLessThanOrEqual(limits.max);
      }
    });

    it('accepts min and max and rejects min-1 and max+1 for every rule', () => {
      // linkTtlMs: 300000 to 86400000
      expect(validateRules({ ...DEFAULT_RULES, linkTtlMs: MIN_LINK_TTL_MS - 1 }).ok).toBe(false);
      expect(validateRules({ ...DEFAULT_RULES, linkTtlMs: MIN_LINK_TTL_MS }).ok).toBe(true);
      expect(validateRules({ ...DEFAULT_RULES, linkTtlMs: MAX_LINK_TTL_MS }).ok).toBe(true);
      expect(validateRules({ ...DEFAULT_RULES, linkTtlMs: MAX_LINK_TTL_MS + 1 }).ok).toBe(false);

      // liveTtlMs: 30000 to 600000
      expect(validateRules({ ...DEFAULT_RULES, liveTtlMs: MIN_LIVE_TTL_MS - 1 }).ok).toBe(false);
      expect(validateRules({ ...DEFAULT_RULES, liveTtlMs: MIN_LIVE_TTL_MS }).ok).toBe(true);
      expect(validateRules({ ...DEFAULT_RULES, liveTtlMs: MAX_LIVE_TTL_MS }).ok).toBe(true);
      expect(validateRules({ ...DEFAULT_RULES, liveTtlMs: MAX_LIVE_TTL_MS + 1 }).ok).toBe(false);

      // printLimit: 1 to 10
      expect(validateRules({ ...DEFAULT_RULES, printLimit: 0 }).ok).toBe(false);
      expect(validateRules({ ...DEFAULT_RULES, printLimit: 1 }).ok).toBe(true);
      expect(validateRules({ ...DEFAULT_RULES, printLimit: 10 }).ok).toBe(true);
      expect(validateRules({ ...DEFAULT_RULES, printLimit: 11 }).ok).toBe(false);

      // graceMs: 0 to 60000
      expect(validateRules({ ...DEFAULT_RULES, graceMs: MIN_GRACE_MS - 1 }).ok).toBe(false);
      expect(validateRules({ ...DEFAULT_RULES, graceMs: MIN_GRACE_MS }).ok).toBe(true);
      expect(validateRules({ ...DEFAULT_RULES, graceMs: MAX_GRACE_MS }).ok).toBe(true);
      expect(validateRules({ ...DEFAULT_RULES, graceMs: MAX_GRACE_MS + 1 }).ok).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Item 11: HTTP shapes
  // --------------------------------------------------------------------------
  describe('Item 11: HTTP shapes', () => {
    it('parses valid HTTP examples', () => {
      expect(parseCreateSessionRequest(examples.http.createSessionRequest).ok).toBe(true);
      expect(parseCreateSessionResponse(examples.http.createSessionResponse).ok).toBe(true);
      expect(parseVerifyResponse(examples.http.verifyResponse).ok).toBe(true);
      expect(parseErrorResponse(examples.http.errorResponse).ok).toBe(true);
    });

    it('generates per-field negatives for CreateSessionRequest', () => {
      const base = examples.http.createSessionRequest;
      // missing required fields
      for (const k of Object.keys(base)) {
        if (k === 'challengeToken') continue; // optional
        const copy = { ...base };
        delete copy[k as keyof typeof copy];
        expect(parseCreateSessionRequest(copy).ok, `missing ${k} must fail`).toBe(false);
      }

      // blobBytes boundary
      expect(parseCreateSessionRequest({ ...base, blobBytes: 0 }).ok).toBe(false);
      expect(parseCreateSessionRequest({ ...base, blobBytes: 1 }).ok).toBe(true);
      expect(parseCreateSessionRequest({ ...base, blobBytes: MAX_BLOB_BYTES }).ok).toBe(true);
      expect(parseCreateSessionRequest({ ...base, blobBytes: MAX_BLOB_BYTES + 1 }).ok).toBe(false);
    });

    it('generates per-field negatives for CreateSessionResponse', () => {
      const base = examples.http.createSessionResponse;
      expect(parseCreateSessionResponse({ ...base, sessionId: 'bad' }).ok).toBe(false);
      expect(parseCreateSessionResponse({ ...base, ownerToken: 'bad' }).ok).toBe(false);
      expect(
        parseCreateSessionResponse({ ...base, limits: { ...base.limits, maxBlobBytes: 0 } }).ok,
      ).toBe(false);
    });

    it('validates isSessionId, isToken32, and isVerifyId', () => {
      expect(isSessionId(examples.ids.sessionId)).toBe(true);
      expect(isToken32(examples.http.createSessionResponse.ownerToken)).toBe(true);
      expect(isVerifyId(examples.ids.verifyId)).toBe(true);

      // Bad length
      expect(isSessionId('AAECAwQFBgcICQoLDA0O')).toBe(false);
      expect(isToken32('u7u7u7u7')).toBe(false);
      expect(isVerifyId('Dw4NDAsK')).toBe(false);

      // Non-base64url characters
      expect(isSessionId(examples.ids.sessionId.slice(0, -1) + '!')).toBe(false);
      expect(isToken32(examples.http.createSessionResponse.ownerToken.slice(0, -1) + '+')).toBe(
        false,
      );
      expect(isVerifyId(examples.ids.verifyId.slice(0, -1) + '/')).toBe(false);

      // Non-strings
      expect(isSessionId(12345)).toBe(false);
      expect(isToken32(null)).toBe(false);
      expect(isVerifyId({})).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Item 12: Never throws (fuzz test)
  // --------------------------------------------------------------------------
  describe('Item 12: Never throws (fuzz)', () => {
    it('feeds each parser at least 5000 fuzzed inputs without throwing and verifies round-trips', () => {
      const seed = 0xdeadbeef ^ Date.now();
      const rand = createPrng(seed);

      const allValidExamples = [
        ...Object.values(examples.shopToRelay),
        ...Object.values(examples.relayToShop),
        ...Object.values(examples.ownerToRelay),
        ...Object.values(examples.relayToOwner),
      ];

      const parsers = [
        {
          name: 'parseShopToRelay',
          parse: parseShopToRelay,
          serialize: serializeShopToRelay as (m: unknown) => string,
        },
        {
          name: 'parseRelayToShop',
          parse: parseRelayToShop,
          serialize: serializeRelayToShop as (m: unknown) => string,
        },
        {
          name: 'parseOwnerToRelay',
          parse: parseOwnerToRelay,
          serialize: serializeOwnerToRelay as (m: unknown) => string,
        },
        {
          name: 'parseRelayToOwner',
          parse: parseRelayToOwner,
          serialize: serializeRelayToOwner as (m: unknown) => string,
        },
      ];

      const iterationsPerParser = 5000;
      const decoder = new TextDecoder('utf-8', { fatal: false });

      for (const { name, parse, serialize } of parsers) {
        for (let i = 0; i < iterationsPerParser; i++) {
          let testInput = '';
          const mode = Math.floor(rand() * 5);

          try {
            if (mode === 0) {
              // 1. Random ASCII / unicode string
              const len = Math.floor(rand() * 200);
              const chars: string[] = [];
              for (let c = 0; c < len; c++) {
                chars.push(String.fromCharCode(Math.floor(rand() * 65536)));
              }
              testInput = chars.join('');
            } else if (mode === 1) {
              // 2. Random bytes decoded as text
              const byteLen = Math.floor(rand() * 200);
              const bytes = new Uint8Array(byteLen);
              for (let b = 0; b < byteLen; b++) {
                bytes[b] = Math.floor(rand() * 256);
              }
              testInput = decoder.decode(bytes);
            } else if (mode === 2) {
              // 3. Valid example with random single-character mutation
              const example = allValidExamples[Math.floor(rand() * allValidExamples.length)];
              const json = JSON.stringify(example);
              if (json.length > 0) {
                const pos = Math.floor(rand() * json.length);
                const mutType = Math.floor(rand() * 3);
                if (mutType === 0) {
                  // replace
                  const ch = String.fromCharCode(Math.floor(rand() * 128));
                  testInput = json.slice(0, pos) + ch + json.slice(pos + 1);
                } else if (mutType === 1) {
                  // delete
                  testInput = json.slice(0, pos) + json.slice(pos + 1);
                } else {
                  // insert
                  const ch = String.fromCharCode(Math.floor(rand() * 128));
                  testInput = json.slice(0, pos) + ch + json.slice(pos);
                }
              } else {
                testInput = '';
              }
            } else if (mode === 3) {
              // 4. Truncated example
              const example = allValidExamples[Math.floor(rand() * allValidExamples.length)];
              const json = JSON.stringify(example);
              const cut = Math.floor(rand() * json.length);
              testInput = json.slice(0, cut);
            } else {
              // 5. Valid example with random field mutated or deleted
              const example = allValidExamples[
                Math.floor(rand() * allValidExamples.length)
              ] as Record<string, unknown>;
              const copy = { ...example };
              const keys = Object.keys(copy);
              if (keys.length > 0) {
                const k = keys[Math.floor(rand() * keys.length)]!;
                if (rand() < 0.5) {
                  delete copy[k];
                } else {
                  copy[k] = rand() < 0.5 ? null : 999999;
                }
              }
              testInput = JSON.stringify(copy);
            }

            const result = parse(testInput);
            expect(typeof result).toBe('object');
            expect(result).not.toBeNull();
            expect(typeof result.ok).toBe('boolean');

            // If a mutated input unexpectedly parsed as ok: true, it must strictly round-trip
            if (result.ok) {
              const reserialized = serialize(result.msg);
              const roundTrip = parse(reserialized);
              expect(roundTrip.ok).toBe(true);
              if (roundTrip.ok) {
                expect(roundTrip.msg).toEqual(result.msg);
              }
            }
          } catch (err) {
            // Print the PRNG seed on any failure as required
            console.error(`Fuzz test failed in ${name} at iteration ${i} with seed: ${seed}`);
            throw err;
          }
        }
      }
    });
  });

  // --------------------------------------------------------------------------
  // Item 13: Serializers
  // --------------------------------------------------------------------------
  describe('Item 13: Serializers', () => {
    it('throws ProtocolError on invalid input', () => {
      // Invalid version
      // @ts-expect-error testing invalid input
      expect(() => serializeShopToRelay({ ...examples.shopToRelay.hb, v: 2 })).toThrow(
        ProtocolError,
      );

      // Invalid seq
      // @ts-expect-error testing invalid input
      expect(() => serializeShopToRelay({ ...examples.shopToRelay.hb, seq: -1 })).toThrow(
        ProtocolError,
      );

      // Missing field
      const missing = { ...examples.shopToRelay.rendered };
      // @ts-expect-error testing invalid input
      delete missing.pageCount;
      // @ts-expect-error testing invalid input
      expect(() => serializeShopToRelay(missing)).toThrow(ProtocolError);

      // Extra field
      expect(() =>
        // @ts-expect-error testing invalid input
        serializeRelayToShop({ ...examples.relayToShop.denied, extra: 'forbidden' }),
      ).toThrow(ProtocolError);

      // Wrong type
      expect(() =>
        // @ts-expect-error testing invalid input
        serializeOwnerToRelay({ ...examples.ownerToRelay.deny, reqId: 12345 }),
      ).toThrow(ProtocolError);

      // Thrown error has code BAD_MESSAGE
      try {
        // @ts-expect-error testing invalid input
        serializeRelayToOwner({ ...examples.relayToOwner.status, printsDone: 99999 });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(ProtocolError);
        expect((err as ProtocolError).code).toBe('BAD_MESSAGE');
      }
    });

    it('throws ProtocolError with code TOO_LARGE if message exceeds max frame size', () => {
      const validMsg = examples.shopToRelay.hello as ShopToRelay;
      // Call serializer with a maxBytes limit smaller than the serialized message
      try {
        serializeShopToRelay(validMsg, 20);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(ProtocolError);
        expect((err as ProtocolError).code).toBe('TOO_LARGE');
      }
    });
  });

  // --------------------------------------------------------------------------
  // Item 14: Tree-shaking
  // --------------------------------------------------------------------------
  describe('Item 14: Tree-shaking', () => {
    it('bundles shop viewer subset without pulling owner or location code and satisfies gzip size', async () => {
      const entryCode = `
        import { parseRelayToShop, serializeShopToRelay } from "./src/index.ts";
        export { parseRelayToShop, serializeShopToRelay };
      `;

      const result = await esbuild.build({
        stdin: {
          contents: entryCode,
          resolveDir: path.resolve(process.cwd(), 'packages/protocol'),
          loader: 'ts',
        },
        bundle: true,
        minify: true,
        format: 'esm',
        target: 'es2018',
        write: false,
      });

      expect(result.outputFiles).toBeDefined();
      expect(result.outputFiles!.length).toBeGreaterThan(0);

      const bundledText = result.outputFiles![0]!.text;

      // Assert tree-shaking drops unused direction code
      expect(bundledText).not.toContain('approxLocation');
      expect(bundledText).not.toContain('parseOwnerToRelay');

      // Assert gzip size is under 8192 bytes
      const gzipped = zlib.gzipSync(result.outputFiles![0]!.contents);
      const measuredGzipSize = gzipped.length;
      console.log(
        `Measured shop bundle size: ${bundledText.length} bytes (gzipped: ${measuredGzipSize} bytes)`,
      );

      expect(measuredGzipSize).toBeLessThan(8192);
    });
  });
});
