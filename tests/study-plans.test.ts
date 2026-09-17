import { describe, expect, it } from 'vitest';
import { calculatePlanProgress } from '../src/lib/progress';
import { getStudyPlan, STUDY_PLANS } from '../src/lib/study-plans';
import type { UserProblem } from '../src/lib/types';

function solved(problemId: string): UserProblem {
  const now = new Date('2026-09-01T12:00:00Z');
  return {
    problemId,
    status: 'learning',
    firstSeenAt: now,
    firstSolvedAt: now,
    lastAttemptAt: now,
    lastAcceptedAt: now,
    reviewCount: 1,
    lapses: 0,
    consecutiveSuccesses: 1,
    approachScore: 0.8,
    implementationScore: 0.8,
  };
}

describe('study plan progress', () => {
  it('has complete, unique fixed lists', () => {
    expect(STUDY_PLANS.map((plan) => plan.slugs.length)).toEqual([75, 250, 100]);
    for (const plan of STUDY_PLANS) {
      expect(new Set(plan.slugs).size).toBe(plan.slugs.length);
    }
    expect(getStudyPlan('blind75').slugs.every((slug) => getStudyPlan('neetcode250').slugs.includes(slug))).toBe(true);
  });

  it('counts each solved problem once in the whole list and topic', () => {
    const plan = getStudyPlan('blind75');
    const result = calculatePlanProgress(plan, [solved('leetcode:two-sum'), solved('leetcode:two-sum')]);
    expect(result.solved).toBe(1);
    expect(result.total).toBe(75);
    expect(result.groups.find((item) => item.group.name === '数组与哈希')).toMatchObject({ solved: 1, total: 8 });
  });
});
