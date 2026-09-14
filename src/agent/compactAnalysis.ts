import { summarizeDataResult, ProfileError, type RankResult, type RankResultSummary } from '../data/index.js';
import { normalizeRankAnalysisOptions, type RankAnalysisOptions } from '../analysis/rank.js';
import type { AnalysisOutput } from '../analysis/index.js';
import type { AnalysisCommit } from '../session/index.js';
import { ANALYSIS_FIELD } from '../session/namespaces.js';
import { stableJson } from '../def/revision.js';

/** Opt-in result presentation, not an execution limit or a whole-response/token budget. */
export interface CompactAnalysisOptions {
  readonly mode: 'compact';
  /** Ranked references on the first saved-result page. Default 3; maximum 16. */
  readonly rowLimit?: number;
  /** JSON UTF-16 characters in a supported summary only. Default 16000; maximum 64000. */
  readonly maxCharacters?: number;
}

export interface AnalysisOutputDescriptor {
  readonly as: AnalysisOutput['as'];
  readonly name?: string;
  readonly table?: string;
  readonly layer?: string;
}
/** Identity for host-managed access, not a new retrieval tool or an automatically retained output. */
export interface AnalysisRetrievalReference {
  readonly kind: 'host-required';
  readonly sessionId: string;
  readonly analysisId: string;
  readonly commitId?: string;
  readonly note: string;
}
interface ProjectionBase {
  readonly mode: 'compact';
  readonly executed: true;
  readonly committed: boolean;
  readonly output: AnalysisOutputDescriptor;
  readonly retrieval: AnalysisRetrievalReference;
}
export type CompactAnalysisProjection = ProjectionBase & (
  | { readonly status: 'summarized'; readonly summary: RankResultSummary }
  | { readonly status: 'omitted'; readonly reason: 'unsupported-analysis' | 'invalid-receipt' | 'summary-limit'; readonly detail: string }
);
/** Successful execution stays successful even when its output cannot be summarized. */
export type CompactAnalysisOutput = { readonly ok: true; readonly projection: CompactAnalysisProjection };
export type VizCompactAnalysisResult = Omit<AnalysisCommit, 'result'> & {
  readonly result: Extract<AnalysisCommit['result'], { ok: false }> | CompactAnalysisOutput;
};

/** Configure once before any act. The session remains the only execution/receipt owner. */
export function analysisResultProjector(sessionId: string, options?: CompactAnalysisOptions): (analysis: AnalysisCommit) => AnalysisCommit['result'] | VizCompactAnalysisResult['result'] {
  if (options === undefined) return analysis => analysis.result;
  if (options.mode !== 'compact') throw new TypeError('analysisResults.mode must be compact');
  const { rowLimit = 3, maxCharacters = 16_000 } = options;
  if (!Number.isSafeInteger(rowLimit) || rowLimit < 1 || rowLimit > 16) throw new TypeError('analysisResults.rowLimit must be an integer from 1 to 16');
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1 || maxCharacters > 64_000) throw new TypeError('analysisResults.maxCharacters must be an integer from 1 to 64000');
  return analysis => {
    if (!analysis.result.ok) return analysis.result;
    const output = analysis.result.output;
    const base: ProjectionBase = {
      mode: 'compact', executed: true, committed: analysis.commit !== undefined,
      output: { as: output.as, ...('name' in output ? { name: output.name } : {}),
        ...('table' in output ? { table: output.table } : {}), ...('layer' in output ? { layer: output.layer } : {}) },
      retrieval: { kind: 'host-required', sessionId, analysisId: analysis.analysisId,
        ...(analysis.commit ? { commitId: analysis.commit.id } : {}),
        note: 'This port does not retain full outputs or add a retrieval tool. The host must retain the native result for later output access; existing session reads cover only their documented data. Re-running is a new analysis, not retrieval.' },
    };
    const omitted = (reason: Extract<CompactAnalysisProjection, { status: 'omitted' }>['reason'], detail: string): CompactAnalysisOutput =>
      ({ ok: true, projection: { ...base, status: 'omitted', reason, detail } });
    // Only a serializable native rank declaration identifies this contract.
    // An arbitrary analysis module may have any property named `ranking`.
    const act = analysis.commit?.value as { id?: unknown; table?: unknown; def?: { builtin?: unknown } } | undefined;
    if (analysis.kind !== 'transform' || analysis.commit?.field !== ANALYSIS_FIELD || act?.def?.builtin !== 'rank') {
      return omitted('unsupported-analysis', 'Analysis executed; a compact summary is not available for this analysis contract. Its decision receipts remain attached.');
    }
    try {
      const expected = normalizeRankAnalysisOptions(act.def as RankAnalysisOptions & { builtin: 'rank' });
      const receipt = (output as AnalysisOutput & { ranking?: RankResult }).ranking;
      if (act.id !== analysis.analysisId || act.table !== expected.schema.table || output.as !== 'table' || receipt === undefined ||
          receipt.operationId !== expected.operationId || receipt.resultRef !== expected.resultRef ||
          stableJson(receipt.plan) !== stableJson(expected.plan) || stableJson(receipt.schema) !== stableJson(expected.schema) ||
          receipt.conventions.population !== 'analysis-input') {
        return omitted('invalid-receipt', 'Analysis executed; its result does not match the committed native rank declaration. No summary was served.');
      }
      const summary = summarizeDataResult(receipt, { rowLimit, maxCharacters });
      return { ok: true, projection: { ...base, status: 'summarized', summary } };
    } catch (error) {
      return error instanceof ProfileError && error.code === 'PROFILE_LIMIT'
        ? omitted('summary-limit', 'Analysis executed; its supported summary exceeds the configured character limit. No raw-output fallback was served.')
        : omitted('invalid-receipt', 'Analysis executed; its result could not be validated for compact presentation. No summary was served.');
    }
  };
}
