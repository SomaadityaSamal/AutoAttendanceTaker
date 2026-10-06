# AutomaticAttendanceTaker

A local macOS screen monitor that saves QR evidence and submits the first available Poll Everywhere response using a separate, persistent Chrome profile.

## Run

Requires Node.js 22+ and Google Chrome (both are installed on this Mac).

```sh
cd '/Users/*name*/Desktop/personal projects/AutomaticAttendanceTaker'
npm install
npm run login
npm start
```

Sign in in the Chrome window opened by the login command, then press Ctrl+C in the terminal. Your login stays in `.chrome-profile`. Each attendance link opens a new tab in that Chrome profile. Stop monitoring with Ctrl+C. Keep the QR visible on a display; the monitor cannot read hidden windows or a locked/sleeping screen.

`npm start` checks saved history, screen capture, Chrome, and the signed-in Poll Everywhere settings page before printing `READY`. If the saved login has expired, it opens the login page, alerts you, and pauses monitoring until you sign in; monitoring then resumes automatically. Network errors or an unrecognized account page stop startup with an attention message. A screen name alone is not considered proof of login. Dry-run detection and mock-only mode do not require a real account.

Failures, blocked dialogs, and unconfirmed attendance clicks print an attention message with a terminal bell and request a macOS notification. Notification delivery depends on macOS notification settings; terminal messages always appear. The startup login check verifies the current session, which can still expire later.

macOS requires Screen Recording permission for the app running the command (Terminal or Codex). Enable it in System Settings > Privacy & Security > Screen Recording (or Screen & System Audio Recording), then restart that app.

## Try Without Submitting

```sh
npm run dry-run -- --image /path/to/a/screenshot.png
npm run dry-run -- --once
npm run browser-dry-run
npm test
```

The image command decodes the supplied image and exits. `--once` takes one set of screen captures. Browser dry-run opens links without clicking; Ctrl+C closes Chrome. Neither dry-run consumes the automatic-submission cooldown. The program never starts automatically in the background.

## Local Mock Poll

In a terminal in this project, run `npm run mock` and open the local URL it prints (normally http://127.0.0.1:4177). The presenter page has a readable QR, a live response count, a Poll open checkbox, and an optional Screen-name popup. The participant page has one Yes button and records a response immediately when clicked.

Stop your regular monitor with Ctrl+C. In a second terminal in the same project, run:

```sh
npm start
```

Keep the presenter QR visible on screen. The mock monitor reads the QR, opens the local participant page in a separate Chrome profile, clicks Yes, and records success when Response recorded appears. The presenter count updates to 1. Click New poll to generate a fresh URL and QR for another attempt without deleting history. To exercise the popup, enable Screen-name popup before creating the new poll. Uncheck Poll open to test the waiting state, then check it again within the monitor's two-minute response wait.

The normal `npm start` command automatically recognizes this project's local mock server from `.mock-server.json`, alongside real Poll Everywhere links. Other local URLs are still rejected. Start the mock server before starting the monitor. No login is needed for the mock poll. Previously blocked attempts do not require clearing history; restarting the monitor is enough.

Optional: `npm run mock-monitor` runs the same monitoring and submission code with only mock URLs accepted, and stores captures, history, and a separate Chrome profile in `.mock-run/`. A new poll is required after restarting the server, whose poll data is kept in memory. Stop both terminal commands with Ctrl+C when finished.

The QR image is generated locally with [node-qrcode](https://github.com/soldair/node-qrcode).

## Configuration

Edit `config.json`. Defaults scan all connected displays every 3 seconds and retry each URL after 30 minutes. Run `npm start -- --list-displays` to see display IDs, then set `displayId` to one of those IDs to monitor a single display. Leave it `null` for all displays.

`responseSelector` optionally supplies an exact CSS selector for response options; the first visible, enabled match is clicked. Otherwise the app checks radios and answer/option controls. Generic buttons inside the main content or a form must have a recognized attendance label such as Yes, No, Here, Present, or Take attendance. Other button labels require a response selector. Navigation, login, and Responding as profile controls are excluded. The screen-name prompt is confirmed using its existing nonempty name when present. `confirmationSelector` optionally identifies an element visible only after successful submission. Default confirmation checks explicit response acknowledgment text. A separate Submit/Send/Vote button is clicked when present after choosing an answer.

The page can wait up to `responseWaitMs` (2 minutes by default) for login or an open poll. Unrecognized pages remain open and produce `needs-attention`. A click without explicit confirmation produces `unconfirmed`, never a claimed success. Live selectors may need adjustment if Poll Everywhere changes its participant page.

Only HTTP(S) links on `pollev.com`, `polleverywhere.com`, or their subdomains are accepted. Credentials and nonstandard ports are rejected. Login redirects can be completed manually; automatic response clicking only happens on trusted domains.

## Saved Evidence

`captures/screenshots/` stores full screenshots containing detected QR codes; `captures/qrs/` stores QR crops. `captures/history.json` records URLs, timestamps, artifact paths, outcomes, and chosen answers. These files and the Chrome profile remain local and are git-ignored. Screenshots may include other content visible on your displays.

Pending attempts are written before opening Chrome. Pending, successful, failed, and unconfirmed attempts all block the same URL for the cooldown, including after restart. Dry-run and rejected links do not. Startup automatically recovers `.monitor.lock` when its recorded process has exited; an active monitor or login session still blocks a second instance. Ctrl+C closes Chrome and releases the lock. Invalid history stops startup instead of silently discarding duplicate protection.

## Acceptance Check

During an active session, show its QR on the monitored display and run `npm start`. Check that a screenshot and QR crop appear, Chrome opens the response page, the first option is chosen, and history records `success` only after confirmation. Inspect `needs-attention` or `unconfirmed` tabs manually. Unit and mock-browser tests do not submit to any live poll.

Implementation references: [Playwright persistent contexts](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context), [jsQR](https://github.com/cozmo/jsQR), and [screenshot-desktop](https://github.com/bencevans/screenshot-desktop).
