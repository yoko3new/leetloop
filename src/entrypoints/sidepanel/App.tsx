import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { dayDifference, localDateKey } from '../../lib/dates';
import { db } from '../../lib/db';
import { calculateTopicMastery } from '../../lib/mastery';
import { normalizeTopic, topicLabel } from '../../lib/topic-labels';
import type {
  Problem,
  ProblemDifficulty,
  Submission,
  SubmissionVerdict,
  UserProblem,
} from '../../lib/types';
import { SettingsPanel } from './SettingsPanel';

type TabId = 'today' | 'topics' | 'history';
type TopicSort = 'weak' | 'count' | 'recent';
type HistoryFilter = 'all' | 'accepted' | 'failed' | 'review';

interface Snapshot {
  problems: Problem[];
  userProblems: UserProblem[];
  submissions: Submission[];
}

type SnapshotQueryState =
  | { status: 'ready'; snapshot: Snapshot }
  | { status: 'error'; message: string };

interface DueItem {
  problem: Problem;
  userProblem: UserProblem;
  estimateMinutes: number;
}

interface TopicMasteryView {
  topic: string;
  label?: string;
  problemCount: number;
  solvedCount?: number;
  reviewedCount: number;
  retention?: number;
  fluency?: number;
  transfer?: number;
  coverage?: number;
  confidence?: number;
  score: number;
  status?: string;
}

interface TopicRow extends TopicMasteryView {
  displayLabel: string;
  scorePercent: number;
  recentAt: number;
  dueCount: number;
  lowEvidence: boolean;
  recommendedProblem: Problem | undefined;
  recommendationLabel: string;
}

