export const VERSION = '0.0.0';

export {
  SPEC_VERSION,
  SESSION_ID_BYTES,
  LINK_SECRET_BYTES,
  FILE_KEY_BYTES,
  NONCE_PREFIX_BYTES,
  GCM_IV_BYTES,
  GCM_TAG_BYTES,
  P256_PUBLIC_RAW_BYTES,
  CHUNK_SIZE,
  randomBytes,
  generateSessionId,
  generateLinkSecret,
  generateFileKeyBytes,
  generateNoncePrefix,
} from './random.js';

export { CryptoError, type CryptoErrorCode } from './errors.js';

export { utf8, concatBytes, u32be, u64be, bytesToHex, hexToBytes } from './bytes.js';

export { base64urlEncode, base64urlDecode } from './base64url.js';

export {
  type ReleaseFields,
  deriveChannelKey,
  computeHelloMac,
  verifyHelloMac,
  computeSas,
  computeReleaseMac,
  verifyReleaseMac,
} from './channel.js';

export {
  type EcdhKeyPair,
  type WrappedKey,
  generateEcdhKeyPair,
  wrapFileKey,
  unwrapFileKey,
} from './agreement.js';

export {
  type ChunkContext,
  type ChunkEncryptor,
  type ChunkDecryptor,
  importFileKey,
  createChunkEncryptor,
  createChunkDecryptor,
} from './chunks.js';
