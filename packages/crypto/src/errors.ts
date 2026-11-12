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
