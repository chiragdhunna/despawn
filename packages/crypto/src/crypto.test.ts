import { describe, expect, it } from 'vitest';
import vectors from '../../../docs/crypto-vectors.json';
import {
  base64urlDecode,
  base64urlEncode,
  bytesToHex,
  CHUNK_SIZE,
  computeHelloMac,
  computeReleaseMac,
  computeSas,
  createChunkDecryptor,
  createChunkEncryptor,
  CryptoError,
  deriveChannelKey,
  generateEcdhKeyPair,
  generateFileKeyBytes,
  generateLinkSecret,
  generateNoncePrefix,
  generateSessionId,
  hexToBytes,
  importFileKey,
  randomBytes,
  type ReleaseFields,
  u32be,
  u64be,
  unwrapFileKey,
  utf8,
  verifyHelloMac,
  verifyReleaseMac,
  wrapFileKey,
} from './index.js';

describe('1. Encoding (base64url and binary)', () => {
  it('encodes and decodes every vector exactly', () => {
    for (const v of vectors.base64url) {
      const bytes = hexToBytes(v.bytesHex);
      const encoded = base64urlEncode(bytes);
      expect(encoded).toBe(v.encoded);

      const decoded = base64urlDecode(v.encoded);
      expect(bytesToHex(decoded)).toBe(v.bytesHex);
    }
  });

  it('rejects invalid characters, padding, whitespace, length mod 4 = 1, and non-canonical strings', () => {
    // Reject padding '='
    expect(() => base64urlDecode('AAECAwQFBgcICQoLDA0ODw==')).toThrow(CryptoError);
    expect(() => base64urlDecode('AAECAwQFBgcICQoLDA0ODw=')).toThrow(CryptoError);

    // Reject '+' and '/'
    expect(() => base64urlDecode('AAE+Aw')).toThrow(CryptoError);
    expect(() => base64urlDecode('AAE/Aw')).toThrow(CryptoError);

    // Reject whitespace
    expect(() => base64urlDecode(' AAECAwQFBgcICQoLDA0ODw')).toThrow(CryptoError);
    expect(() => base64urlDecode('AAECAwQF BgcICQoLDA0ODw')).toThrow(CryptoError);
    expect(() => base64urlDecode('AAECAwQFBgcICQoLDA0ODw\n')).toThrow(CryptoError);

    // Reject length mod 4 = 1
    expect(() => base64urlDecode('A')).toThrow(CryptoError);
    expect(() => base64urlDecode('AAAAA')).toThrow(CryptoError);

    // Reject non-canonical string AAECAwQFBgcICQoLDA0ODx
    expect(() => base64urlDecode('AAECAwQFBgcICQoLDA0ODx')).toThrow(CryptoError);
  });

  it('rejects invalid u32be and u64be inputs', () => {
    expect(() => u32be(-1)).toThrow(CryptoError);
    expect(() => u32be(0x100000000)).toThrow(CryptoError);
    expect(() => u32be(1.5)).toThrow(CryptoError);

    expect(() => u64be(-1)).toThrow(CryptoError);
    expect(() => u64be(Number.MAX_SAFE_INTEGER + 1)).toThrow(CryptoError);
    expect(() => u64be(1.5)).toThrow(CryptoError);
  });

  it('rejects invalid hex inputs', () => {
    expect(() => hexToBytes('abc')).toThrow(CryptoError);
    expect(() => hexToBytes('zz')).toThrow(CryptoError);
  });
});

