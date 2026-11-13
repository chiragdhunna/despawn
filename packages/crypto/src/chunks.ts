import { concatBytes, u32be, u64be, utf8 } from './bytes.js';
import { CryptoError, guard } from './errors.js';
import {
  CHUNK_SIZE,
  FILE_KEY_BYTES,
  GCM_TAG_BYTES,
  NONCE_PREFIX_BYTES,
  SESSION_ID_BYTES,
} from './random.js';

export interface ChunkContext {
  sessionId: Uint8Array;
  noncePrefix: Uint8Array;
}

export interface ChunkEncryptor {
  seal(plaintext: Uint8Array, isFinal: boolean): Promise<Uint8Array>;
  readonly nextIndex: number;
  readonly finished: boolean;
}

export interface ChunkDecryptor {
  open(sealed: Uint8Array): Promise<{ plaintext: Uint8Array; isFinal: boolean; index: number }>;
  finish(): void;
}

function validateContext(ctx: ChunkContext): void {
  if (ctx.sessionId.length !== SESSION_ID_BYTES || ctx.noncePrefix.length !== NONCE_PREFIX_BYTES) {
    throw new CryptoError('INVALID_INPUT');
  }
}

export async function importFileKey(
  raw: Uint8Array,
  usage: 'encrypt' | 'decrypt',
): Promise<CryptoKey> {
  return await guard(async () => {
    if (raw.length !== FILE_KEY_BYTES) {
      throw new CryptoError('INVALID_INPUT');
    }

    return await globalThis.crypto.subtle.importKey(
      'raw',
      new Uint8Array(raw),
      { name: 'AES-GCM' },
      false,
      [usage],
    );
  });
}

class ChunkEncryptorImpl implements ChunkEncryptor {
  private readonly key: CryptoKey;
  private readonly ctx: ChunkContext;
  private index = 0;
  private isDone = false;
  private failed = false;

  constructor(key: CryptoKey, ctx: ChunkContext) {
    this.key = key;
    this.ctx = {
      sessionId: new Uint8Array(ctx.sessionId),
      noncePrefix: new Uint8Array(ctx.noncePrefix),
    };
  }

  get nextIndex(): number {
    return this.index;
  }

  get finished(): boolean {
    return this.isDone;
  }

  async seal(plaintext: Uint8Array, isFinal: boolean): Promise<Uint8Array> {
    if (this.failed) {
      throw new CryptoError('INVALID_INPUT');
    }

    if (this.isDone) {
      throw new CryptoError('AFTER_FINAL');
    }

    if (plaintext.length > CHUNK_SIZE) {
      throw new CryptoError('INVALID_INPUT');
    }

    if (this.index > 0xffffffff) {
      throw new CryptoError('INVALID_INPUT');
    }

    const index = this.index;
    this.index++;
    if (isFinal) {
      this.isDone = true;
    }

    const plaintextCopy = new Uint8Array(plaintext);
    const chunkNonce = concatBytes(this.ctx.noncePrefix, u64be(index));
    const aad = concatBytes(
      utf8('despawn/v1'),
      this.ctx.sessionId,
      u32be(index),
      new Uint8Array([isFinal ? 1 : 0]),
    );

    try {
      const sealed = await globalThis.crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: new Uint8Array(chunkNonce),
          additionalData: new Uint8Array(aad),
          tagLength: 128,
        },
        this.key,
        plaintextCopy,
      );

      return new Uint8Array(sealed);
    } catch (err) {
      this.failed = true;
      if (err instanceof CryptoError) {
        throw err;
      }
      throw new CryptoError('INVALID_INPUT');
    }
  }
}

class ChunkDecryptorImpl implements ChunkDecryptor {
  private readonly key: CryptoKey;
  private readonly ctx: ChunkContext;
  private index = 0;
  private isDone = false;
  private failed = false;
  private tail: Promise<void> = Promise.resolve();

  constructor(key: CryptoKey, ctx: ChunkContext) {
    this.key = key;
    this.ctx = {
      sessionId: new Uint8Array(ctx.sessionId),
      noncePrefix: new Uint8Array(ctx.noncePrefix),
    };
  }

  open(sealed: Uint8Array): Promise<{ plaintext: Uint8Array; isFinal: boolean; index: number }> {
    const copy = new Uint8Array(sealed);
    const run = this.tail.then(() => this.openOne(copy));
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async openOne(
    sealed: Uint8Array,
  ): Promise<{ plaintext: Uint8Array; isFinal: boolean; index: number }> {
    if (this.failed) {
      throw new CryptoError('AUTH_FAILED');
    }

    if (this.isDone) {
      throw new CryptoError('AFTER_FINAL');
    }

    if (this.index > 0xffffffff) {
      this.failed = true;
      throw new CryptoError('INVALID_INPUT');
    }

    if (sealed.length < GCM_TAG_BYTES) {
      this.failed = true;
      throw new CryptoError('AUTH_FAILED');
    }

    if (sealed.length > CHUNK_SIZE + GCM_TAG_BYTES) {
      this.failed = true;
      throw new CryptoError('INVALID_INPUT');
    }

    const chunkNonce = concatBytes(this.ctx.noncePrefix, u64be(this.index));

    // Try isFinal = false first
    const aadNonFinal = concatBytes(
      utf8('despawn/v1'),
      this.ctx.sessionId,
      u32be(this.index),
      new Uint8Array([0]),
    );

    try {
      const pt = await globalThis.crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: new Uint8Array(chunkNonce),
          additionalData: new Uint8Array(aadNonFinal),
          tagLength: 128,
        },
        this.key,
        new Uint8Array(sealed),
      );
      const currentIndex = this.index;
      this.index++;
      return {
        plaintext: new Uint8Array(pt),
        isFinal: false,
        index: currentIndex,
      };
    } catch {
      // Non-final failed; try isFinal = true
    }

    const aadFinal = concatBytes(
      utf8('despawn/v1'),
      this.ctx.sessionId,
      u32be(this.index),
      new Uint8Array([1]),
    );

    try {
      const pt = await globalThis.crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: new Uint8Array(chunkNonce),
          additionalData: new Uint8Array(aadFinal),
          tagLength: 128,
        },
        this.key,
        new Uint8Array(sealed),
      );
      const currentIndex = this.index;
      this.index++;
      this.isDone = true;
      return {
        plaintext: new Uint8Array(pt),
        isFinal: true,
        index: currentIndex,
      };
    } catch {
      this.failed = true;
      throw new CryptoError('AUTH_FAILED');
    }
  }

  finish(): void {
    if (this.failed) {
      throw new CryptoError('AUTH_FAILED');
    }
    if (!this.isDone) {
      throw new CryptoError('TRUNCATED');
    }
  }
}

export function createChunkEncryptor(key: CryptoKey, ctx: ChunkContext): ChunkEncryptor {
  validateContext(ctx);
  return new ChunkEncryptorImpl(key, ctx);
}

export function createChunkDecryptor(key: CryptoKey, ctx: ChunkContext): ChunkDecryptor {
  validateContext(ctx);
  return new ChunkDecryptorImpl(key, ctx);
}
