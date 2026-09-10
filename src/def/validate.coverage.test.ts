/**
 * `validateDashboardDef` (R12 firewall) — coverage packet for the rejection
 * arms not already exercised by `buildDashboard.test.ts`'s behavioral suite.
 * Every test feeds a malformed `DashboardDef` and asserts the EXACT problem
 * message text `validateDashboardDef` produces (never throws — it collects).
 */
import { describe, it, expect } from 'vitest';
import { validateDashboardDef, dispatchVerbs } from './validate.js';
import { DISPATCH_VERBS, MAGNITUDE_CHANNELS } from './types.js';

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
    expect(validateDashboardDef(baseDef({ data: { t: {} } }))).toContain('data["t"] must set rows, csv, or source');
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
      'actors["v"] must be an object { actor, label?, does? }',
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
    ['bookmark:0', 'bookmark:'],
    ['link:bar:point→map', 'link:'],
  ])('rejects a view id in the reserved namespace %p', (viewId, prefix) => {
    const problems = validateDashboardDef(baseDef({ actors: { [viewId]: { actor: 'user' } } }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`actors["${viewId}"]: a view id may not start with "${prefix}"`);
    expect(problems[0]).toContain('silently skipped when a path is adopted');
  });

  it('the exact id "dashboard" is the prose plane\'s subject for the cockpit itself — a view may not take it', () => {
    const problems = validateDashboardDef(baseDef({ actors: { dashboard: { actor: 'user' } } }));
    expect(problems).toEqual(['actors["dashboard"]: "dashboard" is the prose plane\'s name for the cockpit itself (describe with viewId "dashboard" sets the dashboard\'s own words) — a view may not take it']);
    expect(validateDashboardDef(baseDef({ actors: { dashboards: { actor: 'user' } } }))).toEqual([]); // only the exact id is taken
  });

  it('DRIFT PIN: every *_VIEW_PREFIX the branches layer exports is reserved at the def boundary (a new namespace cannot be forgotten)', async () => {
    const branches = (await import('../branches/index.js')) as Record<string, unknown>;
    const prefixes = Object.entries(branches).filter(([name, v]) => name.endsWith('_VIEW_PREFIX') && typeof v === 'string') as [string, string][];
    expect(prefixes.length).toBeGreaterThanOrEqual(7);
    for (const [name, prefix] of prefixes) {
      const problems = validateDashboardDef(baseDef({ actors: { [`${prefix}x`]: { actor: 'user' } } }));
      expect(problems.some((p) => p.includes(`may not start with "${prefix}"`)), `${name} (${prefix}) is not reserved`).toBe(true);
    }
  });

  it('a view id that merely CONTAINS a reserved word is fine — only the prefix is reserved', () => {
    expect(validateDashboardDef(baseDef({ actors: { 'my-chart': { actor: 'user' }, 'x:chart:y': { actor: 'user' } } }))).toEqual([]);
  });
});

describe('validateDashboardDef — analyses shape', () => {
  it('rejects analyses that is not an object (an array included)', () => {
    expect(validateDashboardDef(baseDef({ analyses: ['nope'] }))).toContain(
      'analyses, if present, must be an object mapping id -> AnalysisDef | AnalysisModule | a builtin record { builtin, ...options }',
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
    ).toContain('capabilities[0].encodings must be an array of "point" | "interval" | "cell" | "match" | "neighbourhood"');
  });

  it('rejects capabilities.encodings entries outside the emission kinds', () => {
    expect(
      validateDashboardDef(baseDef({ capabilities: [{ viewId: 'v', canProbe: true, encodings: ['area'] }] })),
    ).toContain('capabilities[0].encodings must be an array of "point" | "interval" | "cell" | "match" | "neighbourhood"');
  });

  it('accepts the packet-5 neighbourhood emission kind in capabilities.encodings', () => {
    expect(
      validateDashboardDef(baseDef({ capabilities: [{ viewId: 'v', canProbe: true, encodings: ['neighbourhood'] }] })),
    ).toEqual([]);
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
      'bookmark',
      'reencode',
      'link',
      'describe',
    ]);
  });
});

