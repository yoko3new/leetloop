import { fsrs } from 'ts-fsrs';
import { normalizeTopic, topicLabel } from './topic-labels';
import type {
  Problem,
  ProblemDifficulty,
  Submission,
  UserProblem,
} from './types';

export type TopicMasteryStatus =
  | 'new'
  | 'unrated'
  | 'weak'
  | 'developing'
  | 'stable'
  | 'mastered';

export interface TopicMastery {
  topic: string;
  label: string;
  problemCount: number;
  solvedCount: number;
  reviewedCount: number;
  reviewAttemptCount: number;
  retention: number;
  fluency: number;
  transfer: number;
  coverage: number;
  confidence: number;
  score: number;
  status: TopicMasteryStatus;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const TARGET_TIME_MS: Record<ProblemDifficulty, number> = {
  Easy: 25 * 60 * 1000,
  Medium: 40 * 60 * 1000,
  Hard: 60 * 60 * 1000,
  Unknown: 40 * 60 * 1000,
};

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function mean(values: number[], fallback = 0): number {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : fallback;
}

function rounded(value: number): number {
  return Math.round(clamp(value) * 1000) / 1000;
}

function retentionFor(userProblem: UserProblem, now: Date): number {
  if (userProblem.schedulerCard) {
    try {
      return clamp(
        fsrs({ enable_fuzz: false }).get_retrievability(
          userProblem.schedulerCard,
          now,
          false,
        ),
      );
    } catch {
      // A partially migrated card falls back to the transparent local score.
    }
  }

  const base = userProblem.approachScore || 0.35;
  const dueAt = userProblem.nextReviewAt;
  if (!dueAt) return clamp(base);
  const overdueDays = Math.max(0, (now.getTime() - dueAt.getTime()) / DAY_MS);
  return clamp(base * Math.exp(-overdueDays / 30));
}

function fluencyFor(
  problem: Problem,
  submission: Submission | undefined,
): number {
  if (!submission) return 0;
  const target = TARGET_TIME_MS[problem.difficulty];
  const elapsed = submission.elapsedMs > 0 ? submission.elapsedMs : target;
  const timeScore = clamp(target / elapsed, 0.25, 1);
  const attemptPenalty = clamp(
    1 - (submission.attemptNumber - 1) * 0.13,
    0.35,
    1,
  );
  const hintPenalty =
    submission.hintExposure === 'solution'
      ? 0.25
      : submission.hintExposure === 'hint'
        ? 0.65
        : 1;
  const verdictPenalty = submission.verdict === 'Accepted' ? 1 : 0.2;
  return clamp(timeScore * attemptPenalty * hintPenalty * verdictPenalty);
}

function statusFor(
  solvedCount: number,
  reviewedCount: number,
  score: number,
  coverage: number,
  transfer: number,
  confidence: number,
): TopicMasteryStatus {
  if (solvedCount === 0) return 'new';
  if (reviewedCount === 0) return 'unrated';
  if (score < 0.4) return 'weak';
  if (score < 0.65) return 'developing';
  if (
    score >= 0.82 &&
    coverage >= 0.65 &&
    transfer >= 0.7 &&
    confidence >= 0.6
  ) {
    return 'mastered';
  }
  return 'stable';
}

/**
 * Keeps memory, coding fluency, transfer and coverage separate. Confidence
 * grows only when evidence spans multiple questions and multiple days.
 */
export function calculateTopicMastery(
  problems: Problem[],
  userProblems: UserProblem[],
  submissions: Submission[],
  now = new Date(),
): TopicMastery[] {
  const userByProblem = new Map(
    userProblems.map((userProblem) => [userProblem.problemId, userProblem]),
  );
  const submissionsByProblem = new Map<string, Submission[]>();
  for (const submission of submissions) {
    const rows = submissionsByProblem.get(submission.problemId) ?? [];
    rows.push(submission);
    submissionsByProblem.set(submission.problemId, rows);
  }
  for (const rows of submissionsByProblem.values()) {
    rows.sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime());
  }

  const topicProblems = new Map<string, Problem[]>();
  for (const problem of problems) {
    const normalizedTopics = new Set(
      problem.topics.map(normalizeTopic).filter(Boolean),
    );
    for (const topic of normalizedTopics) {
      const rows = topicProblems.get(topic) ?? [];
      rows.push(problem);
      topicProblems.set(topic, rows);
    }
  }

