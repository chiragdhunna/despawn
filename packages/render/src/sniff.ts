export type FileType = 'pdf' | 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp' | 'svg' | 'unknown';

function starts(b: Uint8Array, sig: readonly number[], at = 0): boolean {
  return sig.every((v, i) => b[at + i] === v);
}

/** Detects the type from file contents, never from the file name. */
export function sniff(head: Uint8Array): FileType {
  if (starts(head, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf'; // %PDF-
  if (starts(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (starts(head, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (starts(head, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  if (starts(head, [0x52, 0x49, 0x46, 0x46]) && starts(head, [0x57, 0x45, 0x42, 0x50], 8))
    return 'webp';
  if (starts(head, [0x42, 0x4d])) return 'bmp';
  const text = new TextDecoder('utf-8').decode(head.subarray(0, 512)).trimStart().toLowerCase();
  if (text.indexOf('<svg') === 0 || (text.indexOf('<?xml') === 0 && text.indexOf('<svg') > 0))
    return 'svg';
  return 'unknown';
}

/** Pdf may have up to 1024 bytes of junk before the header; accept that like most readers do. */
export function sniffLoose(head: Uint8Array): FileType {
  const t = sniff(head);
  if (t !== 'unknown') return t;
  const s = new TextDecoder('latin1').decode(head.subarray(0, 1024));
  return s.indexOf('%PDF-') >= 0 ? 'pdf' : 'unknown';
}