describe('validateDashboardDef — absence (the declared silence vocabulary)', () => {
  const withAbsence = (absence: unknown, extra: Record<string, unknown> = {}): unknown =>
    baseDef({ data: { data: { rows: [{ id: 1, state: 'unknown', n: 2 }], absence } }, ...extra });

  it('accepts a well-formed declaration that includes "unknown"', () => {
    expect(validateDashboardDef(withAbsence({ field: 'state', states: ['present', 'unavailable', 'unknown'] }))).toEqual([]);
  });

  it('refuses a non-object, unknown keys, a bad field, and a bad states list', () => {
    expect(validateDashboardDef(withAbsence('nope'))).toContain('data["data"].absence, if present, must be an object { field, states }');
    expect(validateDashboardDef(withAbsence({ field: 'state', states: ['unknown'], extra: 1 }))).toContain('data["data"].absence: unknown key "extra"');
    expect(validateDashboardDef(withAbsence({ field: '', states: ['unknown'] }))).toContain(
      'data["data"].absence.field must be a non-empty string (the column that carries the state)',
    );
    expect(validateDashboardDef(withAbsence({ field: 'state', states: [] }))).toContain(
      'data["data"].absence.states must be a non-empty array of non-empty strings',
    );
    expect(validateDashboardDef(withAbsence({ field: 'state', states: ['unknown', 7] }))).toContain(
      'data["data"].absence.states must be a non-empty array of non-empty strings',
    );
  });

  it('refuses a repeated state and a vocabulary with no word for "unknown"', () => {
    expect(validateDashboardDef(withAbsence({ field: 'state', states: ['unknown', 'unknown'] }))).toContain(
      'data["data"].absence.states must not repeat a state',
    );
    expect(validateDashboardDef(withAbsence({ field: 'state', states: ['present', 'not-configured'] }))).toContain(
      'data["data"].absence.states must include "unknown" — a source that cannot tell which silence it saw needs a word for that',
    );
  });

  it('refuses a vocabulary with no word for "present" — its own words for the silences are fine, but the arithmetic reads that one word', () => {
    expect(validateDashboardDef(withAbsence({ field: 'state', states: ['not catalogued', 'unknown'] }))).toContain(
      'data["data"].absence.states must include "present" — the word a row uses to say the source reported a value; without it every cell of this table reads as absent',
    );
    expect(validateDashboardDef(withAbsence({ field: 'state', states: ['present', 'not catalogued', 'unknown'] }))).toEqual([]);
  });

  it('accepts a `carries` list of declared silences — the states that hold a number anyway', () => {
    expect(validateDashboardDef(withAbsence({ field: 'state', states: ['present', 'estimated', 'replaced', 'unavailable', 'unknown'], carries: ['estimated', 'replaced'] }))).toEqual([]);
  });

  it('refuses a malformed `carries`, a word the vocabulary never declared, and the two words it may never name', () => {
    const decl = (carries: unknown): unknown => withAbsence({ field: 'state', states: ['present', 'estimated', 'unknown'], carries });
    for (const bad of ['estimated', [], ['']]) {
      expect(validateDashboardDef(decl(bad))).toContain('data["data"].absence.carries, if present, must be a non-empty array of non-empty strings (which of the states carry a value)');
    }
    expect(validateDashboardDef(decl(['guessed']))).toContain(
      'data["data"].absence.carries names "guessed", which is not one of this table\'s states — a state that carries a value must be a word the vocabulary declares',
    );
    expect(validateDashboardDef(decl(['present']))).toContain(
      'data["data"].absence.carries may not name "present" — that is the word for a row that reported its value, not for a silence that carries one',
    );
    expect(validateDashboardDef(decl(['unknown']))).toContain(
      'data["data"].absence.carries may not name "unknown" — a source that could not tell which silence it saw did not carry the value either',
    );
  });

  // ── SILENCE BELONGS TO A COLUMN: the LIST form, and the two new keys ──
  // The exoplanet demo found this: `AbsenceDecl` spoke for the ROW, so an honest table (a mass
  // measured, a radius never taken, a period of 88) was refused by the library's own validator.

  it('accepts a LIST — one entry per state column, each naming the value columns it governs', () => {
    const columns = { pl_rade: { role: 'measure' }, pl_masse: { role: 'measure' }, radius_state: {}, mass_state: {} };
    const rows = [{ radius_state: 'not-measured', pl_rade: null, mass_state: 'present', pl_masse: 6.4 }];
    expect(
      validateDashboardDef(
        baseDef({
          data: {
            data: {
              rows,
              columns,
              absence: [
                { field: 'radius_state', states: ['present', 'upper-bound', 'not-measured', 'unknown'], carries: ['upper-bound'], governs: ['pl_rade'], arithmetic: 'carried' },
                { field: 'mass_state', states: ['present', 'not-measured', 'unknown'], governs: ['pl_masse'] },
              ],
            },
          },
        }),
      ),
    ).toEqual([]);
  });

  it('accepts `governs` and `arithmetic` on a BARE declaration too', () => {
    expect(
      validateDashboardDef(baseDef({ data: { data: { rows: [{ n: 2, state: 'unknown' }], columns: { n: {}, state: {} }, absence: { field: 'state', states: ['present', 'unknown'], governs: ['n'] } } } })),
    ).toEqual([]);
    expect(validateDashboardDef(withAbsence({ field: 'state', states: ['present', 'unknown'], arithmetic: 'carried' }))).toEqual([]);
    expect(validateDashboardDef(withAbsence({ field: 'state', states: ['present', 'unknown'], arithmetic: 'present-only' }))).toEqual([]);
  });

  it('refuses an EMPTY list — a table naming an absence vocabulary and then naming none', () => {
    expect(validateDashboardDef(withAbsence([]))).toContain(
      'data["data"].absence, if it is a list, must declare at least one entry — an empty list is a table saying it has an absence vocabulary and then naming none',
    );
  });

  it('refuses a list entry with NO `governs` — two entries claiming "every other column" are two answers to one question', () => {
    const problems = validateDashboardDef(withAbsence([{ field: 'state', states: ['present', 'unknown'] }]));
    expect(problems).toContain(
      'data["data"].absence[0].governs must name the value columns this state column speaks for — in a list every entry names its own, because two entries each speaking for "every other column" are two answers to one question',
    );
  });

  it('refuses a malformed `governs`, and names the entry it came from', () => {
    for (const bad of ['n', [], ['']]) {
      expect(validateDashboardDef(withAbsence([{ field: 'state', states: ['present', 'unknown'], governs: bad }]))).toContain(
        'data["data"].absence[0].governs, if present, must be a non-empty array of non-empty strings (the value columns this state column speaks for)',
      );
    }
  });

  it('refuses a `governs` column the table does not DECLARE — a typo would quietly govern nothing', () => {
    const def = (governs: readonly string[]): unknown =>
      baseDef({ data: { data: { rows: [{ n: 2, state: 'unknown' }], columns: { n: {}, state: {} }, absence: [{ field: 'state', states: ['present', 'unknown'], governs }] } } });
    expect(validateDashboardDef(def(['nn']))).toContain(
      'data["data"].absence[0].governs names "nn", which this table does not declare in columns — a state column can only speak for a column the table declares',
    );
    expect(validateDashboardDef(def(['n']))).toEqual([]);
    // …and a table that declares NO columns is held to nothing here: there is no list to check against
    expect(validateDashboardDef(withAbsence([{ field: 'state', states: ['present', 'unknown'], governs: ['whatever'] }]))).toEqual([]);
  });

  it('refuses an entry governing its OWN state column — a state column speaks for itself', () => {
    expect(validateDashboardDef(withAbsence([{ field: 'state', states: ['present', 'unknown'], governs: ['state'] }]))).toContain(
      'data["data"].absence[0].governs may not name "state" — that is this entry\'s own state column, and a state column speaks for itself',
    );
  });

  it('refuses two entries governing the SAME column — one column, one owner', () => {
    expect(
      validateDashboardDef(
        withAbsence([
          { field: 'a_state', states: ['present', 'unknown'], governs: ['n'] },
          { field: 'b_state', states: ['present', 'unknown'], governs: ['n'] },
        ]),
      ),
    ).toContain(
      'data["data"].absence: "n" is governed by both entry 0 ("a_state") and entry 1 ("b_state") — one column, one owner: a column whose silence has two answers has none',
    );
  });

  it('refuses an entry governing a SIBLING\'s state column — a state column speaks for itself, whoever claims it', () => {
    // Silently ignored otherwise: `silenceOfDecl`'s state-column check runs before `governs` is ever
    // consulted (`../data/silence.ts`), so this declaration would validate and then do nothing.
    expect(
      validateDashboardDef(
        withAbsence([
          { field: 'radius_state', states: ['present', 'unknown'], governs: ['pl_rade'] },
          { field: 'mass_state', states: ['present', 'unknown'], governs: ['pl_masse', 'radius_state'] },
        ]),
      ),
    ).toContain(
      'data["data"].absence[1].governs may not name "radius_state" — that is another entry\'s state column, and a state column speaks for itself, so this entry\'s claim on it is silently ignored',
    );
  });

  it('…but ONE entry naming a column twice is still one owner, and says nothing', () => {
    // The duplicate is redundant, not ambiguous: the same entry cannot disagree with itself.
    expect(validateDashboardDef(withAbsence([{ field: 'state', states: ['present', 'unknown'], governs: ['n', 'n'] }]))).toEqual([]);
  });

  it('refuses an `arithmetic` that is not one of the two words', () => {
    expect(validateDashboardDef(withAbsence({ field: 'state', states: ['present', 'unknown'], arithmetic: 'carry' }))).toContain(
      'data["data"].absence.arithmetic, if present, must be one of present-only|carried — "present-only" reads exactly "present" (the default, and every total this library has computed), "carried" also reads the states named in carries',
    );
  });

  it('holds every ENTRY of a list to the same vocabulary rules, naming the entry', () => {
    const problems = validateDashboardDef(
      withAbsence([
        { field: 'a_state', states: ['present'], governs: ['n'] },
        { field: '', states: ['present', 'unknown'], governs: ['id'], extra: 1 },
      ]),
    );
    expect(problems).toContain('data["data"].absence[0].states must include "unknown" — a source that cannot tell which silence it saw needs a word for that');
    expect(problems).toContain('data["data"].absence[1].field must be a non-empty string (the column that carries the state)');
    expect(problems).toContain('data["data"].absence[1]: unknown key "extra"');
  });

  it('refuses a CONTRADICTING table per governed column — and stops refusing the demo\'s honest one', () => {
    const columns = { pl_rade: { role: 'measure' }, pl_orbper: { role: 'measure' }, radius_state: {}, period_state: {} };
    const absence = [
      { field: 'radius_state', states: ['present', 'not-measured', 'unknown'], governs: ['pl_rade'] },
      { field: 'period_state', states: ['present', 'not-measured', 'unknown'], governs: ['pl_orbper'] },
    ];
    const def = (rows: readonly unknown[]): unknown => baseDef({ data: { data: { rows, columns, absence } } });
    // THE FIX: no radius, a period of 88 — refused before this packet, accepted now
    expect(validateDashboardDef(def([{ radius_state: 'not-measured', pl_rade: null, period_state: 'present', pl_orbper: 88 }]))).toEqual([]);
    // …and the check still fires when a column IS silent and holds a number, naming the state column it broke
    expect(validateDashboardDef(def([{ radius_state: 'not-measured', pl_rade: 2.4, period_state: 'present', pl_orbper: 88 }]))).toContain(
      'data["data"].rows[0]: radius_state says "not-measured" — no value — and pl_rade holds 2.4; a table cannot say both, so carry null in pl_rade where the row reports nothing',
    );
  });

  it('gives EVERY state column role `absence`, and refuses one that claims another role', () => {
    const problems = validateDashboardDef(
      baseDef({
        data: {
          data: {
            rows: [{ n: 2, m: 3, a_state: 'unknown', b_state: 'unknown' }],
            columns: { n: {}, m: {}, a_state: { role: 'measure' }, b_state: { role: 'dimension' } },
            absence: [
              { field: 'a_state', states: ['present', 'unknown'], governs: ['n'] },
              { field: 'b_state', states: ['present', 'unknown'], governs: ['m'] },
            ],
          },
        },
      }),
    );
    expect(problems).toContain('data["data"].columns["a_state"].role is "measure" but "a_state" is the table\'s declared absence column — its role is absence');
    expect(problems).toContain('data["data"].columns["b_state"].role is "dimension" but "b_state" is the table\'s declared absence column — its role is absence');
  });

  it('refuses every MAGNITUDE channel — size as much as x — and the list is one shared constant', () => {
    const decl = { field: 'state', states: ['present', 'unknown'] };
    expect(
      validateDashboardDef(
        withAbsence(decl, { encodings: [{ viewId: 'v', chartKind: 'point', channels: ['x', 'size'], initial: { x: 'n', size: 'state' } }] }),
      ),
    ).toContain(
      'encodings[0].initial.size: "state" is the declared absence column — it cannot bind to the magnitude channel "size"; absence is a category, never a magnitude',
    );
    // the four network endpoints are in the class too: `bringOver` writes them
    // as coordinates in the same space as x and y, so the law reaches them
    expect([...MAGNITUDE_CHANNELS].sort()).toEqual(['r', 'radius', 'size', 'sourceX', 'sourceY', 'targetX', 'targetY', 'theta', 'x', 'y']);
  });

  it('refuses binding the absence column to a numeric channel, and allows it on a categorical one', () => {
    const decl = { field: 'state', states: ['present', 'unknown'] };
    expect(
      validateDashboardDef(
        withAbsence(decl, { encodings: [{ viewId: 'v', chartKind: 'point', channels: ['x', 'y'], initial: { x: 'state', y: 'n' } }] }),
      ),
    ).toContain(
      'encodings[0].initial.x: "state" is the declared absence column — it cannot bind to the magnitude channel "x"; absence is a category, never a magnitude',
    );
    expect(
      validateDashboardDef(
        withAbsence(decl, { encodings: [{ viewId: 'v', chartKind: 'bar', channels: ['category'], initial: { category: 'state' } }] }),
      ),
    ).toEqual([]);
  });
});
