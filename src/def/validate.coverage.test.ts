/**
 * `validateDashboardDef` (R12 firewall) — coverage packet for the rejection
 * arms not already exercised by `buildDashboard.test.ts`'s behavioral suite.
 * Every test feeds a malformed `DashboardDef` and asserts the EXACT problem
 * message text `validateDashboardDef` produces (never throws — it collects).
 */
import { describe, it, expect } from 'vitest';
import { validateDashboardDef, dispatchVerbs } from './validate.js';
import { DISPATCH_VERBS } from './types.js';

/** A minimal valid def (one table `data`, one actor `v`) with overrides spliced on top. */
function baseDef(overrides: Record<string, unknown> = {}): unknown {
  return {
    data: { data: { rows: [{ id: 1 }] } },
    actors: { v: { actor: 'user' } },
    ...overrides,
  };
}

describe('validateDashboardDef — top-level shape', () => {
  it.each([null, undefined, 42, 'x', [], true])('rejects a non-object def (%p)', (bad) => {
    expect(validateDashboardDef(bad)).toEqual(['def must be a plain object']);
  });
});

describe('validateDashboardDef — data table shape', () => {
  it('rejects a data table source that is not an object', () => {
    expect(validateDashboardDef(baseDef({ data: { t: 'nope' } }))).toContain(
      'data["t"] must be an object { rows | csv, engine? }',
    );
  });

  it('rejects a data table that sets neither rows nor csv', () => {
    expect(validateDashboardDef(baseDef({ data: { t: {} } }))).toContain('data["t"] must set rows or csv');
  });

  it('rejects rows that are not an array', () => {
    expect(validateDashboardDef(baseDef({ data: { t: { rows: 'nope' } } }))).toContain(
      'data["t"].rows must be an array',
    );
  });

  it('rejects csv that is not a string', () => {
    expect(validateDashboardDef(baseDef({ data: { t: { csv: 42 } } }))).toContain(
      'data["t"].csv must be a string',
    );
  });

  it('rejects an unknown engine', () => {
    expect(validateDashboardDef(baseDef({ data: { t: { rows: [], engine: 'quantum' } } }))).toContain(
      'data["t"].engine must be one of memory|wasm|server|auto',
    );
  });

  it('rejects an unknown layout', () => {
    expect(validateDashboardDef(baseDef({ data: { t: { rows: [], layout: 'diagonal' } } }))).toContain(
      'data["t"].layout, if present, must be "row" | "column"',
    );
  });

  it('accepts "row" and "column" layouts', () => {
    expect(validateDashboardDef(baseDef({ data: { t: { rows: [], layout: 'row' } } }))).toEqual([]);
    expect(validateDashboardDef(baseDef({ data: { t: { rows: [], layout: 'column' } } }))).toEqual([]);
  });
});

