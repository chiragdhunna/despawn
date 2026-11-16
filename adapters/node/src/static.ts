import { readFile, stat } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import path from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

/** Resolves a URL path inside root. Returns null for anything that escapes it. */
export function safeResolve(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) {
    return null;
  }
  const full = path.resolve(root, '.' + path.posix.normalize('/' + decoded));
  const rootResolved = path.resolve(root);
  return full === rootResolved || full.startsWith(rootResolved + path.sep) ? full : null;
}

export async function readStatic(
  root: string,
  relPath: string,
  spaFallback: boolean,
): Promise<{ body: Buffer; type: string; isIndex: boolean } | null> {
  const resolved = safeResolve(root, relPath);
  if (resolved === null) {
    return null;
  }
  const candidates = [resolved];
  if (relPath === '' || relPath.endsWith('/')) {
    candidates.unshift(path.join(resolved, 'index.html'));
  }
  for (const file of candidates) {
    try {
      const st = await stat(file);
      if (st.isFile()) {
        const ext = path.extname(file).toLowerCase();
        return {
          body: await readFile(file),
          type: MIME[ext] ?? 'application/octet-stream',
          isIndex: path.basename(file) === 'index.html',
        };
      }
    } catch {
      // try the next candidate
    }
  }
  if (spaFallback && path.extname(relPath) === '') {
    try {
      return {
        body: await readFile(path.join(root, 'index.html')),
        type: MIME['.html']!,
        isIndex: true,
      };
    } catch {
      return null;
    }
  }
  return null;
}

export function sendBytes(
  res: ServerResponse,
  status: number,
  body: Uint8Array | string,
  headers: Record<string, string>,
): void {
  res.writeHead(status, headers);
  res.end(body);
}
