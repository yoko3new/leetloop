import type { Card } from 'ts-fsrs';

export type ProblemDifficulty = 'Easy' | 'Medium' | 'Hard' | 'Unknown';

export type SubmissionVerdict =
  | 'Accepted'
  | 'Wrong Answer'
  | 'Time Limit Exceeded'
  | 'Runtime Error'
  | 'Memory Limit Exceeded'
  | 'Compile Error'
  | 'Output Limit Exceeded'
  | 'Unknown';

export type HintExposure = 'none' | 'hint' | 'solution';

export type LearningStatus =
  | 'learning'
  | 'reviewing'
  | 'mastered'
  | 'relearning';

export interface Problem {
  id: string;
  provider: 'leetcode';
  slug: string;
  title: string;
  url: string;
  difficulty: ProblemDifficulty;
  topics: string[];
  updatedAt: Date;
}

export interface UserProblem {
  problemId: string;
  status: LearningStatus;
  firstSeenAt: Date;
  firstSolvedAt?: Date;
  lastAttemptAt: Date;
  lastAcceptedAt?: Date;
  nextReviewAt?: Date;
  reviewCount: number;
  lapses: number;
  consecutiveSuccesses: number;
  lastRating?: number;
  approachScore: number;
  implementationScore: number;
  schedulerCard?: Card;
  lastFailedAt?: Date;
  lastFailureGradedAt?: Date;
}

export interface Submission {
  id: string;
  eventId: string;
  problemId: string;
  submittedAt: Date;
  verdict: SubmissionVerdict;
  language?: string;
  elapsedMs: number;
  attemptNumber: number;
  hintExposure: HintExposure;
  isReview: boolean;
}

export interface ReviewLog {
  id: string;
  problemId: string;
  reviewedAt: Date;
  rating: number;
  previousDueAt?: Date;
  nextDueAt: Date;
  elapsedMs: number;
  attemptNumber: number;
  hintExposure: HintExposure;
  verdict?: SubmissionVerdict;
}

export interface Settings {
  id: 'main';
  reminderEnabled: boolean;
  reminderHour: number;
  desiredRetention: number;
  lastNotificationDate?: string;
  selectedStudyPlan?: 'blind75' | 'neetcode250' | 'hot100';
}

export interface ProblemCapture {
  slug: string;
  title: string;
  url: string;
  difficulty: ProblemDifficulty;
  topics: string[];
}

export interface AttemptCapture {
  eventId: string;
  problem: ProblemCapture;
  submittedAt: string;
  verdict: SubmissionVerdict;
  language?: string;
  elapsedMs: number;
  attemptNumber: number;
  hintExposure: HintExposure;
}

export interface ProblemStatus {
  tracked: boolean;
  status?: LearningStatus;
  nextReviewAt?: string;
  due: boolean;
}

export interface RecordAttemptResponse {
  duplicate: boolean;
  accepted: boolean;
  isReview: boolean;
  nextReviewAt?: string;
  rating?: number;
}

export type ExtensionRequest =
  | { type: 'PAGE_SEEN'; problem: ProblemCapture; seenAt: string }
  | { type: 'RECORD_ATTEMPT'; capture: AttemptCapture }
  | { type: 'GET_PROBLEM_STATUS'; slug: string }
  | { type: 'REFRESH_BADGE' };

export type ExtensionResponse =
  | { ok: true; data?: RecordAttemptResponse | ProblemStatus }
  | { ok: false; error: string };
