/**
 * MINIMAL commit-log stub for the X2 spike ONLY.
 *
 * The real commit log (the append-only, cause-tagged provenance stream that the
 * FDR layer reads declared analyses from) is owned by packet L1. This stub
 * exists solely so the X2 acceptance tests have a source of
 * {hypothesisId, pValue, timestamp, branchId} records. Do NOT design against
 * it — L1 replaces it wholesale.
 */

import type { HypothesisRecord } from '../../src/fdr/index.js';

/** A trivial append-only in-memory log of declared analyses. */
export class DeclaredAnalysisLog {
  private readonly records: HypothesisRecord[] = [];

  /** Append a declared analysis result. Returns the record. */
  declare(rec: HypothesisRecord): HypothesisRecord {
    this.records.push(rec);
    return rec;
  }

  /** The declared analyses in arrival order. */
  stream(): readonly HypothesisRecord[] {
    return this.records;
  }
}
