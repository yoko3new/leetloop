import type { StudyPlan, StudyPlanGroup } from './study-plans';
import type { UserProblem } from './types';

export interface GroupProgress {
  group: StudyPlanGroup;
  solved: number;
  total: number;
}

export interface PlanProgress {
  solved: number;
  total: number;
  groups: GroupProgress[];
}

/** One accepted problem counts once, regardless of submissions or reviews. */
export function calculatePlanProgress(
  plan: StudyPlan,
  userProblems: UserProblem[],
): PlanProgress {
  const solved = new Set(
    userProblems
      .filter((item) => Boolean(item.firstSolvedAt))
      .map((item) => item.problemId.replace(/^leetcode:/, '')),
  );
  return {
    solved: plan.slugs.filter((slug) => solved.has(slug)).length,
    total: plan.slugs.length,
    groups: plan.groups.map((group) => ({
      group,
      solved: group.slugs.filter((slug) => solved.has(slug)).length,
      total: group.slugs.length,
    })),
  };
}
