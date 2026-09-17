import Dexie, { type EntityTable } from 'dexie';
import type {
  Problem,
  ReviewLog,
  Settings,
  Submission,
  UserProblem,
} from './types';

export class LeetLoopDatabase extends Dexie {
  problems!: EntityTable<Problem, 'id'>;
  userProblems!: EntityTable<UserProblem, 'problemId'>;
  submissions!: EntityTable<Submission, 'id'>;
  reviewLogs!: EntityTable<ReviewLog, 'id'>;
  settings!: EntityTable<Settings, 'id'>;

  constructor() {
    super('leetloop');

    this.version(1).stores({
      problems: '&id,&slug,difficulty,*topics,updatedAt',
      userProblems:
        '&problemId,status,nextReviewAt,lastAttemptAt,lastAcceptedAt',
      submissions:
        '&id,&eventId,problemId,submittedAt,verdict,isReview',
      reviewLogs: '&id,problemId,reviewedAt,rating,nextDueAt',
      settings: '&id',
    });
  }
}

export const db = new LeetLoopDatabase();

export const DEFAULT_SETTINGS: Settings = {
  id: 'main',
  reminderEnabled: true,
  reminderHour: 9,
  desiredRetention: 0.9,
};

export async function getSettings(): Promise<Settings> {
  return db.transaction('rw', db.settings, async () => {
    const settings = await db.settings.get('main');
    if (settings) return settings;

    await db.settings.put(DEFAULT_SETTINGS);
    return DEFAULT_SETTINGS;
  });
}