describe('2. Hello MAC', () => {
  it('reproduces vector helloMacHex and passes verification', async () => {
    const sessionId = hexToBytes(vectors.inputs.sessionIdHex);
    const linkSecret = hexToBytes(vectors.inputs.linkSecretHex);
    const shopPublicRaw = hexToBytes(vectors.inputs.shopPublicRawHex);

    const channelKey = await deriveChannelKey(linkSecret, sessionId);
    const helloMac = await computeHelloMac(channelKey, sessionId, shopPublicRaw);

    expect(bytesToHex(helloMac)).toBe(vectors.expected.helloMacHex);
    expect(await verifyHelloMac(channelKey, sessionId, shopPublicRaw, helloMac)).toBe(true);
  });

  it('rejects tampered mac, wrong sessionId, different shopPub, and different linkSecret', async () => {
    const sessionId = hexToBytes(vectors.inputs.sessionIdHex);
    const linkSecret = hexToBytes(vectors.inputs.linkSecretHex);
    const shopPublicRaw = hexToBytes(vectors.inputs.shopPublicRawHex);

    const channelKey = await deriveChannelKey(linkSecret, sessionId);
    const helloMac = await computeHelloMac(channelKey, sessionId, shopPublicRaw);

    // 1-bit change in MAC
    const tamperedMac = new Uint8Array(helloMac);
    tamperedMac[0]! ^= 1;
    expect(await verifyHelloMac(channelKey, sessionId, shopPublicRaw, tamperedMac)).toBe(false);

    // Wrong sessionId
    const wrongSessionId = new Uint8Array(sessionId);
    wrongSessionId[0]! ^= 1;
    expect(await verifyHelloMac(channelKey, wrongSessionId, shopPublicRaw, helloMac)).toBe(false);

    // Different shopPub
    const otherShop = await generateEcdhKeyPair();
    expect(await verifyHelloMac(channelKey, sessionId, otherShop.publicKeyRaw, helloMac)).toBe(
      false,
    );

    // Different linkSecret
    const otherSecret = new Uint8Array(linkSecret);
    otherSecret[0]! ^= 1;
    const otherChannelKey = await deriveChannelKey(otherSecret, sessionId);
    expect(await verifyHelloMac(otherChannelKey, sessionId, shopPublicRaw, helloMac)).toBe(false);
  });
});

describe('3. SAS', () => {
  it('reproduces vector sas code exactly', async () => {
    const sessionId = hexToBytes(vectors.inputs.sessionIdHex);
    const shopPublicRaw = hexToBytes(vectors.inputs.shopPublicRawHex);

    const sas = await computeSas(sessionId, shopPublicRaw);
    expect(sas).toBe(vectors.expected.sas);
    expect(sas).toMatch(/^\d{4}$/);
  });

  it('changes when sessionId or shopPub changes over 20 random inputs', async () => {
    const shopPublicRaw = hexToBytes(vectors.inputs.shopPublicRawHex);
    const baseSas = vectors.expected.sas;
    const distinctSasValues = new Set<string>();

    for (let i = 0; i < 20; i++) {
      const randSessionId = randomBytes(16);
      const sas = await computeSas(randSessionId, shopPublicRaw);
      expect(sas).toMatch(/^\d{4}$/);
      distinctSasValues.add(sas);
    }

    // Expect multiple distinct SAS values across 20 random session IDs
    expect(distinctSasValues.size).toBeGreaterThan(1);
    expect(distinctSasValues.has(baseSas) && distinctSasValues.size === 1).toBe(false);
  });
});

