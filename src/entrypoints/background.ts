import { browser } from 'wxt/browser';
import { db, DEFAULT_SETTINGS, getSettings } from '@/lib/db';
import { isDue, localDateKey } from '@/lib/dates';
import { normalizeTopic } from '@/lib/topic-labels';
import {
  updateUserProblemForAttempt,
  type AttemptScheduleInput,
} from '@/lib/scheduler';
import type {
  AttemptCapture,
  ExtensionRequest,
  ExtensionResponse,
  Problem,
  ProblemCapture,
  ProblemStatus,
  RecordAttemptResponse,
  ReviewLog,
  Submission,
} from '@/lib/types';

const ALARM_NAME = 'leetloop-hourly';
const VALID_VERDICTS = new Set([
  'Accepted',
  'Wrong Answer',
  'Time Limit Exceeded',
  'Runtime Error',
  'Memory Limit Exceeded',
  'Compile Error',
  'Output Limit Exceeded',
  'Unknown',
]);

export default defineBackground(() => {
  let initializationPromise: Promise<void> | undefined;

  const initializeOnce = async () => {
    await chrome.sidePanel.setPanelBehavior({
      openPanelOnActionClick: true,
    });

    const existingAlarm = await browser.alarms.get(ALARM_NAME);
    if (!existingAlarm) {
      await browser.alarms.create(ALARM_NAME, {
        delayInMinutes: 1,
        periodInMinutes: 60,
      });
    }

    await getSettings();
    await refreshBadgeSafely('初始化角标');
  };

  const initialize = (): Promise<void> => {
    if (!initializationPromise) {
      initializationPromise = initializeOnce().catch((error: unknown) => {
        // A later lifecycle event or message should be able to retry startup.
        initializationPromise = undefined;
        throw error;
      });
    }
    return initializationPromise;
  };

  const triggerInitialization = (): void => {
    void initialize().catch((error: unknown) => {
      console.error('[LeetLoop] 初始化失败', error);
    });
  };

  browser.runtime.onInstalled.addListener(() => {
    triggerInitialization();
  });

  browser.runtime.onStartup.addListener(() => {
    triggerInitialization();
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARM_NAME) return;
    void refreshBadgeSafely('定时更新角标');
    void maybeNotify().catch((error: unknown) => {
      console.warn('[LeetLoop] 发送复习提醒失败', error);
    });
  });

  browser.notifications.onClicked.addListener((notificationId) => {
    if (!notificationId.startsWith('leetloop-')) return;
    void browser.notifications.clear(notificationId);
    void browser.windows
      .getLastFocused()
      .then((window) => {
        if (window.id !== undefined) {
          return chrome.sidePanel.open({ windowId: window.id });
        }
      })
      .catch((error: unknown) => {
        console.warn('[LeetLoop] 无法从通知打开侧栏', error);
      });
  });

  browser.runtime.onMessage.addListener(
    (request: ExtensionRequest, _sender, sendResponse) => {
      void handleRequest(request)
        .then(sendResponse)
        .catch((error: unknown) => {
          const message =
            error instanceof Error ? error.message : 'LeetLoop 处理事件失败';
          console.error('[LeetLoop]', error);
          sendResponse({ ok: false, error: message } satisfies ExtensionResponse);
        });

      // Keep the channel open on Chrome versions that do not support Promise
      // returns from runtime.onMessage listeners.
      return true;
    },
  );

  triggerInitialization();
});

async function handleRequest(
  request: ExtensionRequest,
): Promise<ExtensionResponse> {
  switch (request.type) {
    case 'PAGE_SEEN':
      await upsertProblem(request.problem, new Date(request.seenAt));
      return { ok: true };
    case 'RECORD_ATTEMPT': {
      const data = await recordAttempt(request.capture);
      // The attempt is already committed. Badge failures must not turn a
      // successful, durable write into a false negative for the content script.
      await refreshBadgeSafely('记录提交后更新角标');
      return { ok: true, data };
    }
    case 'GET_PROBLEM_STATUS': {
      const data = await getProblemStatus(request.slug);
      return { ok: true, data };
    }
    case 'REFRESH_BADGE':
      await refreshBadge();
      return { ok: true };
    default:
      return { ok: false, error: '未知消息类型' };
  }
}

