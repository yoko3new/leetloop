import { describe, expect, it } from 'vitest';
import { calculateTopicMastery } from '../src/lib/mastery';
import type { Problem, Submission, UserProblem } from '../src/lib/types';

const now = new Date('2026-08-22T09:00:00.000Z');

function problem(id: string, difficulty: Problem['difficulty']): Problem {
  const slug = id.replace('leetcode:', '');
  return {
    id,
    provider: 'leetcode',
    slug,
    title: id,
    url: `https://leetcode.com/problems/${slug}/`,
    difficulty,
    topics: ['sliding-window'],
    updatedAt: now,
  };
}

function userProblem(id: string, reviewCount = 2): UserProblem {
  return {
    problemId: id,
    status: 'reviewing',
    firstSeenAt: new Date('2026-08-01T09:00:00.000Z'),
    firstSolvedAt: new Date('2026-08-01T09:00:00.000Z'),
    lastAttemptAt: new Date('2026-08-20T09:00:00.000Z'),
    lastAcceptedAt: new Date('2026-08-20T09:00:00.000Z'),
    nextReviewAt: new Date('2026-08-25T09:00:00.000Z'),
    reviewCount,
    lapses: 0,
    consecutiveSuccesses: 2,
    approachScore: 0.85,
    implementationScore: 0.8,
  };
}

function submission(
  id: string,
  problemId: string,
  date: string,
  isReview: boolean,
): Submission {
  return {
    id,
    eventId: `event:${id}`,
    problemId,
    submittedAt: new Date(date),
    verdict: 'Accepted',
    elapsedMs: 18 * 60 * 1000,
    attemptNumber: 1,
    hintExposure: 'none',
    isReview,
  };
}

describe('topic mastery', () => {
  it('does not equate one AC with mastery', () => {
    const result = calculateTopicMastery(
      [problem('leetcode:a', 'Easy')],
      [userProblem('leetcode:a', 1)],
      [submission('s1', 'leetcode:a', '2026-08-20T09:00:00.000Z', false)],
      now,
    )[0]!;

    expect(result.solvedCount).toBe(1);
    expect(result.reviewedCount).toBe(0);
    expect(result.status).toBe('unrated');
    expect(result.confidence).toBeLessThan(0.3);
    expect(result.coverage).toBeLessThan(0.6);
    expect(result.transfer).toBe(0);
  });

  it('rewards transfer across varied problems and spaced reviews', () => {
    const problems = [
      problem('leetcode:a', 'Easy'),
      problem('leetcode:b', 'Medium'),
      problem('leetcode:c', 'Hard'),
      problem('leetcode:d', 'Medium'),
      problem('leetcode:e', 'Medium'),
    ];
    const users = problems.map((item) => userProblem(item.id, 3));
    const submissions = problems.flatMap((item, index) => [
      submission(
        `first-${index}`,
        item.id,
        `2026-08-${String(index + 1).padStart(2, '0')}T09:00:00.000Z`,
        false,
      ),
      submission(
        `review-${index}`,
        item.id,
        `2026-08-${String(index + 18).padStart(2, '0')}T09:00:00.000Z`,
        true,
      ),
    ]);

    const result = calculateTopicMastery(problems, users, submissions, now)[0]!;
    expect(result.transfer).toBe(1);
    expect(result.coverage).toBe(1);
    expect(result.reviewedCount).toBe(5);
    expect(result.score).toBeGreaterThan(0.75);
    expect(['stable', 'mastered']).toContain(result.status);
  });

  it('does not let repeated submissions on one problem create high confidence', () => {
    const rows = Array.from({ length: 8 }, (_, index) =>
      submission(
        `same-${index}`,
        'leetcode:a',
        `2026-08-${String(index * 3 + 1).padStart(2, '0')}T09:00:00.000Z`,
        false,
      ),
    );
    const result = calculateTopicMastery(
      [problem('leetcode:a', 'Easy')],
      [userProblem('leetcode:a', 1)],
      rows,
      now,
    )[0]!;

    expect(result.confidence).toBeLessThan(0.2);
    expect(result.reviewedCount).toBe(0);
  });

  it('deduplicates normalized topic aliases on the same problem', () => {
    const item = problem('leetcode:a', 'Easy');
    item.topics = ['Sliding Window', 'sliding-window'];
    const result = calculateTopicMastery(
      [item],
      [userProblem(item.id)],
      [submission('s1', item.id, '2026-08-20T09:00:00.000Z', false)],
      now,
    )[0]!;

    expect(result.problemCount).toBe(1);
    expect(result.solvedCount).toBe(1);
  });

  it('does not change mastery when an unsolved topic page is merely opened', () => {
    const solved = problem('leetcode:a', 'Easy');
    const unseen = problem('leetcode:b', 'Hard');
    const {
      firstSolvedAt: _firstSolvedAt,
      lastAcceptedAt: _lastAcceptedAt,
      nextReviewAt: _nextReviewAt,
      ...visitedOnly
    } = userProblem(unseen.id, 0);
    const before = calculateTopicMastery(
      [solved],
      [userProblem(solved.id)],
      [submission('s1', solved.id, '2026-08-20T09:00:00.000Z', false)],
      now,
    )[0]!;
    const after = calculateTopicMastery(
      [solved, unseen],
      [userProblem(solved.id), visitedOnly],
      [submission('s1', solved.id, '2026-08-20T09:00:00.000Z', false)],
      now,
    )[0]!;

    expect(after.score).toBe(before.score);
    expect(after.coverage).toBe(before.coverage);
    expect(after.confidence).toBe(before.confidence);
  });
});
