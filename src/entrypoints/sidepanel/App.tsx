import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { dayDifference, localDateKey } from '../../lib/dates';
import { db, DEFAULT_SETTINGS } from '../../lib/db';
import { calculatePlanProgress } from '../../lib/progress';
import { getStudyPlan, STUDY_PLANS, titleFromSlug, type StudyPlanId } from '../../lib/study-plans';
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

const difficultyLabels: Record<ProblemDifficulty, string> = {
  Easy: '简单',
  Medium: '中等',
  Hard: '困难',
  Unknown: '未知',
};

const verdictLabels: Record<SubmissionVerdict, string> = {
  Accepted: '通过',
  'Wrong Answer': '答案错误',
  'Time Limit Exceeded': '超出时间限制',
  'Runtime Error': '运行错误',
  'Memory Limit Exceeded': '超出内存限制',
  'Compile Error': '编译错误',
  'Output Limit Exceeded': '输出超限',
  Unknown: '未通过',
};

const tabItems: Array<{ id: TabId; label: string; icon: IconName }> = [
  { id: 'today', label: '今日', icon: 'today' },
  { id: 'topics', label: '题单', icon: 'topics' },
  { id: 'history', label: '记录', icon: 'history' },
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

function formatPageDate(value: Date): string {
  const date = new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
  }).format(value);
  const weekday = new Intl.DateTimeFormat('zh-CN', {
    weekday: 'long',
  }).format(value);
  return `${date} · ${weekday}`;
}

function formatClock(value: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(value);
}

function formatDate(value: Date | undefined): string {
  return value
    ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' }).format(value)
    : '—';
}

function formatDuration(milliseconds: number): string {
  if (milliseconds <= 0) return '用时未记录';
  const minutes = Math.round(milliseconds / 60_000);
  if (minutes < 1) return `${Math.max(1, Math.round(milliseconds / 1000))} 秒`;
  return `${minutes} 分钟`;
}

function formatDueState(dueAt: Date, now: Date): string {
  const daysLate = dayDifference(now, dueAt);
  if (daysLate > 0) return `逾期 ${daysLate} 天`;
  return '今天到期';
}

function formatNextDue(dueAt: Date, now: Date): string {
  const days = dayDifference(dueAt, now);
  if (days <= 0) return `今天 ${formatClock(dueAt)}`;
  if (days === 1) return '明天';
  return `${days} 天后`;
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

function historyMeta(submission: Submission): string {
  const parts: string[] = [];

  if (submission.verdict === 'Accepted') {
    if (submission.hintExposure === 'none') parts.push('未检测到提示');
    if (submission.hintExposure === 'hint') parts.push('看过提示');
    if (submission.hintExposure === 'solution') parts.push('看过题解');
  } else {
    parts.push(verdictLabels[submission.verdict]);
  }

  if (submission.language) parts.push(submission.language);
  parts.push(formatDuration(submission.elapsedMs));
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

function LoadingState() {
  return (
    <div aria-label="正在读取学习记录" className="loading-state" role="status">
      <span className="skeleton skeleton--heading" />
      <span className="skeleton skeleton--summary" />
      <span className="skeleton skeleton--row" />
      <span className="skeleton skeleton--row" />
      <span className="sr-only">正在读取学习记录</span>
    </div>
  );
}

function DataErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="page">
      <EmptyState
        action={
          <button className="primary-button" onClick={onRetry} type="button">
            重新读取
          </button>
        }
        description={`本地学习记录暂时无法读取。${message ? ` ${message}` : ''}`}
        icon="history"
        title="读取记录失败"
      />
    </div>
  );
}

