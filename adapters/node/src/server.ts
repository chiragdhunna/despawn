import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { MAX_FRAME_BYTES, isSessionId, isToken32 } from '@despawn/protocol';
import {
  Relay,
  systemScheduler,
  type Logger,
  type RelayConfig,
  type RelaySocket,
  type SocketHandler,
} from '@despawn/server-core';
import { WebSocket, WebSocketServer } from 'ws';
import { FileBlobStore, MemoryStore, type CountingBlobStore } from './blobstore.js';
import { readStatic, sendBytes } from './static.js';

export interface ServerOptions {
  readonly port?: number;
  readonly host?: string;
  /** Directory of the built owner app (served at /app/). */
  readonly ownerDist?: string | undefined;
  /** Directory of the built shop viewer (assets at /v/, page at /s/<id>). */
  readonly viewerDist?: string | undefined;
  /** Store ciphertext on disk here. Omit to keep it in memory. */
  readonly blobDir?: string | undefined;
  /** Trust X-Forwarded-For and CF-IPCountry (only behind a proxy you control). */
  readonly trustProxy?: boolean | undefined;
  readonly config?: Partial<RelayConfig> | undefined;
  readonly createsPerMinutePerIp?: number | undefined;
  readonly maxSocketsPerIp?: number | undefined;
  readonly logger?: Logger | undefined;
}

export interface RunningServer {
  readonly url: string;
  readonly port: number;
  readonly relay: Relay;
  inspect(): Promise<{ sessions: number; blobs: number }>;
  close(): Promise<void>;
}

const SUBPROTOCOL = 'despawn.v1';
const TOKEN_PREFIX = 'token.';
const JSON_LIMIT = 4096;

function baseHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
  };
}

function safeHost(req: IncomingMessage): string {
  const h = String(req.headers.host ?? 'localhost');
  return /^[A-Za-z0-9.:[\]-]{1,255}$/.test(h) ? h : 'localhost';
}

/** CSP for the shop viewer page. Everything is same-origin, nothing inline. */
export function viewerCsp(host: string): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src blob: 'self'",
    `connect-src 'self' ws://${host} wss://${host}`,
    "font-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function ownerCsp(host: string): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' blob: data:",
    "worker-src 'self' blob:",
    `connect-src 'self' ws://${host} wss://${host} blob:`,
    "font-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      resolve(null);
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(null));
  });
}

