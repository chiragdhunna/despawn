import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  holdApprove,
  launch,
  makePdf,
  newPages,
  ownerCreateLink,
  startApp,
  stubPrint,
  type RunningServer,
} from './helpers.js';

let browser: Browser;
let srv: RunningServer;
beforeAll(async () => {
  browser = await launch();
  srv = await startApp();
});
afterAll(async () => {
  await browser?.close();
  await srv?.close();
});

async function toReady(): Promise<{
  o: Awaited<ReturnType<typeof newPages>>;
  s: Awaited<ReturnType<typeof newPages>>;
}> {
  const o = await newPages(browser);
  const s = await newPages(browser);
  await stubPrint(s.page);
  const link = await ownerCreateLink(o.page, srv.url, {
    name: 'doc.pdf',
    mimeType: 'application/pdf',
    buffer: makePdf(),
  });
  await s.page.goto(link);
  await o.page.getByTestId('takeover').waitFor();
  await holdApprove(o.page);
  await s.page.waitForSelector('[data-screen=ready]', { timeout: 30_000 });
  return { o, s };
}

/** Reads the printed output the way the browser would, and checks the page image is on it. */
async function printedPdf(s: { page: import('playwright-core').Page }): Promise<string> {
  await s.page.emulateMedia({ media: 'print' });
  const buf = await s.page.pdf({ preferCSSPageSize: true, printBackground: true });
  await s.page.emulateMedia({ media: 'screen' });
  if (process.env.DESPAWN_E2E_SAVE_PDF)
    (await import('node:fs')).writeFileSync(process.env.DESPAWN_E2E_SAVE_PDF, buf);
  return buf.toString('latin1');
}

describe('printing works however it is started', () => {
  it('the printable page exists as soon as the document is ready (so Ctrl+P is not blank)', async () => {
    const { o, s } = await toReady();
    const state = await s.page.evaluate(() => {
      const root = document.getElementById('print-root');
      const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('#print-root img'));
      return {
        exists: root !== null,
        screenDisplay: root ? getComputedStyle(root).display : null,
        loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
        total: imgs.length,
        path: location.pathname,
        hash: location.hash,
      };
    });
    expect(state).toEqual({
      exists: true,
      screenDisplay: 'none',
      loaded: 1,
      total: 1,
      path: '/',
      hash: '',
    });

    // nobody pressed our Print button: this is what Ctrl+P would print
    const pdf = await printedPdf(s);
    expect((pdf.match(/\/Subtype\s*\/Image/g) ?? []).length).toBe(1);
    const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf);
    expect(Number(box?.[1])).toBeCloseTo(595.28, 0);
    expect(Number(box?.[2])).toBeCloseTo(841.89, 0);
    await o.page.getByTestId('destroy-now').click();
    await s.page.waitForSelector('[data-screen=destroyed]');
    expect(await s.page.evaluate(() => document.getElementById('print-root'))).toBeNull();
    await Promise.all([o.ctx.close(), s.ctx.close()]);
  });

  it('Ctrl+P (browser events without our button) moves to the "did it print" question', async () => {
    const { o, s } = await toReady();
    await s.page.evaluate(() => {
      window.dispatchEvent(new Event('beforeprint'));
      setTimeout(() => window.dispatchEvent(new Event('afterprint')), 30);
    });
    await s.page.waitForSelector('[data-screen=confirm]', { timeout: 10_000 });
    expect(
      await s.page.evaluate(() => (window as unknown as { __printCalls: number }).__printCalls),
    ).toBe(0);
    await s.page.getByRole('button', { name: 'Yes, printed' }).click();
    await s.page.waitForSelector('[data-screen=destroyed]', { timeout: 30_000 });
    await o.page.waitForSelector('[data-testid=receipt]', { timeout: 15_000 });
    expect(await o.page.getByTestId('receipt-prints').innerText()).toBe('1');
    await Promise.all([o.ctx.close(), s.ctx.close()]);
  });

  it('the Print button still works and Print again reprints without a second printStarted', async () => {
    const { o, s } = await toReady();
    await s.page.getByRole('button', { name: 'Print', exact: true }).click();
    await s.page.waitForSelector('[data-screen=confirm]', { timeout: 10_000 });
    await s.page.getByRole('button', { name: 'Print again' }).click();
    await s.page.waitForSelector('[data-screen=confirm]', { timeout: 10_000 });
    expect(
      await s.page.evaluate(() => (window as unknown as { __printCalls: number }).__printCalls),
    ).toBe(2);
    expect((await printedPdf(s)).match(/\/Subtype\s*\/Image/g)?.length).toBe(1);
    await o.page.getByTestId('destroy-now').click();
    await Promise.all([o.ctx.close(), s.ctx.close()]);
  });
});
