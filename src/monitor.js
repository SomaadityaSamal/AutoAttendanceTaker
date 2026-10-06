import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import screenshot from 'screenshot-desktop';
import sharp from 'sharp';
import { decodeQrs } from './qr.js';
import { AttendanceBrowser } from './browser.js';
import { trustedUrl, retryAllowed, readHistory, saveHistory } from './state.js';
import { acquireLock } from './lock.js';
import { alertUser } from './notify.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values: args } = parseArgs({ options: {
  'dry-run': { type: 'boolean' }, 'browser-dry-run': { type: 'boolean' },
  'once': { type: 'boolean' }, 'image': { type: 'string' },
  'login': { type: 'boolean' }, 'list-displays': { type: 'boolean' },
  'mock-test': { type: 'boolean' },
} });
const config = JSON.parse(await readFile(path.join(root, 'config.json'), 'utf8'));
for (const field of ['scanIntervalMs', 'retryCooldownMs', 'pageTimeoutMs', 'responseWaitMs', 'confirmationTimeoutMs']) {
  if (!Number.isFinite(config[field]) || config[field] <= 0) throw new Error(`Invalid config: ${field} must be positive.`);
}
if (config.clickRule !== 'first-option') throw new Error('Only first-option clickRule is supported.');
if (!Array.isArray(config.trustedDomains) || !config.trustedDomains.length || config.trustedDomains.some(d => !['pollev.com', 'polleverywhere.com'].includes(d))) {
  throw new Error('trustedDomains must contain only pollev.com and/or polleverywhere.com.');
}
if (args['dry-run'] && args['browser-dry-run']) throw new Error('Choose only one dry-run mode.');
delete config.mockOrigin;
try {
  const metadata = JSON.parse(await readFile(path.join(root, '.mock-server.json'), 'utf8'));
  const origin = new URL(metadata.origin);
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.username || origin.password) throw new Error('Invalid local mock origin.');
  config.mockOrigin = origin.origin;
} catch (error) {
  if (args['mock-test']) throw new Error(`Start the mock website with npm run mock first. ${error.message}`);
  if (error.code !== 'ENOENT') console.warn(`Local mock unavailable: ${error.message}`);
}
const storageRoot = args['mock-test'] ? path.join(root, '.mock-run') : root;
if (args['mock-test']) {
  if (args.login) throw new Error('Mock mode does not require login.');
  config.trustedDomains = [];
  await mkdir(storageRoot, { recursive: true });
  console.log(`LOCAL MOCK MODE: ${config.mockOrigin}. Real Poll Everywhere links will not be opened.`);
} else if (config.mockOrigin) {
  console.log(`Local mock enabled: ${config.mockOrigin}. Poll Everywhere links are also supported.`);
}
if (args['list-displays']) {
  console.log(await screenshot.listDisplays());
} else {
  const lockPath = path.join(storageRoot, '.monitor.lock');
  const releaseLock = acquireLock(lockPath);
  const browser = new AttendanceBrowser(storageRoot, config);
  let stopping = false;
  const stop = () => { stopping = true; void browser.close().catch(() => {}); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('SIGHUP', stop);
  const sleep = async ms => {
    const end = Date.now() + ms;
    while (!stopping && Date.now() < end) await new Promise(resolve => setTimeout(resolve, Math.min(200, end - Date.now())));
  };
  const captureFrames = () => config.displayId === null
    ? screenshot.listDisplays().then(displays => {
      if (!displays.length) throw new Error('No displays detected.');
      return Promise.all(displays.map(display => screenshot({ screen: display.id, format: 'png' })));
    }) : screenshot({ screen: config.displayId, format: 'png' }).then(frame => [frame]);
  let stage = 'startup';
  try {
    if (args.login) {
      await browser.open('https://pollev.com', true);
      console.log('Sign in in Chrome. Press Ctrl+C here when finished; the profile is saved.');
      while (!stopping && browser.context) await sleep(500);
    } else {
      const historyFile = path.join(storageRoot, 'captures/history.json');
      const history = await readHistory(historyFile);
      const seen = new Map();
      for (const folder of ['screenshots', 'qrs']) await mkdir(path.join(storageRoot, 'captures', folder), { recursive: true, mode: 0o700 });
      stage = 'screen capture';
      console.log('STARTUP: checking screen capture and saved history...');
      let initialFrames = args.image ? [await readFile(path.resolve(args.image))] : await captureFrames();
      for (const frame of initialFrames) await sharp(frame).metadata();
      if (!args['dry-run'] && !args['mock-test']) {
        stage = 'Chrome account check';
        console.log('STARTUP: checking Poll Everywhere login in the saved Chrome profile...');
        await browser.checkLogin({
          shouldStop: () => stopping,
          onRequired: () => alertUser('Login required. Sign in in the open Chrome tab. Monitoring is paused and will resume automatically once your account is verified.'),
        });
        console.log('STARTUP: Poll Everywhere account verified.');
        // Refresh after manual login so an old screenshot cannot trigger a response.
        initialFrames = null;
      }
      if (stopping) throw new Error('Startup cancelled.');
      console.log(`READY: ${args['dry-run'] ? 'screen capture verified (detection only)' : args['mock-test'] ? 'local mock monitoring' : 'screen capture and Poll Everywhere login verified'}. Monitoring started.`);
      console.log(`Attendance monitor: ${args['dry-run'] ? 'detection only' : args['browser-dry-run'] ? 'open tabs only' : 'automatic submission'}. Ctrl+C stops it.`);
      do {
        stage = 'screen capture';
        const frames = initialFrames || (args.image ? [await readFile(path.resolve(args.image))] : await captureFrames());
        initialFrames = null;
        stage = 'QR processing';
        for (const frame of frames) {
          for (const qr of await decodeQrs(frame)) {
            if (stopping) break;
            const url = trustedUrl(qr.value, config.trustedDomains, config.mockOrigin);
            const key = url || qr.value;
            if (Date.now() - (seen.get(key) || 0) < config.retryCooldownMs) continue;
            if (url && !args['dry-run'] && !args['browser-dry-run'] && !retryAllowed(history, url, config.retryCooldownMs)) continue;
            seen.set(key, Date.now());
            const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
            const screenshotPath = `captures/screenshots/${id}.png`;
            const qrPath = `captures/qrs/${id}.png`;
            await writeFile(path.join(storageRoot, screenshotPath), await sharp(frame).png().toBuffer(), { mode: 0o600 });
            await sharp(frame).extract(qr.crop).png().toFile(path.join(storageRoot, qrPath));
            const entry = { url: url || qr.value, timestamp: new Date().toISOString(), status: !url ? 'blocked' : args['dry-run'] ? 'detected' : args['browser-dry-run'] ? 'browser-dry-run' : 'pending', screenshotPath, qrPath };
            history.push(entry);
            // Persist pending before any click so a crash cannot immediately cause a duplicate response.
            await saveHistory(historyFile, history);
            if (url && !args['dry-run']) {
              try { Object.assign(entry, await browser.open(url, args['browser-dry-run'])); }
              catch (error) { Object.assign(entry, { status: 'failure', detail: error.message }); }
              entry.finishedAt = new Date().toISOString();
              await saveHistory(historyFile, history);
            }
            console.log(`${entry.status}: ${entry.url}${entry.detail ? ` (${entry.detail})` : ''}`);
            if (['failure', 'needs-attention', 'unconfirmed'].includes(entry.status)) alertUser(entry.detail || `Attendance attempt: ${entry.status}. Check the Chrome tab.`);
          }
        }
        if (args.once || args.image) break;
        await sleep(config.scanIntervalMs);
      } while (!stopping);
      if (browser.context && !stopping) {
        console.log('Scan finished. Chrome remains open for inspection. Ctrl+C closes it.');
        while (!stopping && browser.context) await sleep(500);
      }
    }
  } catch (error) {
    if (!stopping) {
      alertUser(`${stage}: ${error.message}`);
      if (stage === 'screen capture' && !args.image) console.error('Enable Screen Recording for your terminal or Codex in macOS System Settings > Privacy & Security, then restart that app.');
      process.exitCode = 1;
    }
  } finally {
    try { await browser.close(); }
    finally { releaseLock(); }
  }
}
