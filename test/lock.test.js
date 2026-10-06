import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { acquireLock } from '../src/lock.js';

test('lock prevents concurrent sessions, releases, and recovers exited owners', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'attendance-lock-'));
  const file = path.join(dir, '.monitor.lock');
  try {
    const release = acquireLock(file);
    assert.throws(() => acquireLock(file), /session is running/);
    release();
    assert.equal(existsSync(file), false);
    const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']);
    assert.equal(child.status, 0);
    writeFileSync(file, child.stdout);
    const recovered = acquireLock(file);
    recovered();
    assert.equal(existsSync(file), false);
    assert.equal(existsSync(`${file}.acquiring`), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
