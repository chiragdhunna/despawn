/* global console, process */
// Guards the shop viewer build: ES2018 only, small, self-contained, no storage, no inline code.
import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { parse } from 'acorn';

const dist = path.resolve('apps/viewer/dist');
const BUDGET_GZIP = 100 * 1024;
const FORBIDDEN = [
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'document.cookie',
  'XMLHttpRequest',
  'importScripts',
  'serviceWorker',
  'eval(',
  'new Function',
  'innerHTML',
  'BigInt',
];
const problems = [];
let gz = 0;
const assets = path.join(dist, 'assets');
for (const f of readdirSync(assets).filter((n) => n.endsWith('.js'))) {
  const src = readFileSync(path.join(assets, f), 'utf8');
  gz += gzipSync(src).length;
  try {
    parse(src, { ecmaVersion: 2018, sourceType: 'module' });
  } catch (e) {
    problems.push(`${f}: not valid ES2018 (${e.message})`);
  }
  for (const w of FORBIDDEN) if (src.includes(w)) problems.push(`${f}: contains forbidden "${w}"`);
  // Explanatory text may mention "http://"; a real absolute URL with a host would be a remote request.
  const remote = src.match(/https?:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi);
  if (remote)
    problems.push(`${f}: contains absolute URL(s): ${[...new Set(remote)].slice(0, 3).join(', ')}`);
}
const html = readFileSync(path.join(dist, 'index.html'), 'utf8');
if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) problems.push('index.html has an inline script');
if (/<style[\s>]/i.test(html) || /\sstyle=/i.test(html))
  problems.push('index.html has inline style');
if (/(src|href)=["']https?:/i.test(html)) problems.push('index.html loads a remote resource');
const css = readdirSync(assets)
  .filter((n) => n.endsWith('.css'))
  .map((n) => readFileSync(path.join(assets, n), 'utf8'))
  .join('');
if (/url\(["']?(https?:|data:)/i.test(css) || /@import\s+url\(["']?https?:/i.test(css))
  problems.push('css references a remote or data: url');
if (gz > BUDGET_GZIP) problems.push(`js gzip ${gz} bytes exceeds ${BUDGET_GZIP}`);
if (problems.length) {
  console.error('viewer bundle check FAILED:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log(
  `viewer bundle OK: ES2018, ${gz} bytes gzip (budget ${BUDGET_GZIP}), no storage, no inline code, no remote URLs`,
);
