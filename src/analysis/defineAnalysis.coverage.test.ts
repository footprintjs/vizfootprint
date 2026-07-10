/**
 * defineAnalysis.coverage.test.ts — closes two `validateAnalysisDef` gaps
 * that defineAnalysis.test.ts's "bad" corpus does not include: a NON-OBJECT
 * entry inside `inputs` (as opposed to an object missing `column`), and a
 * NON-OBJECT (or null) `honesty` declaration.
 */

import { describe, it, expect } from 'vitest';
import { flowChart } from 'footprintjs';
import { defineAnalysis, validateAnalysisDef, AnalysisDefError } from './defineAnalysis.js';
import type { AnalysisDef, ScalarOutput } from './index.js';

function minimalDef(over: Partial<AnalysisDef<void, ScalarOutput>> = {}): AnalysisDef<void, ScalarOutput> {
  return {
    id: 'min',
    kind: 'transform',
    produces: 'scalar',
    inputs: [],
    build: () => flowChart<Record<string, unknown>>('seed', (s) => s.$setValue('v', 42), 'seed').build(),
    toRunInput: () => ({}),
    readOutput: ({ snapshot }) => ({
      ok: true,
      output: { as: 'scalar', name: 'v', value: snapshot.sharedState.v as number },
    }),
    ...over,
  };
}

describe('validateAnalysisDef — inputs entries that are not objects at all', () => {
  it('a bare string in inputs is rejected with an "must be an object" problem, not a crash', () => {
    const problems = validateAnalysisDef(minimalDef({ inputs: ['amount'] as unknown as AnalysisDef['inputs'] }));
    expect(problems).toContain('inputs[0] must be an object');
  });

  it('null inside inputs is also rejected as "must be an object"', () => {
    const problems = validateAnalysisDef(
      minimalDef({ inputs: [null] as unknown as AnalysisDef['inputs'] }),
    );
    expect(problems).toContain('inputs[0] must be an object');
  });

  it('a number inside inputs is rejected, and does NOT also report a spurious column/role problem for that entry', () => {
    const problems = validateAnalysisDef(minimalDef({ inputs: [42] as unknown as AnalysisDef['inputs'] }));
    expect(problems).toEqual(['inputs[0] must be an object']);
  });

  it('rejects at construction too (defineAnalysis throws AnalysisDefError)', () => {
    expect(() => defineAnalysis(minimalDef({ inputs: ['x'] as unknown as AnalysisDef['inputs'] }))).toThrow(
      AnalysisDefError,
    );
  });
});

describe('validateAnalysisDef — a non-function precheck', () => {
  it('a precheck that is present but not a function is rejected', () => {
    const problems = validateAnalysisDef(
      minimalDef({ precheck: 'always fine' as unknown as AnalysisDef['precheck'] }),
    );
    expect(problems).toContain('precheck, if present, must be a function');
  });

  it('an omitted precheck (undefined) is fine — optional', () => {
    expect(validateAnalysisDef(minimalDef({ precheck: undefined }))).toEqual([]);
  });
});

describe('validateAnalysisDef — a non-object honesty declaration', () => {
  it('a string honesty is rejected as "must be an object"', () => {
    const problems = validateAnalysisDef(
      minimalDef({ honesty: 'always trust me' as unknown as AnalysisDef['honesty'] }),
    );
    expect(problems).toContain('honesty, if present, must be an object');
  });

  it('a null honesty is ALSO rejected (honesty !== undefined but honesty === null)', () => {
    const problems = validateAnalysisDef(
      minimalDef({ honesty: null as unknown as AnalysisDef['honesty'] }),
    );
    expect(problems).toContain('honesty, if present, must be an object');
  });

  it('an omitted honesty (undefined) is fine — no problem reported', () => {
    expect(validateAnalysisDef(minimalDef({ honesty: undefined }))).toEqual([]);
  });
});
