import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import QRCode from 'qrcode';
import { trustedUrl, retryAllowed, readHistory, saveHistory } from '../src/state.js';
import { decodeQrs } from '../src/qr.js';
import { submitFirstOption } from '../src/browser.js';

const config = JSON.parse(await readFile(new URL('../config.json', import.meta.url)));
test('URL trust rejects lookalikes, credentials, ports, and non-web schemes', () => {
  for (const url of ['https://pollev.com/vsm', 'https://www.polleverywhere.com/test', 'http://pollev.com/vsm']) assert.ok(trustedUrl(url, config.trustedDomains));
  for (const url of ['https://pollev.com.evil.test', 'https://evilpollev.com', 'https://pollev.com@evil.test', 'https://user@pollev.com', 'javascript:alert(1)', 'file:///tmp/x', 'https://pollev.com:444/test', 'plain text']) assert.equal(trustedUrl(url, config.trustedDomains), null);
});
test('cooldown survives history reload, including pending and failed attempts', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'attendance-state-'));
  try {
    const file = path.join(dir, 'history.json');
    assert.deepEqual(await readHistory(file), []);
    const now = Date.now();
    await saveHistory(file, [{ url: 'https://pollev.com/vsm', timestamp: new Date(now).toISOString(), status: 'pending' }]);
    const history = await readHistory(file);
    assert.equal(retryAllowed(history, history[0].url, 1000, now + 999), false);
    assert.equal(retryAllowed(history, history[0].url, 1000, now + 1000), true);
    history[0].status = 'failure';
    assert.equal(retryAllowed(history, history[0].url, 1000, now), false);
    history[0].status = 'detected';
    assert.equal(retryAllowed(history, history[0].url, 1000, now), true);
  } finally { await rm(dir, { recursive: true }); }
});
test('decodes a Poll Everywhere QR image', async () => {
  const image = await QRCode.toBuffer('https://PollEv.com/vsm?qr=1', { width: 240, margin: 4 });
  const codes = await decodeQrs(image);
  assert.ok(codes.some(code => trustedUrl(code.value, config.trustedDomains)), `Decoded: ${JSON.stringify(codes)}`);
  console.log('Screenshot QR:', codes.map(code => code.value));
});
test('Chrome submission handles options, confirmation, login, and uncertain results', async t => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const cfg = { ...config, responseWaitMs: 600, confirmationTimeoutMs: 700 };
  try {
    for (const fixture of [
      { name: 'radio followed by submit', html: '<main><button>Help</button><input type="radio" value="Yes"><button onclick="document.body.innerHTML=\'Response recorded\'">Submit</button></main>', expected: 'success' },
      { name: 'answer button auto-submit', html: '<main><button onclick="document.body.innerHTML=\'Response recorded\'">Yes</button><button>No</button></main>', expected: 'success' },
      { name: 'hidden radio with visible label', html: '<main><input hidden type="radio" id="yes"><label for="yes">Yes</label><button onclick="if(document.querySelector(\'input\').checked)document.body.innerHTML=\'Response recorded\'">Submit</button></main>', expected: 'success' },
      { name: 'login is never clicked', html: '<main><button onclick="throw Error(\'login clicked\')">Sign in</button></main>', expected: 'needs-attention' },
      { name: 'disabled button alone is not confirmation', html: '<main><button onclick="this.disabled=true">Yes</button></main>', expected: 'unconfirmed' },
      { name: 'already submitted does not click', html: '<main>Response recorded<button>Yes</button></main>', expected: 'already-submitted' },
      { name: 'screen name is confirmed unchanged before responding', html: `<main><section><h2>Update your screen name</h2><label>Name<input value="Existing Name"></label><button onclick="window.savedName=this.parentElement.querySelector('input').value;this.parentElement.remove()">Update</button><button>Cancel</button></section><button onclick="if(window.savedName==='Existing Name')document.body.innerHTML='Response recorded'">Yes</button></main>`, expected: 'success' },
      { name: 'blank screen name requires attention', html: '<main><section><h2>Update your screen name</h2><input value=" "><button>Update</button></section><button>Yes</button></main>', expected: 'needs-attention' },
      { name: 'failed name update does not count as attendance', html: '<main><section><h2>Update your screen name</h2><input value="Existing Name"><button>Update</button></section><button>Yes</button></main>', expected: 'needs-attention' },
      { name: 'other dialogs block response selection', html: '<main><div role="dialog"><button>Continue</button></div><button>Yes</button></main>', expected: 'needs-attention' },
      { name: 'responding-as button never opens the screen-name popup', html: `<main><button onclick="window.profileClicked=true">Responding as Somaaditya S SS</button><h1>Waiting for vsm's presentation</h1></main>`, expected: 'needs-attention', profileUntouched: true },
      { name: 'profile control is skipped before an attendance answer', html: `<main><button onclick="window.profileClicked=true">Responding as Somaaditya S SS</button><button onclick="document.body.innerHTML='Response recorded'">Yes</button></main>`, expected: 'success', profileUntouched: true },
      { name: 'unrecognized waiting-page buttons are not answers', html: '<main><button onclick="window.profileClicked=true">View account</button></main>', expected: 'needs-attention', profileUntouched: true },
    ]) {
      await t.test(fixture.name, async () => {
        const page = await browser.newPage();
        await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: fixture.html }));
        await page.goto('https://pollev.com/local-test');
        const result = await submitFirstOption(page, { ...cfg, pageTimeoutMs: 500, responseWaitMs: 2000 });
        assert.equal(result.status, fixture.expected);
        if (fixture.profileUntouched) assert.equal(await page.evaluate(() => Boolean(window.profileClicked)), false);
        await page.close();
      });
    }
  } finally { await browser.close(); }
});
