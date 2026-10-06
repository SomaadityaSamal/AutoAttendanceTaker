export async function loginState(page) {
  const url = new URL(page.url());
  if (url.hostname === 'id.polleverywhere.com' || /\/(?:login|sign_in)(?:\/|$)/.test(url.pathname)) return 'required';
  if (url.hostname !== 'pollev.com' || url.pathname !== '/settings') return 'unknown';
  const logout = page.getByRole('button', { name: /^log\s*out$/i }).or(page.getByRole('link', { name: /^log\s*out$/i }));
  for (const control of await logout.all()) if (await control.isVisible()) return 'ready';
  return 'unknown';
}

export async function waitForLogin(page, { timeoutMs = 30000, shouldStop = () => false, onRequired = () => {} } = {}) {
  await page.goto('https://pollev.com/settings', { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  let deadline = Date.now() + timeoutMs;
  let waiting = false;
  while (!shouldStop()) {
    const state = await loginState(page);
    if (state === 'ready') return;
    if (state === 'required') {
      if (!waiting) { waiting = true; await onRequired(); }
      // Manual sign-in may take arbitrarily long, especially with institutional SSO.
      deadline = Date.now() + timeoutMs;
    } else if (waiting && new URL(page.url()).hostname === 'pollev.com' && new URL(page.url()).pathname !== '/settings') {
      await page.goto('https://pollev.com/settings', { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      deadline = Date.now() + timeoutMs;
    } else if (waiting && !['pollev.com', 'www.polleverywhere.com'].includes(new URL(page.url()).hostname)) {
      deadline = Date.now() + timeoutMs;
    } else if (Date.now() >= deadline) {
      throw new Error('Could not verify the Poll Everywhere login. Check the account tab in Chrome and your internet connection, then restart.');
    }
    await page.waitForTimeout(500);
  }
  throw new Error('Startup cancelled.');
}
