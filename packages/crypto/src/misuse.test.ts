import { describe, expect, it } from 'vitest';
import {
  bytesToHex,
  CHUNK_SIZE,
  computeHelloMac,
  computeReleaseMac,
  createChunkDecryptor,
  createChunkEncryptor,
  CryptoError,
  generateEcdhKeyPair,
  generateFileKeyBytes,
  generateNoncePrefix,
  generateSessionId,
  importFileKey,
  randomBytes,
  utf8,
  verifyHelloMac,
  verifyReleaseMac,
  wrapFileKey,
  unwrapFileKey,
} from './index.js';

interface PromiseSettledResult<T> {
  status: 'fulfilled' | 'rejected';
  value?: T;
  reason?: unknown;
}

const promiseAllSettled = (
  Promise as unknown as {
    allSettled<T>(values: Promise<T>[]): Promise<PromiseSettledResult<T>[]>;
  }
).allSettled.bind(Promise);

describe('13. Misuse and concurrency', () => {
  it('4a: 50 un-awaited seals via Promise.all with sequential verification', async () => {
    const fileKey = generateFileKeyBytes();
    const encKey = await importFileKey(fileKey, 'encrypt');
    const decKey = await importFileKey(fileKey, 'decrypt');
    const ctx = {
      sessionId: generateSessionId(),
      noncePrefix: generateNoncePrefix(),
    };

    const encryptor = createChunkEncryptor(encKey, ctx);
    const plaintexts: Uint8Array[] = [];
    const sealPromises: Promise<Uint8Array>[] = [];

    for (let i = 0; i < 50; i++) {
      const pt = utf8(`chunk-payload-${i}`);
      plaintexts.push(pt);
      sealPromises.push(encryptor.seal(pt, i === 49));
    }

    const sealedChunks = await Promise.all(sealPromises);

    // Every sealed chunk must be distinct from every other
    const hexSet = new Set<string>();
    for (const chunk of sealedChunks) {
      hexSet.add(bytesToHex(chunk));
    }
    expect(hexSet.size).toBe(50);

    // Pass all 50 in order (0 through 49) into a fresh decryptor
    const decryptor = createChunkDecryptor(decKey, ctx);
    for (let i = 0; i < 50; i++) {
      const opened = await decryptor.open(sealedChunks[i]!);
      expect(opened.index).toBe(i);
      expect(opened.isFinal).toBe(i === 49);
      expect(bytesToHex(opened.plaintext)).toBe(bytesToHex(plaintexts[i]!));
    }

    expect(() => decryptor.finish()).not.toThrow();
    expect(encryptor.nextIndex).toBe(50);
    expect(encryptor.finished).toBe(true);
  });

  it('4b: Seal index assignment order for un-awaited calls', async () => {
    const fileKey = generateFileKeyBytes();
    const encKey = await importFileKey(fileKey, 'encrypt');
    const decKey = await importFileKey(fileKey, 'decrypt');
    const ctx = {
      sessionId: generateSessionId(),
      noncePrefix: generateNoncePrefix(),
    };

    const enc = createChunkEncryptor(encKey, ctx);
    const p0 = utf8('chunk 0 content');
    const p1 = utf8('chunk 1 content');

    const s0Promise = enc.seal(p0, false);
    const s1Promise = enc.seal(p1, false);
    const [s0, s1] = await Promise.all([s0Promise, s1Promise]);

    const dec = createChunkDecryptor(decKey, ctx);
    const r0 = await dec.open(s0);
    expect(r0.index).toBe(0);
    expect(bytesToHex(r0.plaintext)).toBe(bytesToHex(p0));

    const r1 = await dec.open(s1);
    expect(r1.index).toBe(1);
    expect(bytesToHex(r1.plaintext)).toBe(bytesToHex(p1));
  });

  it('4c: Decryptor queue rejects concurrent duplicate opens and fails closed', async () => {
    const fileKey = generateFileKeyBytes();
    const encKey = await importFileKey(fileKey, 'encrypt');
    const decKey = await importFileKey(fileKey, 'decrypt');
    const ctx = {
      sessionId: generateSessionId(),
      noncePrefix: generateNoncePrefix(),
    };

    const enc = createChunkEncryptor(encKey, ctx);
    const c0 = await enc.seal(utf8('payload 0'), false);

    const d = createChunkDecryptor(decKey, ctx);
    const results = await promiseAllSettled([d.open(c0), d.open(c0)]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const reason = rejected[0]?.reason;
    expect(reason).toBeInstanceOf(CryptoError);
    expect((reason as CryptoError).code).toBe('AUTH_FAILED');

    // The decryptor is now permanently failed
    await expect(d.open(c0)).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    expect(() => d.finish()).toThrow(CryptoError);
    try {
      d.finish();
    } catch (err) {
      expect((err as CryptoError).code).toBe('AUTH_FAILED');
    }
  });

  it('4d: Concurrent valid opens are queued strictly in call order', async () => {
    const fileKey = generateFileKeyBytes();
    const encKey = await importFileKey(fileKey, 'encrypt');
    const decKey = await importFileKey(fileKey, 'decrypt');
    const ctx = {
      sessionId: generateSessionId(),
      noncePrefix: generateNoncePrefix(),
    };

    const enc = createChunkEncryptor(encKey, ctx);
    const p0 = utf8('content 0');
    const p1 = utf8('content 1');
    const p2 = utf8('content 2');

    const c0 = await enc.seal(p0, false);
    const c1 = await enc.seal(p1, false);
    const c2 = await enc.seal(p2, true);

    const d = createChunkDecryptor(decKey, ctx);
    const [r0, r1, r2] = await Promise.all([d.open(c0), d.open(c1), d.open(c2)]);

    expect(r0.index).toBe(0);
    expect(r0.isFinal).toBe(false);
    expect(bytesToHex(r0.plaintext)).toBe(bytesToHex(p0));

    expect(r1.index).toBe(1);
    expect(r1.isFinal).toBe(false);
    expect(bytesToHex(r1.plaintext)).toBe(bytesToHex(p1));

    expect(r2.index).toBe(2);
    expect(r2.isFinal).toBe(true);
    expect(bytesToHex(r2.plaintext)).toBe(bytesToHex(p2));

    expect(() => d.finish()).not.toThrow();
  });

  it('4e: Decryptor fails closed after authentication failure', async () => {
    const fileKey = generateFileKeyBytes();
    const encKey = await importFileKey(fileKey, 'encrypt');
    const decKey = await importFileKey(fileKey, 'decrypt');
    const ctx = {
      sessionId: generateSessionId(),
      noncePrefix: generateNoncePrefix(),
    };

    const enc = createChunkEncryptor(encKey, ctx);
    const c0 = await enc.seal(utf8('content 0'), false);

    const d = createChunkDecryptor(decKey, ctx);
    const garbage = randomBytes(32);
    await expect(d.open(garbage)).rejects.toMatchObject({ code: 'AUTH_FAILED' });

    // Then immediately open valid c0: must reject with AUTH_FAILED
    await expect(d.open(c0)).rejects.toMatchObject({ code: 'AUTH_FAILED' });

    // Calling finish() must throw AUTH_FAILED
    expect(() => d.finish()).toThrow(CryptoError);
    try {
      d.finish();
    } catch (err) {
      expect((err as CryptoError).code).toBe('AUTH_FAILED');
    }
  });

  it('4f: Encryptor fail-closed on crypto failure and non-poisoning validation', async () => {
    const fileKey = generateFileKeyBytes();
    // Key imported with usage ['decrypt'] only: subtle.encrypt will fail
    const decKey = await importFileKey(fileKey, 'decrypt');
    const ctx = {
      sessionId: generateSessionId(),
      noncePrefix: generateNoncePrefix(),
    };

    const badEnc = createChunkEncryptor(decKey, ctx);
    await expect(badEnc.seal(utf8('test'), false)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    // Second seal must also reject because encryptor is permanently failed
    await expect(badEnc.seal(utf8('test'), false)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });

    // On a healthy encryptor, oversized plaintext rejects but does NOT poison encryptor
    const healthyKey = await importFileKey(fileKey, 'encrypt');
    const healthyEnc = createChunkEncryptor(healthyKey, ctx);
    const oversized = new Uint8Array(CHUNK_SIZE + 1);

    await expect(healthyEnc.seal(oversized, false)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    expect(healthyEnc.nextIndex).toBe(0);

    const valid4 = utf8('test');
    const sealed = await healthyEnc.seal(valid4, true);
    expect(healthyEnc.nextIndex).toBe(1);
    expect(healthyEnc.finished).toBe(true);

    const healthyDec = createChunkDecryptor(decKey, ctx);
    const opened = await healthyDec.open(sealed);
    expect(opened.index).toBe(0);
    expect(opened.isFinal).toBe(true);
    expect(bytesToHex(opened.plaintext)).toBe(bytesToHex(valid4));
    expect(() => healthyDec.finish()).not.toThrow();
  });

  it('4g: Exception hygiene converts WebCrypto DOMException to CryptoError(INVALID_INPUT)', async () => {
    const hmacKey = await globalThis.crypto.subtle.generateKey(
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    );
    const ecdhPair = await generateEcdhKeyPair();
    const sessionId = generateSessionId();
    const fileKey = generateFileKeyBytes();

    // 1. wrapFileKey with HMAC key as ownerPrivateKey
    await expect(
      wrapFileKey({
        ownerPrivateKey: hmacKey,
        ownerPublicRaw: ecdhPair.publicKeyRaw,
        shopPublicRaw: ecdhPair.publicKeyRaw,
        sessionId,
        fileKey,
      }),
    ).rejects.toSatisfy((err) => err instanceof CryptoError && err.code === 'INVALID_INPUT');

    // 2. unwrapFileKey with HMAC key as shopPrivateKey
    await expect(
      unwrapFileKey({
        shopPrivateKey: hmacKey,
        shopPublicRaw: ecdhPair.publicKeyRaw,
        ownerPublicRaw: ecdhPair.publicKeyRaw,
        sessionId,
        nonce: randomBytes(12),
        wrappedKey: randomBytes(48),
      }),
    ).rejects.toSatisfy((err) => err instanceof CryptoError && err.code === 'INVALID_INPUT');

    // 3. computeHelloMac with ECDH key as channelKey
    await expect(
      computeHelloMac(ecdhPair.privateKey, sessionId, ecdhPair.publicKeyRaw),
    ).rejects.toSatisfy((err) => err instanceof CryptoError && err.code === 'INVALID_INPUT');

    // 4. verifyHelloMac with ECDH key as channelKey
    await expect(
      verifyHelloMac(ecdhPair.privateKey, sessionId, ecdhPair.publicKeyRaw, randomBytes(32)),
    ).rejects.toSatisfy((err) => err instanceof CryptoError && err.code === 'INVALID_INPUT');

    // 5. computeReleaseMac with ECDH key as channelKey
    const releaseFields = {
      sessionId,
      ownerPublicRaw: ecdhPair.publicKeyRaw,
      shopPublicRaw: ecdhPair.publicKeyRaw,
      nonce: randomBytes(12),
      wrappedKey: randomBytes(48),
    };
    await expect(computeReleaseMac(ecdhPair.privateKey, releaseFields)).rejects.toSatisfy(
      (err) => err instanceof CryptoError && err.code === 'INVALID_INPUT',
    );

    // 6. verifyReleaseMac with ECDH key as channelKey
    await expect(
      verifyReleaseMac(ecdhPair.privateKey, releaseFields, randomBytes(32)),
    ).rejects.toSatisfy((err) => err instanceof CryptoError && err.code === 'INVALID_INPUT');

    // 7. importFileKey with wrong length
    await expect(importFileKey(new Uint8Array(16), 'encrypt')).rejects.toSatisfy(
      (err) => err instanceof CryptoError && err.code === 'INVALID_INPUT',
    );
  });

  it('4h: AFTER_FINAL behavior after completed stream does not fail-closed', async () => {
    const fileKey = generateFileKeyBytes();
    const encKey = await importFileKey(fileKey, 'encrypt');
    const decKey = await importFileKey(fileKey, 'decrypt');
    const ctx = {
      sessionId: generateSessionId(),
      noncePrefix: generateNoncePrefix(),
    };

    const enc = createChunkEncryptor(encKey, ctx);
    const c0 = await enc.seal(utf8('chunk 0'), false);
    const c1 = await enc.seal(utf8('chunk 1'), true);

    const d = createChunkDecryptor(decKey, ctx);
    await d.open(c0);
    await d.open(c1);

    // Calling decryptor.open(c0) after stream final chunk must reject with AFTER_FINAL
    await expect(d.open(c0)).rejects.toMatchObject({ code: 'AFTER_FINAL' });

    // Calling decryptor.finish() after that must NOT throw (AFTER_FINAL is not a tampering failure)
    expect(() => d.finish()).not.toThrow();

    // Calling open(c1) again must also reject with AFTER_FINAL
    await expect(d.open(c1)).rejects.toMatchObject({ code: 'AFTER_FINAL' });
  });
});
