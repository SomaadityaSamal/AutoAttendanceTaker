import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';

export function trustedUrl(value, domains, mockOrigin) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (mockOrigin) {
      const origin = new URL(mockOrigin);
      if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1') return null;
      if (url.origin === origin.origin && /^\/poll\/[a-f0-9-]+$/.test(url.pathname)) {
        url.hash = '';
        return url.href;
      }
    }
    if (url.port) return null;
    if (!domains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

export function retryAllowed(history, url, cooldown, now = Date.now()) {
  return !history.some(entry => entry.url === url && !['detected', 'browser-dry-run', 'blocked'].includes(entry.status)
    && now - Date.parse(entry.timestamp) < cooldown);
}

export async function readHistory(file) {
  try {
    const history = JSON.parse(await readFile(file, 'utf8'));
    if (!Array.isArray(history) || history.some(e => typeof e.url !== 'string' || !Number.isFinite(Date.parse(e.timestamp)))) {
      throw new Error('Invalid history data; restore history before starting to preserve cooldowns.');
    }
    return history;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function saveHistory(file, history) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify(history, null, 2) + '\n', { mode: 0o600 });
  await rename(`${file}.tmp`, file);
}
