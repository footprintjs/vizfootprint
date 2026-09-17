/**
 * actFilled.def.test.ts — A TABLE MAY BE DECLARED WITH NO CARRIER AND FILLED BY
 * AN ACT (`./actFilled.ts`), judged at the DEF DOOR and served by the BUILD
 * DOOR.
 *
 * The defect this packet closes, read out of the code rather than guessed: a
 * `data` entry with no `rows`, no `csv` and no `source` was refused, so a table
 * whose rows come from a computation could not be DECLARED at all — no declared
 * table, no declared relation, no clause reaching it, no `viewQuery` asking for
 * it. The one act that lands a table had to MINT one from its own record
 * instead, which is why its own declaration says *a record that could name its
 * own relation could name one nobody declared*.
 *
 * What is pinned here is the whole def-door judgement (seven refusals, each
 * naming both sides), the provider a read gets before the act runs, the Sources
 * row of a table with no carrier, the arrived-columns guard at the act's own
 * landing, and the `refresh` answer — plus the two byte-identity floors: the
 * carrier's guard-2 sentence, and a def that declares no act-filled table.
 *
 * The session half — the rows, the cursor, the relations a clause travels, the
 * replay — is `../session/actFilledTable.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard, buildDashboardAsync, validateDashboardDef } from './index.js';
import { notTheDeclaredTable, unlandedProvider } from './declaredTable.js';
import { actFilledTables, tableFilledBy, unfilledTableRefusal } from './actFilled.js';
import type { Dashboard } from './buildDashboard.js';
import type { DashboardDef, DashboardRuntime } from './index.js';
import { groupByAnalysis } from '../analysis/index.js';
import { defineAnalysis } from '../analysis/index.js';
import type { AnalysisModule, ColumnsOutput, DataRow } from '../analysis/index.js';
import { flowChart } from 'footprintjs';
import type { LandedColumns, Row } from '../data/index.js';

/** Three nodes in two groups — the parent an act reads. */
const NODES: readonly Row[] = [
  { id: 'flu', size: 12, group: 'viral' },
  { id: 'cold', size: 7, group: 'viral' },
  { id: 'strep', size: 3, group: 'bacterial' },
];

/** The act: the `groupBy` builtin, which produces the TABLE channel and rides on a commit as data. */
const SUMMARY: DashboardDef['analyses'] = { summary: { builtin: 'groupBy', by: 'group', measure: 'size' } };

/** What that act lands, declared: two groups, a count and a mean — the columns the def promises. */
const SUMMARY_COLUMNS: DashboardDef['data'][string]['columns'] = {
  group: { role: 'identifier' },
  count: { role: 'measure' },
  size_mean: { role: 'measure' },
};

/**
 * The def under test: a parent with rows, and a table with NO CARRIER whose
 * rows the act fills. `defaultTable` is the parent on purpose — a default table
 * with no rows yet is legal and is the session suite's business, not this one's.
 */
function filledDef(extra: Partial<DashboardDef> = {}, table: Partial<DashboardDef['data'][string]> = {}): DashboardDef {
  return {
    meta: { title: 'a table an act fills' },
    data: {
      nodes: { rows: [...NODES], key: 'id', columns: { id: { role: 'identifier' }, size: { role: 'measure' }, group: { role: 'dimension' } } },
      by_group: { filledBy: 'summary', key: 'group', columns: SUMMARY_COLUMNS, ...table },
    },
    actors: { grid: { actor: 'user', label: 'The grid' } },
    analyses: SUMMARY,
    defaultTable: 'nodes',
    ...extra,
  } as DashboardDef;
}

/**
 * A def whose `by_group` entry is replaced wholesale — for the exclusivity and
 * shape refusals. The declared `columns` ride under the entry, because the def
 * door REQUIRES them on an act-filled table and a test about one refusal should
 * not be reading another's sentence.
 */
const withTable = (entry: unknown, extra: Partial<DashboardDef> = {}): unknown => ({
  ...filledDef(extra),
  data: { nodes: { rows: [...NODES], key: 'id' }, by_group: typeof entry === 'object' && entry !== null ? { columns: SUMMARY_COLUMNS, ...entry } : entry },
});

