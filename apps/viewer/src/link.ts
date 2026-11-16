import { base64urlDecode, LINK_SECRET_BYTES } from '@despawn/crypto';
import { isSessionId } from '@despawn/protocol';

export interface ParsedLink {
  readonly sessionId: string;
  readonly linkSecret: Uint8Array;
}

/** Reads /s/<sessionId> and #<linkSecret>. Returns null for anything malformed. */
export function parseLink(pathname: string, hash: string): ParsedLink | null {
  const m = /^\/s\/([A-Za-z0-9_-]+)\/?$/.exec(pathname);
  const id = m?.[1] ?? '';
  if (!isSessionId(id)) {
    return null;
  }
  const raw = hash.charAt(0) === '#' ? hash.slice(1) : hash;
  try {
    const secret = base64urlDecode(raw);
    return secret.length === LINK_SECRET_BYTES ? { sessionId: id, linkSecret: secret } : null;
  } catch {
    return null;
  }
}
