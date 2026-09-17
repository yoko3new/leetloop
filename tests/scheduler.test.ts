import { Rating } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import {
  updateUserProblemForAttempt,
  type AttemptScheduleInput,
} from '../src/lib/scheduler';

const baseTime = new Date('2026-08-01T09:00:00.000Z');

function attempt(
  overrides: Partial<AttemptScheduleInput> = {},
): AttemptScheduleInput {
  return {
    problemId: 'leetcode:two-sum',
    attemptedAt: baseTime,
    verdict: 'Accepted',
    difficulty: 'Easy',
    elapsedMs: 12 * 60 * 1000,
    attemptNumber: 1,
    hintExposure: 'none',
    ...overrides,
  };
}

describe('review scheduler', () => {
  it('keeps the first AC in learning and schedules at least the next day', () => {
    const result = updateUserProblemForAttempt(undefined, attempt(), {
      desiredRetention: 0.9,
      reminderHour: 9,
    });

    expect(result.accepted).toBe(true);
    expect(result.isReview).toBe(false);
    expect(result.rating).toBe(Rating.Good);
    expect(result.userProblem.status).toBe('learning');
    expect(result.userProblem.reviewCount).toBe(1);
    expect(result.nextDueAt!.getTime() - baseTime.getTime()).toBeGreaterThanOrEqual(
      24 * 60 * 60 * 1000,
    );
  });

  it('does not count repeated ACs in the same session again', () => {
    const first = updateUserProblemForAttempt(undefined, attempt());
    const repeated = updateUserProblemForAttempt(
      first.userProblem,
      attempt({ attemptedAt: new Date(baseTime.getTime() + 60 * 60 * 1000) }),
    );

    expect(repeated.accepted).toBe(true);
    expect(repeated.isReview).toBe(false);
    expect(repeated.rating).toBeUndefined();
    expect(repeated.userProblem.reviewCount).toBe(1);
    expect(repeated.nextDueAt).toEqual(first.nextDueAt);
  });

  it('anchors the same-session window to the last scheduled success', () => {
    const first = updateUserProblemForAttempt(undefined, attempt());
    const repeated = updateUserProblemForAttempt(
      first.userProblem,
      attempt({ attemptedAt: new Date(baseTime.getTime() + 10 * 60 * 60 * 1000) }),
    );
    const later = updateUserProblemForAttempt(
      repeated.userProblem,
      attempt({ attemptedAt: new Date(baseTime.getTime() + 15 * 60 * 60 * 1000) }),
    );

    expect(repeated.userProblem.lastAcceptedAt).toEqual(first.userProblem.lastAcceptedAt);
    expect(later.isReview).toBe(true);
    expect(later.userProblem.reviewCount).toBe(2);
  });

  it('grades a later independent repetition as a review', () => {
    const first = updateUserProblemForAttempt(undefined, attempt());
    const later = new Date(baseTime.getTime() + 36 * 60 * 60 * 1000);
    const review = updateUserProblemForAttempt(
      first.userProblem,
      attempt({ attemptedAt: later, elapsedMs: 8 * 60 * 1000 }),
    );

    expect(review.isReview).toBe(true);
    expect(review.rating).toBe(Rating.Easy);
    expect(review.userProblem.reviewCount).toBe(2);
  });

  it('treats solution exposure as Again despite a final AC', () => {
    const result = updateUserProblemForAttempt(
      undefined,
      attempt({ hintExposure: 'solution' }),
    );
    expect(result.rating).toBe(Rating.Again);
    expect(result.userProblem.consecutiveSuccesses).toBe(0);
  });

  it('records a failed attempt without creating a solved card', () => {
    const result = updateUserProblemForAttempt(
      undefined,
      attempt({ verdict: 'Wrong Answer' }),
    );
    expect(result.accepted).toBe(false);
    expect(result.userProblem.firstSolvedAt).toBeUndefined();
    expect(result.userProblem.nextReviewAt).toBeUndefined();
  });

  it('keeps the due date and card unchanged after a failed review attempt', () => {
    const first = updateUserProblemForAttempt(undefined, attempt());
    const failed = updateUserProblemForAttempt(
      first.userProblem,
      attempt({
        attemptedAt: first.nextDueAt!,
        verdict: 'Wrong Answer',
      }),
    );

    expect(failed.isReview).toBe(true);
    expect(failed.userProblem.nextReviewAt).toEqual(first.nextDueAt);
    expect(failed.userProblem.schedulerCard).toEqual(
      first.userProblem.schedulerCard,
    );
  });

  it('grades an AC after a failed review submission as Hard', () => {
    const first = updateUserProblemForAttempt(undefined, attempt());
    const review = updateUserProblemForAttempt(
      first.userProblem,
      attempt({
        attemptedAt: first.nextDueAt!,
        attemptNumber: 2,
      }),
    );

    expect(review.rating).toBe(Rating.Hard);
  });

  it('repairs a solved record whose next review date is missing', () => {
    const first = updateUserProblemForAttempt(undefined, attempt());
    const { nextReviewAt: _removedDueAt, ...broken } = first.userProblem;
    const repaired = updateUserProblemForAttempt(
      broken,
      attempt({ attemptedAt: new Date(baseTime.getTime() + 60 * 60 * 1000) }),
    );

    expect(repaired.isReview).toBe(true);
    expect(repaired.nextDueAt).toBeInstanceOf(Date);
    expect(Number.isNaN(repaired.nextDueAt!.getTime())).toBe(false);
  });

  it('does not move state backward for an out-of-order event', () => {
    const first = updateUserProblemForAttempt(undefined, attempt());
    const oldEvent = updateUserProblemForAttempt(
      first.userProblem,
      attempt({ attemptedAt: new Date(baseTime.getTime() - 60 * 60 * 1000) }),
    );

    expect(oldEvent.rating).toBeUndefined();
    expect(oldEvent.userProblem.lastAcceptedAt).toEqual(
      first.userProblem.lastAcceptedAt,
    );
    expect(oldEvent.userProblem.reviewCount).toBe(1);
  });
});
