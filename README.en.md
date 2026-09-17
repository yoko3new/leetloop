# LeetLoop

<p align="right"><a href="./README.md"><kbd>简体中文</kbd></a> <a href="./README.en.md"><kbd>English</kbd></a></p>

LeetLoop is a local-first LeetCode review companion. It records your submissions as you solve problems and schedules practice with spaced repetition. The goal is to keep checking what you can still solve, rather than simply counting problems you have completed.

## Current features

- Detects problems and submission results on `leetcode.com/problems/*` pages;
- Records the date, AC/WA/TLE result, time spent, number of submissions, language, and detected exposure to hints or solutions on the page;
- Schedules reviews using FSRS plus problem-solving rules;
- Provides Today, Study Plans, and History views in the Chrome side panel, with overall and topic progress for Blind 75, NeetCode 250, and Top 100 Liked;
- Groups all submissions for a problem into one expandable history entry with first-solve and review details;
- Uses failed reviews to bring the next review forward, suggests similar problems, and restarts the current interval after a successful early review;
- Shows due problem counts with the extension badge and a daily notification;
- Lets you toggle daily reminders and set their time from the top-right corner of the side panel;
- Stores all data locally, without an account or server;
- Does not save your code, cookies, or LeetCode session, and does not bulk-read submission history.

## Tech stack

- TypeScript: all application logic;
- React: side panel UI;
- WXT: Manifest V3 builds, development, and packaging;
- Dexie + IndexedDB: local browser database;
- ts-fsrs: spaced repetition scheduling;
- Vitest: unit tests for scheduling and mastery.

The extension has three execution contexts:

1. The `leetcode.content` content script observes only the problem page you currently have open and sends submission events to the extension background process.
2. The `background` service worker handles deduplication, storage, scheduling, notifications, and the badge.
3. The `sidepanel` React app reads today's tasks, study plan progress, and per-problem history from the local database.

## Install a prebuilt version

After downloading and extracting a release package:

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** in the top-right corner.
3. Click **Load unpacked**.
4. Select `leetloop/.output/chrome-mv3` inside the extracted package.
5. Open a LeetCode problem and click the LeetLoop icon in the toolbar.

This is a development build that has not been published to the Chrome Web Store, so you need to load it through Developer mode the first time.

## Local development

Requires Node.js 20 or later.

```bash
npm install
npm run dev
```

Then:

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** in the top-right corner.
3. Click **Load unpacked**.
4. Select `.output/chrome-mv3`.
5. Open a LeetCode problem and click the LeetLoop icon in the toolbar to open the side panel.

WXT rebuilds the extension automatically while the development server runs. If Chrome does not update it automatically, click the refresh button on the extension card.

## Checks and packaging

```bash
npm run compile
npm test
npm run build
npm run zip
```

The loadable extension is built in `.output/chrome-mv3`; the ZIP package is placed in `.output`.

## Automatic scoring

An Accepted result does not automatically mean a problem is mastered. LeetLoop considers:

- Whether this is the first completion or a spaced review;
- The number of submissions in the current session;
- Time spent solving the problem;
- Whether you opened Hint, Editorial, or Solutions;
- Problem difficulty;
- Time since the previous completion.

The first successful submission only moves a problem into **Learning**. A failed later review is treated as a lapse and brings the next review forward; repeated failures in one session receive one grade. A successful early review restarts the current interval from that day. These scores are conservative signals for scheduling, not proof that you solved a problem independently or can reproduce the performance in an interview.

## Privacy and platform boundaries

This project does not call undocumented LeetCode APIs, poll LeetCode in the background, automatically navigate pages, or bulk-scrape past submissions. The content script processes only the problem page you actively open and stores only the metadata needed for review.

The current version starts building reliable records after installation. It does not automatically import problems you completed in the past; those problems enter the review system naturally when you open and submit them again.

## Current limitations

- LeetCode site changes may require updates to the submission-result selectors. Site parsing is kept in one content script to make those fixes easier.
- The extension can detect hints or solutions opened on LeetCode pages, but it cannot know whether you viewed answers on other websites.
- The current version supports only `leetcode.com`. The Chinese site could be supported with a separate provider adapter.
- Data does not yet sync across devices. To upgrade, replace the files in the original installation directory and click Reload in Chrome's extensions page. Uninstalling the extension deletes its local records.