describe('validateDashboardDef — actors shape', () => {
  it('rejects actors that is not an object', () => {
    expect(validateDashboardDef(baseDef({ actors: 'nope' }))).toContain(
      'actors must be an object mapping viewId -> { actor, label? }',
    );
  });

  it('rejects an actor meta entry that is not an object', () => {
    expect(validateDashboardDef(baseDef({ actors: { v: 'nope' } }))).toContain(
      'actors["v"] must be an object { actor, label? }',
    );
  });

  it('rejects a non-string label', () => {
    expect(validateDashboardDef(baseDef({ actors: { v: { actor: 'user', label: 42 } } }))).toContain(
      'actors["v"].label, if present, must be a string',
    );
  });

  it('accepts a valid string label', () => {
    expect(validateDashboardDef(baseDef({ actors: { v: { actor: 'user', label: 'ok' } } }))).toEqual([]);
  });

  // TL-1: the session lands its own commits under these namespaces, where they
  // are INERT in the fold by design — a host view squatting one would be
  // unfoldable, invisible to compare, and silently skipped by adoptPath. Rejected
  // at the def boundary, with the prefix named, instead of failing confusingly later.
  it.each([
    ['chart:x', 'chart:'],
    ['encoding:scatter', 'encoding:'],
    ['analysis:correlation', 'analysis:'],
    ['annotation:user', 'annotation:'],
    ['layout:dashboard', 'layout:'],
  ])('rejects a view id in the reserved namespace %p', (viewId, prefix) => {
    const problems = validateDashboardDef(baseDef({ actors: { [viewId]: { actor: 'user' } } }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`actors["${viewId}"]: a view id may not start with "${prefix}"`);
    expect(problems[0]).toContain('silently skipped when a path is adopted');
  });

  it('a view id that merely CONTAINS a reserved word is fine — only the prefix is reserved', () => {
    expect(validateDashboardDef(baseDef({ actors: { 'my-chart': { actor: 'user' }, 'x:chart:y': { actor: 'user' } } }))).toEqual([]);
  });
});

describe('validateDashboardDef — analyses shape', () => {
  it('rejects analyses that is not an object (an array included)', () => {
    expect(validateDashboardDef(baseDef({ analyses: ['nope'] }))).toContain(
      'analyses, if present, must be an object mapping id -> AnalysisDef | AnalysisModule',
    );
  });
});

describe('validateDashboardDef — capabilities shape', () => {
  it('rejects capabilities that is not an array', () => {
    expect(validateDashboardDef(baseDef({ capabilities: {} }))).toContain(
      'capabilities, if present, must be an array of CapabilityDecl',
    );
  });

  it('rejects a capability entry that is not an object', () => {
    expect(validateDashboardDef(baseDef({ capabilities: ['nope'] }))).toContain(
      'capabilities[0] must be an object',
    );
  });

  it('rejects a missing viewId', () => {
    expect(validateDashboardDef(baseDef({ capabilities: [{ canProbe: true }] }))).toContain(
      'capabilities[0].viewId must be a non-empty string',
    );
  });

  it('rejects an empty-string viewId', () => {
    expect(validateDashboardDef(baseDef({ capabilities: [{ viewId: '', canProbe: true }] }))).toContain(
      'capabilities[0].viewId must be a non-empty string',
    );
  });

  it('rejects a non-boolean canProbe', () => {
    expect(validateDashboardDef(baseDef({ capabilities: [{ viewId: 'v', canProbe: 'yes' }] }))).toContain(
      'capabilities[0].canProbe must be a boolean',
    );
  });

  it('rejects capabilities.encodings that is not an array', () => {
    expect(
      validateDashboardDef(baseDef({ capabilities: [{ viewId: 'v', canProbe: true, encodings: 'point' }] })),
    ).toContain('capabilities[0].encodings must be an array of "point" | "interval" | "cell"');
  });

  it('rejects capabilities.encodings entries outside point|interval|cell', () => {
    expect(
      validateDashboardDef(baseDef({ capabilities: [{ viewId: 'v', canProbe: true, encodings: ['area'] }] })),
    ).toContain('capabilities[0].encodings must be an array of "point" | "interval" | "cell"');
  });

  it('accepts the D30 cell emission kind in capabilities.encodings', () => {
    expect(
      validateDashboardDef(baseDef({ capabilities: [{ viewId: 'v', canProbe: true, encodings: ['cell'] }] })),
    ).toEqual([]);
  });

  it('accepts valid capabilities.encodings', () => {
    expect(
      validateDashboardDef(
        baseDef({ capabilities: [{ viewId: 'v', canProbe: true, encodings: ['point', 'interval'] }] }),
      ),
    ).toEqual([]);
  });

  it('rejects capabilities.fields that is not an array', () => {
    expect(
      validateDashboardDef(baseDef({ capabilities: [{ viewId: 'v', canProbe: true, fields: 'price' }] })),
    ).toContain('capabilities[0].fields must be an array of strings');
  });

  it('rejects capabilities.fields with a non-string entry', () => {
    expect(
      validateDashboardDef(baseDef({ capabilities: [{ viewId: 'v', canProbe: true, fields: [42] }] })),
    ).toContain('capabilities[0].fields must be an array of strings');
  });

  it('accepts valid capabilities.fields', () => {
    expect(
      validateDashboardDef(
        baseDef({ capabilities: [{ viewId: 'v', canProbe: true, fields: ['price', 'rating'] }] }),
      ),
    ).toEqual([]);
  });
});

describe('validateDashboardDef — encodings shape (top-level ViewEncodingDecl list)', () => {
  it('rejects encodings that is not an array', () => {
    expect(validateDashboardDef(baseDef({ encodings: {} }))).toContain(
      'encodings, if present, must be an array of ViewEncodingDecl',
    );
  });

  it('rejects an encoding entry that is not an object', () => {
    expect(validateDashboardDef(baseDef({ encodings: ['nope'] }))).toContain('encodings[0] must be an object');
  });

  it('rejects a missing viewId', () => {
    expect(
      validateDashboardDef(baseDef({ encodings: [{ chartKind: 'point', channels: ['x'] }] })),
    ).toContain('encodings[0].viewId must be a non-empty string');
  });

  it('rejects a missing chartKind', () => {
    expect(
      validateDashboardDef(baseDef({ encodings: [{ viewId: 'v', channels: ['x'] }] })),
    ).toContain('encodings[0].chartKind must be a non-empty string');
  });

  it('accepts an encoding declaration with no initial mapping', () => {
    expect(
      validateDashboardDef(baseDef({ encodings: [{ viewId: 'v', chartKind: 'point', channels: ['x'] }] })),
    ).toEqual([]);
  });
});

describe('validateDashboardDef — fdr shape', () => {
  it('rejects fdr that is not an object', () => {
    expect(validateDashboardDef(baseDef({ fdr: 'nope' }))).toContain('fdr, if present, must be an object');
  });

  it('rejects an unknown procedure', () => {
    expect(validateDashboardDef(baseDef({ fdr: { procedure: 'bogus', alpha: 0.05 } }))).toContain(
      'fdr.procedure must be "LORD++" | "alpha-investing"',
    );
  });

  it('rejects alpha out of (0,1)', () => {
    expect(validateDashboardDef(baseDef({ fdr: { procedure: 'LORD++', alpha: 0 } }))).toContain(
      'fdr.alpha must be a number in (0,1)',
    );
  });

  it('rejects a non-number w0', () => {
    expect(
      validateDashboardDef(baseDef({ fdr: { procedure: 'LORD++', alpha: 0.05, w0: 'x' } })),
    ).toContain('fdr.w0, if present, must be a non-negative number');
  });

  it('rejects a negative w0', () => {
    expect(
      validateDashboardDef(baseDef({ fdr: { procedure: 'LORD++', alpha: 0.05, w0: -1 } })),
    ).toContain('fdr.w0, if present, must be a non-negative number');
  });

  it('accepts a valid w0', () => {
    expect(validateDashboardDef(baseDef({ fdr: { procedure: 'LORD++', alpha: 0.05, w0: 0.01 } }))).toEqual([]);
  });

  it('rejects a non-number omega', () => {
    expect(
      validateDashboardDef(baseDef({ fdr: { procedure: 'alpha-investing', alpha: 0.05, omega: 'x' } })),
    ).toContain('fdr.omega, if present, must be a non-negative number');
  });

  it('rejects a negative omega', () => {
    expect(
      validateDashboardDef(baseDef({ fdr: { procedure: 'alpha-investing', alpha: 0.05, omega: -1 } })),
    ).toContain('fdr.omega, if present, must be a non-negative number');
  });

  it('accepts a valid omega', () => {
    expect(
      validateDashboardDef(baseDef({ fdr: { procedure: 'alpha-investing', alpha: 0.05, omega: 0.01 } })),
    ).toEqual([]);
  });

  it('rejects a gamma that is a string, not a function (never a declarative sequence name)', () => {
    expect(
      validateDashboardDef(baseDef({ fdr: { procedure: 'LORD++', alpha: 0.05, gamma: 'lordGamma' } })),
    ).toContain('fdr.gamma, if present, must be a function (a GammaSequence), never a string');
  });

  it('accepts a real gamma function', () => {
    expect(
      validateDashboardDef(baseDef({ fdr: { procedure: 'LORD++', alpha: 0.05, gamma: (j: number) => 1 / j } })),
    ).toEqual([]);
  });
});

describe('validateDashboardDef — agent.intents shape', () => {
  it('rejects agent that is not an object', () => {
    expect(validateDashboardDef(baseDef({ agent: 'nope' }))).toContain('agent, if present, must be an object');
  });

  it('accepts an agent object with no intents key', () => {
    expect(validateDashboardDef(baseDef({ agent: {} }))).toEqual([]);
  });

  it('rejects agent.intents that is not an array', () => {
    expect(validateDashboardDef(baseDef({ agent: { intents: {} } }))).toContain(
      'agent.intents must be an array of { verb, intent }',
    );
  });

  it('rejects an intents entry that is not an object', () => {
    expect(validateDashboardDef(baseDef({ agent: { intents: ['nope'] } }))).toContain(
      'agent.intents[0] must be an object { verb, intent }',
    );
  });

  it('rejects an unknown verb', () => {
    expect(
      validateDashboardDef(baseDef({ agent: { intents: [{ verb: 'teleport', intent: 'mandatory-analytical' }] } })),
    ).toContain(`agent.intents[0].verb must be one of ${DISPATCH_VERBS.join('|')}`);
  });

  it('rejects an unknown intent class', () => {
    expect(
      validateDashboardDef(baseDef({ agent: { intents: [{ verb: 'select', intent: 'sometimes' }] } })),
    ).toContain('agent.intents[0].intent must be "mandatory-analytical" | "optional-interaction"');
  });

  it('accepts a valid intents override', () => {
    expect(
      validateDashboardDef(baseDef({ agent: { intents: [{ verb: 'select', intent: 'optional-interaction' }] } })),
    ).toEqual([]);
  });
});

describe('validateDashboardDef — defaultTable shape', () => {
  it('rejects a non-string defaultTable', () => {
    expect(validateDashboardDef(baseDef({ defaultTable: 42 }))).toContain(
      'defaultTable, if present, must be a string',
    );
  });

  it('rejects a defaultTable naming an undeclared table', () => {
    expect(validateDashboardDef(baseDef({ defaultTable: 'ghost' }))).toContain(
      'defaultTable "ghost" is not a declared data table',
    );
  });

  it('accepts a defaultTable naming a declared table', () => {
    expect(validateDashboardDef(baseDef({ defaultTable: 'data' }))).toEqual([]);
  });
});

describe('dispatchVerbs', () => {
  it('returns the frozen DISPATCH_VERBS list (tool-surface enumeration)', () => {
    expect(dispatchVerbs()).toBe(DISPATCH_VERBS);
    expect(dispatchVerbs()).toEqual([
      'select',
      'filter',
      'annotate',
      'navigate',
      'analyze',
      'fork',
      'checkpoint',
      'reencode',
    ]);
  });
});