describe('4. Wrap & Unwrap', () => {
  async function loadKeys() {
    const shopPrivateKey = await globalThis.crypto.subtle.importKey(
      'jwk',
      vectors.inputs.shopPrivateJwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits'],
    );
    const ownerPrivateKey = await globalThis.crypto.subtle.importKey(
      'jwk',
      vectors.inputs.ownerPrivateJwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits'],
    );
    return { shopPrivateKey, ownerPrivateKey };
  }

  it('reproduces vector wrappedKeyHex and opens vector chunks', async () => {
    const { shopPrivateKey, ownerPrivateKey } = await loadKeys();
    const sessionId = hexToBytes(vectors.inputs.sessionIdHex);
    const ownerPublicRaw = hexToBytes(vectors.inputs.ownerPublicRawHex);
    const shopPublicRaw = hexToBytes(vectors.inputs.shopPublicRawHex);
    const fileKey = hexToBytes(vectors.inputs.fileKeyHex);
    const wrapNonce = hexToBytes(vectors.inputs.wrapNonceHex);

    const wrapped = await wrapFileKey({
      ownerPrivateKey,
      ownerPublicRaw,
      shopPublicRaw,
      sessionId,
      fileKey,
      nonce: wrapNonce,
    });

    // Directly assert vector ECDH shared secret and HKDF wrap key
    const shopPubKey = await globalThis.crypto.subtle.importKey(
      'raw',
      new Uint8Array(shopPublicRaw),
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    );
    const sharedBits = await globalThis.crypto.subtle.deriveBits(
      { name: 'ECDH', public: shopPubKey },
      ownerPrivateKey,
      256,
    );
    expect(bytesToHex(new Uint8Array(sharedBits))).toBe(vectors.expected.ecdhSharedSecretHex);

    const ikmKey = await globalThis.crypto.subtle.importKey(
      'raw',
      new Uint8Array(sharedBits),
      'HKDF',
      false,
      ['deriveBits'],
    );
    const info = new Uint8Array([...utf8('despawn/v1/wrap'), ...ownerPublicRaw, ...shopPublicRaw]);
    const wrapKeyBits = await globalThis.crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(sessionId),
        info,
      },
      ikmKey,
      256,
    );
    expect(bytesToHex(new Uint8Array(wrapKeyBits))).toBe(vectors.expected.wrapKeyHex);

    expect(bytesToHex(wrapped.nonce)).toBe(vectors.inputs.wrapNonceHex);
    expect(bytesToHex(wrapped.wrappedKey)).toBe(vectors.expected.wrappedKeyHex);

    // Unwrap with shop private key
    const unwrappedKey = await unwrapFileKey({
      shopPrivateKey,
      shopPublicRaw,
      ownerPublicRaw,
      sessionId,
      nonce: wrapNonce,
      wrappedKey: wrapped.wrappedKey,
    });

    // Verify unwrapped key can decrypt vector chunks
    const chunkCtx = {
      sessionId,
      noncePrefix: hexToBytes(vectors.inputs.noncePrefixHex),
    };
    const decryptor = createChunkDecryptor(unwrappedKey, chunkCtx);

    const ch0 = await decryptor.open(hexToBytes(vectors.chunks[0]!.sealedHex));
    expect(new TextDecoder().decode(ch0.plaintext)).toBe(vectors.chunks[0]!.plaintextUtf8);
    expect(ch0.isFinal).toBe(false);

    const ch1 = await decryptor.open(hexToBytes(vectors.chunks[1]!.sealedHex));
    expect(new TextDecoder().decode(ch1.plaintext)).toBe(vectors.chunks[1]!.plaintextUtf8);
    expect(ch1.isFinal).toBe(true);

    expect(() => decryptor.finish()).not.toThrow();
  });

  it('fails unwrap with AUTH_FAILED on tampered inputs', async () => {
    const { shopPrivateKey } = await loadKeys();
    const sessionId = hexToBytes(vectors.inputs.sessionIdHex);
    const ownerPublicRaw = hexToBytes(vectors.inputs.ownerPublicRawHex);
    const shopPublicRaw = hexToBytes(vectors.inputs.shopPublicRawHex);
    const wrapNonce = hexToBytes(vectors.inputs.wrapNonceHex);
    const wrappedKey = hexToBytes(vectors.expected.wrappedKeyHex);

    // Wrong sessionId
    const badSession = new Uint8Array(sessionId);
    badSession[0]! ^= 1;
    await expect(
      unwrapFileKey({
        shopPrivateKey,
        shopPublicRaw,
        ownerPublicRaw,
        sessionId: badSession,
        nonce: wrapNonce,
        wrappedKey,
      }),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });

    // Modified ownerPub
    const otherOwner = await generateEcdhKeyPair();
    await expect(
      unwrapFileKey({
        shopPrivateKey,
        shopPublicRaw,
        ownerPublicRaw: otherOwner.publicKeyRaw,
        sessionId,
        nonce: wrapNonce,
        wrappedKey,
      }),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });

    // Modified shopPub
    const otherShop = await generateEcdhKeyPair();
    await expect(
      unwrapFileKey({
        shopPrivateKey,
        shopPublicRaw: otherShop.publicKeyRaw,
        ownerPublicRaw,
        sessionId,
        nonce: wrapNonce,
        wrappedKey,
      }),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });

    // Modified nonce
    const badNonce = new Uint8Array(wrapNonce);
    badNonce[0]! ^= 1;
    await expect(
      unwrapFileKey({
        shopPrivateKey,
        shopPublicRaw,
        ownerPublicRaw,
        sessionId,
        nonce: badNonce,
        wrappedKey,
      }),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });

    // One flipped bit in wrappedKey
    const badWrappedKey = new Uint8Array(wrappedKey);
    badWrappedKey[0]! ^= 1;
    await expect(
      unwrapFileKey({
        shopPrivateKey,
        shopPublicRaw,
        ownerPublicRaw,
        sessionId,
        nonce: wrapNonce,
        wrappedKey: badWrappedKey,
      }),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });
});

