import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { loginState, waitForLogin } from '../src/login.js';

test('startup verifies account evidence, pauses for login, and rejects ambiguous pages', async t => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    await t.test('signed-in settings is ready; anonymous screen name is not evidence', async () => {
      const page = await browser.newPage();
      await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main>Settings<button>Logout</button></main>' }));
      await waitForLogin(page, { timeoutMs: 3000 });
      assert.equal(await loginState(page), 'ready');
      await page.setContent('<button>Responding as Test Name</button>');
      assert.equal(await loginState(page), 'unknown');
      await page.close();
    });
    await t.test('expired login triggers alert and resumes after sign-in', async () => {
      const page = await browser.newPage();
      let signedIn = false;
      let alerts = 0;
      await page.route('**/*', route => {
        if (route.request().url().startsWith('https://pollev.com/settings') && !signedIn) return route.fulfill({ status: 302, headers: { location: 'https://id.polleverywhere.com/login' } });
        return route.fulfill({ contentType: 'text/html', body: signedIn ? '<a href="/logout">Logout</a>' : '<h1>Sign in</h1><input type="email">' });
      });
      await waitForLogin(page, { timeoutMs: 3000, onRequired: async () => {
        alerts++;
        assert.equal(await loginState(page), 'required');
        signedIn = true;
        await page.goto('https://pollev.com/');
      } });
      assert.equal(alerts, 1);
      assert.equal(await loginState(page), 'ready');
      await page.close();
    });
    await t.test('unknown page cannot produce ready', async () => {
      const page = await browser.newPage();
      await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<h1>Service unavailable</h1>' }));
      await assert.rejects(waitForLogin(page, { timeoutMs: 300 }), /Could not verify/);
      await page.close();
    });
    await t.test('network failure is reported', async () => {
      const page = await browser.newPage();
      await page.route('**/*', route => route.abort('internetdisconnected'));
      await assert.rejects(waitForLogin(page, { timeoutMs: 500 }));
      await page.close();
    });
  } finally { await browser.close(); }
});