/** A columns-channel MODULE — the third slot form, on the wrong channel. */
function columnAnalysis(id: string): AnalysisModule<readonly DataRow[], ColumnsOutput> {
  return defineAnalysis<readonly DataRow[], ColumnsOutput>({
    id,
    kind: 'transform',
    produces: 'columns',
    inputs: [{ column: 'size', role: 'value' }],
    build: () => flowChart<Record<string, unknown>>('count', (scope) => { scope.$setValue('n', 1); }, 'load').build(),
    toRunInput: (rows) => ({ rows: rows.length }),
    readOutput: () => ({ ok: true, output: { as: 'columns', table: 'nodes', columns: { n: { type: 'int' } } } }),
  });
}

/** The registry, read the way the session reads it (`./landedColumns.def.test.ts`). */
const landedOf = (dash: Dashboard): LandedColumns => (dash.createSession() as unknown as { runtime: DashboardRuntime }).runtime.landedColumns;

/** THE READ REFUSAL, once — the provider, the window and the session all quote it. */
const UNFILLED =
  '"by_group" declares no carrier — the act "summary" fills it, and it has not landed on this path: every read of "by_group" is refused in these words. ' +
  'Perform "summary" to fill it — it takes the act\'s rows only if they carry the columns this table declares; its columns, its key and its relations are declared, and do not wait for it.';