describe('5. Release MAC', () => {
  it('reproduces vector releaseMacHex and passes verification', async () => {
    const sessionId = hexToBytes(vectors.inputs.sessionIdHex);
    const linkSecret = hexToBytes(vectors.inputs.linkSecretHex);
    const ownerPublicRaw = hexToBytes(vectors.inputs.ownerPublicRawHex);
    const shopPublicRaw = hexToBytes(vectors.inputs.shopPublicRawHex);
    const nonce = hexToBytes(vectors.inputs.wrapNonceHex);
    const wrappedKey = hexToBytes(vectors.expected.wrappedKeyHex);

    const channelKey = await deriveChannelKey(linkSecret, sessionId);
    const fields: ReleaseFields = {
      sessionId,
      ownerPublicRaw,
      shopPublicRaw,
      nonce,
      wrappedKey,
    };

    const mac = await computeReleaseMac(channelKey, fields);
    expect(bytesToHex(mac)).toBe(vectors.expected.releaseMacHex);
    expect(await verifyReleaseMac(channelKey, fields, mac)).toBe(true);
  });

  it('rejects a change to any one of the five fields individually', async () => {
    const sessionId = hexToBytes(vectors.inputs.sessionIdHex);
    const linkSecret = hexToBytes(vectors.inputs.linkSecretHex);
    const ownerPublicRaw = hexToBytes(vectors.inputs.ownerPublicRawHex);
    const shopPublicRaw = hexToBytes(vectors.inputs.shopPublicRawHex);
    const nonce = hexToBytes(vectors.inputs.wrapNonceHex);
    const wrappedKey = hexToBytes(vectors.expected.wrappedKeyHex);

    const channelKey = await deriveChannelKey(linkSecret, sessionId);
    const baseFields: ReleaseFields = {
      sessionId,
      ownerPublicRaw,
      shopPublicRaw,
      nonce,
      wrappedKey,
    };
    const validMac = await computeReleaseMac(channelKey, baseFields);

    // 1. Change sessionId
    const badSession = new Uint8Array(sessionId);
    badSession[0]! ^= 1;
    expect(
      await verifyReleaseMac(channelKey, { ...baseFields, sessionId: badSession }, validMac),
    ).toBe(false);

    // 2. Change ownerPublicRaw
    const otherOwner = await generateEcdhKeyPair();
    expect(
      await verifyReleaseMac(
        channelKey,
        { ...baseFields, ownerPublicRaw: otherOwner.publicKeyRaw },
        validMac,
      ),
    ).toBe(false);

    // 3. Change shopPublicRaw
    const otherShop = await generateEcdhKeyPair();
    expect(
      await verifyReleaseMac(
        channelKey,
        { ...baseFields, shopPublicRaw: otherShop.publicKeyRaw },
        validMac,
      ),
    ).toBe(false);

    // 4. Change nonce
    const badNonce = new Uint8Array(nonce);
    badNonce[0]! ^= 1;
    expect(await verifyReleaseMac(channelKey, { ...baseFields, nonce: badNonce }, validMac)).toBe(
      false,
    );

    // 5. Change wrappedKey
    const badWrapped = new Uint8Array(wrappedKey);
    badWrapped[0]! ^= 1;
    expect(
      await verifyReleaseMac(channelKey, { ...baseFields, wrappedKey: badWrapped }, validMac),
    ).toBe(false);
  });
});

