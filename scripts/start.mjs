/* global process, console */
// `pnpm start`: runs the built relay, owner app and shop viewer on one port (default 8080).
// Works the same on Windows, macOS and Linux. Run `pnpm build` first.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = path.join(root, 'adapters/node/dist/main.mjs');
const owner = path.join(root, 'apps/owner/dist');
const viewer = path.join(root, 'apps/viewer/dist');

for (const p of [server, owner, viewer]) {
  if (!existsSync(p)) {
    console.error(`Missing ${path.relative(root, p)}. Run "pnpm build" first.`);
    process.exit(1);
  }
}

const port = process.env.PORT ?? '8080';
console.log(`Despawn is starting on http://localhost:${port}/app/`);
console.log(
  'For a phone or another computer you need HTTPS, for example: cloudflared tunnel --url http://localhost:' +
    port,
);

const child = spawn(process.execPath, [server], {
  stdio: 'inherit',
  env: { ...process.env, PORT: port, OWNER_DIST: owner, VIEWER_DIST: viewer },
});
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