interface HistoryGroup {
  key: string;
  label: string;
  items: Submission[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_RENDER_LIMIT = 300;

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
  { id: 'topics', label: '主题', icon: 'topics' },
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

function asPercent(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.round(clamp(value <= 1 ? value * 100 : value, 0, 100));
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

function topicStatus(row: TopicRow): string {
  if (row.dueCount > 0) return '优先复习';
  if (row.lowEvidence) return '尚需证据';

  const statusMap: Record<string, string> = {
    new: '尚未评估',
    unrated: '尚未评估',
    unstarted: '尚未评估',
    weak: '优先复习',
    struggling: '优先复习',
    'review-due': '优先复习',
    developing: '正在巩固',
    learning: '正在巩固',
    building: '正在巩固',
    stable: '表现稳定',
    strong: '表现稳定',
    mastered: '掌握良好',
  };

  const normalizedStatus = row.status?.trim().toLowerCase();
  if (normalizedStatus && statusMap[normalizedStatus]) {
    return statusMap[normalizedStatus];
  }
  if (row.reviewedCount === 0) return '尚未评估';
  if (row.scorePercent < 40) return '优先复习';
  if (row.scorePercent < 65) return '正在巩固';
  if (row.scorePercent < 82) return '表现稳定';
  return '掌握良好';
}

function topicReason(row: TopicRow): string {
  if (row.dueCount > 0) {
    return `有 ${row.dueCount} 道题已经到期，建议优先回顾`;
  }
  if (row.lowEvidence) {
    return '还需要更多题目和间隔复习，暂时不判断掌握程度';
  }
  if (asPercent(row.coverage) < 45) {
    return '练习覆盖较少，先补充几道不同类型的题';
  }
  if (asPercent(row.retention) < 60) {
    return '近期回忆不够稳定，需要缩短复习间隔';
  }
  if (asPercent(row.fluency) < 60) {
    return '思路基本正确，解题速度还可以继续提高';
  }
  if (asPercent(row.transfer) < 55) {
    return '相似题的迁移表现还不稳定';
  }
  return '近期回忆和未检测到提示的完成表现稳定';
}

function topicStatusTone(row: TopicRow): 'muted' | 'warning' | 'accent' | 'success' {
  const status = topicStatus(row);
  if (status === '尚未评估' || status === '尚需证据') return 'muted';
  if (status === '优先复习') return 'warning';
  if (status === '正在巩固') return 'accent';
  return 'success';
}

function historyGroupLabel(date: Date, now: Date): string {
  const difference = dayDifference(now, date);
  if (difference === 0) return '今天';
  if (difference === 1) return '昨天';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(date);
}

function historyEventLabel(
  submission: Submission,
  firstAcceptedIds: Set<string>,
): string {
  if (submission.verdict !== 'Accepted') return '提交未通过';
  if (submission.isReview) return '复习完成';
  if (firstAcceptedIds.has(submission.id)) return '首次记录通过';
  return '再次通过';
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
              从薄弱主题选一题
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
  const [sort, setSort] = useState<TopicSort>('weak');

  const rows = useMemo(() => {
    const todayEnd = endOfDay(now);
    const rawRows = calculateTopicMastery(
      snapshot.problems,
      snapshot.userProblems,
      snapshot.submissions,
      now,
    ) as unknown as TopicMasteryView[];
    const userProblemById = new Map(
      snapshot.userProblems.map((item) => [item.problemId, item]),
    );

    return rawRows.map<TopicRow>((row) => {
      const normalized = normalizeTopic(row.topic);
      const relatedProblems = snapshot.problems.filter((problem) =>
        problem.topics.some((topic) => normalizeTopic(topic) === normalized),
      );
      let recentAt = 0;
      let dueCount = 0;
      for (const problem of relatedProblems) {
        const userProblem = userProblemById.get(problem.id);
        if (!userProblem) continue;
        recentAt = Math.max(recentAt, userProblem.lastAttemptAt.getTime());
        if (userProblem.nextReviewAt && userProblem.nextReviewAt <= todayEnd) {
          dueCount += 1;
        }
      }

      const recommendedProblem = [...relatedProblems].sort((a, b) => {
        const aUser = userProblemById.get(a.id);
        const bUser = userProblemById.get(b.id);
        const aDue = Boolean(
          aUser?.nextReviewAt && aUser.nextReviewAt <= todayEnd,
        );
        const bDue = Boolean(
          bUser?.nextReviewAt && bUser.nextReviewAt <= todayEnd,
        );
        if (aDue !== bDue) return aDue ? -1 : 1;

        const aUnsolved = !aUser?.firstSolvedAt;
        const bUnsolved = !bUser?.firstSolvedAt;
        if (aUnsolved !== bUnsolved) return aUnsolved ? -1 : 1;

        const aLastPracticed = aUser?.lastAttemptAt.getTime() ?? 0;
        const bLastPracticed = bUser?.lastAttemptAt.getTime() ?? 0;
        return aLastPracticed - bLastPracticed;
      })[0];
      const recommendedUser = recommendedProblem
        ? userProblemById.get(recommendedProblem.id)
        : undefined;
      const recommendedIsDue = Boolean(
        recommendedUser?.nextReviewAt &&
          recommendedUser.nextReviewAt <= todayEnd,
      );
      const recommendationLabel = recommendedIsDue
        ? '今天复习'
        : !recommendedUser?.firstSolvedAt
          ? '建议新做'
          : '再次练习';
      const lowEvidence =
        (row.solvedCount ?? 0) < 2 ||
        row.reviewedCount === 0 ||
        (row.confidence ?? 0) < 0.35;

      return {
        ...row,
        displayLabel: row.label || topicLabel(row.topic),
        scorePercent: asPercent(row.score),
        recentAt,
        dueCount,
        lowEvidence,
        recommendedProblem,
        recommendationLabel,
      };
    });
  }, [now, snapshot.problems, snapshot.submissions, snapshot.userProblems]);

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      if (sort === 'count') return b.problemCount - a.problemCount;
      if (sort === 'recent') return b.recentAt - a.recentAt;

      const priority = (row: TopicRow): number => {
        if (row.dueCount > 0) return 0;
        if (!row.lowEvidence && row.scorePercent < 65) return 1;
        if (!row.lowEvidence) return 2;
        return 3;
      };
      return (
        priority(a) - priority(b) ||
        b.dueCount - a.dueCount ||
        a.scorePercent - b.scorePercent ||
        b.problemCount - a.problemCount
      );
    });
  }, [rows, sort]);

  return (
    <div className="page page--topics">
      <header className="page-heading">
        <div>
          <p className="eyebrow">了解真正掌握的部分</p>
          <h1>主题掌握度</h1>
        </div>
      </header>

      <aside className="index-explainer">
        <strong>综合训练指数</strong>
        <p>综合复习保持、熟练度、迁移和覆盖情况，不代表做对概率。</p>
      </aside>

      <div aria-label="主题排序" className="segment-control" role="group">
        {(
          [
            ['weak', '薄弱优先'],
            ['count', '题目最多'],
            ['recent', '最近练习'],
          ] as const
        ).map(([value, label]) => (
          <button
            aria-pressed={sort === value}
            className={sort === value ? 'is-active' : ''}
            key={value}
            onClick={() => setSort(value)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {sortedRows.length === 0 ? (
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
          description="完成几道题并进行至少一次复习后，这里会显示你的真实掌握情况。"
          icon="topics"
          title="还没有足够的数据"
        />
      ) : (
        <section aria-label="各主题掌握度" className="topic-list">
          {sortedRows.map((row) => (
            <article className="topic-card" key={row.topic}>
              <div className="topic-card__heading">
                <div>
                  <h2>{row.displayLabel}</h2>
                  <p>
                    已解 {row.solvedCount ?? 0} / 已收录 {row.problemCount} · 已复习{' '}
                    {row.reviewedCount}
                  </p>
                </div>
                <span className={`status-chip status-chip--${topicStatusTone(row)}`}>
                  {topicStatus(row)}
                </span>
              </div>
              {row.lowEvidence ? (
                <div className="evidence-state">
                  <span>综合训练指数</span>
                  <strong>证据不足</strong>
                </div>
              ) : (
                <div className="mastery-line">
                  <div
                    aria-label={`${row.displayLabel}综合训练指数 ${row.scorePercent}%`}
                    aria-valuemax={100}
                    aria-valuemin={0}
                    aria-valuenow={row.scorePercent}
                    className="mastery-track"
                    role="progressbar"
                  >
                    <span style={{ width: `${row.scorePercent}%` }} />
                  </div>
                  <strong>{row.scorePercent}%</strong>
                </div>
              )}
              <p className="topic-reason">{topicReason(row)}</p>
              {row.recommendedProblem && (
                <div className="topic-recommendation">
                  <span className="topic-recommendation__copy">
                    <small>{row.recommendationLabel}</small>
                    <strong title={row.recommendedProblem.title}>
                      {row.recommendedProblem.title}
                    </strong>
                  </span>
                  <button
                    aria-label={`打开${row.recommendedProblem.title}`}
                    onClick={() => openLeetCode(row.recommendedProblem)}
                    type="button"
                  >
                    打开题目
                    <Icon name="arrow" size={15} />
                  </button>
                </div>
              )}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

function HistoryPage({ now, snapshot }: { now: Date; snapshot: Snapshot }) {
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const problemById = useMemo(
    () => new Map(snapshot.problems.map((problem) => [problem.id, problem])),
    [snapshot.problems],
  );

  const firstAcceptedIds = useMemo(() => {
    const ids = new Set<string>();
    const seenProblems = new Set<string>();
    const oldestFirst = [...snapshot.submissions].sort(
      (a, b) => a.submittedAt.getTime() - b.submittedAt.getTime(),
    );
    for (const submission of oldestFirst) {
      if (
        submission.verdict === 'Accepted' &&
        !seenProblems.has(submission.problemId)
      ) {
        seenProblems.add(submission.problemId);
        ids.add(submission.id);
      }
    }
    return ids;
  }, [snapshot.submissions]);

  const historySelection = useMemo(() => {
    const matching = snapshot.submissions
      .filter((submission) => {
        if (filter === 'accepted') return submission.verdict === 'Accepted';
        if (filter === 'failed') return submission.verdict !== 'Accepted';
        if (filter === 'review') return submission.isReview;
        return true;
      })
      .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());
    return {
      items: matching.slice(0, HISTORY_RENDER_LIMIT),
      total: matching.length,
    };
  }, [filter, snapshot.submissions]);

  const filteredSubmissions = historySelection.items;

  const groups = useMemo(() => {
    const result: HistoryGroup[] = [];
    for (const submission of filteredSubmissions) {
      const key = localDateKey(submission.submittedAt);
      let group = result[result.length - 1];
      if (!group || group.key !== key) {
        group = {
          key,
          label: historyGroupLabel(submission.submittedAt, now),
          items: [],
        };
        result.push(group);
      }
      group.items.push(submission);
    }
    return result;
  }, [filteredSubmissions, now]);

  const weekStart = now.getTime() - 7 * DAY_MS;
  const recentSubmissions = snapshot.submissions.filter(
    (submission) => submission.submittedAt.getTime() >= weekStart,
  );
  const recentReviews = recentSubmissions.filter(
    (submission) => submission.isReview && submission.verdict === 'Accepted',
  ).length;
  const recentAccepted = recentSubmissions.filter(
    (submission) =>
      submission.verdict === 'Accepted' &&
      (submission.isReview || firstAcceptedIds.has(submission.id)),
  );
  const noHintRate =
    recentAccepted.length === 0
      ? null
      : Math.round(
          (recentAccepted.filter((submission) => submission.hintExposure === 'none')
            .length /
            recentAccepted.length) *
            100,
        );

  return (
    <div className="page page--history">
      <header className="page-heading">
        <div>
          <p className="eyebrow">每次尝试都算数</p>
          <h1>学习记录</h1>
        </div>
      </header>

      <section className="week-summary">
        <span>近 7 天</span>
        <p>
          完成 <strong>{recentReviews}</strong> 次复习
          <span aria-hidden="true"> · </span>
          未检测到提示占比{' '}
          <strong>{noHintRate === null ? '—' : `${noHintRate}%`}</strong>
        </p>
      </section>

      <div aria-label="记录筛选" className="filter-chips" role="group">
        {(
          [
            ['all', '全部'],
            ['accepted', '通过'],
            ['failed', '未通过'],
            ['review', '复习'],
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

      {historySelection.total > HISTORY_RENDER_LIMIT && (
        <p className="history-limit-note" role="status">
          该筛选共 {historySelection.total} 条，仅显示最近 {HISTORY_RENDER_LIMIT} 条。
        </p>
      )}

      {snapshot.submissions.length === 0 ? (
        <EmptyState
          description="你的第一次提交或复习会出现在这里。"
          icon="history"
          title="还没有学习记录"
        />
      ) : groups.length === 0 ? (
        <EmptyState
          description="尝试切换上方的筛选条件。"
          icon="history"
          title="没有符合条件的记录"
        />
      ) : (
        <div className="history-groups">
          {groups.map((group) => (
            <section className="history-group" key={group.key}>
              <h2>{group.label}</h2>
              <div className="history-list">
                {group.items.map((submission) => {
                  const problem = problemById.get(submission.problemId);
                  const eventLabel = historyEventLabel(
                    submission,
                    firstAcceptedIds,
                  );
                  const eventClass =
                    submission.verdict !== 'Accepted'
                      ? 'failed'
                      : submission.isReview
                        ? 'review'
                        : 'accepted';

                  return (
                    <button
                      className="history-item"
                      disabled={!problem}
                      key={submission.id}
                      onClick={() => openLeetCode(problem)}
                      type="button"
                    >
                      <time dateTime={submission.submittedAt.toISOString()}>
                        {formatClock(submission.submittedAt)}
                      </time>
                      <span className={`timeline-dot timeline-dot--${eventClass}`} />
                      <span className="history-item__content">
                        <span className="history-item__title">
                          {problem?.title ?? '未知题目'}
                        </span>
                        <span className="history-item__event-row">
                          <span className={`event-label event-label--${eventClass}`}>
                            {eventLabel}
                          </span>
                          {problem && (
                            <span
                              className={`difficulty difficulty--${problem.difficulty.toLowerCase()}`}
                            >
                              {difficultyLabels[problem.difficulty]}
                            </span>
                          )}
                        </span>
                        <span className="history-item__meta">
                          {historyMeta(submission)}
                        </span>
                      </span>
                      {problem && <Icon name="arrow" size={15} />}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
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
      const [problems, userProblems, submissions] = await Promise.all([
        db.problems.toArray(),
        db.userProblems.toArray(),
        db.submissions.toArray(),
      ]);
      return {
        status: 'ready',
        snapshot: { problems, userProblems, submissions },
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
