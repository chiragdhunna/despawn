import { startServer } from './server.js';

const env = process.env;
const num = (v: string | undefined, d: number): number =>
  v !== undefined && v !== '' ? Number(v) : d;

const server = await startServer({
  port: num(env.PORT, 8080),
  host: env.HOST ?? '0.0.0.0',
  ownerDist: env.OWNER_DIST,
  viewerDist: env.VIEWER_DIST,
  blobDir: env.BLOB_DIR,
  trustProxy: env.TRUST_PROXY === 'true',
  config: {
    maxBlobBytes: num(env.MAX_BLOB_BYTES, 26214400),
    maxSessionsPerDay: num(env.MAX_SESSIONS_PER_DAY, 10000),
    maxActiveSessions: num(env.MAX_ACTIVE_SESSIONS, 1000),
  },
  logger: {
    // Content-free structured events only
    event: (name, fields) => console.log(JSON.stringify({ t: Date.now(), event: name, ...fields })),
  },
});

console.log(JSON.stringify({ t: Date.now(), event: 'listening', port: server.port }));

const stop = (): void => {
  void server.close().then(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
