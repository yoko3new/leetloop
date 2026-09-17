import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { dayDifference, localDateKey } from '../../lib/dates';
import { db, DEFAULT_SETTINGS, getSettings } from '../../lib/db';
import { getLocale, t, type Locale, type TextKey } from '../../lib/i18n';
import { calculatePlanProgress } from '../../lib/progress';
import { getStudyPlan, STUDY_PLANS, studyPlanGroupName, studyPlanName, titleFromSlug, type StudyPlanId } from '../../lib/study-plans';
import { topicLabel } from '../../lib/topic-labels';
import type {
  Problem,
  ProblemDifficulty,
  ReviewLog,
  Settings,
  Submission,
  SubmissionVerdict,
  UserProblem,
} from '../../lib/types';
import { SettingsPanel } from './SettingsPanel';

type TabId = 'today' | 'topics' | 'history';
type HistoryFilter = 'all' | 'solved' | 'failed' | 'review';

interface Snapshot {
  problems: Problem[];
  userProblems: UserProblem[];
  submissions: Submission[];
  reviewLogs: ReviewLog[];
  settings: Settings;
}

type SnapshotQueryState =
  | { status: 'ready'; snapshot: Snapshot }
  | { status: 'error'; message: string };

interface DueItem {
  problem: Problem;
  userProblem: UserProblem;
  estimateMinutes: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const difficultyLabelKeys: Record<ProblemDifficulty, TextKey> = {
  Easy: 'difficultyEasy',
  Medium: 'difficultyMedium',
  Hard: 'difficultyHard',
  Unknown: 'difficultyUnknown',
};

const verdictLabelKeys: Record<SubmissionVerdict, TextKey> = {
  Accepted: 'verdictAccepted',
  'Wrong Answer': 'verdictWrong',
  'Time Limit Exceeded': 'verdictTime',
  'Runtime Error': 'verdictRuntime',
  'Memory Limit Exceeded': 'verdictMemory',
  'Compile Error': 'verdictCompile',
  'Output Limit Exceeded': 'verdictOutput',
  Unknown: 'verdictUnknown',
};

const tabItems: Array<{ id: TabId; labelKey: TextKey; icon: IconName }> = [
  { id: 'today', labelKey: 'tabToday', icon: 'today' },
  { id: 'topics', labelKey: 'tabPlans', icon: 'topics' },
  { id: 'history', labelKey: 'tabHistory', icon: 'history' },
];

type IconName =
  | 'arrow'
  | 'check'
  | 'history'
  | 'loop'
  | 'today'
  | 'topics';

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    arrow: (
      <>
        <path d="M7 17 17 7" />
        <path d="M8 7h9v9" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    history: (
      <>
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
        <path d="M3 3v5h5M12 7v5l3 2" />
      </>
    ),
    loop: (
      <path d="M8.2 8.3c-1.7-1.8-4.5-1.8-6.2 0a4.7 4.7 0 0 0 0 6.5c1.7 1.8 4.5 1.8 6.2 0L16 7.2c1.7-1.8 4.5-1.8 6.2 0a4.7 4.7 0 0 1 0 6.5c-1.7 1.8-4.5 1.8-6.2 0L12.9 11" />
    ),
    today: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M8 3v4M16 3v4M3 10h18" />
        <path d="m8 15 2.2 2L16 12" />
      </>
    ),
    topics: (
      <>
        <path d="M4 6h16M4 12h11M4 18h7" />
        <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="15" cy="18" r="1" fill="currentColor" stroke="none" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <g
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      >
        {paths[name]}
      </g>
    </svg>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function endOfDay(value: Date): Date {
  const result = new Date(value);
  result.setHours(23, 59, 59, 999);
  return result;
}

function formatPageDate(value: Date, locale: Locale): string {
  const language = locale === 'zh' ? 'zh-CN' : 'en-US';
  const date = new Intl.DateTimeFormat(language, {
    month: 'long',
    day: 'numeric',
  }).format(value);
  const weekday = new Intl.DateTimeFormat(language, {
    weekday: 'long',
  }).format(value);
  return `${date} · ${weekday}`;
}

function formatClock(value: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(value);
}

function formatDate(value: Date | undefined, locale: Locale): string {
  return value
    ? new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'numeric', day: 'numeric' }).format(value)
    : '—';
}

