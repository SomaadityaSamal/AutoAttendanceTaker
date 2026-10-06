import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startMockServer } from '../mock/server.js';
import { trustedUrl } from '../src/state.js';
import { decodeQrs } from '../src/qr.js';
import { submitFirstOption } from '../src/browser.js';

const defaults = JSON.parse(await readFile(new URL('../config.json', import.meta.url)));
test('registered mock works alongside real polls; mock-only mode still excludes them', () => {
  const origin = 'http://127.0.0.1:4177';
  assert.equal(trustedUrl(`${origin}/poll/abc`, defaults.trustedDomains), null);
  assert.equal(trustedUrl(`${origin}/poll/abc`, [], origin), `${origin}/poll/abc`);
  assert.equal(trustedUrl(`${origin}/poll/abc`, defaults.trustedDomains, origin), `${origin}/poll/abc`);
  assert.equal(trustedUrl('https://pollev.com/vsm', defaults.trustedDomains, origin), 'https://pollev.com/vsm');
  assert.equal(trustedUrl('https://pollev.com/vsm', [], origin), null);
  for (const url of ['http://127.0.0.1:4178/poll/abc', 'http://localhost:4177/poll/abc', `${origin}/`, 'http://127.0.0.1.evil.test:4177/poll/abc']) {
    assert.equal(trustedUrl(url, defaults.trustedDomains, origin), null);
  }
});

test('local mock: visible QR through Yes confirmation, popup, pause, and repeat', async () => {
  const mock = await startMockServer(0);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const config = { ...defaults, mockOrigin: mock.origin, responseWaitMs: 1500, pageTimeoutMs: 1500 };
  const preview = new URL('../.mock-run/previews/', import.meta.url);
  await mkdir(preview, { recursive: true });
  const newPoll = async settings => (await fetch(`${mock.origin}/api/new`, { method: 'POST', body: JSON.stringify(settings) })).json();
  try {
    const presenter = await context.newPage();
    await presenter.goto(mock.origin);
    await presenter.locator('#qr').waitFor({ state: 'visible' });
    await presenter.waitForFunction(() => document.querySelector('#qr').naturalWidth > 0);
    const shot = await presenter.screenshot({ path: fileURLToPath(new URL('presenter-desktop.png', preview)), fullPage: true });
    const decoded = await decodeQrs(shot);
    const pollUrl = decoded.map(qr => trustedUrl(qr.value, [], mock.origin)).find(Boolean);
    assert.ok(pollUrl, 'Presenter screenshot QR must be readable');
    const page = await context.newPage();
    await page.goto(pollUrl);
    await page.locator('#yes').waitFor({ state: 'visible' });
    await page.screenshot({ path: fileURLToPath(new URL('participant-desktop.png', preview)) });
    assert.equal((await submitFirstOption(page, config)).status, 'success');
    await page.screenshot({ path: fileURLToPath(new URL('confirmation-desktop.png', preview)) });
    await presenter.waitForFunction(() => document.querySelector('#count').textContent === '1');
    await page.reload();
    assert.equal((await submitFirstOption(page, config)).status, 'already-submitted');
    assert.equal((await (await fetch(`${mock.origin}/api/current`)).json()).count, 1);

    const withPrompt = await newPoll({ namePrompt: true });
    await page.goto(withPrompt.url);
    await page.locator('#name-dialog').waitFor({ state: 'visible' });
    await page.screenshot({ path: fileURLToPath(new URL('popup-desktop.png', preview)) });
    assert.equal((await submitFirstOption(page, config)).status, 'success');

    const paused = await newPoll({ open: false });
    await page.goto(paused.url);
    assert.equal((await submitFirstOption(page, { ...config, responseWaitMs: 600 })).status, 'needs-attention');
    assert.equal(await page.locator('#name-dialog').isVisible(), false, 'Profile button must not open a popup');
    assert.equal((await (await fetch(`${mock.origin}/api/current`)).json()).count, 0);
    await fetch(`${mock.origin}/api/settings`, { method: 'POST', body: JSON.stringify({ open: true }) });
    assert.equal((await submitFirstOption(page, config)).status, 'success');

    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await presenter.setViewportSize(viewport);
      await presenter.reload();
      await presenter.waitForFunction(() => document.querySelector('#qr').naturalWidth > 0);
      assert.ok(await presenter.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (viewport.width === 390) {
        const image = await presenter.screenshot({ path: fileURLToPath(new URL('presenter-mobile.png', preview)), fullPage: true });
        assert.ok((await decodeQrs(image)).length);
        const mobilePoll = await newPoll({ namePrompt: true });
        await page.setViewportSize(viewport);
        await page.goto(mobilePoll.url);
        await page.locator('#name-dialog').waitFor({ state: 'visible' });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.screenshot({ path: fileURLToPath(new URL('popup-mobile.png', preview)) });
        assert.equal((await submitFirstOption(page, config)).status, 'success');
        await page.screenshot({ path: fileURLToPath(new URL('confirmation-mobile.png', preview)) });
      }
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await mock.close(); }
});
