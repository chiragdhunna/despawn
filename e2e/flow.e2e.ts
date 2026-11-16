import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  browserResidue,
  holdApprove,
  launch,
  makePdf,
  makePng,
  newPages,
  ownerCreateLink,
  redPixels,
  startApp,
  stubPrint,
  watch,
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

const pdf = () => ({ name: 'doc.pdf', mimeType: 'application/pdf', buffer: makePdf() });

async function settle(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const s = await srv.inspect();
    if (s.sessions === 0 && s.blobs === 0) return;
    await new Promise((r) => setTimeout(r, 250));
  }
}

describe('complete flow in real browsers', () => {
  it('imports a PDF, shows the code on both screens, approves, renders, prints and wipes', async () => {
    const o = await newPages(browser);
    const s = await newPages(browser);
    const ownerErrors = await watch(o.page);
    const shopErrors = await watch(s.page);
    await stubPrint(s.page);
    const putBodies: Buffer[] = [];
    o.page.on('request', (r) => {
      if (r.method() === 'PUT' && r.url().includes('/blob'))
        putBodies.push(r.postDataBuffer() ?? Buffer.alloc(0));
    });
    const shopBlobRequests: string[] = [];
    s.page.on('request', (r) => {
      if (r.url().includes('/blob')) shopBlobRequests.push(r.url());
    });

    const link = await ownerCreateLink(o.page, srv.url, pdf());
    expect(link).toMatch(/\/s\/[A-Za-z0-9_-]{22}#[A-Za-z0-9_-]{22}$/);

    await s.page.goto(link);
    await s.page.waitForSelector('[data-screen=waiting]');
    const shopCode = (await s.page.locator('[data-code]').getAttribute('data-code'))!;
    expect(shopCode).toMatch(/^\d{4}$/);
    expect((await browserResidue(s.page)).url).not.toContain('#'); // link secret removed from the address bar
    expect(await s.page.locator('.pageimg').count()).toBe(0); // nothing visible before approval
    expect(shopBlobRequests).toEqual([]); // and no ciphertext fetched

    await o.page.getByTestId('takeover').waitFor();
    expect(await o.page.getByTestId('sas').getAttribute('data-code')).toBe(shopCode);
    await holdApprove(o.page);

    await s.page.waitForSelector('[data-screen=ready]', { timeout: 30_000 });
    expect(await redPixels(s.page)).toBeGreaterThan(5000);
    await o.page.waitForSelector('[data-testid=live-status]');

    // print layout: exactly one A4 page
    await s.page.getByRole('button', { name: 'Print', exact: true }).click();
    await s.page.waitForSelector('[data-screen=confirm]');
    expect(
      await s.page.evaluate(() => (window as unknown as { __printCalls: number }).__printCalls),
    ).toBe(1);
    await s.page.emulateMedia({ media: 'print' });
    const printed = (await s.page.pdf({ preferCSSPageSize: true, printBackground: true })).toString(
      'latin1',
    );
    await s.page.emulateMedia({ media: 'screen' });
    const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(printed);
    expect(Number(box?.[1])).toBeCloseTo(595.28, 0);
    expect(Number(box?.[2])).toBeCloseTo(841.89, 0);
    expect((printed.match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(1);

    await s.page.getByRole('button', { name: 'Yes, printed' }).click();
    await s.page.waitForSelector('[data-screen=destroyed]', { timeout: 30_000 });
    await expect(s.page.locator('[data-reason]').getAttribute('data-reason')).resolves.toBe(
      'reason.PRINTED',
    );

    const residue = await browserResidue(s.page);
    expect(residue).toMatchObject({
      localStorage: 0,
      sessionStorage: 0,
      cookie: '',
      indexedDB: 0,
      caches: 0,
      serviceWorkers: 0,
      canvases: 0,
    });
    expect(residue.images).toEqual(['logo']); // no page image left anywhere
    expect(
      await s.page
        .locator('img')
        .evaluateAll((els) =>
          els.map((e) => (e as HTMLImageElement).src).filter((u) => u.startsWith('blob:')),
        ),
    ).toEqual([]);

    await o.page.waitForSelector('[data-testid=receipt]');
    expect(await o.page.getByTestId('receipt-prints').innerText()).toBe('1');
    await expect(o.page.getByTestId('receipt-shopwipe').getAttribute('class')).resolves.toBe('ok');

    // what the relay saw: only ciphertext
    expect(putBodies).toHaveLength(1);
    const body = putBodies[0]!.toString('latin1');
    for (const needle of ['JFIF', 'Exif', 'PDF', 'IHDR']) expect(body.includes(needle)).toBe(false);
    expect(shopBlobRequests).toHaveLength(1);
    await settle();
    expect(await srv.inspect()).toEqual({ sessions: 0, blobs: 0 });
    expect(await ownerErrors()).toEqual([]);
    expect(await shopErrors()).toEqual([]);
    await o.ctx.close();
    await s.ctx.close();
  });

  it('two browsers open the link: separate codes, only the approved one gets the document', async () => {
    const o = await newPages(browser);
    const a = await newPages(browser);
    const b = await newPages(browser);
    const link = await ownerCreateLink(o.page, srv.url, pdf());
    const blobFetches: string[] = [];
    b.page.on('request', (r) => {
      if (r.url().includes('/blob')) blobFetches.push(r.url());
    });
    await a.page.goto(link);
    await a.page.waitForSelector('[data-screen=waiting]');
    await b.page.goto(link);
    await b.page.waitForSelector('[data-screen=waiting]');
    const codeA = (await a.page.locator('[data-code]').getAttribute('data-code'))!;
    const codeB = (await b.page.locator('[data-code]').getAttribute('data-code'))!;
    expect(codeA).not.toBe(codeB);

    await o.page.waitForFunction(
      () => document.querySelectorAll('[data-testid=request]').length === 2,
    );
    const codes = await o.page
      .locator('[data-testid=sas]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-code')));
    expect(codes.sort()).toEqual([codeA, codeB].sort());
    const index = (
      await o.page
        .locator('[data-testid=sas]')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-code')))
    ).indexOf(codeB);
    await holdApprove(o.page, index);

    await b.page.waitForSelector('[data-screen=ready]', { timeout: 30_000 });
    await a.page.waitForSelector('[data-screen=destroyed]', { timeout: 15_000 });
    expect(await a.page.locator('.pageimg').count()).toBe(0);
    expect(blobFetches).toHaveLength(1);
    await o.page.getByTestId('destroy-now').click();
    await o.page.waitForSelector('[data-testid=receipt]', { timeout: 15_000 });
    await settle();
    await Promise.all([o.ctx.close(), a.ctx.close(), b.ctx.close()]);
  });

  it('deny sends the shop away and the owner keeps waiting', async () => {
    const o = await newPages(browser);
    const s = await newPages(browser);
    const link = await ownerCreateLink(o.page, srv.url, pdf());
    await s.page.goto(link);
    await o.page.getByTestId('takeover').waitFor();
    await o.page.getByTestId('deny').click();
    await s.page.waitForSelector('[data-screen=destroyed]');
    expect(await s.page.locator('[data-reason]').getAttribute('data-reason')).toBe('reason.DENIED');
    await o.page.getByTestId('armed-status').waitFor();
    await o.page.getByTestId('cancel-session').click();
    await o.page.waitForSelector('[data-testid=receipt]', { timeout: 15_000 });
    await settle();
    await Promise.all([o.ctx.close(), s.ctx.close()]);
  });

  it('owner Destroy now wipes the shop page within seconds', async () => {
    const o = await newPages(browser);
    const s = await newPages(browser);
    await stubPrint(s.page);
    const link = await ownerCreateLink(o.page, srv.url, pdf());
    await s.page.goto(link);
    await o.page.getByTestId('takeover').waitFor();
    await holdApprove(o.page);
    await s.page.waitForSelector('[data-screen=ready]', { timeout: 30_000 });
    await o.page.getByTestId('destroy-now').click();
    await s.page.waitForSelector('[data-screen=destroyed]', { timeout: 10_000 });
    expect(await s.page.locator('[data-reason]').getAttribute('data-reason')).toBe(
      'reason.OWNER_KILLED',
    );
    expect((await browserResidue(s.page)).images).toEqual(['logo']);
    await o.page.waitForSelector('[data-testid=receipt]', { timeout: 15_000 });
    await expect(o.page.getByTestId('receipt-shopwipe').getAttribute('class')).resolves.toBe('ok');
    await settle();
    await Promise.all([o.ctx.close(), s.ctx.close()]);
  });

  it('the shop page wipes itself when its connection to the owner is lost', async () => {
    const o = await newPages(browser);
    const s = await newPages(browser);
    const link = await ownerCreateLink(o.page, srv.url, pdf());
    await s.page.goto(link);
    await o.page.getByTestId('takeover').waitFor();
    await holdApprove(o.page);
    await s.page.waitForSelector('[data-screen=ready]', { timeout: 30_000 });
    await s.ctx.setOffline(true);
    await s.page.waitForSelector('[data-screen=destroyed]', { timeout: 20_000 });
    expect((await browserResidue(s.page)).images).toEqual(['logo']);
    await o.page.waitForSelector('[data-testid=receipt]', { timeout: 20_000 });
    await settle();
    await Promise.all([o.ctx.close(), s.ctx.close()]);
  });

  it('an ID card image prints as a 300 dpi A4 sheet', async () => {
    const o = await newPages(browser);
    const s = await newPages(browser);
    await stubPrint(s.page);
    const link = await ownerCreateLink(
      o.page,
      srv.url,
      { name: 'card.png', mimeType: 'image/png', buffer: makePng(1011, 638, [200, 30, 30]) },
      async (p) => {
        await p.getByTestId('layout-idcard').click();
        await p.waitForSelector('[data-testid=preview][data-ready]');
      },
    );
    await s.page.goto(link);
    await o.page.getByTestId('takeover').waitFor();
    await holdApprove(o.page);
    await s.page.waitForSelector('[data-screen=ready]', { timeout: 30_000 });
    const size = await s.page.evaluate(() => {
      const i = document.querySelector<HTMLImageElement>('.pageimg')!;
      return [i.naturalWidth, i.naturalHeight];
    });
    expect(size).toEqual([2480, 3508]);
    expect(await redPixels(s.page)).toBeGreaterThan(50_000);
    await o.page.getByTestId('destroy-now').click();
    await s.page.waitForSelector('[data-screen=destroyed]', { timeout: 10_000 });
    await settle();
    await Promise.all([o.ctx.close(), s.ctx.close()]);
  });

  it('rejects links that are malformed or missing the secret', async () => {
    const o = await newPages(browser);
    const link = await ownerCreateLink(o.page, srv.url, pdf());
    const s = await newPages(browser);
    await s.page.goto(link.split('#')[0]!); // no secret
    await s.page.waitForSelector('[data-screen=invalid]');
    await s.page.goto(`${srv.url}/s/short#abc`);
    await s.page.waitForSelector('[data-screen=invalid]');
    expect(await o.page.locator('[data-testid=takeover]').count()).toBe(0);
    await o.page.getByTestId('cancel-session').click();
    await o.page.waitForSelector('[data-testid=receipt]', { timeout: 15_000 });
    await settle();
    await Promise.all([o.ctx.close(), s.ctx.close()]);
  });
});