function formatDuration(milliseconds: number, locale: Locale): string {
  if (milliseconds <= 0) return t(locale, 'noTime');
  const minutes = Math.round(milliseconds / 60_000);
  if (minutes < 1) return t(locale, 'seconds', { count: Math.max(1, Math.round(milliseconds / 1000)) });
  return t(locale, 'minutes', { count: minutes });
}

function formatDueState(dueAt: Date, now: Date, locale: Locale): string {
  const daysLate = dayDifference(now, dueAt);
  if (daysLate > 0) return t(locale, daysLate === 1 ? 'overdueOne' : 'overdueDays', { count: daysLate });
  return t(locale, 'dueToday');
}

function formatNextDue(dueAt: Date, now: Date, locale: Locale): string {
  const days = dayDifference(dueAt, now);
  if (days <= 0) return t(locale, 'nextToday', { time: formatClock(dueAt, locale) });
  if (days === 1) return t(locale, 'tomorrow');
  return t(locale, 'inDays', { count: days });
}

function estimateReviewMinutes(
  problem: Problem,
  latestSubmission: Submission | undefined,
): number {
  if (latestSubmission && latestSubmission.elapsedMs > 0) {
    return clamp(Math.round(latestSubmission.elapsedMs / 60_000 / 2), 5, 25);
  }

  if (problem.difficulty === 'Easy') return 8;
  if (problem.difficulty === 'Hard') return 18;
  return 12;
}

function problemUrl(problem: Problem): string {
  if (/^https:\/\//i.test(problem.url)) return problem.url;
  return `https://leetcode.com/problems/${problem.slug}/`;
}

function openLeetCode(problem?: Problem): void {
  const url = problem
    ? problemUrl(problem)
    : 'https://leetcode.com/problemset/';

  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    void chrome.tabs.create({ url });
    return;
  }

  window.open(url, '_blank', 'noopener,noreferrer');
}

function openLeetCodeSlug(slug: string): void {
  const url = `https://leetcode.com/problems/${slug}/`;
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    void chrome.tabs.create({ url });
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

function historyMeta(submission: Submission, locale: Locale): string {
  const parts: string[] = [];

  if (submission.verdict === 'Accepted') {
    if (submission.hintExposure === 'none') parts.push(t(locale, 'noHint'));
    if (submission.hintExposure === 'hint') parts.push(t(locale, 'sawHint'));
    if (submission.hintExposure === 'solution') parts.push(t(locale, 'sawSolution'));
  } else {
    parts.push(t(locale, verdictLabelKeys[submission.verdict]));
  }

  if (submission.language) parts.push(submission.language);
  parts.push(formatDuration(submission.elapsedMs, locale));
  return parts.join(' · ');
}

function similarSlugs(slug: string, selectedPlanId: StudyPlanId, snapshot: Snapshot): string[] {
  const closeMatches: Record<string, string[]> = {
    'two-sum': ['two-sum-ii-input-array-is-sorted', '3sum'],
    'climbing-stairs': ['min-cost-climbing-stairs', 'n-th-tribonacci-number'],
    'longest-common-subsequence': ['edit-distance', 'distinct-subsequences'],
    'lowest-common-ancestor-of-a-binary-search-tree': ['lowest-common-ancestor-of-a-binary-tree', 'kth-smallest-element-in-a-bst'],
    'house-robber-ii': ['house-robber', 'house-robber-iii'],
    'alien-dictionary': ['verifying-an-alien-dictionary', 'course-schedule'],
    'implement-trie-prefix-tree': ['design-add-and-search-words-data-structure', 'word-search-ii'],
  };
  const plans = [getStudyPlan(selectedPlanId), ...STUDY_PLANS.filter((plan) => plan.id !== selectedPlanId)];
  const source = snapshot.problems.find((problem) => problem.slug === slug);
  const topics = new Set(source?.topics ?? []);
  const words = new Set(slug.split('-').filter((word) =>
    word.length >= 3 && !['array', 'string', 'binary', 'tree', 'number', 'with', 'from', 'into', 'and', 'the'].includes(word),
  ));
  const groups = plans.flatMap((plan) => plan.groups);
  const sameGroups = groups.filter((group) => group.slugs.includes(slug));
  const known = new Map(snapshot.problems.map((problem) => [problem.slug, problem]));
  const solved = new Set(snapshot.userProblems.filter((item) => item.firstSolvedAt).map((item) => item.problemId));
  const candidates = new Set([
    ...plans.flatMap((plan) => plan.slugs),
    ...snapshot.problems.map((problem) => problem.slug),
  ]);
  return [...candidates]
    .filter((candidate) => candidate !== slug)
    .map((candidate) => {
      const explicit = closeMatches[slug]?.indexOf(candidate) ?? -1;
      const sharedTopics = known.get(candidate)?.topics.filter((topic) => topics.has(topic)).length ?? 0;
      const sharedWords = candidate.split('-').filter((word) => words.has(word)).length;
      const sameGroup = sameGroups.some((group) => group.slugs.includes(candidate));
      return {
        slug: candidate,
        score: (explicit >= 0 ? 100 - explicit : 0) + sharedTopics * 8 + sharedWords * 4 + (sameGroup ? 2 : 0),
      };
    })
    .filter((candidate) => candidate.score >= 4)
    .sort((a, b) =>
      b.score - a.score ||
      Number(solved.has(`leetcode:${a.slug}`)) - Number(solved.has(`leetcode:${b.slug}`)) ||
      a.slug.localeCompare(b.slug),
    )
    .map((candidate) => candidate.slug)
    .slice(0, 2);
}

function lastReviewDate(problemId: string, snapshot: Snapshot): Date | undefined {
  const firstSolvedAt = snapshot.userProblems.find((item) => item.problemId === problemId)?.firstSolvedAt;
  return snapshot.reviewLogs
    .filter((log) => log.problemId === problemId && (!firstSolvedAt || log.reviewedAt > firstSolvedAt))
    .sort((a, b) => b.reviewedAt.getTime() - a.reviewedAt.getTime())[0]?.reviewedAt;
}

function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: IconName;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <section className="empty-state">
      <span className="empty-state__icon">
        <Icon name={icon} size={24} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </section>
  );
}

