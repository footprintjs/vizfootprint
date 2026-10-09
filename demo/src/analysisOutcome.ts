import type { AnalysisCommit } from 'vizfootprint/session';

/** A refusal before execution is not a data fit or an engine read failure. */
export function analysisOutcomeText(result: Extract<AnalysisCommit['result'], { ok: false }>, degenerate: (n: number) => string): string {
  if (result.reason === 'degenerate-fit') return degenerate(result.n);
  if (result.reason === 'guard-failed') return `not run — ${result.detail}`;
  return `unavailable — the engine refused the read: ${result.rejection.detail ?? result.rejection.reason}`;
}
