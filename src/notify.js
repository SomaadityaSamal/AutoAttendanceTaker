import { execFile } from 'node:child_process';

export function alertUser(message) {
  console.error(`\x07ATTENTION: ${message}`);
  if (process.platform === 'darwin') {
    const script = 'on run argv\n display notification (item 1 of argv) with title "AutomaticAttendanceTaker" sound name "Glass"\nend run';
    execFile('/usr/bin/osascript', ['-e', script, message], { timeout: 5000 }, () => {});
  }
}