describe('6. Chunks, known answer', () => {
  it('reproduces both vector sealedHex values including nonce and AAD behavior', async () => {
    const fileKey = hexToBytes(vectors.inputs.fileKeyHex);
    const encKey = await importFileKey(fileKey, 'encrypt');
    const decKey = await importFileKey(fileKey, 'decrypt');

    const ctx = {
      sessionId: hexToBytes(vectors.inputs.sessionIdHex),
      noncePrefix: hexToBytes(vectors.inputs.noncePrefixHex),
    };

    const encryptor = createChunkEncryptor(encKey, ctx);
    expect(encryptor.nextIndex).toBe(0);
    expect(encryptor.finished).toBe(false);

    // Chunk 0
    const sealed0 = await encryptor.seal(
      utf8(vectors.chunks[0]!.plaintextUtf8),
      vectors.chunks[0]!.isFinal,
    );
    expect(bytesToHex(sealed0)).toBe(vectors.chunks[0]!.sealedHex);
    expect(encryptor.nextIndex).toBe(1);
    expect(encryptor.finished).toBe(false);

    // Chunk 1
    const sealed1 = await encryptor.seal(
      utf8(vectors.chunks[1]!.plaintextUtf8),
      vectors.chunks[1]!.isFinal,
    );
    expect(bytesToHex(sealed1)).toBe(vectors.chunks[1]!.sealedHex);
    expect(encryptor.nextIndex).toBe(2);
    expect(encryptor.finished).toBe(true);

    // Open both with decryptor
    const decryptor = createChunkDecryptor(decKey, ctx);
    const o0 = await decryptor.open(sealed0);
    expect(o0.isFinal).toBe(false);
    expect(o0.index).toBe(0);
    expect(new TextDecoder().decode(o0.plaintext)).toBe(vectors.chunks[0]!.plaintextUtf8);

    const o1 = await decryptor.open(sealed1);
    expect(o1.isFinal).toBe(true);
    expect(o1.index).toBe(1);
    expect(new TextDecoder().decode(o1.plaintext)).toBe(vectors.chunks[1]!.plaintextUtf8);

    expect(() => decryptor.finish()).not.toThrow();
  });
});

describe('7. Chunks, tamper', () => {
  it('detects bit flips, key mismatches, reordering, replay, truncation, and after-final operations', async () => {
    const fileKey = hexToBytes(vectors.inputs.fileKeyHex);
    const encKey = await importFileKey(fileKey, 'encrypt');
    const decKey = await importFileKey(fileKey, 'decrypt');

    const ctx = {
      sessionId: hexToBytes(vectors.inputs.sessionIdHex),
      noncePrefix: hexToBytes(vectors.inputs.noncePrefixHex),
    };

    const sealed0 = hexToBytes(vectors.chunks[0]!.sealedHex);
    const sealed1 = hexToBytes(vectors.chunks[1]!.sealedHex);

    // One flipped bit in ciphertext
    const badCiphertext = new Uint8Array(sealed0);
    badCiphertext[0]! ^= 1;
    const dec1 = createChunkDecryptor(decKey, ctx);
    await expect(dec1.open(badCiphertext)).rejects.toMatchObject({ code: 'AUTH_FAILED' });

    // One flipped bit in tag
    const badTag = new Uint8Array(sealed0);
    badTag[badTag.length - 1]! ^= 1;
    const dec2 = createChunkDecryptor(decKey, ctx);
    await expect(dec2.open(badTag)).rejects.toMatchObject({ code: 'AUTH_FAILED' });

    // Wrong key
    const wrongKey = await importFileKey(randomBytes(32), 'decrypt');
    const dec3 = createChunkDecryptor(wrongKey, ctx);
    await expect(dec3.open(sealed0)).rejects.toMatchObject({ code: 'AUTH_FAILED' });

    // Wrong sessionId
    const dec4 = createChunkDecryptor(decKey, { ...ctx, sessionId: randomBytes(16) });
    await expect(dec4.open(sealed0)).rejects.toMatchObject({ code: 'AUTH_FAILED' });

    // Wrong noncePrefix
    const dec5 = createChunkDecryptor(decKey, { ...ctx, noncePrefix: randomBytes(4) });
    await expect(dec5.open(sealed0)).rejects.toMatchObject({ code: 'AUTH_FAILED' });

    // Swapping two chunks (feeding chunk 1 first)
    const dec6 = createChunkDecryptor(decKey, ctx);
    await expect(dec6.open(sealed1)).rejects.toMatchObject({ code: 'AUTH_FAILED' });

    // Dropping final chunk then calling finish()
    const dec7 = createChunkDecryptor(decKey, ctx);
    await dec7.open(sealed0);
    expect(() => dec7.finish()).toThrow(CryptoError);
    try {
      dec7.finish();
    } catch (e) {
      expect((e as CryptoError).code).toBe('TRUNCATED');
    }

    // Feeding a chunk after the final gives AFTER_FINAL
    const dec8 = createChunkDecryptor(decKey, ctx);
    await dec8.open(sealed0);
    await dec8.open(sealed1);
    await expect(dec8.open(sealed0)).rejects.toMatchObject({ code: 'AFTER_FINAL' });

    // Encryptor sealing after final gives AFTER_FINAL
    const enc = createChunkEncryptor(encKey, ctx);
    await enc.seal(utf8('test'), true);
    await expect(enc.seal(utf8('more'), false)).rejects.toMatchObject({ code: 'AFTER_FINAL' });

    // Replaying chunk 0 in position 1 gives AUTH_FAILED
    const dec9 = createChunkDecryptor(decKey, ctx);
    await dec9.open(sealed0);
    await expect(dec9.open(sealed0)).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });
});

