import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launch, newPages, startApp } from './helpers.js';

let browser: Awaited<ReturnType<typeof launch>>;
let srv: Awaited<ReturnType<typeof startApp>>;

// despawn.test resolves to this machine but is not "localhost", so it is NOT a secure context,
// exactly like opening http://192.168.x.x:8080 on a phone.
beforeAll(async () => {
  browser = await launch(['--host-resolver-rules=MAP despawn.test 127.0.0.1']);
  srv = await startApp();
});
afterAll(async () => {
  await browser?.close();
  await srv?.close();
});

describe('plain http on a non-localhost address', () => {
  it('owner app explains the problem and blocks starting a job', async () => {
    const { page, ctx } = await newPages(browser);
    await page.goto(`http://despawn.test:${srv.port}/app/`);
    expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
    const notice = page.getByTestId('insecure-notice');
    await notice.waitFor();
    expect(await notice.innerText()).toContain('HTTPS');
    expect(await page.getByTestId('new-job').isDisabled()).toBe(true);
    await ctx.close();
  });

  it('shop viewer explains the problem instead of failing silently', async () => {
    const { page, ctx } = await newPages(browser);
    await page.goto(
      `http://despawn.test:${srv.port}/s/AAAAAAAAAAAAAAAAAAAAAA#AAAAAAAAAAAAAAAAAAAAAA`,
    );
    await page.waitForSelector('[data-screen=insecure]');
    expect(await page.locator('main').innerText()).toContain('https://');
    expect((await srv.inspect()).sessions).toBe(0);
    await ctx.close();
  });

  it('the same pages work on localhost (a secure context)', async () => {
    const { page, ctx } = await newPages(browser);
    await page.goto(`${srv.url}/app/`);
    expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
    expect(await page.getByTestId('insecure-notice').count()).toBe(0);
    expect(await page.getByTestId('new-job').isDisabled()).toBe(false);
    await ctx.close();
  });
});