function LoadingState({ locale }: { locale: Locale }) {
  return (
    <div aria-label={t(locale, 'loadingRecords')} className="loading-state" role="status">
      <span className="skeleton skeleton--heading" />
      <span className="skeleton skeleton--summary" />
      <span className="skeleton skeleton--row" />
      <span className="skeleton skeleton--row" />
      <span className="sr-only">{t(locale, 'loadingRecords')}</span>
    </div>
  );
}

function DataErrorState({
  locale,
  message,
  onRetry,
}: {
  locale: Locale;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="page">
      <EmptyState
        action={
          <button className="primary-button" onClick={onRetry} type="button">
            {t(locale, 'retry')}
          </button>
        }
        description={t(locale, 'readFailedDescription', { message: message ? ` ${message}` : '' })}
        icon="history"
        title={t(locale, 'readFailed')}
      />
    </div>
  );
}

function TodayPage({
  locale,
  now,
  snapshot,
  onShowTopics,
}: {
  locale: Locale;
  now: Date;
  snapshot: Snapshot;
  onShowTopics: () => void;
}) {
  const problemById = useMemo(
    () => new Map(snapshot.problems.map((problem) => [problem.id, problem])),
    [snapshot.problems],
  );

  const latestSubmissionByProblem = useMemo(() => {
    const result = new Map<string, Submission>();
    for (const submission of snapshot.submissions) {
      const current = result.get(submission.problemId);
      if (!current || current.submittedAt < submission.submittedAt) {
        result.set(submission.problemId, submission);
      }
    }
    return result;
  }, [snapshot.submissions]);

  const todayEnd = endOfDay(now);

  const dueItems = useMemo(() => {
    const items: DueItem[] = [];
    for (const userProblem of snapshot.userProblems) {
      if (!userProblem.nextReviewAt || userProblem.nextReviewAt > todayEnd) continue;
      const problem = problemById.get(userProblem.problemId);
      if (!problem) continue;
      items.push({
        problem,
        userProblem,
        estimateMinutes: estimateReviewMinutes(
          problem,
          latestSubmissionByProblem.get(problem.id),
        ),
      });
    }
    return items.sort((a, b) => {
      const aDue = a.userProblem.nextReviewAt?.getTime() ?? 0;
      const bDue = b.userProblem.nextReviewAt?.getTime() ?? 0;
      return aDue - bDue;
    });
  }, [latestSubmissionByProblem, problemById, snapshot.userProblems, todayEnd]);

  const todayKey = localDateKey(now);
  const completedTodayProblemIds = new Set(
    snapshot.submissions
      .filter(
        (submission) =>
          submission.isReview &&
          submission.verdict === 'Accepted' &&
          localDateKey(submission.submittedAt) === todayKey,
      )
      .map((submission) => submission.problemId),
  );
  const completedToday = completedTodayProblemIds.size;
  const estimatedMinutes = dueItems.reduce(
    (total, item) => total + item.estimateMinutes,
    0,
  );
  const progressTotal = dueItems.length + completedToday;
  const progressPercent =
    progressTotal === 0 ? 0 : Math.round((completedToday / progressTotal) * 100);

  const nextFutureReview = snapshot.userProblems
    .map((item) => item.nextReviewAt)
    .filter((date): date is Date => Boolean(date && date > todayEnd))
    .sort((a, b) => a.getTime() - b.getTime())[0];

  return (
    <div className="page page--today">
      <header className="page-heading">
        <div>
          <p className="eyebrow">{formatPageDate(now, locale)}</p>
          <h1>{t(locale, 'todayHeading')}</h1>
        </div>
        {dueItems.length > 0 && (
          <span className="count-badge" aria-label={t(locale, dueItems.length === 1 ? 'dueCountOne' : 'dueCount', { count: dueItems.length })}>
            {dueItems.length}
          </span>
        )}
      </header>

      {dueItems.length > 0 ? (
        <>
          <section className="today-summary">
            <div className="today-summary__copy">
              <p>{t(locale, 'stillToReview')}</p>
              <strong>{t(locale, dueItems.length === 1 ? 'problemCountOne' : 'problemCount', { count: dueItems.length })}</strong>
              <span>{t(locale, 'estimatedMinutes', { count: estimatedMinutes })}</span>
            </div>
            <button
              className="primary-button primary-button--compact"
              onClick={() => openLeetCode(dueItems[0]?.problem)}
              type="button"
            >
              {t(locale, completedToday > 0 ? 'continueReview' : 'startReview')}
              <Icon name="arrow" size={17} />
            </button>
            {completedToday > 0 && (
              <div className="today-summary__progress">
                <div className="progress-copy">
                  <span>{t(locale, 'completedProgress', { done: completedToday, total: progressTotal })}</span>
                  <span>{progressPercent}%</span>
                </div>
                <div className="progress-track">
                  <span style={{ width: `${progressPercent}%` }} />
                </div>
              </div>
            )}
          </section>

          <section aria-labelledby="due-heading" className="section-block">
            <div className="section-heading">
              <h2 id="due-heading">{t(locale, 'toReview')}</h2>
              <span>{t(locale, 'overdueFirst')}</span>
            </div>
            <div className="problem-list">
              {dueItems.map(({ problem, userProblem, estimateMinutes }) => (
                <article className="problem-card" key={problem.id}>
                  <div className="problem-card__topline">
                    <span className={`difficulty difficulty--${problem.difficulty.toLowerCase()}`}>
                      {t(locale, difficultyLabelKeys[problem.difficulty])}
                    </span>
                    <span
                      className={`due-label ${
                        dayDifference(now, userProblem.nextReviewAt ?? now) > 0
                          ? 'due-label--late'
                          : ''
                      }`}
                    >
                      {formatDueState(userProblem.nextReviewAt ?? now, now, locale)}
                    </span>
                  </div>
                  <h3>{problem.title}</h3>
                  <div className="problem-card__meta">
                    <span>
                      {problem.topics.slice(0, 2).map((topic) => topicLabel(topic, locale)).join(' · ') ||
                        t(locale, 'uncategorized')}
                    </span>
                    <span>{t(locale, 'estimatedMinutes', { count: estimateMinutes })}</span>
                  </div>
                  <button
                    aria-label={t(locale, 'openForReview', { title: problem.title })}
                    className="open-button"
                    onClick={() => openLeetCode(problem)}
                    type="button"
                  >
                    {t(locale, 'reviewAction')}
                    <Icon name="arrow" size={16} />
                  </button>
                </article>
              ))}
            </div>
          </section>
        </>
      ) : snapshot.userProblems.length === 0 ? (
        <EmptyState
          action={
            <button
              className="primary-button"
              onClick={() => openLeetCode()}
              type="button"
            >
              {t(locale, 'openLeetCode')}
              <Icon name="arrow" size={17} />
            </button>
          }
          description={t(locale, 'noPlanDescription')}
          icon="today"
          title={t(locale, 'noPlanTitle')}
        />
      ) : (
        <EmptyState
          action={
            <button className="secondary-button" onClick={onShowTopics} type="button">
              {t(locale, 'chooseFromPlan')}
            </button>
          }
          description={
            nextFutureReview
              ? t(locale, 'nextProblemDue', { when: formatNextDue(nextFutureReview, now, locale) })
              : t(locale, 'noScheduled')
          }
          icon="check"
          title={t(locale, completedToday > 0 ? 'doneToday' : 'noDueToday')}
        />
      )}
    </div>
  );
}

