import { describe, expect, it } from 'vitest';
import { getLocale, t } from '../src/lib/i18n';
import { STUDY_PLANS, studyPlanGroupName, studyPlanName } from '../src/lib/study-plans';

describe('language selection', () => {
  it('defaults existing records without a locale to English', () => {
    expect(getLocale(undefined)).toBe('en');
    expect(getLocale('invalid')).toBe('en');
    expect(getLocale('zh')).toBe('zh');
  });

  it('translates dynamic review text in both languages', () => {
    expect(t('en', 'badgeDue', { count: 7 })).toBe('LeetLoop: 7 problems to review today');
    expect(t('zh', 'badgeDue', { count: 7 })).toBe('LeetLoop：今天有 7 道待复习');
  });

  it('shows English names for every study plan topic', () => {
    expect(studyPlanName(STUDY_PLANS[2]!, 'en')).toBe('LeetCode Top 100');
    for (const plan of STUDY_PLANS) {
      for (const group of plan.groups) {
        expect(studyPlanGroupName(group.name, 'en')).not.toMatch(/[\u3400-\u9fff]/);
        expect(studyPlanGroupName(group.name, 'zh')).toBe(group.name);
      }
    }
  });
});
