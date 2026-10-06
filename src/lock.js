import { openSync, closeSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';

export function acquireLock(file) {
  const owner = String(process.pid);
  // Serialize stale-lock recovery as well as normal acquisition.
  const guard = `${file}.acquiring`;
  let guardFd;
  try { guardFd = openSync(guard, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Another startup is in progress. If startup crashed, remove ${guard} before retrying.`);
    throw error;
  }
  try {
    let previous;
    try { previous = readFileSync(file, 'utf8').trim(); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (previous !== undefined) {
      if (!/^[1-9]\d*$/.test(previous) || !Number.isSafeInteger(Number(previous))) throw new Error('Invalid .monitor.lock. Check for running monitors before removing it.');
      let alive = true;
      try { process.kill(Number(previous), 0); }
      catch (error) {
        if (error.code === 'ESRCH') alive = false;
        else if (error.code !== 'EPERM') throw error;
      }
      if (alive) throw new Error(`Another monitor or login session is running (PID ${previous}). Stop it with Ctrl+C first.`);
      unlinkSync(file);
    }
    writeFileSync(file, owner, { flag: 'wx', mode: 0o600 });
  } finally {
    closeSync(guardFd);
    unlinkSync(guard);
  }
  return () => {
    try { if (readFileSync(file, 'utf8') === owner) unlinkSync(file); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  };
}
