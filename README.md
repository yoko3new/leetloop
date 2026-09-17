# LeetLoop

> 🌐 **Language:** 🇺🇸 English (default) · [**🇨🇳 阅读中文版 →**](./README.zh-CN.md)

LeetLoop is a local-first Chrome extension that records your LeetCode submissions and schedules spaced reviews. It helps you see what you can still solve, rather than only what you solved once.

## 1. Installation and usage

### Install

Requires Chrome 116 or later. To build from source, install Node.js 22.12 or later and run:

```bash
npm ci
npm run build
```

If you downloaded a release package that already contains `.output/chrome-mv3`, you can skip the build step.

1. Open `chrome://extensions` in Chrome and turn on **Developer mode**.
2. Click **Load unpacked** and select `.output/chrome-mv3` in the project or extracted package.
3. Open a problem on `leetcode.com/problems/*` and click the LeetLoop toolbar icon to open the side panel.

### Use

Solve and submit problems as usual. LeetLoop records the result and updates the review schedule automatically. Use **Today** for due reviews, **Plans** for curated-list progress, and **History** for per-problem details. Switch between **EN / 中文** in the side-panel header; open the gear icon to manage reminders.

To update an existing installation, rebuild or replace the files in the same extension directory, then click **Reload** on the LeetLoop card at `chrome://extensions`. Keep the original extension installed so its local records remain available.

## 2. Features

- **Automatic capture:** Records accepted and failed submissions, date, elapsed time, attempt count, language, and detected use of LeetCode hints or solutions. It does not store your code.
- **Daily review:** Shows due problems in the side panel, extension badge, and optional daily notification.
- **Study plans:** Tracks overall and topic progress for Blind 75, NeetCode 250, and LeetCode Top 100. Open a topic to see each problem's first solve date, review count, and latest review.
- **One record per problem:** Groups repeat submissions and alternative solutions into one expandable history entry while retaining individual attempts.
- **Practice suggestions:** Offers related problems when a review indicates more practice is needed.
- **Two languages:** English is the default; the side-panel switch saves your English or Simplified Chinese preference locally.

## 3. Memory system

LeetLoop uses FSRS with problem-solving signals to schedule reviews. It considers the result, whether this is a first solve or later review, attempts in the current session, elapsed time, problem difficulty, and detected hint or solution exposure.

- A first accepted submission starts a problem's learning schedule; it does not mark the problem as mastered.
- A failed review is treated as a lapse and brings the next review forward. Repeated failures in one study session receive one scheduling grade.
- Repeat accepted submissions in the same session remain in history without creating extra review grades.
- A successful early review restarts the current review interval from that day. A difficult attempt can result in an earlier next review.

These grades are scheduling signals, not proof of independent solving or interview readiness.

## 4. Code architecture

| Part | Responsibility |
| --- | --- |
| `leetcode.content` | Observes the problem page you opened and sends submission events. |
| `background` | Deduplicates events, stores records, updates schedules, badges, and notifications. |
| `sidepanel` | Displays daily reviews, study plans, history, settings, and language selection. |

The project uses TypeScript, React, WXT (Manifest V3), Dexie with IndexedDB, and `ts-fsrs`. Run the checks and build with:

```bash
npm run compile
npm test
npm run build
npm run zip
```

The loadable extension is in `.output/chrome-mv3`; the ZIP package is placed in `.output`.

## 5. Limitations and privacy

- Only `leetcode.com` is supported. `leetcode.cn` needs a separate site adapter.
- Tracking starts after installation. Previously completed problems are not imported automatically; they enter the system when you submit them again.
- Records and settings stay in this browser and do not sync across devices. Uninstalling the extension deletes its local records.
- LeetCode page changes may require an update to the submission detector. The extension can detect hints opened on LeetCode, but not answers viewed on other sites.
- The extension does not call undocumented LeetCode APIs, poll the site in the background, bulk-read past submissions, or save code, cookies, or LeetCode session data.
