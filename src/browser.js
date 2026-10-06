import { chromium } from 'playwright';
import { trustedUrl } from './state.js';
import { waitForLogin } from './login.js';

const confirmedText = /(?:response|answer|attendance) (?:has been |was |is )?(?:recorded|submitted|received)|thank you for (?:responding|participating)|you (?:have |already )?(?:responded|submitted)|response recorded/i;
const excluded = /log ?in|sign ?in|sign ?up|register|cookie|accept|decline|privacy|help|menu|next|back|submit|send|vote|presentation|share|edit|delete|reset|clear|logout|log out|update|cancel|responding as|screen name|profile|settings|home|history/i;
const attendanceAnswer = /^(yes|no|present|here|i(?:'m| am) here|take attendance|mark (?:my )?attendance|check[ -]?in)$/i;

async function handleScreenName(page, config) {
  const title = page.getByText('Update your screen name', { exact: true }).filter({ visible: true }).first();
  if (!await title.isVisible()) return null;
  // The site may render a drawer without an accessible dialog role.
  const panel = title.locator('xpath=ancestor::*[.//input][1]');
  const name = panel.locator('input:not([type]), input[type="text"], textarea').filter({ visible: true }).first();
  const update = panel.getByRole('button', { name: 'Update', exact: true }).first();
  if (!await name.isVisible() || !(await name.inputValue()).trim()) {
    return { status: 'needs-attention', detail: 'The screen-name prompt needs a name. Fill it in and click Update in Chrome, then retry.' };
  }
  if (!await update.isVisible() || !await update.isEnabled()) {
    return { status: 'needs-attention', detail: 'The screen-name prompt cannot be confirmed. Check it in Chrome.' };
  }
  await update.click();
  try { await title.waitFor({ state: 'hidden', timeout: config.pageTimeoutMs }); }
  catch (error) {
    if (error.name !== 'TimeoutError') throw error;
    return { status: 'needs-attention', detail: 'The screen-name prompt stayed open after Update. Check it in Chrome.' };
  }
  return null;
}

async function confirmed(page, config) {
  if (config.confirmationSelector && await page.locator(config.confirmationSelector).first().isVisible()) return true;
  return confirmedText.test(await page.locator('body').innerText());
}

async function firstOption(page, config) {
  const selectors = config.responseSelector ? [config.responseSelector] : [
    'input[type="radio"], [role="radio"], label:has(input[type="radio"]), label[for]',
    '[data-testid*="answer"], [data-testid*="option"], button[class*="answer"], button[class*="option"], [role="button"][class*="option"]',
    'main button, [role="main"] button, form button',
  ];
  for (const selector of selectors) {
    for (const candidate of await page.locator(selector).all()) {
      const validLabel = await candidate.evaluate(el => el.tagName !== 'LABEL' || (el.control?.type === 'radio' && !el.control.disabled));
      if (!validLabel) continue;
      if (!await candidate.isVisible() || !await candidate.isEnabled()) continue;
      const label = (await candidate.innerText() || await candidate.getAttribute('aria-label') || await candidate.getAttribute('value') || '').trim();
      if (excluded.test(label)) continue;
      // Generic main-content buttons include account controls on the waiting page.
      if (selector === 'main button, [role="main"] button, form button' && !attendanceAnswer.test(label)) continue;
      return candidate;
    }
  }
  return null;
}

export async function submitFirstOption(page, config) {
  const deadline = Date.now() + config.responseWaitMs;
  let option;
  while (Date.now() < deadline) {
    if (!trustedUrl(page.url(), config.trustedDomains, config.mockOrigin)) {
      await page.waitForTimeout(500);
      continue;
    }
    const promptResult = await handleScreenName(page, config);
    if (promptResult) return promptResult;
    if (!trustedUrl(page.url(), config.trustedDomains, config.mockOrigin)) continue;
    if (await page.locator('[role="dialog"], [aria-modal="true"], dialog[open]').filter({ visible: true }).count()) {
      return { status: 'needs-attention', detail: 'A dialog is blocking the response page. Check the open Chrome tab.' };
    }
    if (await confirmed(page, config)) return { status: 'already-submitted' };
    option = await firstOption(page, config);
    if (option) break;
    await page.waitForTimeout(500);
  }
  if (!option) return { status: 'needs-attention', detail: 'No response option found. Sign in, check whether the poll is open, or configure responseSelector.' };
  const choice = (await option.innerText() || await option.getAttribute('value') || await option.getAttribute('aria-label') || 'First response option').trim();
  await option.click();
  const end = Date.now() + config.confirmationTimeoutMs;
  let submitted = false;
  while (Date.now() < end) {
    if (!trustedUrl(page.url(), config.trustedDomains, config.mockOrigin)) return { status: 'unconfirmed', choice, detail: 'Navigated away from trusted attendance domains.' };
    if (await confirmed(page, config)) return { status: 'success', choice };
    if (!submitted) {
      const submit = page.getByRole('button', { name: /^(submit(?: response| answer)?|send|vote)$/i }).first();
      if (await submit.isVisible() && await submit.isEnabled()) {
        await submit.click();
        submitted = true;
      }
    }
    await page.waitForTimeout(250);
  }
  return { status: 'unconfirmed', choice, detail: 'Option clicked, but no explicit response confirmation appeared. Inspect the open tab.' };
}

export class AttendanceBrowser {
  constructor(root, config) { this.root = root; this.config = config; }
  async launch() {
    if (!this.context) {
      this.context = await chromium.launchPersistentContext(`${this.root}/.chrome-profile`, {
        channel: 'chrome', headless: false, viewport: null,
        handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
      });
      this.context.setDefaultTimeout(this.config.pageTimeoutMs);
      this.context.on('close', () => { this.context = null; });
    }
    return this.context;
  }
  async open(url, dryRun = false) {
    if (!trustedUrl(url, this.config.trustedDomains, this.config.mockOrigin)) throw new Error('Untrusted QR URL');
    const context = await this.launch();
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.config.pageTimeoutMs });
    if (dryRun) return { status: 'browser-dry-run' };
    console.log('Waiting for a response option. If Chrome requests login, sign in in its open tab.');
    return submitFirstOption(page, this.config);
  }
  async checkLogin(options = {}) {
    const context = await this.launch();
    const page = await context.newPage();
    await waitForLogin(page, { timeoutMs: this.config.pageTimeoutMs, ...options });
    await page.close();
  }
  async close() { await this.context?.close(); }
}