  const result: TopicMastery[] = [];
  for (const [topic, relatedProblems] of topicProblems) {
    const solvedProblems = relatedProblems.filter((problem) =>
      Boolean(userByProblem.get(problem.id)?.firstSolvedAt),
    );
    const relatedUsers = solvedProblems
      .map((problem) => userByProblem.get(problem.id))
      .filter((item): item is UserProblem => Boolean(item));
    const latestSubmission = new Map<string, Submission>();
    const firstAccepted: Submission[] = [];
    const topicSubmissions: Submission[] = [];

    for (const problem of solvedProblems) {
      const rows = submissionsByProblem.get(problem.id) ?? [];
      topicSubmissions.push(...rows);
      const accepted = rows.filter((row) => row.verdict === 'Accepted');
      if (accepted[0]) firstAccepted.push(accepted[0]);
      if (rows.at(-1)) latestSubmission.set(problem.id, rows.at(-1)!);
    }

    const reviewAttempts = topicSubmissions.filter(
      (row) => row.isReview && row.verdict === 'Accepted',
    );
    const reviewedProblemIds = new Set(
      reviewAttempts.map((row) => row.problemId),
    );
    const reviewedCount = reviewedProblemIds.size;
    const retention = mean(relatedUsers.map((item) => retentionFor(item, now)));
    const fluency = mean(
      solvedProblems.map((problem) =>
        fluencyFor(problem, latestSubmission.get(problem.id)),
      ),
    );
    const independentFirstPassRatio = firstAccepted.length
      ? firstAccepted.filter(
          (row) => row.hintExposure === 'none' && row.attemptNumber <= 2,
        ).length / firstAccepted.length
      : 0;
    const transferBreadth = clamp((firstAccepted.length - 1) / 3);
    const transfer = independentFirstPassRatio * transferBreadth;

    const difficultyCount = new Set(
      solvedProblems
        .map((problem) => problem.difficulty)
        .filter((difficulty) => difficulty !== 'Unknown'),
    ).size;
    // We do not know LeetCode's complete topic catalogue without crawling it.
    // Coverage therefore measures demonstrated breadth only; merely opening an
    // unsolved page must not lower (or raise) an existing mastery estimate.
    const coverage = clamp(
      Math.min(solvedProblems.length / 5, 1) * 0.65 +
        (difficultyCount / 3) * 0.35,
    );

    const meaningfulEvidence = [
      ...firstAccepted,
      ...reviewAttempts,
    ];
    const evidenceDates = meaningfulEvidence
      .map((row) => row.submittedAt.getTime())
      .sort((a, b) => a - b);
    const evidenceSpan = evidenceDates.length
      ? (evidenceDates.at(-1)! - evidenceDates[0]!) / DAY_MS
      : 0;
    const distinctProblemEvidence = Math.min(solvedProblems.length / 5, 1);
    const reviewedProblemEvidence = solvedProblems.length
      ? reviewedCount / solvedProblems.length
      : 0;
    const confidence = clamp(
      distinctProblemEvidence * 0.35 +
        reviewedProblemEvidence * 0.35 +
        Math.min(evidenceSpan / 21, 1) * 0.3,
    );

    const rawScore =
      retention * 0.35 +
      fluency * 0.25 +
      transfer * 0.25 +
      coverage * 0.15;
    const score = rawScore * (0.65 + confidence * 0.35);

    result.push({
      topic,
      label: topicLabel(topic),
      problemCount: relatedProblems.length,
      solvedCount: solvedProblems.length,
      reviewedCount,
      reviewAttemptCount: reviewAttempts.length,
      retention: rounded(retention),
      fluency: rounded(fluency),
      transfer: rounded(transfer),
      coverage: rounded(coverage),
      confidence: rounded(confidence),
      score: rounded(score),
      status: statusFor(
        solvedProblems.length,
        reviewedCount,
        score,
        coverage,
        transfer,
        confidence,
      ),
    });
  }

  return result.sort(
    (a, b) => a.score - b.score || b.problemCount - a.problemCount,
  );
}