function problemId(slug: string): string {
  return `leetcode:${slug}`;
}

function toProblem(capture: ProblemCapture, updatedAt: Date): Problem {
  const slug = capture.slug.trim().toLowerCase();
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) {
    throw new Error('题目标识无效');
  }
  const title = capture.title.trim().slice(0, 160) || slug;
  const difficulty = ['Easy', 'Medium', 'Hard', 'Unknown'].includes(
    capture.difficulty,
  )
    ? capture.difficulty
    : 'Unknown';
  const topics = [
    ...new Set(
      capture.topics
        .slice(0, 24)
        .map(normalizeTopic)
        .filter(Boolean),
    ),
  ];

  return {
    id: problemId(slug),
    provider: 'leetcode',
    slug,
    title,
    url: `https://leetcode.com/problems/${slug}/`,
    difficulty,
    topics,
    updatedAt,
  };
}

async function upsertProblem(
  capture: ProblemCapture,
  updatedAt: Date,
): Promise<Problem> {
  const incoming = toProblem(capture, updatedAt);
  return db.transaction('rw', db.problems, async () => {
    const existing = await db.problems.get(incoming.id);

    if (!existing) {
      await db.problems.put(incoming);
      return incoming;
    }

    const merged: Problem = {
      ...existing,
      ...incoming,
      title: incoming.title || existing.title,
      difficulty:
        incoming.difficulty === 'Unknown'
          ? existing.difficulty
          : incoming.difficulty,
      // A non-empty capture is the latest topic snapshot. Replacing it lets a
      // later clean read repair an earlier UI parsing mistake; permanent union
      // would make a single stray sidebar tag impossible to remove.
      topics: incoming.topics.length ? incoming.topics : existing.topics,
    };
    await db.problems.put(merged);
    return merged;
  });
}