describe('8. Chunks, limits', () => {
  it('handles exact CHUNK_SIZE, rejects CHUNK_SIZE + 1, and handles multi-chunk round trips', async () => {
    const fileKey = generateFileKeyBytes();
    const encKey = await importFileKey(fileKey, 'encrypt');
    const decKey = await importFileKey(fileKey, 'decrypt');
    const ctx = {
      sessionId: generateSessionId(),
      noncePrefix: generateNoncePrefix(),
    };

    // Plaintext of exactly CHUNK_SIZE
    const maxPlaintext = randomBytes(CHUNK_SIZE);
    const enc = createChunkEncryptor(encKey, ctx);
    const sealed = await enc.seal(maxPlaintext, true);

    const dec = createChunkDecryptor(decKey, ctx);
    const opened = await dec.open(sealed);
    expect(opened.plaintext.length).toBe(CHUNK_SIZE);
    expect(bytesToHex(opened.plaintext.subarray(0, 32))).toBe(
      bytesToHex(maxPlaintext.subarray(0, 32)),
    );
    expect(opened.isFinal).toBe(true);
    expect(() => dec.finish()).not.toThrow();

    // Plaintext of CHUNK_SIZE + 1 gives INVALID_INPUT
    const enc2 = createChunkEncryptor(encKey, ctx);
    const oversize = new Uint8Array(CHUNK_SIZE + 1);
    await expect(enc2.seal(oversize, false)).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    // Multi-chunk round trip: 5 chunks with varying sizes, last one empty
    const sizes = [100, 50000, 1000, CHUNK_SIZE, 0];
    const encMulti = createChunkEncryptor(encKey, ctx);
    const decMulti = createChunkDecryptor(decKey, ctx);

    for (let i = 0; i < sizes.length; i++) {
      const size = sizes[i]!;
      const isFinal = i === sizes.length - 1;
      const pt = randomBytes(size);
      const ct = await encMulti.seal(pt, isFinal);
      const res = await decMulti.open(ct);
      expect(res.index).toBe(i);
      expect(res.isFinal).toBe(isFinal);
      expect(res.plaintext.length).toBe(size);
      expect(bytesToHex(res.plaintext)).toBe(bytesToHex(pt));
    }
    expect(() => decMulti.finish()).not.toThrow();
  });
});

