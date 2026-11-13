export class ProtocolError extends Error {
  readonly code: 'BAD_MESSAGE' | 'TOO_LARGE';

  constructor(code: 'BAD_MESSAGE' | 'TOO_LARGE', message?: string) {
    super(message !== undefined ? message : code);
    this.name = 'ProtocolError';
    this.code = code;
    Object.setPrototypeOf(this, ProtocolError.prototype);
  }
}

export type ParseResult<T> =
  { ok: true; msg: T } | { ok: false; code: 'BAD_MESSAGE' | 'TOO_LARGE' };