async function recordAttempt(
  capture: AttemptCapture,
): Promise<RecordAttemptResponse> {
  if (
    typeof capture.eventId !== 'string' ||
    capture.eventId.length < 8 ||
    capture.eventId.length > 300 ||
    !VALID_VERDICTS.has(capture.verdict)
  ) {
    throw new Error('提交事件无效');
  }

  const attemptedAt = new Date(capture.submittedAt);
  if (Number.isNaN(attemptedAt.getTime())) {
    throw new Error('提交时间无效');
  }
  const elapsedMs = Number.isFinite(capture.elapsedMs)
    ? Math.min(Math.max(0, capture.elapsedMs), 7 * 24 * 60 * 60 * 1000)
    : 0;
  const attemptNumber = Number.isFinite(capture.attemptNumber)
    ? Math.min(Math.max(1, Math.floor(capture.attemptNumber)), 1000)
    : 1;
  const hintExposure = ['none', 'hint', 'solution'].includes(
    capture.hintExposure,
  )
    ? capture.hintExposure
    : 'none';
  const language = capture.language?.trim().slice(0, 40);

  return db.transaction(
    'rw',
    db.problems,
    db.userProblems,
    db.submissions,
    db.reviewLogs,
    db.settings,
    async () => {
      // The read and the unique-index write share one serialized read/write
      // transaction. Concurrent deliveries of the same event therefore see
      // the first committed row instead of racing into a ConstraintError.
      const duplicate = await db.submissions
        .where('eventId')
        .equals(capture.eventId)
        .first();
      if (duplicate) {
        const current = await db.userProblems.get(duplicate.problemId);
        return {
          duplicate: true,
          accepted: duplicate.verdict === 'Accepted',
          isReview: duplicate.isReview,
          ...(current?.nextReviewAt
            ? { nextReviewAt: current.nextReviewAt.toISOString() }
            : {}),
          ...(current?.lastRating !== undefined
            ? { rating: current.lastRating }
            : {}),
        } satisfies RecordAttemptResponse;
      }

      const problem = await upsertProblem(capture.problem, attemptedAt);
      const existing = await db.userProblems.get(problem.id);
      const settings =
        (await db.settings.get('main')) ?? DEFAULT_SETTINGS;

      const scheduleInput: AttemptScheduleInput = {
        problemId: problem.id,
        attemptedAt,
        verdict: capture.verdict,
        difficulty: problem.difficulty,
        elapsedMs,
        attemptNumber,
        hintExposure,
      };
      const outcome = updateUserProblemForAttempt(existing, scheduleInput, {
        desiredRetention: settings.desiredRetention,
        reminderHour: settings.reminderHour,
      });

      await db.userProblems.put(outcome.userProblem);

      const submission: Submission = {
        id: crypto.randomUUID(),
        eventId: capture.eventId,
        problemId: problem.id,
        submittedAt: attemptedAt,
        verdict: capture.verdict,
        ...(language ? { language } : {}),
        elapsedMs,
        attemptNumber,
        hintExposure,
        isReview: outcome.isReview,
      };
      await db.submissions.add(submission);

      if (outcome.rating !== undefined && outcome.nextDueAt) {
        const reviewLog: ReviewLog = {
          id: crypto.randomUUID(),
          problemId: problem.id,
          reviewedAt: attemptedAt,
          rating: outcome.rating,
          ...(outcome.previousDueAt
            ? { previousDueAt: outcome.previousDueAt }
            : {}),
          nextDueAt: outcome.nextDueAt,
          elapsedMs,
          attemptNumber,
          hintExposure,
          verdict: capture.verdict,
        };
        await db.reviewLogs.add(reviewLog);
      }

      return {
        duplicate: false,
        accepted: outcome.accepted,
        isReview: outcome.isReview,
        ...(outcome.nextDueAt
          ? { nextReviewAt: outcome.nextDueAt.toISOString() }
          : {}),
        ...(outcome.rating !== undefined ? { rating: outcome.rating } : {}),
      } satisfies RecordAttemptResponse;
    },
  );
}

async function getProblemStatus(slug: string): Promise<ProblemStatus> {
  const problem = await db.problems.where('slug').equals(slug).first();
  if (!problem) return { tracked: false, due: false };

  const userProblem = await db.userProblems.get(problem.id);
  if (!userProblem) return { tracked: false, due: false };

  return {
    tracked: true,
    status: userProblem.status,
    ...(userProblem.nextReviewAt
      ? { nextReviewAt: userProblem.nextReviewAt.toISOString() }
      : {}),
    due: isDue(userProblem.nextReviewAt),
  };
}

async function dueCount(now = new Date()): Promise<number> {
  return db.userProblems
    .where('nextReviewAt')
    .belowOrEqual(now)
    .count();
}

async function refreshBadge(): Promise<void> {
  const count = await dueCount();
  await browser.action.setBadgeBackgroundColor({ color: '#5B5BD6' });
  await browser.action.setBadgeText({ text: count ? String(count) : '' });
  await browser.action.setTitle({
    title: count ? `LeetLoop：今天有 ${count} 道待复习` : 'LeetLoop：今日已完成',
  });
}

async function refreshBadgeSafely(context: string): Promise<void> {
  try {
    await refreshBadge();
  } catch (error) {
    console.warn(`[LeetLoop] ${context}失败`, error);
  }
}

async function maybeNotify(now = new Date()): Promise<void> {
  const settings = await getSettings();
  if (!settings.reminderEnabled || now.getHours() < settings.reminderHour) {
    return;
  }

  const today = localDateKey(now);
  if (settings.lastNotificationDate === today) return;

  const count = await dueCount(now);
  if (count === 0) return;

  await browser.notifications.create(`leetloop-${today}`, {
    type: 'basic',
    iconUrl: browser.runtime.getURL('/icons/icon-128.png'),
    title: '今天该复习了',
    message: `有 ${count} 道题正在接近遗忘点。`,
  });
  await db.settings.update('main', { lastNotificationDate: today });
}