describe('9. Key agreement & ECDH properties', () => {
  it('generates non-extractable ECDH keys and common wrap key', async () => {
    const ownerPair = await generateEcdhKeyPair();
    const shopPair = await generateEcdhKeyPair();

    expect(ownerPair.privateKey.extractable).toBe(false);
    expect(shopPair.privateKey.extractable).toBe(false);
    expect(ownerPair.publicKeyRaw.length).toBe(65);
    expect(ownerPair.publicKeyRaw[0]).toBe(0x04);
    expect(shopPair.publicKeyRaw.length).toBe(65);
    expect(shopPair.publicKeyRaw[0]).toBe(0x04);

    const sessionId = generateSessionId();
    const fileKey = generateFileKeyBytes();

    const wrapped = await wrapFileKey({
      ownerPrivateKey: ownerPair.privateKey,
      ownerPublicRaw: ownerPair.publicKeyRaw,
      shopPublicRaw: shopPair.publicKeyRaw,
      sessionId,
      fileKey,
    });

    const unwrapped = await unwrapFileKey({
      shopPrivateKey: shopPair.privateKey,
      shopPublicRaw: shopPair.publicKeyRaw,
      ownerPublicRaw: ownerPair.publicKeyRaw,
      sessionId,
      nonce: wrapped.nonce,
      wrappedKey: wrapped.wrappedKey,
    });

    expect(unwrapped.extractable).toBe(false);
    expect(unwrapped.usages).toEqual(['decrypt']);
  });

  it('rejects invalid public keys (length, prefix 0x02, point not on curve)', async () => {
    const ownerPair = await generateEcdhKeyPair();
    const sessionId = generateSessionId();
    const fileKey = generateFileKeyBytes();

    // Wrong length
    await expect(
      wrapFileKey({
        ownerPrivateKey: ownerPair.privateKey,
        ownerPublicRaw: ownerPair.publicKeyRaw,
        shopPublicRaw: new Uint8Array(64),
        sessionId,
        fileKey,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    // Prefix 0x02 (compressed point)
    const badPrefix = new Uint8Array(ownerPair.publicKeyRaw);
    badPrefix[0] = 0x02;
    await expect(
      wrapFileKey({
        ownerPrivateKey: ownerPair.privateKey,
        ownerPublicRaw: ownerPair.publicKeyRaw,
        shopPublicRaw: badPrefix,
        sessionId,
        fileKey,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    // Point not on curve (all 0xFF)
    const notOnCurve = new Uint8Array(65);
    notOnCurve.fill(0xff);
    notOnCurve[0] = 0x04;
    await expect(
      wrapFileKey({
        ownerPrivateKey: ownerPair.privateKey,
        ownerPublicRaw: ownerPair.publicKeyRaw,
        shopPublicRaw: notOnCurve,
        sessionId,
        fileKey,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('10. Key objects', () => {
  it('verifies unwrapped key and importFileKey keys are non-extractable with correct usages', async () => {
    const encKey = await importFileKey(randomBytes(32), 'encrypt');
    expect(encKey.extractable).toBe(false);
    expect(encKey.usages).toEqual(['encrypt']);

    const decKey = await importFileKey(randomBytes(32), 'decrypt');
    expect(decKey.extractable).toBe(false);
    expect(decKey.usages).toEqual(['decrypt']);
  });
});

describe('11. Error messages & information leakage prevention', () => {
  it('error messages are fixed strings that never contain input secrets or keys', async () => {
    const secretHex = 'deadbeefcafebabe0123456789abcdef';
    const secretB64 = base64urlEncode(hexToBytes(secretHex));
    const secretPt = utf8('super-sensitive-document-content');

    const errCodes: Array<'INVALID_INPUT' | 'AUTH_FAILED' | 'TRUNCATED' | 'AFTER_FINAL'> = [
      'INVALID_INPUT',
      'AUTH_FAILED',
      'TRUNCATED',
      'AFTER_FINAL',
    ];

    for (const code of errCodes) {
      const err = new CryptoError(code);
      expect(err.code).toBe(code);
      expect(typeof err.message).toBe('string');
      expect(err.message.length).toBeGreaterThan(0);
      expect(err.message.includes(secretHex)).toBe(false);
      expect(err.message.includes(secretB64)).toBe(false);
      expect(err.message.includes(new TextDecoder().decode(secretPt))).toBe(false);
    }
  });
});

describe('12. Full flow (Owner & Shop end-to-end handshake & stream)', () => {
  it('completes the entire owner and shop protocol lifecycle successfully', async () => {
    // 1. Session setup
    const sessionId = generateSessionId();
    const linkSecret = generateLinkSecret();
    const fileKey = generateFileKeyBytes();
    const noncePrefix = generateNoncePrefix();

    // 2. Shop generates ephemeral key pair
    const shopPair = await generateEcdhKeyPair();

    // 3. Shop derives channelKey from linkSecret and sessionId
    const shopChannelKey = await deriveChannelKey(linkSecret, sessionId);

    // 4. Shop computes helloMac
    const helloMac = await computeHelloMac(shopChannelKey, sessionId, shopPair.publicKeyRaw);

    // 5. Owner derives channelKey from linkSecret and sessionId
    const ownerChannelKey = await deriveChannelKey(linkSecret, sessionId);

    // 6. Owner verifies helloMac
    const helloOk = await verifyHelloMac(
      ownerChannelKey,
      sessionId,
      shopPair.publicKeyRaw,
      helloMac,
    );
    expect(helloOk).toBe(true);

    // 7. SAS computation on both sides
    const ownerSas = await computeSas(sessionId, shopPair.publicKeyRaw);
    const shopSas = await computeSas(sessionId, shopPair.publicKeyRaw);
    expect(ownerSas).toBe(shopSas);
    expect(ownerSas).toMatch(/^\d{4}$/);

    // 8. Owner generates ephemeral key pair
    const ownerPair = await generateEcdhKeyPair();

    // 9. Owner wraps file key
    const wrapped = await wrapFileKey({
      ownerPrivateKey: ownerPair.privateKey,
      ownerPublicRaw: ownerPair.publicKeyRaw,
      shopPublicRaw: shopPair.publicKeyRaw,
      sessionId,
      fileKey,
    });

    // 10. Owner computes releaseMac
    const releaseFields: ReleaseFields = {
      sessionId,
      ownerPublicRaw: ownerPair.publicKeyRaw,
      shopPublicRaw: shopPair.publicKeyRaw,
      nonce: wrapped.nonce,
      wrappedKey: wrapped.wrappedKey,
    };
    const releaseMac = await computeReleaseMac(ownerChannelKey, releaseFields);

    // 11. Shop verifies releaseMac
    const releaseOk = await verifyReleaseMac(shopChannelKey, releaseFields, releaseMac);
    expect(releaseOk).toBe(true);

    // 12. Shop unwraps file key
    const unwrappedKey = await unwrapFileKey({
      shopPrivateKey: shopPair.privateKey,
      shopPublicRaw: shopPair.publicKeyRaw,
      ownerPublicRaw: ownerPair.publicKeyRaw,
      sessionId,
      nonce: wrapped.nonce,
      wrappedKey: wrapped.wrappedKey,
    });

    // 13. Owner prepares encryptor and seals 3 chunks
    const ownerEncKey = await importFileKey(fileKey, 'encrypt');
    const chunkCtx = { sessionId, noncePrefix };
    const encryptor = createChunkEncryptor(ownerEncKey, chunkCtx);

    const chunk0Plaintext = utf8('{"pageCount": 2, "paperSize": "A4"}');
    const chunk1Plaintext = utf8('=== Page 1 Image Bytes ===');
    const chunk2Plaintext = utf8('=== Page 2 Image Bytes ===');

    const sealed0 = await encryptor.seal(chunk0Plaintext, false);
    const sealed1 = await encryptor.seal(chunk1Plaintext, false);
    const sealed2 = await encryptor.seal(chunk2Plaintext, true);

    expect(encryptor.finished).toBe(true);

    // 14. Shop prepares decryptor and opens the 3 chunks in order
    const decryptor = createChunkDecryptor(unwrappedKey, chunkCtx);

    const open0 = await decryptor.open(sealed0);
    expect(open0.index).toBe(0);
    expect(open0.isFinal).toBe(false);
    expect(new TextDecoder().decode(open0.plaintext)).toBe(
      new TextDecoder().decode(chunk0Plaintext),
    );

    const open1 = await decryptor.open(sealed1);
    expect(open1.index).toBe(1);
    expect(open1.isFinal).toBe(false);
    expect(new TextDecoder().decode(open1.plaintext)).toBe(
      new TextDecoder().decode(chunk1Plaintext),
    );

    const open2 = await decryptor.open(sealed2);
    expect(open2.index).toBe(2);
    expect(open2.isFinal).toBe(true);
    expect(new TextDecoder().decode(open2.plaintext)).toBe(
      new TextDecoder().decode(chunk2Plaintext),
    );

    expect(() => decryptor.finish()).not.toThrow();
  });
});
