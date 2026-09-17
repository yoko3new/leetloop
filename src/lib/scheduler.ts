import {
  Rating,
  createEmptyCard,
  fsrs,
  type Card,
  type Grade,
} from 'ts-fsrs';
import { dayDifference, localDateKey, nextMorning } from './dates';
import type {
  HintExposure,
  LearningStatus,
  ProblemDifficulty,
  SubmissionVerdict,
  UserProblem,
} from './types';

const MIN_RETENTION = 0.7;
const MAX_RETENTION = 0.97;
const MAXIMUM_INTERVAL_DAYS = 365;
const SAME_SESSION_MS = 12 * 60 * 60 * 1000;

const TARGET_TIME_MS: Record<ProblemDifficulty, number> = {
  Easy: 25 * 60 * 1000,
  Medium: 40 * 60 * 1000,
  Hard: 60 * 60 * 1000,
  Unknown: 40 * 60 * 1000,
};

export interface RatingInput {
  difficulty: ProblemDifficulty;
  elapsedMs: number;
  attemptNumber: number;
  hintExposure: HintExposure;
  isReview: boolean;
  reviewCount: number;
  verdict?: SubmissionVerdict;
}

export interface AcceptedReviewInput {
  difficulty: ProblemDifficulty;
  elapsedMs: number;
  attemptNumber: number;
  hintExposure: HintExposure;
  isReview?: boolean;
  reviewCount?: number;
}

export interface AttemptScheduleInput {
  problemId: string;
  attemptedAt: Date;
  verdict: SubmissionVerdict;
  difficulty: ProblemDifficulty;
  elapsedMs: number;
  attemptNumber: number;
  hintExposure: HintExposure;
}

export interface AttemptScheduleOptions {
  desiredRetention: number;
  reminderHour: number;
}

export interface AcceptedReviewResult {
  userProblem: UserProblem;
  rating: Grade;
  nextDueAt: Date;
  previousDueAt?: Date;
}

