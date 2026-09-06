/**
 * `registerAnalysisSlot` — the one heterogeneous-registry boundary where a
 * declared analysis (a raw {@link AnalysisDef}, a pre-built
 * {@link AnalysisModule} such as an L3 built-in, or a builtin RECORD naming one
 * as data) is normalized into a {@link RegisteredAnalysis} the session drives
 * uniformly with `readonly Row[]`.
 *
 * Lives in its own module (imported by BOTH `buildDashboard` and the session)
 * so neither the def nor the session layer has to import the other for it — the
 * only value edge between the two layers stays `def → session`
 * (`buildDashboard` → `createInteractionSession`), never a cycle.
 */

import { defineAnalysis, type AnalysisOutput } from '../analysis/index.js';
import { buildBuiltinAnalysis, isBuiltinRecord, type BuiltinAnalysisDecl } from './builtinAnalyses.js';
import type { AnalysisSlot, RegisteredAnalysis } from './types.js';

function isAnalysisModule(slot: AnalysisSlot): slot is Extract<AnalysisSlot, { run: unknown }> {
  return typeof (slot as { run?: unknown }).run === 'function';
}

export function registerAnalysisSlot(id: string, slot: AnalysisSlot): RegisteredAnalysis {
  // A pre-built module (an L3 built-in), a builtin record resolved to its
  // factory, or a raw def promoted via defineAnalysis — routed on SHAPE by the
  // same two predicates the def door validates with, so what validates is what
  // gets built. All three expose { id, kind, def, run }; the input generic is
  // erased HERE so the session can drive any analysis with `readonly Row[]`
  // (the runtime shape every built-in accepts — its `toRunInput` maps the rows
  // onward). A slot that is none of the three falls to `defineAnalysis`, whose
  // own refusal names every missing piece.
  //
  // A RECORD with no `id` takes the key it was declared under. A module carries
  // its own identity because a developer wrote it and may register it anywhere;
  // a record has no identity except the name a person gave it, and that name is
  // the one they will look for in `why`, in the FDR ledger and in a citation. A
  // factory spelling (`groupby:disease:cases`) leaking into provenance would be
  // an implementation detail wearing a person's name badge. An explicit `id` on
  // a record still wins; modules are untouched.
  //
  // A RECORD is kept beside the module it built, because a record is DATA and a
  // module is not: an act declared from one can carry its own declaration onto
  // the trace, and a replay can then rebuild it from bytes alone (law 6). The
  // record kept is the one that was actually built — id injected — so what
  // replays is what ran, not what was typed.
  const record = isAnalysisModule(slot) || !isBuiltinRecord(slot) ? undefined : ({ ...slot, id: slot.id ?? id } as BuiltinAnalysisDecl);
  const mod = isAnalysisModule(slot)
    ? slot
    : record !== undefined
      ? buildBuiltinAnalysis(record)
      : defineAnalysis(slot as Parameters<typeof defineAnalysis>[0]);
  return {
    id,
    kind: mod.kind,
    def: mod.def as RegisteredAnalysis['def'],
    run: (input, opts) => mod.run(input as never, opts),
    ...(record !== undefined ? { record } : {}),
  };
}

export type { AnalysisOutput };
