export type CryptoErrorCode = 'INVALID_INPUT' | 'AUTH_FAILED' | 'TRUNCATED' | 'AFTER_FINAL';

const ERROR_MESSAGES: Record<CryptoErrorCode, string> = {
  INVALID_INPUT: 'Invalid cryptographic input',
  AUTH_FAILED: 'Cryptographic authentication failed',
  TRUNCATED: 'Cryptographic stream truncated before final chunk',
  AFTER_FINAL: 'Cryptographic operation attempted after final chunk',
};

export class CryptoError extends Error {
  readonly code: CryptoErrorCode;

  constructor(code: CryptoErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'CryptoError';
    this.code = code;
    Object.setPrototypeOf(this, CryptoError.prototype);
  }
}

/**
 * Executes an async operation, rethrowing any CryptoError as-is, and converting
 * any other thrown error (such as a platform DOMException) into CryptoError('INVALID_INPUT').
 * Not exported from index.ts.
 */
export async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof CryptoError) {
      throw err;
    }
    throw new CryptoError('INVALID_INPUT');
  }
}