function TopicsPage({ locale, now, snapshot }: { locale: Locale; now: Date; snapshot: Snapshot }) {
  const [expanded, setExpanded] = useState('');
  const selectedPlanId = snapshot.settings.selectedStudyPlan ?? 'blind75';
  const plan = getStudyPlan(selectedPlanId);
  const progress = useMemo(
    () => calculatePlanProgress(plan, snapshot.userProblems),
    [plan, snapshot.userProblems],
  );
  const problemBySlug = useMemo(
    () => new Map(snapshot.problems.map((problem) => [problem.slug, problem])),
    [snapshot.problems],
  );
  const userById = useMemo(
    () => new Map(snapshot.userProblems.map((item) => [item.problemId, item])),
    [snapshot.userProblems],
  );

  return (
    <div className="page page--plans">
      <header className="page-heading">
        <div>
          <p className="eyebrow">{t(locale, 'planEyebrow')}</p>
          <h1>{t(locale, 'planHeading')}</h1>
        </div>
      </header>

      <div aria-label={t(locale, 'choosePlan')} className="plan-picker" role="group">
        {STUDY_PLANS.map((option) => (
          <button
            aria-pressed={option.id === plan.id}
            className={option.id === plan.id ? 'is-active' : ''}
            key={option.id}
            onClick={() => {
              void db.settings.put({
                ...snapshot.settings,
                selectedStudyPlan: option.id,
              });
            }}
            type="button"
          >
            {studyPlanName(option, locale)}
          </button>
        ))}
      </div>

      <section aria-label={t(locale, 'overallProgress', { plan: studyPlanName(plan, locale) })} className="plan-summary">
        <span>{t(locale, 'completed')}</span>
        <strong>{progress.solved}<small> {t(locale, 'totalProblems', { count: progress.total })}</small></strong>
        <div
          aria-label={t(locale, 'progressAria', { done: progress.solved, total: progress.total })}
          aria-valuemax={progress.total}
          aria-valuemin={0}
          aria-valuenow={progress.solved}
          className="progress-track"
          role="progressbar"
        >
          <span style={{ width: `${Math.round(progress.solved / progress.total * 100)}%` }} />
        </div>
        <p>{t(locale, 'progressNote')}</p>
      </section>

      <div className="section-heading plan-section-heading">
        <h2>{t(locale, 'topicProgress')}</h2>
        <a href={plan.sourceUrl} rel="noreferrer" target="_blank">{t(locale, 'viewOriginalPlan')}</a>
      </div>
      <div className="plan-groups">
        {progress.groups.map(({ group, solved, total }) => {
          const key = `${plan.id}:${group.name}`;
          const isOpen = expanded === key;
          return (
            <section className="plan-group" key={key}>
              <button
                aria-expanded={isOpen}
                className="plan-group__trigger"
                onClick={() => setExpanded(isOpen ? '' : key)}
                type="button"
              >
                <span className="plan-group__heading">
                  <strong>{studyPlanGroupName(group.name, locale)}</strong>
                  <span>{t(locale, total === 1 ? 'groupProblemCountOne' : 'groupProblemCount', { done: solved, total })}</span>
                </span>
                <span className="plan-group__progress">
                  <span style={{ width: `${Math.round(solved / total * 100)}%` }} />
                </span>
                <span className="plan-group__chevron" aria-hidden="true">{isOpen ? '⌃' : '⌄'}</span>
              </button>
              {isOpen && (
                <div className="plan-problems">
                  {group.slugs.map((slug) => {
                    const problem = problemBySlug.get(slug);
                    const user = userById.get(`leetcode:${slug}`);
                    const reviewCount = Math.max(0, (user?.reviewCount ?? 0) - (user?.firstSolvedAt ? 1 : 0));
                    const recentReview = lastReviewDate(`leetcode:${slug}`, snapshot);
                    return (
                      <article className="plan-problem" key={slug}>
                        <div className="plan-problem__top">
                          <span className={user?.firstSolvedAt ? 'plan-problem__check is-done' : 'plan-problem__check'}>
                            {user?.firstSolvedAt ? '✓' : '○'}
                          </span>
                          <strong>{problem?.title ?? titleFromSlug(slug)}</strong>
                          <button
                            aria-label={t(locale, 'openProblemNamed', { title: problem?.title ?? titleFromSlug(slug) })}
                            onClick={() => openLeetCodeSlug(slug)}
                            type="button"
                          >
                            <Icon name="arrow" size={15} />
                          </button>
                        </div>
                        <div className="plan-problem__details">
                          <span>{t(locale, 'firstSolved')} {formatDate(user?.firstSolvedAt, locale)}</span>
                          <span>{t(locale, 'reviewCount')} {t(locale, 'reviewTimes', { count: reviewCount })}</span>
                          <span>{t(locale, 'lastReview')} {formatDate(recentReview, locale)}</span>
                        </div>
                        {user?.nextReviewAt && (
                          <p className="plan-problem__next">{t(locale, 'nextReviewDate', { date: formatDate(user.nextReviewAt, locale) })}{user.nextReviewAt <= now ? ` · ${t(locale, 'alreadyDue')}` : ''}</p>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function HistoryPage({ locale, now, snapshot }: { locale: Locale; now: Date; snapshot: Snapshot }) {
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [expandedProblemId, setExpandedProblemId] = useState<string | null>(null);
  const problemById = useMemo(
    () => new Map(snapshot.problems.map((problem) => [problem.id, problem])),
    [snapshot.problems],
  );
  const userById = useMemo(
    () => new Map(snapshot.userProblems.map((item) => [item.problemId, item])),
    [snapshot.userProblems],
  );
  const entries = useMemo(() => {
    const byProblem = new Map<string, Submission[]>();
    for (const submission of snapshot.submissions) {
      const rows = byProblem.get(submission.problemId) ?? [];
      rows.push(submission);
      byProblem.set(submission.problemId, rows);
    }
    return [...byProblem].map(([problemId, rows]) => ({
      problemId,
      attempts: rows.sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime()),
    })).sort((a, b) =>
      (b.attempts[0]?.submittedAt.getTime() ?? 0) -
      (a.attempts[0]?.submittedAt.getTime() ?? 0),
    );
  }, [snapshot.submissions]);
  const filteredEntries = entries.filter((entry) => {
    const user = userById.get(entry.problemId);
    if (filter === 'solved') return Boolean(user?.firstSolvedAt);
    if (filter === 'failed') return entry.attempts.some((attempt) => attempt.verdict !== 'Accepted');
    if (filter === 'review') return (user?.reviewCount ?? 0) > 1;
    return true;
  });
  const weekStart = now.getTime() - 7 * DAY_MS;
  const recentSubmissions = snapshot.submissions.filter((item) => item.submittedAt.getTime() >= weekStart);
  const practicedThisWeek = new Set(recentSubmissions.map((item) => item.problemId)).size;
  const reviewCountThisWeek = snapshot.reviewLogs.filter((log) => {
    const firstSolved = userById.get(log.problemId)?.firstSolvedAt;
    return log.reviewedAt.getTime() >= weekStart && Boolean(firstSolved && log.reviewedAt > firstSolved);
  }).length;

  return (
    <div className="page page--history">
      <header className="page-heading">
        <div>
          <p className="eyebrow">{t(locale, 'historyEyebrow')}</p>
          <h1>{t(locale, 'historyHeading')}</h1>
        </div>
      </header>

      <section className="week-summary">
        <span>{t(locale, 'lastSevenDays')}</span>
        <p>{locale === 'en'
          ? `Practiced ${practicedThisWeek} ${practicedThisWeek === 1 ? 'problem' : 'problems'} · ${reviewCountThisWeek} ${reviewCountThisWeek === 1 ? 'review' : 'reviews'}`
          : t(locale, 'practicedSummary', { problems: practicedThisWeek, reviews: reviewCountThisWeek })}</p>
      </section>

      <div aria-label={t(locale, 'historyFilters')} className="filter-chips" role="group">
        {(
          [
            ['all', 'filterAll'],
            ['solved', 'filterSolved'],
            ['failed', 'filterFailed'],
            ['review', 'filterReviewed'],
          ] as const
        ).map(([value, labelKey]) => (
          <button
            aria-pressed={filter === value}
            className={filter === value ? 'is-active' : ''}
            key={value}
            onClick={() => setFilter(value)}
            type="button"
          >
            {t(locale, labelKey)}
          </button>
        ))}
      </div>

      {entries.length === 0 ? (
        <EmptyState description={t(locale, 'emptyHistoryDescription')} icon="history" title={t(locale, 'emptyHistory')} />
      ) : filteredEntries.length === 0 ? (
        <EmptyState description={t(locale, 'noFilterResultsDescription')} icon="history" title={t(locale, 'noFilterResults')} />
      ) : (
        <div className="history-problems">
          {filteredEntries.map((entry) => {
            const problem = problemById.get(entry.problemId);
            const user = userById.get(entry.problemId);
            const latest = entry.attempts[0]!;
            const slug = problem?.slug ?? entry.problemId.replace(/^leetcode:/, '');
            const title = problem?.title ?? titleFromSlug(slug);
            const reviewCount = Math.max(0, (user?.reviewCount ?? 0) - (user?.firstSolvedAt ? 1 : 0));
            const latestReview = lastReviewDate(entry.problemId, snapshot);
            const hasRecentFailure = Boolean(user?.lastFailedAt && (
              !user.lastAcceptedAt || user.lastFailedAt >= user.lastAcceptedAt
            ));
            const needsPractice = hasRecentFailure || user?.status === 'relearning';
            const related = needsPractice
              ? similarSlugs(slug, snapshot.settings.selectedStudyPlan ?? 'blind75', snapshot)
              : [];
            const isOpen = expandedProblemId === entry.problemId;
            return (
              <article className="history-problem" key={entry.problemId}>
                <button
                  aria-expanded={isOpen}
                  className="history-problem__trigger"
                  onClick={() => setExpandedProblemId(isOpen ? null : entry.problemId)}
                  type="button"
                >
                  <span className={needsPractice || !user?.firstSolvedAt ? 'timeline-dot timeline-dot--failed' : 'timeline-dot timeline-dot--accepted'} />
                  <span className="history-problem__main">
                    <strong>{title}</strong>
                    <span>{t(locale, entry.attempts.length === 1 ? 'attemptSummaryOne' : 'attemptSummary', { count: entry.attempts.length, date: formatDate(latest.submittedAt, locale) })}</span>
                  </span>
                  <span className={needsPractice
                    ? 'status-chip status-chip--warning'
                    : user?.firstSolvedAt
                      ? 'status-chip status-chip--success'
                      : 'status-chip status-chip--danger'}>
                    {t(locale, needsPractice ? 'needsPractice' : user?.firstSolvedAt ? 'solved' : 'notAccepted')}
                  </span>
                  <span aria-hidden="true" className="history-problem__chevron">{isOpen ? '⌃' : '⌄'}</span>
                </button>
                {isOpen && (
                  <div className="history-problem__body">
                    <div className="history-problem__stats">
                      <span>{t(locale, 'firstSolved')} <strong>{formatDate(user?.firstSolvedAt, locale)}</strong></span>
                      <span>{t(locale, 'reviewCount')} <strong>{t(locale, 'reviewTimes', { count: reviewCount })}</strong></span>
                      <span>{t(locale, 'lastReview')} <strong>{formatDate(latestReview, locale)}</strong></span>
                    </div>
                    {user?.nextReviewAt && (
                      <p className="history-problem__due">{t(locale, 'nextReviewDate', { date: formatDate(user.nextReviewAt, locale) })}</p>
                    )}
                    <div className="history-problem__actions">
                      <button className="secondary-button" onClick={() => openLeetCodeSlug(slug)} type="button">
                        {t(locale, 'openProblem')} <Icon name="arrow" size={15} />
                      </button>
                    </div>
                    {related.length > 0 && (
                      <section className="similar-problems">
                        <strong>{t(locale, 'similarProblems')}</strong>
                        {related.map((candidate) => (
                          <button key={candidate} onClick={() => openLeetCodeSlug(candidate)} type="button">
                            {problemById.get(`leetcode:${candidate}`)?.title ?? titleFromSlug(candidate)}
                            <Icon name="arrow" size={14} />
                          </button>
                        ))}
                      </section>
                    )}
                    <div className="history-problem__attempts">
                      <strong>{t(locale, 'submissionDetails')}</strong>
                      {entry.attempts.map((attempt) => (
                        <div className="history-attempt" key={attempt.id}>
                          <time dateTime={attempt.submittedAt.toISOString()}>
                            {formatDate(attempt.submittedAt, locale)} {formatClock(attempt.submittedAt, locale)}
                          </time>
                          <span className={attempt.verdict === 'Accepted' ? 'history-attempt__result is-accepted' : 'history-attempt__result is-failed'}>
                            {t(locale, verdictLabelKeys[attempt.verdict])}{attempt.isReview ? t(locale, 'reviewSuffix') : ''}
                          </span>
                          <small>{historyMeta(attempt, locale)}</small>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

async function saveLocale(locale: Locale): Promise<void> {
  await getSettings();
  await db.settings.update('main', { locale });
  try {
    await chrome.runtime.sendMessage({ type: 'REFRESH_BADGE' });
  } catch {
    // The side panel can also be previewed outside the extension.
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('today');
  const [now, setNow] = useState(() => new Date());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [queryRevision, setQueryRevision] = useState(0);
  const queryState = useLiveQuery(async (): Promise<SnapshotQueryState> => {
    try {
      const [problems, userProblems, submissions, reviewLogs, settings] = await Promise.all([
        db.problems.toArray(),
        db.userProblems.toArray(),
        db.submissions.toArray(),
        db.reviewLogs.toArray(),
        db.settings.get('main'),
      ]);
      return {
        status: 'ready',
        snapshot: { problems, userProblems, submissions, reviewLogs, settings: settings ?? DEFAULT_SETTINGS },
      };
    } catch (error) {
      return {
        status: 'error',
        message: error instanceof Error ? error.message : t('en', 'unknownError'),
      };
    }
  }, [queryRevision]);
  const locale = getLocale(queryState?.status === 'ready' ? queryState.snapshot.settings.locale : undefined);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  }, [locale]);

  return (
    <div className="app-shell">
      <header className="brand-bar">
        <span className="brand-mark">
          <Icon name="loop" size={20} />
        </span>
        <span className="brand-name">LeetLoop</span>
        <span className="local-badge">{t(locale, 'localOnly')}</span>
        <div aria-label={t(locale, 'language')} className="language-switch" role="group">
          <button aria-pressed={locale === 'en'} className={locale === 'en' ? 'is-active' : ''} onClick={() => void saveLocale('en')} type="button">EN</button>
          <button aria-pressed={locale === 'zh'} className={locale === 'zh' ? 'is-active' : ''} onClick={() => void saveLocale('zh')} type="button">中文</button>
        </div>
        <button
          aria-label={t(locale, 'openSettings')}
          className="settings-trigger"
          onClick={() => setSettingsOpen(true)}
          title={t(locale, 'openSettings')}
          type="button"
        >
          <svg aria-hidden="true" fill="none" height="17" viewBox="0 0 24 24" width="17">
            <path
              d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
              stroke="currentColor"
              strokeWidth="1.7"
            />
            <path
              d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.94 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.58 15 1.7 1.7 0 0 0 3 14H3v-4h.08A1.7 1.7 0 0 0 4.6 8.94a1.7 1.7 0 0 0-.34-1.88L4.2 7l2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.58 1.7 1.7 0 0 0 10 3V3h4v.08A1.7 1.7 0 0 0 15.06 4.6a1.7 1.7 0 0 0 1.88-.34L17 4.2 19.83 7l-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 21 10h.08v4H21a1.7 1.7 0 0 0-1.6 1Z"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.45"
            />
          </svg>
        </button>
      </header>

      <main className="app-content">
        {!queryState ? (
          <LoadingState locale={locale} />
        ) : queryState.status === 'error' ? (
          <DataErrorState
            locale={locale}
            message={queryState.message}
            onRetry={() => setQueryRevision((revision) => revision + 1)}
          />
        ) : activeTab === 'today' ? (
          <TodayPage
            locale={locale}
            now={now}
            onShowTopics={() => setActiveTab('topics')}
            snapshot={queryState.snapshot}
          />
        ) : activeTab === 'topics' ? (
          <TopicsPage locale={locale} now={now} snapshot={queryState.snapshot} />
        ) : (
          <HistoryPage locale={locale} now={now} snapshot={queryState.snapshot} />
        )}
      </main>

      <nav aria-label={t(locale, 'mainNavigation')} className="tab-bar">
        {tabItems.map((item) => (
          <button
            aria-current={activeTab === item.id ? 'page' : undefined}
            className={activeTab === item.id ? 'is-active' : ''}
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            type="button"
          >
            <Icon name={item.icon} size={21} />
            <span>{t(locale, item.labelKey)}</span>
          </button>
        ))}
      </nav>
      {settingsOpen && <SettingsPanel locale={locale} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
