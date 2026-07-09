/**
 * `registerAnalysisSlot` — the one heterogeneous-registry boundary where a
 * declared analysis (a raw {@link AnalysisDef} or a pre-built
 * {@link AnalysisModule} such as an L3 built-in) is normalized into a
 * {@link RegisteredAnalysis} the session drives uniformly with `readonly Row[]`.
 *
 * Lives in its own module (imported by BOTH `buildDashboard` and the session)
 * so neither the def nor the session layer has to import the other for it — the
 * only value edge between the two layers stays `def → session`
 * (`buildDashboard` → `createInteractionSession`), never a cycle.
 */

import { defineAnalysis, type AnalysisOutput } from '../analysis/index.js';
import type { AnalysisSlot, RegisteredAnalysis } from './types.js';

function isAnalysisModule(slot: AnalysisSlot): slot is Extract<AnalysisSlot, { run: unknown }> {
  return typeof (slot as { run?: unknown }).run === 'function';
}

export function registerAnalysisSlot(id: string, slot: AnalysisSlot): RegisteredAnalysis {
  // A pre-built module (an L3 built-in) or a raw def promoted via defineAnalysis.
  // Both expose { id, kind, def, run }; the input generic is erased HERE so the
  // session can drive any analysis with `readonly Row[]` (the runtime shape
  // every built-in accepts — its `toRunInput` maps the rows onward).
  const mod = isAnalysisModule(slot)
    ? slot
    : defineAnalysis(slot as Parameters<typeof defineAnalysis>[0]);
  return {
    id,
    kind: mod.kind,
    def: mod.def as RegisteredAnalysis['def'],
    run: (input, opts) => mod.run(input as never, opts),
  };
}

export type { AnalysisOutput };
