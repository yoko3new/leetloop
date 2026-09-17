import { describe, expect, it } from 'vitest';
import { terminalBelongsToAttempt } from '../src/lib/capture-state';

describe('submission result correlation', () => {
  it('accepts a semantic terminal result when the page had no old result', () => {
    expect(
      terminalBelongsToAttempt({
        verdict: 'Accepted',
        inResultContainer: true,
        exactVerdictNode: false,
        sawTransition: false,
      }),
    ).toBe(true);
  });

  it('ignores an unchanged old result until judging is observed', () => {
    expect(
      terminalBelongsToAttempt({
        verdict: 'Accepted',
        baselineVerdict: 'Accepted',
        inResultContainer: true,
        exactVerdictNode: true,
        sawTransition: false,
      }),
    ).toBe(false);
  });

  it('accepts the same verdict after the old result was replaced', () => {
    expect(
      terminalBelongsToAttempt({
        verdict: 'Accepted',
        baselineVerdict: 'Accepted',
        inResultContainer: true,
        exactVerdictNode: true,
        sawTransition: true,
      }),
    ).toBe(true);
  });

  it('ignores unrelated verdict copy outside the result area', () => {
    expect(
      terminalBelongsToAttempt({
        verdict: 'Wrong Answer',
        inResultContainer: false,
        exactVerdictNode: false,
        sawTransition: true,
      }),
    ).toBe(false);
    expect(
      terminalBelongsToAttempt({
        verdict: 'Wrong Answer',
        inResultContainer: false,
        exactVerdictNode: true,
        sawTransition: false,
      }),
    ).toBe(false);
  });

  it('accepts an exact fallback only after a judging transition', () => {
    expect(
      terminalBelongsToAttempt({
        verdict: 'Runtime Error',
        inResultContainer: false,
        exactVerdictNode: true,
        sawTransition: true,
      }),
    ).toBe(true);
  });
});
