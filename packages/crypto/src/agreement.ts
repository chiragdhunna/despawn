import { concatBytes, utf8 } from './bytes.js';
import { CryptoError, guard } from './errors.js';
import {
  FILE_KEY_BYTES,
  GCM_IV_BYTES,
  GCM_TAG_BYTES,
  P256_PUBLIC_RAW_BYTES,
  randomBytes,
  SESSION_ID_BYTES,
} from './random.js';

export interface EcdhKeyPair {
  privateKey: CryptoKey;
  publicKeyRaw: Uint8Array;
}

export interface WrappedKey {
  nonce: Uint8Array;
  wrappedKey: Uint8Array;
}

async function importP256Public(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== P256_PUBLIC_RAW_BYTES || raw[0] !== 0x04) {
    throw new CryptoError('INVALID_INPUT');
  }

  try {
    return await globalThis.crypto.subtle.importKey(
      'raw',
      new Uint8Array(raw),
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    );
  } catch {
    throw new CryptoError('INVALID_INPUT');
  }
}

export async function generateEcdhKeyPair(): Promise<EcdhKeyPair> {
  return await guard(async () => {
    const pair = await globalThis.crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits'],
    );

    const rawPub = await globalThis.crypto.subtle.exportKey('raw', pair.publicKey);
    return {
      privateKey: pair.privateKey,
      publicKeyRaw: new Uint8Array(rawPub),
    };
  });
}

export async function wrapFileKey(p: {
  ownerPrivateKey: CryptoKey;
  ownerPublicRaw: Uint8Array;
  shopPublicRaw: Uint8Array;
  sessionId: Uint8Array;
  fileKey: Uint8Array;
  nonce?: Uint8Array;
}): Promise<WrappedKey> {
  return await guard(async () => {
    if (
      p.ownerPublicRaw.length !== P256_PUBLIC_RAW_BYTES ||
      p.ownerPublicRaw[0] !== 0x04 ||
      p.sessionId.length !== SESSION_ID_BYTES ||
      p.fileKey.length !== FILE_KEY_BYTES
    ) {
      throw new CryptoError('INVALID_INPUT');
    }

    const nonce = p.nonce !== undefined ? p.nonce : randomBytes(GCM_IV_BYTES);
    if (nonce.length !== GCM_IV_BYTES) {
      throw new CryptoError('INVALID_INPUT');
    }

    const shopPubKey = await importP256Public(p.shopPublicRaw);

    let sharedBits: ArrayBuffer | undefined;
    let wrapKeyBits: ArrayBuffer | undefined;

    try {
      sharedBits = await globalThis.crypto.subtle.deriveBits(
        { name: 'ECDH', public: shopPubKey },
        p.ownerPrivateKey,
        256,
      );

      const ikmKey = await globalThis.crypto.subtle.importKey(
        'raw',
        new Uint8Array(sharedBits),
        'HKDF',
        false,
        ['deriveBits'],
      );

      const info = concatBytes(utf8('despawn/v1/wrap'), p.ownerPublicRaw, p.shopPublicRaw);

      wrapKeyBits = await globalThis.crypto.subtle.deriveBits(
        {
          name: 'HKDF',
          hash: 'SHA-256',
          salt: new Uint8Array(p.sessionId),
          info: new Uint8Array(info),
        },
        ikmKey,
        256,
      );

      const wrapKey = await globalThis.crypto.subtle.importKey(
        'raw',
        new Uint8Array(wrapKeyBits),
        { name: 'AES-GCM' },
        false,
        ['encrypt'],
      );

      const aad = concatBytes(p.sessionId, p.ownerPublicRaw, p.shopPublicRaw);

      const ciphertext = await globalThis.crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: new Uint8Array(nonce),
          additionalData: new Uint8Array(aad),
          tagLength: 128,
        },
        wrapKey,
        new Uint8Array(p.fileKey),
      );

      return {
        nonce: new Uint8Array(nonce),
        wrappedKey: new Uint8Array(ciphertext),
      };
    } finally {
      // JavaScript cannot guarantee memory scrubbing; zeroing ArrayBuffer is best effort.
      if (sharedBits) new Uint8Array(sharedBits).fill(0);
      if (wrapKeyBits) new Uint8Array(wrapKeyBits).fill(0);
    }
  });
}

export async function unwrapFileKey(p: {
  shopPrivateKey: CryptoKey;
  shopPublicRaw: Uint8Array;
  ownerPublicRaw: Uint8Array;
  sessionId: Uint8Array;
  nonce: Uint8Array;
  wrappedKey: Uint8Array;
}): Promise<CryptoKey> {
  return await guard(async () => {
    if (
      p.shopPublicRaw.length !== P256_PUBLIC_RAW_BYTES ||
      p.shopPublicRaw[0] !== 0x04 ||
      p.sessionId.length !== SESSION_ID_BYTES ||
      p.nonce.length !== GCM_IV_BYTES ||
      p.wrappedKey.length !== FILE_KEY_BYTES + GCM_TAG_BYTES
    ) {
      throw new CryptoError('INVALID_INPUT');
    }

    const ownerPubKey = await importP256Public(p.ownerPublicRaw);

    let sharedBits: ArrayBuffer | undefined;
    let wrapKeyBits: ArrayBuffer | undefined;
    let rawFileKey: Uint8Array | undefined;

    try {
      sharedBits = await globalThis.crypto.subtle.deriveBits(
        { name: 'ECDH', public: ownerPubKey },
        p.shopPrivateKey,
        256,
      );

      const ikmKey = await globalThis.crypto.subtle.importKey(
        'raw',
        new Uint8Array(sharedBits),
        'HKDF',
        false,
        ['deriveBits'],
      );

      const info = concatBytes(utf8('despawn/v1/wrap'), p.ownerPublicRaw, p.shopPublicRaw);

      wrapKeyBits = await globalThis.crypto.subtle.deriveBits(
        {
          name: 'HKDF',
          hash: 'SHA-256',
          salt: new Uint8Array(p.sessionId),
          info: new Uint8Array(info),
        },
        ikmKey,
        256,
      );

      const wrapKey = await globalThis.crypto.subtle.importKey(
        'raw',
        new Uint8Array(wrapKeyBits),
        { name: 'AES-GCM' },
        false,
        ['decrypt'],
      );

      const aad = concatBytes(p.sessionId, p.ownerPublicRaw, p.shopPublicRaw);

      try {
        const pt = await globalThis.crypto.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv: new Uint8Array(p.nonce),
            additionalData: new Uint8Array(aad),
            tagLength: 128,
          },
          wrapKey,
          new Uint8Array(p.wrappedKey),
        );
        rawFileKey = new Uint8Array(pt);
      } catch {
        throw new CryptoError('AUTH_FAILED');
      }

      if (rawFileKey.length !== FILE_KEY_BYTES) {
        throw new CryptoError('AUTH_FAILED');
      }

      return await globalThis.crypto.subtle.importKey(
        'raw',
        new Uint8Array(rawFileKey),
        { name: 'AES-GCM' },
        false,
        ['decrypt'],
      );
    } finally {
      // JavaScript cannot guarantee memory scrubbing; zeroing ArrayBuffer is best effort.
      if (sharedBits) new Uint8Array(sharedBits).fill(0);
      if (wrapKeyBits) new Uint8Array(wrapKeyBits).fill(0);
      if (rawFileKey) rawFileKey.fill(0);
    }
  });
}