export interface AttemptScheduleResult {
  userProblem: UserProblem;
  isReview: boolean;
  accepted: boolean;
  rating?: Grade;
  previousDueAt?: Date;
  nextDueAt?: Date;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function safeAttemptNumber(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

function safeElapsedMs(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * Turns passive LeetCode telemetry into a conservative FSRS grade. It is a
 * proxy built from observed attempts, time and detected help exposure; it must
 * not be presented as proof that the work was independent.
 */
export function inferRating(input: RatingInput): Grade {
  if (input.verdict && input.verdict !== 'Accepted') return Rating.Again;
  if (input.hintExposure === 'solution') return Rating.Again;
  if (input.hintExposure === 'hint') return Rating.Hard;

  const attempts = safeAttemptNumber(input.attemptNumber);
  const elapsedMs = safeElapsedMs(input.elapsedMs);
  const targetMs = TARGET_TIME_MS[input.difficulty];
  const timeRatio = elapsedMs > 0 ? elapsedMs / targetMs : 1;

  if (
    attempts >= 3 ||
    (input.isReview && attempts >= 2) ||
    timeRatio > 1.75
  ) {
    return Rating.Hard;
  }

  // Easy is deliberately reserved for demonstrated, fluent retrieval.  A
  // first AC therefore lands on Good and receives a normal 2--3 day interval.
  if (
    input.isReview &&
    input.reviewCount > 0 &&
    attempts === 1 &&
    elapsedMs > 0 &&
    timeRatio <= 0.7
  ) {
    return Rating.Easy;
  }

  return Rating.Good;
}

function schedulerFor(desiredRetention: number) {
  return fsrs({
    request_retention: clamp(
      Number.isFinite(desiredRetention) ? desiredRetention : 0.9,
      MIN_RETENTION,
      MAX_RETENTION,
    ),
    maximum_interval: MAXIMUM_INTERVAL_DAYS,
    enable_fuzz: false,
    enable_short_term: false,
    learning_steps: [],
    relearning_steps: [],
  });
}

function normalizeHour(value: number): number {
  if (!Number.isFinite(value)) return 9;
  return clamp(Math.floor(value), 0, 23);
}

function alignCardDue(
  card: Card,
  reviewedAt: Date,
  reminderHour: number,
): Card {
  let due = new Date(card.due);
  due.setHours(normalizeHour(reminderHour), 0, 0, 0);

  // Algorithm questions should never reappear as a same-day micro-step.  This
  // also guarantees at least the following calendar day after the first AC.
  if (dayDifference(due, reviewedAt) < 1) {
    due = nextMorning(reviewedAt, 1, normalizeHour(reminderHour));
  }

  return {
    ...card,
    due,
    scheduled_days: Math.max(1, dayDifference(due, reviewedAt)),
  };
}

function ratingQuality(rating: Rating): number {
  switch (rating) {
    case Rating.Again:
      return 0.25;
    case Rating.Hard:
      return 0.55;
    case Rating.Good:
      return 0.82;
    case Rating.Easy:
      return 1;
    default:
      return 0.5;
  }
}

function updateEvidence(previous: number, observation: number): number {
  const safePrevious = clamp(
    Number.isFinite(previous) ? previous : 0,
    0,
    1,
  );
  const next = safePrevious === 0
    ? observation
    : safePrevious * 0.65 + observation * 0.35;
  return Math.round(clamp(next, 0, 1) * 1000) / 1000;
}

function learningStatus(
  wasReview: boolean,
  rating: Rating,
  reviewCount: number,
  consecutiveSuccesses: number,
  stability: number,
): LearningStatus {
  if (!wasReview) return 'learning';
  if (wasReview && rating === Rating.Again) return 'relearning';
  if (
    reviewCount >= 4 &&
    consecutiveSuccesses >= 3 &&
    stability >= 21
  ) {
    return 'mastered';
  }
  return 'reviewing';
}

/** Apply an accepted attempt to the FSRS card and immutable UserProblem. */
export function applyAcceptedReview(
  userProblem: UserProblem,
  input: AcceptedReviewInput,
  now: Date,
  desiredRetention: number,
  reminderHour = 9,
): AcceptedReviewResult {
  const isReview = input.isReview ?? Boolean(userProblem.firstSolvedAt);
  const reviewCount = input.reviewCount ?? userProblem.reviewCount;
  const rating = inferRating({
    difficulty: input.difficulty,
    elapsedMs: input.elapsedMs,
    attemptNumber: input.attemptNumber,
    hintExposure: input.hintExposure,
    isReview,
    reviewCount,
    verdict: 'Accepted',
  });

  const sourceCard: Card =
    userProblem.schedulerCard ?? createEmptyCard<Card>(now);
  const scheduled = schedulerFor(desiredRetention).next(
    sourceCard,
    now,
    rating,
  );
  let schedulerCard = alignCardDue(scheduled.card, now, reminderHour);
  const previousDueAt = userProblem.nextReviewAt
    ? new Date(userProblem.nextReviewAt)
    : undefined;
  // A successful, voluntary early review restarts the *current* interval
  // today. FSRS still updates stability, but it does not postpone this review
  // by increasing a seven-day interval to a longer one immediately.
  if (isReview && previousDueAt && previousDueAt > now) {
    const currentInterval = Math.round(clamp(
      userProblem.schedulerCard?.scheduled_days ||
        dayDifference(previousDueAt, userProblem.lastAcceptedAt ?? now),
      1,
      MAXIMUM_INTERVAL_DAYS,
    ));
    const days = rating >= Rating.Good
      ? currentInterval
      : Math.min(currentInterval, schedulerCard.scheduled_days);
    schedulerCard = {
      ...schedulerCard,
      due: nextMorning(now, days, normalizeHour(reminderHour)),
      scheduled_days: days,
    };
  }
  const nextDueAt = new Date(schedulerCard.due);
  const nextReviewCount = userProblem.reviewCount + 1;
  const strongSuccess = rating >= Rating.Good;
  const consecutiveSuccesses = strongSuccess
    ? userProblem.consecutiveSuccesses + 1
    : 0;
  const lapses = userProblem.lapses +
    (isReview && rating === Rating.Again ? 1 : 0);

  const baseQuality = ratingQuality(rating);
  const attempts = safeAttemptNumber(input.attemptNumber);
  const implementationObservation = clamp(
    baseQuality - Math.max(0, attempts - 1) * 0.06,
    0,
    1,
  );
  const approachObservation = input.hintExposure === 'solution'
    ? Math.min(baseQuality, 0.2)
    : input.hintExposure === 'hint'
      ? Math.min(baseQuality, 0.55)
      : baseQuality;

  const nextUserProblem: UserProblem = {
    ...userProblem,
    status: learningStatus(
      isReview,
      rating,
      nextReviewCount,
      consecutiveSuccesses,
      schedulerCard.stability,
    ),
    firstSolvedAt: userProblem.firstSolvedAt ?? new Date(now),
    lastAttemptAt: new Date(now),
    lastAcceptedAt: new Date(now),
    nextReviewAt: nextDueAt,
    reviewCount: nextReviewCount,
    lapses,
    consecutiveSuccesses,
    lastRating: rating,
    approachScore: updateEvidence(
      userProblem.approachScore,
      approachObservation,
    ),
    implementationScore: updateEvidence(
      userProblem.implementationScore,
      implementationObservation,
    ),
    schedulerCard,
  };

  const result: AcceptedReviewResult = {
    userProblem: nextUserProblem,
    rating,
    nextDueAt,
  };
  return previousDueAt ? { ...result, previousDueAt } : result;
}

function newUserProblem(problemId: string, attemptedAt: Date): UserProblem {
  return {
    problemId,
    status: 'learning',
    firstSeenAt: new Date(attemptedAt),
    lastAttemptAt: new Date(attemptedAt),
    reviewCount: 0,
    lapses: 0,
    consecutiveSuccesses: 0,
    approachScore: 0,
    implementationScore: 0,
  };
}

/** Main background-facing API. One failed review is graded per study session. */
export function updateUserProblemForAttempt(
  existing: UserProblem | undefined,
  input: AttemptScheduleInput,
  options: Partial<AttemptScheduleOptions> = {},
): AttemptScheduleResult {
  const attemptedAt = new Date(input.attemptedAt);
  const current = existing ?? newUserProblem(input.problemId, attemptedAt);
  const outOfOrder = attemptedAt.getTime() < current.lastAttemptAt.getTime();

  if (outOfOrder) {
    return {
      userProblem: current,
      isReview: false,
      accepted: input.verdict === 'Accepted',
      ...(current.nextReviewAt
        ? { nextDueAt: new Date(current.nextReviewAt) }
        : {}),
    };
  }

  const hasSolvedBefore = Boolean(current.firstSolvedAt);
  const sinceLastAccepted = current.lastAcceptedAt
    ? attemptedAt.getTime() - current.lastAcceptedAt.getTime()
    : Number.POSITIVE_INFINITY;
  const reviewIsDue = Boolean(
    current.nextReviewAt &&
      current.nextReviewAt.getTime() <= attemptedAt.getTime(),
  );
  const isReview =
    hasSolvedBefore &&
    (!current.nextReviewAt || reviewIsDue || sinceLastAccepted >= SAME_SESSION_MS);

  if (input.verdict !== 'Accepted') {
    const lastFailedAt = new Date(attemptedAt);
    const recentlyGradedFailure = Boolean(
      current.lastFailureGradedAt &&
      localDateKey(current.lastFailureGradedAt) === localDateKey(attemptedAt) &&
      attemptedAt.getTime() - current.lastFailureGradedAt.getTime() < SAME_SESSION_MS,
    );
    if (isReview && !recentlyGradedFailure) {
      const sourceCard = current.schedulerCard ?? createEmptyCard<Card>(attemptedAt);
      const scheduled = schedulerFor(options.desiredRetention ?? 0.9).next(
        sourceCard,
        attemptedAt,
        Rating.Again,
      );
      const schedulerCard = alignCardDue(
        scheduled.card,
        attemptedAt,
        options.reminderHour ?? 9,
      );
      const nextDueAt = new Date(schedulerCard.due);
      return {
        userProblem: {
          ...current,
          status: 'relearning',
          lastAttemptAt: attemptedAt,
          lastFailedAt,
          lastFailureGradedAt: attemptedAt,
          nextReviewAt: nextDueAt,
          reviewCount: current.reviewCount + 1,
          lapses: current.lapses + 1,
          consecutiveSuccesses: 0,
          lastRating: Rating.Again,
          approachScore: updateEvidence(current.approachScore, 0.25),
          implementationScore: updateEvidence(current.implementationScore, 0.25),
          schedulerCard,
        },
        isReview: true,
        accepted: false,
        rating: Rating.Again,
        ...(current.nextReviewAt
          ? { previousDueAt: new Date(current.nextReviewAt) }
          : {}),
        nextDueAt,
      };
    }
    return {
      userProblem: {
        ...current,
        lastAttemptAt: attemptedAt,
        lastFailedAt,
      },
      isReview,
      accepted: false,
      ...(current.nextReviewAt
        ? { nextDueAt: new Date(current.nextReviewAt) }
        : {}),
    };
  }

  // A later AC in the same failed review session does not erase its Again
  // evidence or extend the shortened interval. The raw AC is still retained.
  if (
    hasSolvedBefore &&
    current.lastFailureGradedAt &&
    localDateKey(current.lastFailureGradedAt) === localDateKey(attemptedAt) &&
    attemptedAt.getTime() - current.lastFailureGradedAt.getTime() < SAME_SESSION_MS &&
    current.nextReviewAt
  ) {
    return {
      userProblem: {
        ...current,
        lastAttemptAt: attemptedAt,
        lastAcceptedAt: attemptedAt,
      },
      nextDueAt: new Date(current.nextReviewAt),
      isReview: true,
      accepted: true,
    };
  }

  if (
    hasSolvedBefore &&
    !isReview &&
    sinceLastAccepted < SAME_SESSION_MS
  ) {
    const nextDueAt = new Date(current.nextReviewAt!);
    return {
      userProblem: {
        ...current,
        lastAttemptAt: attemptedAt,
      },
      nextDueAt,
      isReview: false,
      accepted: true,
    };
  }

  const scheduled = applyAcceptedReview(
    current,
    {
      difficulty: input.difficulty,
      elapsedMs: input.elapsedMs,
      attemptNumber: input.attemptNumber,
      hintExposure: input.hintExposure,
      isReview,
      reviewCount: current.reviewCount,
    },
    attemptedAt,
    options.desiredRetention ?? 0.9,
    options.reminderHour ?? 9,
  );

  const result: AttemptScheduleResult = {
    userProblem: scheduled.userProblem,
    rating: scheduled.rating,
    nextDueAt: scheduled.nextDueAt,
    isReview,
    accepted: true,
  };
  return scheduled.previousDueAt
    ? { ...result, previousDueAt: scheduled.previousDueAt }
    : result;
}