/** One read of the table, answered or refused. */
async function readOf(dash: Dashboard, table = 'by_group'): Promise<{ readonly ok: boolean; readonly reason?: string; readonly engineReason?: string; readonly rejected?: string; readonly count?: number }> {
  const res = await dash.createSession().viewQuery({ table });
  return res.ok ? { ok: true, count: res.count } : { ok: false, reason: res.reason, ...(res.engineReason !== undefined ? { engineReason: res.engineReason } : {}), rejected: res.rejected };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('the def door: a table declared with no carrier', () => {
  it('a good declaration is accepted, and the one reader says which act fills it', () => {
    expect(validateDashboardDef(filledDef())).toEqual([]);
    expect([...actFilledTables(filledDef())]).toEqual([['by_group', 'summary']]);
    expect(tableFilledBy(filledDef(), 'summary')).toBe('by_group');
    expect(tableFilledBy(filledDef(), 'nobody')).toBeUndefined();
    // …and the readers are total over a def nobody validated, like every reader on this boundary
    expect([...actFilledTables(undefined)]).toEqual([]);
    expect([...actFilledTables({ data: 7 })]).toEqual([]);
    expect([...actFilledTables({ data: { t: 7, u: { filledBy: '' } } })]).toEqual([]);
  });

  it('the act is the FOURTH way rows arrive, and a table\'s rows come from ONE place — each pairing, one sentence', () => {
    for (const carrier of [{ rows: [] }, { csv: 'a\n1\n' }, { source: { format: 'csv', via: 'inline', at: 'a\n1\n' } }]) {
      expect(validateDashboardDef(withTable({ filledBy: 'summary', ...carrier }))).toContain('data["by_group"] must set only one of rows, csv, source, filledBy');
    }
    // …and a table that sets NONE of the four is still refused — now naming the fourth
    expect(validateDashboardDef(withTable({}))).toContain('data["by_group"] must set rows, csv, source, or filledBy');
  });

  it('the act must be NAMED: the empty string and a non-string are not an analysis id', () => {
    // …and the VALUE is quoted back, the way the engine refusal below quotes what it saw
    expect(validateDashboardDef(withTable({ filledBy: '' }))).toContain('data["by_group"].filledBy must be the id of a declared analysis — it is ""');
    expect(validateDashboardDef(withTable({ filledBy: 42 }))).toContain('data["by_group"].filledBy must be the id of a declared analysis — it is "42"');
  });

  it('a table with NO CARRIER must declare its COLUMNS — they are the only thing that says what it is', () => {
    // WHY it is required here and optional everywhere else: three questions are deferred from the
    // def door to a post-build door exactly WHEN a table declares no columns — its `key`
    // (`./validate.ts`), a relation's `from.column` (`./relations.ts` · `judgeFrom`) and a binding
    // on it (`dashboard.lint()`) — and for a table with no carrier that door can never answer,
    // because there are no rows to ask. Requiring them makes the def door their one owner.
    const sentence =
      'data["by_group"].filledBy "summary" — declare data["by_group"].columns first; a table with no carrier has nothing but its declaration, ' +
      'and its columns are what its key, its relations and every binding on it are judged against';
    expect(validateDashboardDef({ ...filledDef(), data: { nodes: { rows: [...NODES], key: 'id' }, by_group: { filledBy: 'summary' } } })).toEqual([sentence]);
    // an EMPTY map says nothing, which is the same as saying nothing
    expect(validateDashboardDef({ ...filledDef(), data: { nodes: { rows: [...NODES], key: 'id' }, by_group: { filledBy: 'summary', columns: {} } } })).toEqual([sentence]);
    // …and it is a DIFFERENT question from the act rules, so a def that gets both wrong hears both
    expect(validateDashboardDef({ ...filledDef(), data: { nodes: { rows: [...NODES], key: 'id' }, by_group: { filledBy: 'ghost' } } })).toEqual([
      'data["by_group"].filledBy "ghost" — declare data["by_group"].columns first; a table with no carrier has nothing but its declaration, and its columns are what its key, its relations and every binding on it are judged against',
      'data["by_group"].filledBy "ghost" is not a declared analysis — the analyses are summary',
    ]);
    // a CARRIER table still declares columns or not, exactly as it always did
    expect(validateDashboardDef({ ...filledDef(), data: { nodes: { rows: [...NODES] }, by_group: { rows: [], key: undefined } } } as DashboardDef)).toEqual([]);
  });

  it('an unknown act is refused with the analyses this def HAS — and with the honest sentence when it declares none', () => {
    expect(validateDashboardDef(withTable({ filledBy: 'ghost' }))).toContain('data["by_group"].filledBy "ghost" is not a declared analysis — the analyses are summary');
    expect(validateDashboardDef(withTable({ filledBy: 'ghost' }, { analyses: undefined }))).toContain('data["by_group"].filledBy "ghost" is not a declared analysis — this def declares none');
  });

  it('an act on another CHANNEL lands no rows, and is refused by the channel it does land — all three forms of a slot', () => {
    const wrong = (analyses: unknown): string[] => validateDashboardDef({ ...(withTable({ filledBy: 'act' }) as Record<string, unknown>), analyses }) as string[];
    // a builtin RECORD: the channel is read off the one spec table, before any factory runs
    expect(wrong({ act: { builtin: 'formula', expression: 'size / 2', name: 'half' } })).toContain('data["by_group"].filledBy "act" produces the columns channel, not a table — only a table-channel act can fill a table');
    expect(wrong({ act: { builtin: 'correlation', x: 'size', y: 'size' } })).toContain('data["by_group"].filledBy "act" produces the scalar channel, not a table — only a table-channel act can fill a table');
    expect(wrong({ act: { builtin: 'regression', x: 'size', y: 'size' } })).toContain('data["by_group"].filledBy "act" produces the geometry channel, not a table — only a table-channel act can fill a table');
    // a built MODULE carries its own def…
    expect(wrong({ act: columnAnalysis('act') })).toContain('data["by_group"].filledBy "act" produces the columns channel, not a table — only a table-channel act can fill a table');
    // …and a raw AnalysisDef IS one (refused on its own lines too, which is not this rule's business)
    expect(wrong({ act: { id: 'act', kind: 'transform', produces: 'scalar' } })).toContain('data["by_group"].filledBy "act" produces the scalar channel, not a table — only a table-channel act can fill a table');
    // the table-channel forms pass: the record above, and a module
    expect(validateDashboardDef(filledDef())).toEqual([]);
    expect(wrong({ act: groupByAnalysis({ by: 'group', measure: 'size', id: 'act' }) })).toEqual([]);
  });

  it('a slot this door cannot READ says nothing about `filledBy` — the slot is already refused on its own line', () => {
    const problems = validateDashboardDef({ ...(withTable({ filledBy: 'act' }) as Record<string, unknown>), analyses: { act: 42 } }) as string[];
    expect(problems.filter((p) => p.includes('filledBy'))).toEqual([]);
    expect(problems.some((p) => p.startsWith('analyses["act"]'))).toBe(true);

    // …and the same for a slot that names a channel this library does not have. There are FOUR
    // (`../analysis/types.ts` · `OUTPUT_CHANNELS`) and "fit" is not one of them — a fit lands on
    // the `geometry` channel. So this is not a table-filling refusal at all: the analyses pass
    // refuses the word itself, in its own sentence, and this rule adds nothing to it.
    const fit = validateDashboardDef({ ...(withTable({ filledBy: 'act' }) as Record<string, unknown>), analyses: { act: { id: 'act', kind: 'transform', produces: 'fit' } } }) as string[];
    expect(fit.filter((p) => p.includes('filledBy'))).toEqual([]);
    expect(fit).toContain('analyses["act"]: produces must be one of columns|geometry|scalar|table');
  });

  it('an AGGREGATE mints its own table, so it never fills a declared one', () => {
    const agg = { builtin: 'aggregate', table: 'nodes', name: 'by_group', ops: 1, groupBy: ['group'], measures: [{ as: 'total', expr: { op: 'sum', args: [{ col: 'size' }] } }] };
    expect(validateDashboardDef({ ...(withTable({ filledBy: 'agg' }) as Record<string, unknown>), analyses: { agg } })).toContain(
      'data["by_group"].filledBy "agg" is an aggregate — an aggregate mints the table it lands, with its own key and its own relation to its parent, so it never fills a declared one',
    );
  });

  it('ONE act fills at most ONE table, and a declared name an aggregate already MINTS has two owners', () => {
    const twice = { ...filledDef(), data: { ...filledDef().data, other: { filledBy: 'summary', columns: SUMMARY_COLUMNS } } } as DashboardDef;
    expect(validateDashboardDef(twice)).toContain('data["other"].filledBy "summary" already fills data["by_group"] — an analysis fills at most one table');
    const collides = filledDef({
      analyses: {
        ...SUMMARY,
        agg: { builtin: 'aggregate', table: 'nodes', name: 'by_group', ops: 1, groupBy: ['group'], measures: [{ as: 'total', expr: { op: 'sum', args: [{ col: 'size' }] } }] },
      },
    });
    expect(validateDashboardDef(collides)).toContain('data["by_group"] is filled by the act "summary", and the aggregate "agg" mints a table of the same name — one name, one owner');
  });

  it('the engine it declares must be one that can RECEIVE the act\'s rows — which is the one it lands in', () => {
    for (const engine of ['wasm', 'server', 'auto'] as const) {
      expect(validateDashboardDef(filledDef({}, { engine }))).toContain(
        `data["by_group"] sets engine "${engine}" with filledBy; an act's rows are computed in this process, so an act-filled table declares "memory" — or no engine at all`,
      );
    }
    expect(validateDashboardDef(filledDef({}, { engine: 'memory' }))).toEqual([]);
  });

  it('a HOST provider brings rows too, so it is the same refusal one door along', () => {
    const provider = { engine: 'memory' as const, capabilities: { canEvaluateSQL: false, canMaterialize: false }, tables: async () => [], columns: async () => [], evaluate: async () => ({ count: 0 }), materializeColumn: async () => ({ ok: true as const }) };
    expect(() => buildDashboard(filledDef(), { providers: { by_group: provider as never } })).toThrow(
      /providers\["by_group"\] brings its own rows, and data\["by_group"\] is filled by the act "summary" — a table's rows come from one place; drop one of them/,
    );
  });

  it('`columns`, `key`, `absence` and `grain` are judged EXACTLY as they are on a sourced table', () => {
    // the key must be a declared column — the same sentence a sourced table gets
    expect(validateDashboardDef(filledDef({}, { key: 'ghost' }))).toContain('data["by_group"].key "ghost" is not a declared column');
    // an absence column may not bind a numeric channel, and its vocabulary needs the honest word
    expect(validateDashboardDef(filledDef({}, { absence: { field: 'state', states: ['present'] } }))).toContain(
      'data["by_group"].absence.states must include "unknown" — a source that cannot tell which silence it saw needs a word for that',
    );
    // a grain is stated facts, nothing executable
    expect(validateDashboardDef(filledDef({}, { grain: { collapsedFrom: -1 } }))).toContain('data["by_group"].grain.collapsedFrom, if present, must be a non-negative finite number');
    // …and all four, well declared, are accepted together
    expect(
      validateDashboardDef(
        filledDef({}, { columns: { ...SUMMARY_COLUMNS, state: {} }, absence: { field: 'state', states: ['present', 'unknown'], governs: ['count'] }, grain: { bucket: 'group', reducer: 'mean' } }),
      ),
    ).toEqual([]);
  });
});

describe('the build door: a table with no carrier has a provider, and every read of it is refused in the words that name the act', () => {
  for (const [door, build] of [
    ['buildDashboard', (def: DashboardDef) => Promise.resolve(buildDashboard(def))],
    ['buildDashboardAsync', (def: DashboardDef) => buildDashboardAsync(def)],
  ] as const) {
    it(`${door}: the sentence, no provenance, the engine it will land in, and the tables that did land untouched`, async () => {
      const dash = await build(filledDef());
      // `no-columns` is the read door's FIRST gate (`../session/session.ts` · `viewClauses`): a window
      // asks what columns it may project before it asks for rows, and this table's provider refuses
      // that too. The reason names which door answered; the SENTENCE is the one that matters, and it
      // rides whole — the same words the provider was built with.
      expect(await readOf(dash)).toEqual({ ok: false, reason: 'no-columns', rejected: UNFILLED });
      // NOTHING VOUCHES for rows that have not come: no `sources` entry, and no build note either —
      // an unlanded table is a STATE, not a failure, and a note would tell an author to go and fix it
      expect(Object.keys(dash.sources)).toEqual([]);
      expect(dash.notes).toEqual([]);
      // the engine the act's rows will land in, reported at the audit like every table's
      expect(dash.engines).toEqual({ nodes: 'memory', by_group: 'memory' });
      // the registry claims nothing: omit, never invent
      expect(landedOf(dash).get('by_group')).toBeUndefined();
      // …and the parent reads exactly as it always did
      expect(await readOf(dash, 'nodes')).toEqual({ ok: true, count: 3 });
    });
  }

  it('the two LINT doors say nothing about it — one owner per question, and a healthy def is not a problem list', async () => {
    const withLayer = filledDef({
      encodings: [
        {
          viewId: 'grid',
          chartKind: 'point',
          channels: ['x', 'y'],
          layers: [
            { layerId: 'nodes', table: 'nodes', chartKind: 'point', channels: ['x', 'y'], initial: { x: 'size' } },
            { layerId: 'groups', table: 'by_group', chartKind: 'bar', channels: ['x', 'y'], initial: { x: 'count' } },
          ],
        },
      ],
    });
    const dash = buildDashboard(withLayer);
    // the KEY and the relation column were judged against the DECLARATION at the def door, which is
    // what makes this skip correct: there is nothing left for a door with no rows to answer
    expect(await dash.lintData()).toEqual([]);
    // …and the encoding plane does not THROW on a layer drawing it — an edge table filled by an act
    // is the whole case this packet exists for — and it does not go SILENT either: the layer is
    // judged against the columns the def declares (`./buildDashboard.ts` · `columnsToJudge`)
    expect(await dash.lint()).toEqual([]);
    const ghost = buildDashboard({
      ...withLayer,
      encodings: [
        {
          viewId: 'grid',
          chartKind: 'point',
          channels: ['x', 'y'],
          layers: [
            { layerId: 'nodes', table: 'nodes', chartKind: 'point', channels: ['x', 'y'], initial: { x: 'size' } },
            { layerId: 'groups', table: 'by_group', chartKind: 'bar', channels: ['x', 'y'], initial: { x: 'ghost' } },
          ],
        },
      ],
    } as DashboardDef);
    // the SAME row a carrier table's layer gets for the same mistake — which is the whole point of
    // requiring the columns: a binding on a table whose rows have not arrived is still judged
    expect((await ghost.lint()).map((p) => [p.rule, p.viewId, p.channel, p.field, p.severity])).toEqual([['column', 'grid~groups', 'x', 'ghost', 'refused']]);
  });

  it('`refresh()` moves carriers, and there is none here: an act is PERFORMED, never refreshed', async () => {
    const dash = await buildDashboardAsync(filledDef());
    const out = await dash.refresh(['by_group', 'nodes']);
    expect(out.tables['by_group']).toEqual({
      refused: true,
      reason: 'no-source',
      message: 'data["by_group"] declares no source — the act "summary" fills it, and an act is performed, never refreshed',
    });
    // …and the table that carries inline rows still says its own sentence, byte for byte
    expect(out.tables['nodes']).toEqual({ refused: true, reason: 'no-source', message: 'data["nodes"] declares no source — inline rows never move' });
    // the answer is journaled like any other, so the tab can say what was asked
    expect(dash.journal().at(-1)!.asked).toEqual(['by_group', 'nodes']);
  });
});

describe('the arrived columns are judged against the declaration — the same guard, its own sentence', () => {
  /** What the act actually landed, when it landed something else entirely. */
  const FOREIGN: readonly Row[] = [{ ref: 'a', year: 2011 }, { ref: 'b', year: 2017 }];

  it('ZERO overlap is not this table, and the sentence carries both lists whole', () => {
    expect(notTheDeclaredTable('by_group', { filledBy: 'summary', columns: SUMMARY_COLUMNS }, FOREIGN)).toBe(
      'the act "summary" landed 2 rows and none of the columns this table declares — declared "group", "count", "size_mean", arrived "ref", "year". ' +
        'A computed table is never the declared table by accident, so these rows are not landed: "by_group" stays unlanded and every read of it is refused in the words that name the act. ' +
        'Land this table\'s own columns from "summary", or declare the columns it computes.',
    );
  });

  it('the guard\'s three silences are the same three, for the same reason: refuse a contradiction, never ignorance', () => {
    // a PARTIAL mismatch is today's law
    expect(notTheDeclaredTable('by_group', { filledBy: 'summary', columns: SUMMARY_COLUMNS }, [{ group: 'viral', count: 2 }])).toBeUndefined();
    // a table that declares NO columns has said nothing to contradict. For an act-filled table
    // the DEF DOOR now makes that unreachable (`columns` are required there), and the guard stays
    // total anyway: it is a pure function two doors call, and a caller that hands it a declaration
    // the door would refuse must still get an answer rather than a crash.
    expect(notTheDeclaredTable('by_group', { filledBy: 'summary' }, FOREIGN)).toBeUndefined();
    // and no rows is this library not being able to see the columns, not a disagreement
    expect(notTheDeclaredTable('by_group', { filledBy: 'summary', columns: SUMMARY_COLUMNS }, [])).toBeUndefined();
  });

  it('the CARRIER\'s own verdict is byte-identical: only the opening of the sentence differs, because the repair does', () => {
    const declared = { state: { role: 'dimension' as const }, cases: { role: 'measure' as const } };
    expect(notTheDeclaredTable('cells', { source: { format: 'csv', via: 'http', at: 'x' }, columns: declared }, FOREIGN)).toBe(
      'the csv source landed 2 rows and none of the columns this table declares — declared "state", "cases", arrived "ref", "year". ' +
        'A document is never a table by accident, so nothing vouches for these bytes: every read of "cells" is refused in these words. ' +
        "Point the source at this table's own data, or declare the columns these bytes carry.",
    );
    // …and an inline source is still never judged at all
    expect(notTheDeclaredTable('cells', { source: { format: 'csv', via: 'inline', at: 'a\n1\n' }, columns: declared }, FOREIGN)).toBeUndefined();
  });

  it('the refusing provider is the ONE provider for a table that did not land — no second one was written', async () => {
    const provider = unlandedProvider('memory', unfilledTableRefusal('by_group', 'summary'));
    expect(await provider.columns('by_group')).toEqual({ ok: false, engine: 'memory', operation: 'columns', reason: 'unknown-table', detail: UNFILLED });
    expect(await provider.evaluate('by_group', null)).toMatchObject({ ok: false, reason: 'unknown-table', detail: UNFILLED });
    expect(provider.replaceRows).toBeUndefined(); // there is nothing to re-land: the rows never came
  });
});

describe('a def that declares no act-filled table is byte-identical to one written before this door existed', () => {
  it('nothing about the new arm appears in the build, the audit or the Sources rows', async () => {
    const plain: DashboardDef = {
      meta: { title: 'no act fills anything here' },
      data: { nodes: { rows: [...NODES], key: 'id', columns: { id: { role: 'identifier' } } } },
      actors: { grid: { actor: 'user', label: 'The grid' } },
      defaultTable: 'nodes',
    } as DashboardDef;
    expect(validateDashboardDef(plain)).toEqual([]);
    const dash = buildDashboard(plain);
    expect(dash.notes).toEqual([]);
    expect(dash.engines).toEqual({ nodes: 'memory' });
    const o = await dash.createSession().overview();
    expect(o.tables).toEqual([{ name: 'nodes', source: { inline: 'rows', rows: 3 }, engine: 'memory', key: 'id', declaredColumns: 1 }]);
    // the projection gains NO key when nothing declares one: the words this packet added are simply absent
    const text = JSON.stringify(o);
    for (const word of ['filledBy', 'computed', 'landed']) expect(text).not.toContain(word);
  });
});
