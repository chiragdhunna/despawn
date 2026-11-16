import { deflateSync, crc32 } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, type RunningServer } from '@despawn/adapter-node';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function launch(): Promise<Browser> {
  const executablePath = process.env.CHROMIUM_PATH;
  const extra: string[] = process.env.CHROMIUM_ARGS
    ? (JSON.parse(process.env.CHROMIUM_ARGS) as string[])
    : [];
  return chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', ...extra],
  });
}

export async function startApp(): Promise<RunningServer> {
  return startServer({
    ownerDist: path.join(root, 'apps/owner/dist'),
    viewerDist: path.join(root, 'apps/viewer/dist'),
    createsPerMinutePerIp: 1000,
  });
}

/** A one-page A4 PDF made of rectangles only (no fonts needed): red block, blue block, black rule. */
export function makePdf(): Buffer {
  const content =
    '1 0 0 rg 100 600 300 150 re f 0 0 1 rg 100 300 300 150 re f 0 g 50 50 495 6 re f';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** A solid-colour PNG (8-bit RGB). */
export function makePng(w: number, h: number, rgb: [number, number, number]): Buffer {
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Records CSP violations and uncaught errors so tests can assert there were none. */
export async function watch(page: Page): Promise<() => Promise<string[]>> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { __csp: string[] }).__csp.push(
        `${e.violatedDirective} ${e.blockedURI}`,
      );
    });
  });
  return async () => {
    const csp = await page
      .evaluate(() => (window as unknown as { __csp: string[] }).__csp)
      .catch(() => []);
    return [...errors, ...csp.map((c) => `csp: ${c}`)];
  };
}

/** Replaces window.print so headless runs behave like a printer that finished immediately. */
export async function stubPrint(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __printCalls: number };
    w.__printCalls = 0;
    window.print = () => {
      w.__printCalls++;
      setTimeout(() => window.dispatchEvent(new Event('afterprint')), 50);
    };
  });
}

export async function newPages(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    viewport: { width: 1000, height: 900 },
    acceptDownloads: false,
  });
  return { ctx, page: await ctx.newPage() };
}

/** Owner: import a file, accept defaults (or tweak), lock, and return the share link. */
export async function ownerCreateLink(
  owner: Page,
  baseUrl: string,
  file: { name: string; mimeType: string; buffer: Buffer },
  tweak?: (p: Page) => Promise<void>,
): Promise<string> {
  await owner.goto(`${baseUrl}/app/`);
  await owner.setInputFiles('[data-testid=file-input]', file);
  await owner.waitForSelector('[data-screen=prepare]', { timeout: 60_000 });
  await owner.waitForSelector('[data-testid=preview][data-ready]', { timeout: 60_000 });
  if (tweak) await tweak(owner);
  await owner.getByTestId('prepare-continue').click();
  await owner.getByTestId('rules-lock').click();
  await owner.getByTestId('share-link').waitFor({ timeout: 90_000 });
  return (await owner.getByTestId('share-link').innerText()).trim();
}

export async function holdApprove(owner: Page, index = 0): Promise<void> {
  const b = owner.getByTestId('hold-approve').nth(index);
  const box = await b.boundingBox();
  if (!box) throw new Error('hold button not visible');
  await owner.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await owner.mouse.down();
  await owner.waitForTimeout(1300);
  await owner.mouse.up();
}

/** Counts strongly red pixels in the first page image shown on the shop screen. */
export async function redPixels(shop: Page): Promise<number> {
  return shop.evaluate(async () => {
    const img = document.querySelector<HTMLImageElement>('.pageimg');
    if (!img) return -1;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    if (!ctx) return -1;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4)
      if ((d[i] ?? 0) > 180 && (d[i + 1] ?? 255) < 90 && (d[i + 2] ?? 255) < 90) n++;
    return n;
  });
}

/** Everything the shop page could have left behind in the browser. */
export async function browserResidue(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(async () => ({
    localStorage: localStorage.length,
    sessionStorage: sessionStorage.length,
    cookie: document.cookie,
    indexedDB: 'databases' in indexedDB ? (await indexedDB.databases()).length : 0,
    caches: 'caches' in window ? (await caches.keys()).length : 0,
    serviceWorkers:
      'serviceWorker' in navigator ? (await navigator.serviceWorker.getRegistrations()).length : 0,
    images: Array.from(document.images).map((i) => i.className || i.alt),
    canvases: document.getElementsByTagName('canvas').length,
    url: location.href,
  }));
}

export type { RunningServer };
