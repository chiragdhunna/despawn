import { concatBytes, utf8 } from './bytes.js';
import { CryptoError } from './errors.js';
import {
  FILE_KEY_BYTES,
  GCM_IV_BYTES,
  GCM_TAG_BYTES,
  LINK_SECRET_BYTES,
  P256_PUBLIC_RAW_BYTES,
  SESSION_ID_BYTES,
} from './random.js';

export interface ReleaseFields {
  sessionId: Uint8Array;
  ownerPublicRaw: Uint8Array;
  shopPublicRaw: Uint8Array;
  nonce: Uint8Array;
  wrappedKey: Uint8Array;
}

export async function deriveChannelKey(
  linkSecret: Uint8Array,
  sessionId: Uint8Array,
): Promise<CryptoKey> {
  if (linkSecret.length !== LINK_SECRET_BYTES || sessionId.length !== SESSION_ID_BYTES) {
    throw new CryptoError('INVALID_INPUT');
  }

  const ikm = await globalThis.crypto.subtle.importKey(
    'raw',
    new Uint8Array(linkSecret),
    'HKDF',
    false,
    ['deriveBits'],
  );

  const bits = await globalThis.crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(sessionId),
      info: new Uint8Array(utf8('despawn/v1/chan')),
    },
    ikm,
    256,
  );

  return await globalThis.crypto.subtle.importKey(
    'raw',
    new Uint8Array(bits),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function computeHelloMac(
  channelKey: CryptoKey,
  sessionId: Uint8Array,
  shopPublicRaw: Uint8Array,
): Promise<Uint8Array> {
  if (
    sessionId.length !== SESSION_ID_BYTES ||
    shopPublicRaw.length !== P256_PUBLIC_RAW_BYTES ||
    shopPublicRaw[0] !== 0x04
  ) {
    throw new CryptoError('INVALID_INPUT');
  }

  const data = concatBytes(utf8('hello'), sessionId, shopPublicRaw);
  const signature = await globalThis.crypto.subtle.sign('HMAC', channelKey, new Uint8Array(data));
  return new Uint8Array(signature);
}

export async function verifyHelloMac(
  channelKey: CryptoKey,
  sessionId: Uint8Array,
  shopPublicRaw: Uint8Array,
  mac: Uint8Array,
): Promise<boolean> {
  if (
    sessionId.length !== SESSION_ID_BYTES ||
    shopPublicRaw.length !== P256_PUBLIC_RAW_BYTES ||
    shopPublicRaw[0] !== 0x04 ||
    mac.length !== 32
  ) {
    throw new CryptoError('INVALID_INPUT');
  }

  const data = concatBytes(utf8('hello'), sessionId, shopPublicRaw);
  return await globalThis.crypto.subtle.verify(
    'HMAC',
    channelKey,
    new Uint8Array(mac),
    new Uint8Array(data),
  );
}

export async function computeSas(
  sessionId: Uint8Array,
  shopPublicRaw: Uint8Array,
): Promise<string> {
  if (
    sessionId.length !== SESSION_ID_BYTES ||
    shopPublicRaw.length !== P256_PUBLIC_RAW_BYTES ||
    shopPublicRaw[0] !== 0x04
  ) {
    throw new CryptoError('INVALID_INPUT');
  }

  const data = concatBytes(utf8('despawn/v1/sas'), sessionId, shopPublicRaw);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(data));
  const view = new DataView(digest);
  const n = view.getUint32(0, false);
  const mod = n % 10000;
  const modStr = mod.toString(10);
  return '0000'.substring(0, 4 - modStr.length) + modStr;
}

function validateReleaseFields(f: ReleaseFields): void {
  if (
    f.sessionId.length !== SESSION_ID_BYTES ||
    f.ownerPublicRaw.length !== P256_PUBLIC_RAW_BYTES ||
    f.ownerPublicRaw[0] !== 0x04 ||
    f.shopPublicRaw.length !== P256_PUBLIC_RAW_BYTES ||
    f.shopPublicRaw[0] !== 0x04 ||
    f.nonce.length !== GCM_IV_BYTES ||
    f.wrappedKey.length !== FILE_KEY_BYTES + GCM_TAG_BYTES
  ) {
    throw new CryptoError('INVALID_INPUT');
  }
}

export async function computeReleaseMac(
  channelKey: CryptoKey,
  f: ReleaseFields,
): Promise<Uint8Array> {
  validateReleaseFields(f);

  const data = concatBytes(
    utf8('release'),
    f.sessionId,
    f.ownerPublicRaw,
    f.shopPublicRaw,
    f.nonce,
    f.wrappedKey,
  );
  const signature = await globalThis.crypto.subtle.sign('HMAC', channelKey, new Uint8Array(data));
  return new Uint8Array(signature);
}

export async function verifyReleaseMac(
  channelKey: CryptoKey,
  f: ReleaseFields,
  mac: Uint8Array,
): Promise<boolean> {
  if (mac.length !== 32) {
    throw new CryptoError('INVALID_INPUT');
  }
  validateReleaseFields(f);

  const data = concatBytes(
    utf8('release'),
    f.sessionId,
    f.ownerPublicRaw,
    f.shopPublicRaw,
    f.nonce,
    f.wrappedKey,
  );
  return await globalThis.crypto.subtle.verify(
    'HMAC',
    channelKey,
    new Uint8Array(mac),
    new Uint8Array(data),
  );
}