function TodayPage({
  now,
  snapshot,
  onShowTopics,
}: {
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
          <p className="eyebrow">{formatPageDate(now)}</p>
          <h1>今日复习</h1>
        </div>
        {dueItems.length > 0 && (
          <span className="count-badge" aria-label={`${dueItems.length} 道待复习`}>
            {dueItems.length}
          </span>
        )}
      </header>

      {dueItems.length > 0 ? (
        <>
          <section className="today-summary">
            <div className="today-summary__copy">
              <p>今天还有</p>
              <strong>{dueItems.length} 道题</strong>
              <span>预计 {estimatedMinutes} 分钟</span>
            </div>
            <button
              className="primary-button primary-button--compact"
              onClick={() => openLeetCode(dueItems[0]?.problem)}
              type="button"
            >
              {completedToday > 0 ? '继续复习' : '开始复习'}
              <Icon name="arrow" size={17} />
            </button>
            {completedToday > 0 && (
              <div className="today-summary__progress">
                <div className="progress-copy">
                  <span>已完成 {completedToday} 道 / 共 {progressTotal} 道</span>
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
              <h2 id="due-heading">待复习</h2>
              <span>逾期优先</span>
            </div>
            <div className="problem-list">
              {dueItems.map(({ problem, userProblem, estimateMinutes }) => (
                <article className="problem-card" key={problem.id}>
                  <div className="problem-card__topline">
                    <span className={`difficulty difficulty--${problem.difficulty.toLowerCase()}`}>
                      {difficultyLabels[problem.difficulty]}
                    </span>
                    <span
                      className={`due-label ${
                        dayDifference(now, userProblem.nextReviewAt ?? now) > 0
                          ? 'due-label--late'
                          : ''
                      }`}
                    >
                      {formatDueState(userProblem.nextReviewAt ?? now, now)}
                    </span>
                  </div>
                  <h3>{problem.title}</h3>
                  <div className="problem-card__meta">
                    <span>
                      {problem.topics.slice(0, 2).map(topicLabel).join(' · ') ||
                        '暂未分类'}
                    </span>
                    <span>约 {estimateMinutes} 分钟</span>
                  </div>
                  <button
                    aria-label={`在 LeetCode 打开${problem.title}`}
                    className="open-button"
                    onClick={() => openLeetCode(problem)}
                    type="button"
                  >
                    去复习
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
              打开 LeetCode
              <Icon name="arrow" size={17} />
            </button>
          }
          description="在 LeetCode 题目页开始做题，通过后会自动进入复习计划。"
          icon="today"
          title="还没有复习计划"
        />
      ) : (
        <EmptyState
          action={
            <button className="secondary-button" onClick={onShowTopics} type="button">
              从题单选一题
            </button>
          }
          description={
            nextFutureReview
              ? `下一道题将在${formatNextDue(nextFutureReview, now)}到期。`
              : '目前没有已安排的复习，完成新题后会自动加入。'
          }
          icon="check"
          title={completedToday > 0 ? '今天的复习完成了' : '今天没有到期题目'}
        />
      )}
    </div>
  );
}

function TopicsPage({ now, snapshot }: { now: Date; snapshot: Snapshot }) {
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
          <p className="eyebrow">按常见题单查看真实进度</p>
          <h1>题单进度</h1>
        </div>
      </header>

      <div aria-label="选择题单" className="plan-picker" role="group">
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
            {option.name}
          </button>
        ))}
      </div>

      <section aria-label={`${plan.name}总体进度`} className="plan-summary">
        <span>已完成</span>
        <strong>{progress.solved}<small> / {progress.total} 题</small></strong>
        <div
          aria-label={`已完成 ${progress.solved} / ${progress.total} 题`}
          aria-valuemax={progress.total}
          aria-valuemin={0}
          aria-valuenow={progress.solved}
          className="progress-track"
          role="progressbar"
        >
          <span style={{ width: `${Math.round(progress.solved / progress.total * 100)}%` }} />
        </div>
        <p>只有记录过通过的题目计入完成；重复提交不会重复计数。</p>
      </section>

      <div className="section-heading plan-section-heading">
        <h2>分主题进度</h2>
        <a href={plan.sourceUrl} rel="noreferrer" target="_blank">查看原题单 ↗</a>
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
                  <strong>{group.name}</strong>
                  <span>{solved} / {total} 题</span>
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
                            aria-label={`打开${problem?.title ?? titleFromSlug(slug)}`}
                            onClick={() => openLeetCodeSlug(slug)}
                            type="button"
                          >
                            <Icon name="arrow" size={15} />
                          </button>
                        </div>
                        <div className="plan-problem__details">
                          <span>首刷 {formatDate(user?.firstSolvedAt)}</span>
                          <span>复习 {reviewCount} 次</span>
                          <span>最近复习 {formatDate(recentReview)}</span>
                        </div>
                        {user?.nextReviewAt && (
                          <p className="plan-problem__next">下次复习：{formatDate(user.nextReviewAt)}{user.nextReviewAt <= now ? ' · 已到期' : ''}</p>
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

function HistoryPage({ now, snapshot }: { now: Date; snapshot: Snapshot }) {
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
          <p className="eyebrow">同一道题只显示一条记录</p>
          <h1>学习记录</h1>
        </div>
      </header>

      <section className="week-summary">
        <span>近 7 天</span>
        <p>练习 <strong>{practicedThisWeek}</strong> 道题 · 复习 <strong>{reviewCountThisWeek}</strong> 次</p>
      </section>

      <div aria-label="记录筛选" className="filter-chips" role="group">
        {(
          [
            ['all', '全部'],
            ['solved', '已完成'],
            ['failed', '有失败'],
            ['review', '已复习'],
          ] as const
        ).map(([value, label]) => (
          <button
            aria-pressed={filter === value}
            className={filter === value ? 'is-active' : ''}
            key={value}
            onClick={() => setFilter(value)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {entries.length === 0 ? (
        <EmptyState description="在 LeetCode 提交后，这里会按题目汇总记录。" icon="history" title="还没有学习记录" />
      ) : filteredEntries.length === 0 ? (
        <EmptyState description="尝试切换上方的筛选条件。" icon="history" title="没有符合条件的记录" />
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
                    <span>{entry.attempts.length} 次提交 · 最近 {formatDate(latest.submittedAt)}</span>
                  </span>
                  <span className={needsPractice
                    ? 'status-chip status-chip--warning'
                    : user?.firstSolvedAt
                      ? 'status-chip status-chip--success'
                      : 'status-chip status-chip--danger'}>
                    {needsPractice ? '待巩固' : user?.firstSolvedAt ? '已完成' : '未通过'}
                  </span>
                  <span aria-hidden="true" className="history-problem__chevron">{isOpen ? '⌃' : '⌄'}</span>
                </button>
                {isOpen && (
                  <div className="history-problem__body">
                    <div className="history-problem__stats">
                      <span>首刷 <strong>{formatDate(user?.firstSolvedAt)}</strong></span>
                      <span>复习 <strong>{reviewCount} 次</strong></span>
                      <span>最近复习 <strong>{formatDate(latestReview)}</strong></span>
                    </div>
                    {user?.nextReviewAt && (
                      <p className="history-problem__due">下次复习：{formatDate(user.nextReviewAt)}</p>
                    )}
                    <div className="history-problem__actions">
                      <button className="secondary-button" onClick={() => openLeetCodeSlug(slug)} type="button">
                        打开题目 <Icon name="arrow" size={15} />
                      </button>
                    </div>
                    {related.length > 0 && (
                      <section className="similar-problems">
                        <strong>类似题练习</strong>
                        {related.map((candidate) => (
                          <button key={candidate} onClick={() => openLeetCodeSlug(candidate)} type="button">
                            {problemById.get(`leetcode:${candidate}`)?.title ?? titleFromSlug(candidate)}
                            <Icon name="arrow" size={14} />
                          </button>
                        ))}
                      </section>
                    )}
                    <div className="history-problem__attempts">
                      <strong>提交明细</strong>
                      {entry.attempts.map((attempt) => (
                        <div className="history-attempt" key={attempt.id}>
                          <time dateTime={attempt.submittedAt.toISOString()}>
                            {formatDate(attempt.submittedAt)} {formatClock(attempt.submittedAt)}
                          </time>
                          <span className={attempt.verdict === 'Accepted' ? 'history-attempt__result is-accepted' : 'history-attempt__result is-failed'}>
                            {verdictLabels[attempt.verdict]}{attempt.isReview ? ' · 复习' : ''}
                          </span>
                          <small>{historyMeta(attempt)}</small>
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
        message: error instanceof Error ? error.message : '未知错误',
      };
    }
  }, [queryRevision]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="app-shell">
      <header className="brand-bar">
        <span className="brand-mark">
          <Icon name="loop" size={20} />
        </span>
        <span className="brand-name">LeetLoop</span>
        <span className="local-badge">仅存本地</span>
        <button
          aria-label="打开提醒设置"
          className="settings-trigger"
          onClick={() => setSettingsOpen(true)}
          title="提醒设置"
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
          <LoadingState />
        ) : queryState.status === 'error' ? (
          <DataErrorState
            message={queryState.message}
            onRetry={() => setQueryRevision((revision) => revision + 1)}
          />
        ) : activeTab === 'today' ? (
          <TodayPage
            now={now}
            onShowTopics={() => setActiveTab('topics')}
            snapshot={queryState.snapshot}
          />
        ) : activeTab === 'topics' ? (
          <TopicsPage now={now} snapshot={queryState.snapshot} />
        ) : (
          <HistoryPage now={now} snapshot={queryState.snapshot} />
        )}
      </main>

      <nav aria-label="主要页面" className="tab-bar">
        {tabItems.map((item) => (
          <button
            aria-current={activeTab === item.id ? 'page' : undefined}
            className={activeTab === item.id ? 'is-active' : ''}
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            type="button"
          >
            <Icon name={item.icon} size={21} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
