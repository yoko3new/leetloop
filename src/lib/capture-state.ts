import type { SubmissionVerdict } from './types';

export interface TerminalVerdictEvidence {
  verdict: SubmissionVerdict;
  baselineVerdict?: SubmissionVerdict;
  inResultContainer: boolean;
  exactVerdictNode: boolean;
  sawTransition: boolean;
}

/**
 * Correlates a terminal verdict with an explicit submit intent. A semantic
 * result is sufficient on a page with no previous result. If a previous result
 * exists, the new result must differ or follow an observed judging transition.
 * Text-only fallbacks are accepted only after that transition and only when the
 * node contains exactly the verdict.
 */
export function terminalBelongsToAttempt(
  evidence: TerminalVerdictEvidence,
): boolean {
  const semanticTerminal =
    evidence.inResultContainer &&
    (!evidence.baselineVerdict ||
      evidence.sawTransition ||
      evidence.verdict !== evidence.baselineVerdict);

  return (
    semanticTerminal ||
    (evidence.exactVerdictNode && evidence.sawTransition)
  );
}