function bearer(req: IncomingMessage): string {
  const h = String(req.headers.authorization ?? '');
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

function respond(res: ServerResponse, r: { status: number; json?: unknown }): void {
  if (r.json === undefined) {
    sendBytes(res, r.status, '', baseHeaders());
  } else {
    json(res, r.status, r.json);
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  sendBytes(res, status, JSON.stringify(body), {
    ...baseHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
  });
}

export async function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const store: CountingBlobStore =
    opts.blobDir === undefined ? new MemoryStore() : new FileBlobStore(opts.blobDir);
  if (store instanceof FileBlobStore) {
    await store.init();
  }
  const relay = new Relay({
    blobs: store,
    scheduler: systemScheduler,
    config: opts.config,
    logger: opts.logger,
  });

  const salt = randomBytes(16);
  const hashIp = (ip: string): string =>
    createHash('sha256').update(salt).update(ip).digest('hex').slice(0, 16);
  const clientIp = (req: IncomingMessage): string => {
    if (opts.trustProxy === true) {
      const xff = String(req.headers['x-forwarded-for'] ?? '')
        .split(',')[0]
        ?.trim();
      if (xff) {
        return xff;
      }
    }
    return req.socket.remoteAddress ?? 'unknown';
  };

  const creates = new Map<string, number[]>();
  const limitPerMin = opts.createsPerMinutePerIp ?? 20;
  const allowCreate = (ip: string): boolean => {
    const key = hashIp(ip);
    const now = Date.now();
    const list = (creates.get(key) ?? []).filter((t) => now - t < 60_000);
    if (list.length >= limitPerMin) {
      creates.set(key, list);
      return false;
    }
    list.push(now);
    creates.set(key, list);
    return true;
  };
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of creates) {
      if (v.every((t) => now - t >= 60_000)) {
        creates.delete(k);
      }
    }
  }, 60_000);
  sweep.unref();

  const sockets = new Map<string, number>();
  const maxSockets = opts.maxSocketsPerIp ?? 40;

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://x');
    const p = url.pathname;
    const method = req.method ?? 'GET';
    const host = safeHost(req);

    if (p === '/v1/health') {
      json(res, 200, { ok: true, sessions: relay.stats().sessions });
      return;
    }
    if (p === '/v1/sessions') {
      if (method !== 'POST') {
        json(res, 405, { error: 'BAD_MESSAGE' });
        return;
      }
      if (!allowCreate(clientIp(req))) {
        json(res, 429, { error: 'RATE_LIMITED' });
        return;
      }
      const body = await readBody(req, JSON_LIMIT);
      if (body === null) {
        json(res, 413, { error: 'TOO_LARGE' });
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(body.toString('utf8'));
      } catch {
        json(res, 400, { error: 'BAD_MESSAGE' });
        return;
      }
      const r = await relay.createSession(parsed);
      json(res, r.status, r.json);
      return;
    }
    const m = /^\/v1\/sessions\/([A-Za-z0-9_-]+)(\/blob)?$/.exec(p);
    if (m !== null) {
      const id = m[1] ?? '';
      if (!isSessionId(id)) {
        json(res, 404, { error: 'NOT_FOUND' });
        return;
      }
      if (m[2] === '/blob') {
        if (method === 'PUT') {
          const token = bearer(req);
          if (!isToken32(token)) {
            json(res, 403, { error: 'FORBIDDEN' });
            return;
          }
          const body = await readBody(req, relay.config.maxBlobBytes);
          if (body === null) {
            json(res, 413, { error: 'TOO_LARGE' });
            return;
          }
          const r = await relay.putBlob(id, token, new Uint8Array(body));
          respond(res, r);
          return;
        }
        if (method === 'GET') {
          const t = url.searchParams.get('t') ?? '';
          if (!isToken32(t)) {
            json(res, 404, { error: 'NOT_FOUND' });
            return;
          }
          const r = await relay.getBlob(id, t);
          if (r.status === 200 && r.body !== undefined) {
            sendBytes(res, 200, r.body, {
              ...baseHeaders(),
              'Content-Type': 'application/octet-stream',
              'Content-Length': String(r.body.length),
            });
          } else {
            json(res, 404, { error: 'NOT_FOUND' });
          }
          return;
        }
        json(res, 405, { error: 'BAD_MESSAGE' });
        return;
      }
      if (method === 'DELETE') {
        const token = bearer(req);
        const r = isToken32(token)
          ? relay.deleteSession(id, token)
          : { status: 403, json: { error: 'FORBIDDEN' } };
        respond(res, r);
        return;
      }
      json(res, 405, { error: 'BAD_MESSAGE' });
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      json(res, 405, { error: 'BAD_MESSAGE' });
      return;
    }
    // Shop viewer page: one HTML file for every /s/<id>
    const s = /^\/s\/([A-Za-z0-9_-]+)\/?$/.exec(p);
    if (s !== null && opts.viewerDist !== undefined) {
      const f = await readStatic(opts.viewerDist, 'index.html', false);
      if (f === null) {
        json(res, 404, { error: 'NOT_FOUND' });
        return;
      }
      sendBytes(res, 200, f.body, {
        ...baseHeaders(),
        'Content-Type': f.type,
        'Content-Security-Policy': viewerCsp(host),
      });
      return;
    }
    const staticRoutes: Array<[string, string | undefined, boolean, (h: string) => string]> = [
      ['/v/', opts.viewerDist, false, viewerCsp],
      ['/app/', opts.ownerDist, true, ownerCsp],
    ];
    for (const [prefix, root, spa, csp] of staticRoutes) {
      if (root !== undefined && (p.startsWith(prefix) || p + '/' === prefix)) {
        const f = await readStatic(root, p.slice(prefix.length), spa);
        if (f === null) {
          json(res, 404, { error: 'NOT_FOUND' });
          return;
        }
        sendBytes(res, 200, method === 'HEAD' ? '' : f.body, {
          ...baseHeaders(),
          'Content-Type': f.type,
          'Content-Security-Policy': csp(host),
          'Cache-Control': f.isIndex ? 'no-cache' : 'public, max-age=31536000, immutable',
        });
        return;
      }
    }
    if (p === '/' && opts.ownerDist !== undefined) {
      res.writeHead(302, { Location: '/app/', ...baseHeaders() });
      res.end();
      return;
    }
    json(res, 404, { error: 'NOT_FOUND' });
  };

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) {
        json(res, 500, { error: 'UNAVAILABLE' });
      } else {
        res.end();
      }
    });
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 15_000;

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FRAME_BYTES,
    handleProtocols: (protocols) => (protocols.has(SUBPROTOCOL) ? SUBPROTOCOL : false),
  });

  const rejectUpgrade = (socket: Duplex, code: number, text: string): void => {
    socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  };

  server.on('upgrade', (req: IncomingMessage, socket: Duplex) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const m = /^\/v1\/sessions\/([A-Za-z0-9_-]+)\/(owner|shop)$/.exec(url.pathname);
    if (m === null || !isSessionId(m[1] ?? '')) {
      rejectUpgrade(socket, 404, 'Not Found');
      return;
    }
    const id = m[1] ?? '';
    const role = m[2];
    const ip = hashIp(clientIp(req));
    if ((sockets.get(ip) ?? 0) >= maxSockets) {
      rejectUpgrade(socket, 429, 'Too Many Requests');
      return;
    }
    const offered = String(req.headers['sec-websocket-protocol'] ?? '')
      .split(',')
      .map((x) => x.trim());
    const tokenProto = offered.find((x) => x.startsWith(TOKEN_PREFIX));
    const ownerToken = tokenProto === undefined ? '' : tokenProto.slice(TOKEN_PREFIX.length);
    if (role === 'owner' && !isToken32(ownerToken)) {
      rejectUpgrade(socket, 401, 'Unauthorized');
      return;
    }
    const approxCountry =
      opts.trustProxy === true && /^[A-Z]{2}$/.test(String(req.headers['cf-ipcountry'] ?? ''))
        ? String(req.headers['cf-ipcountry'])
        : undefined;

    wss.handleUpgrade(req, socket, Buffer.alloc(0), (ws: WebSocket) => {
      const rs: RelaySocket = {
        send: (t) => ws.send(t),
        close: () => ws.close(1000),
        get isOpen() {
          return ws.readyState === WebSocket.OPEN;
        },
      };
      const handler: SocketHandler | null =
        role === 'owner'
          ? relay.attachOwner(id, ownerToken, rs)
          : relay.attachShop(id, rs, approxCountry === undefined ? {} : { approxCountry });
      if (handler === null) {
        ws.close(1008);
        return;
      }
      sockets.set(ip, (sockets.get(ip) ?? 0) + 1);
      ws.on('message', (data, isBinary) => {
        if (isBinary) {
          ws.close(1003);
          return;
        }
        handler.onMessage(data.toString('utf8'));
      });
      ws.on('close', () => {
        sockets.set(ip, Math.max(0, (sockets.get(ip) ?? 1) - 1));
        handler.onClose();
      });
      ws.on('error', () => ws.terminate());
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, opts.host ?? '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0;

  return {
    url: `http://localhost:${port}`,
    port,
    relay,
    inspect: async () => ({ sessions: relay.stats().sessions, blobs: await store.count() }),
    close: async () => {
      clearInterval(sweep);
      relay.shutdown();
      for (const c of wss.clients) {
        c.terminate();
      }
      wss.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
