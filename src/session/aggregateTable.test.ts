/**
 * AN AGGREGATE, from the outside — what a person who cut one sees.
 *
 * The act is not new: an aggregate lands through `analyze` like every other
 * analysis, over the rows visible at its cursor, as ONE cause-tagged commit
 * carrying its whole declaration. What is new is the second half of the law —
 * it lands a DERIVED DATASET beside the parent, and that table belongs to the
 * act that made it exactly as a derived column does: a slot per act, resolved
 * at the cursor's branch path, dropped from view outside it.
 *
 * This file is the proof of the parts nobody could see from the derive folder:
 * the table appears and vanishes with the cursor, the relation back to the
 * parent is MINTED and routes a selection both ways, the rows are recomputed on
 * replay from the bytes and never serialised, an aggregate can be a parent in
 * turn, a refresh of the parent takes it away and says so — and the three
 * outcomes stay distinct, so a stub engine is UNAVAILABLE and an empty group
 * set is an honest table that LANDS.
 *
 * The laws it pins: `src/data/README.md` (a derived thing belongs to its act),
 * `./README.md` (judge before anything moves), `../derive/README.md` (the
 * measures are the reducers).
 */

import { describe, expect, it } from 'vitest';
import { buildDashboard, buildDashboardAsync } from '../def/index.js';
import type { DashboardDef, SourceAdapter } from '../def/index.js';
import type { Cause } from '../cause/index.js';
import { flowChart } from 'footprintjs';
import { defineAnalysis } from '../analysis/index.js';
import type { AnalysisModule, ColumnsOutput, DataRow } from '../analysis/index.js';
import type { Expr, Measure } from '../derive/index.js';
import { vizAsTools } from '../agent/index.js';
import { noSqlConnection } from './dashboard.fixture.js';

const cause: Cause = { requestedBy: 'user', computedBy: 'user', intent: 'a test' };

/**
 * Four rows, two diseases, two kinds — so a group has more than one row, a
 * filter really removes one, and the totals differ with and without it.
 */
const ROWS = [
  { id: 'a', disease: 'flu', kind: 'state', cases: 10 },
  { id: 'b', disease: 'flu', kind: 'state', cases: 20 },
  { id: 'c', disease: 'measles', kind: 'state', cases: 5 },
  { id: 'd', disease: 'measles', kind: 'city', cases: 7 },
] as unknown as DataRow[];

const sum = (column: string): Expr => ({ op: 'sum', args: [{ col: column }] });
const TOTAL: Measure = { as: 'total', expr: sum('cases') };

/** The act's own record — `by_disease`, one row per disease, one measure. */
function byDisease(where?: Expr): DashboardDef['analyses'] {
  return { by_disease: { builtin: 'aggregate', table: 'cells', name: 'by_disease', ops: 1, groupBy: ['disease'], measures: [TOTAL], ...(where === undefined ? {} : { where }) } };
}

function defWith(analyses: DashboardDef['analyses'], opts: { readonly engine?: 'wasm'; readonly links?: DashboardDef['links'] } = {}): DashboardDef {
  return {
    data: { cells: { rows: [...ROWS], key: 'id', ...(opts.engine !== undefined ? { engine: opts.engine } : {}) } },
    actors: { grid: { actor: 'user', label: 'The grid' }, bars: { actor: 'user', label: 'The bars' } },
    ...(analyses !== undefined ? { analyses } : {}),
    ...(opts.links !== undefined ? { links: opts.links } : {}),
    defaultTable: 'cells',
  };
}

/**
 * A columns-channel MODULE — no record, so nothing about it can ride on a
 * commit. Used only to prove what a replay says when a module's declared
 * channel and its answer disagree.
 */
function columnAnalysis(id: string): AnalysisModule<readonly DataRow[], ColumnsOutput> {
  return defineAnalysis<readonly DataRow[], ColumnsOutput>({
    id,
    kind: 'transform',
    produces: 'columns',
    inputs: [{ column: 'cases', role: 'value' }],
    build: () => flowChart<Record<string, unknown>>('count', (scope) => { scope.$setValue('n', scope.$getArgs<{ rows: number }>().rows); }, 'load').build(),
    toRunInput: (rows) => ({ rows: rows.length }),
    readOutput: () => ({ ok: true, output: { as: 'columns', table: 'cells', columns: { n: { type: 'int' } } } }),
  });
}

type Session = ReturnType<ReturnType<typeof buildDashboard>['createSession']>;

/** One table's rows at the cursor, or the sentence the read was refused with. */
async function rowsOf(s: Session, table: string): Promise<unknown[]> {
  const res = await s.viewQuery({ table, limit: 40 });
  return res.ok ? [...res.rows] : [`REFUSED: ${res.rejected}`];
}

// ─────────────────────────────────────────────────────────────────────────────

describe('one act, one commit, one table', () => {
  it('lands a named table at its cursor — with the key and the relation it minted, and whats_here serves all three', async () => {
    const s = buildDashboard(defWith(byDisease())).createSession();
    const made = await s.declareAnalysis('by_disease', { cause });

    expect(made.result.ok).toBe(true);
    expect(made.gap).toBeUndefined();
    expect(s.log.records).toHaveLength(1); // ONE cause-tagged commit for the whole act
    const at = made.commit!.id;

    // the rows live in the store, computed once
    expect(await rowsOf(s, 'by_disease')).toEqual([
      { disease: 'flu', total: 30 },
      { disease: 'measles', total: 12 },
    ]);
    expect(s.tablesAt()).toEqual(['cells', 'by_disease']);

    // the KEY is the group column, so identity rides every window
    const win = await s.viewQuery({ table: 'by_disease' });
    expect(win.ok && [win.key, win.positional, win.rowIds]).toEqual(['disease', false, ['flu', 'measles']]);

    const o = await s.overview();
    expect(o.tables.at(-1)).toEqual({
      name: 'by_disease',
      source: { computed: 'aggregate' },
      engine: 'memory',
      key: 'disease',
      derived: { of: 'cells', groupBy: ['disease'], measures: ['total'], at },
      declaredColumns: 2,
    });
    // the edge is MINTED from the key — nobody declared it, and the def has none
    expect(o.relations).toEqual([{ from: { table: 'cells', column: 'disease' }, to: { table: 'by_disease', column: 'disease' }, kind: 'many-to-one' }]);
    expect(o.columns['by_disease']!.map((c) => c.field)).toEqual(['disease', 'total']);

    // …and the LENS serves the same three, which is why `tables` and `relations` are
    // parts of the CURSOR now: a reader that cached the declared list would omit this
    const port = vizAsTools(s, { as: 'agent' });
    const answer = (await port.call('viz.whats_here', { of: ['tables', 'relations'] })) as Record<string, unknown>;
    expect(answer['tables']).toEqual(o.tables);
    expect(answer['relations']).toEqual(o.relations);
  });

  it('the commit says which data it was true of — the PARENT it read, not the session default', async () => {
    const both: DashboardDef = {
      ...defWith({ by_disease: { builtin: 'aggregate', table: 'other', name: 'by_disease', ops: 1, groupBy: ['disease'], measures: [TOTAL] } }),
      data: {
        cells: { rows: [...ROWS], key: 'id' },
        other: { source: { format: 'rows', via: 'inline', at: [...ROWS] as unknown as Record<string, unknown>[] }, key: 'id' },
      },
    };
    const dash = buildDashboard(both);
    const s = dash.createSession();
    const made = await s.declareAnalysis('by_disease', { table: 'other', cause });
    expect(made.commit!.data).toEqual({ other: dash.sources['other']!.version });
    // …and the SESSION's default is what an act over that table still says, byte-identically
    const home = await s.declareAnalysis('by_disease', { cause });
    expect(home.commit!.data).toBeUndefined(); // `cells` carries inline rows: there is no version to claim
  });
});

describe('the table is the ACT’s, and moves with the cursor', () => {
  it('seeking before the act makes the name stop being a table, and the read says so', async () => {
    const s = buildDashboard(defWith(byDisease())).createSession();
    const root = await s.dispatch({ verb: 'select', viewId: 'grid', field: 'kind', value: 'state', cause });
    const rootId = root.ok ? root.commit!.id : '';
    await s.declareAnalysis('by_disease', { cause });
    expect(s.tablesAt()).toContain('by_disease');

    s.seek(rootId);
    expect(s.tablesAt()).toEqual(['cells']);
    expect(await rowsOf(s, 'by_disease')).toEqual(['REFUSED: no table "by_disease" here — the tables at this point are cells']);
    // …and nothing about it is served either: no Sources row, no relation, no columns
    const o = await s.overview();
    expect(o.tables.map((t) => t.name)).toEqual(['cells']);
    expect(o.relations).toEqual([]);
    expect(o.columns['by_disease']).toBeUndefined();
  });

  it('a branch that grows out of the act sees it; a sibling branch does not', async () => {
    const s = buildDashboard(defWith(byDisease())).createSession();
    const root = await s.dispatch({ verb: 'select', viewId: 'grid', field: 'kind', value: 'state', cause });
    const rootId = root.ok ? root.commit!.id : '';
    const made = await s.declareAnalysis('by_disease', { cause });

    // a commit landed AFTER the act, on its own branch
    const after = await s.dispatch({ verb: 'select', viewId: 'grid', field: 'disease', value: 'flu', cause });
    expect(s.tablesAt()).toContain('by_disease');
    // a later selection filters the WINDOW like any table's — it never recomputes the rows behind it
    expect(await rowsOf(s, 'by_disease')).toEqual([{ disease: 'flu', total: 30 }]);
    await s.dispatch({ verb: 'select', viewId: 'grid', field: 'disease', value: null, cause });
    // …and the totals are the ones the act CUT: it folded the rows visible at its own cursor,
    // where `kind = state` was live, so the city row was never in it and never comes back
    expect(await rowsOf(s, 'by_disease')).toEqual([{ disease: 'flu', total: 30 }, { disease: 'measles', total: 5 }]);

    // …and a SIBLING branch from the same moment never saw the act at all
    s.seek(rootId);
    await s.dispatch({ verb: 'select', viewId: 'grid', field: 'disease', value: 'measles', cause });
    expect(s.tablesAt()).toEqual(['cells']);

    s.seek(after.ok ? after.commit!.id : '');
    expect(s.tablesAt()).toContain('by_disease');
    expect(made.commit).toBeDefined();
  });
});

describe('the rows are recomputed from the bytes, never serialised', () => {
  it('a replay into a fresh session with NOTHING registered rebuilds the identical table', async () => {
    const source = buildDashboard(defWith(byDisease())).createSession();
    await source.declareAnalysis('by_disease', { cause });
    const before = await rowsOf(source, 'by_disease');
    const wire = JSON.stringify(source.log.records);
    // the ROWS never ride — the record carries the declaration, and the measure's NAME is part of it
    expect(wire).not.toContain('"disease":"flu"');
    expect(wire).toContain('"groupBy":["disease"]');

    const fresh = buildDashboard(defWith(undefined)).createSession(); // no analyses declared at all
    const res = await fresh.replay(wire);
    expect(res.ok && [res.landed, res.reran, res.filed]).toEqual([1, 1, 0]);
    expect(await rowsOf(fresh, 'by_disease')).toEqual(before);
    expect(fresh.tablesAt()).toEqual(['cells', 'by_disease']);
  });
});

describe('the selection is the fold at the cursor', () => {
  it('a saved selection applied on the parent narrows what a NEW aggregate reads — and leaves the old one alone', async () => {
    const s = buildDashboard(defWith({
      ...byDisease(),
      again: { builtin: 'aggregate', table: 'cells', name: 'again', ops: 1, groupBy: ['disease'], measures: [TOTAL] },
    })).createSession();

    const whole = await s.declareAnalysis('by_disease', { cause });
    expect(whole.result.ok).toBe(true);

    await s.dispatch({ verb: 'select', viewId: 'grid', field: 'kind', value: 'state', cause });
    const saved = s.saveSelection('states only', { live: 'all' });
    expect(saved.ok).toBe(true);
    await s.dispatch({ verb: 'select', viewId: 'grid', field: 'kind', value: null, cause });
    const applied = await s.applySaved('states only', cause);
    expect(applied.ok).toBe(true);

    // the NEW act folds only what the picture keeps — the city row is gone
    await s.declareAnalysis('again', { cause });
    // …read with nothing live: `kind` is the PARENT's column, and a window on the derived
    // table under it would be refused, as any table's window under another table's clause is
    await s.dispatch({ verb: 'select', viewId: 'grid', field: 'kind', value: null, cause });
    expect(await rowsOf(s, 'again')).toEqual([
      { disease: 'flu', total: 30 },
      { disease: 'measles', total: 5 },
    ]);
    // …and the first table is untouched: a later selection does not recompute it
    expect(await rowsOf(s, 'by_disease')).toEqual([
      { disease: 'flu', total: 30 },
      { disease: 'measles', total: 12 },
    ]);
  });

  it('a declared filter on the act narrows it the same way, and an empty group set LANDS as an honest empty table', async () => {
    const s = buildDashboard(defWith({
      filtered: { builtin: 'aggregate', table: 'cells', name: 'filtered', ops: 1, groupBy: ['disease'], measures: [TOTAL], where: { op: 'eq', args: [{ col: 'kind' }, { lit: 'city' }] } },
      none: { builtin: 'aggregate', table: 'cells', name: 'none', ops: 1, groupBy: ['disease'], measures: [TOTAL], where: { op: 'eq', args: [{ col: 'kind' }, { lit: 'nowhere' }] } },
    })).createSession();

    await s.declareAnalysis('filtered', { cause });
    expect(await rowsOf(s, 'filtered')).toEqual([{ disease: 'measles', total: 7 }]);

    const empty = await s.declareAnalysis('none', { cause });
    expect(empty.result.ok).toBe(true); // EMPTY lands: zero rows is an answer, never a degenerate flag
    expect(empty.gap).toBeUndefined();
    expect(s.tablesAt()).toContain('none');
    const win = await s.viewQuery({ table: 'none' });
    expect(win.ok && [win.rows, win.count]).toEqual([[], 0]);
  });
});

describe('the minted relation routes both ways, with no new code', () => {
  it('a selection on the derived table reaches the parent’s rows, and the reverse edge highlights', async () => {
    const s = buildDashboard(defWith(byDisease(), {
      links: [
        { source: 'bars', kind: 'point', target: 'grid', response: 'filter' },
        { source: 'grid', kind: 'point', target: 'bars', response: 'highlight' },
      ],
    })).createSession();
    await s.declareAnalysis('by_disease', { cause });

    // FORWARD: the group column keeps its name, so the identity mapping carries the clause to the parent
    await s.dispatch({ verb: 'select', viewId: 'bars', field: 'disease', value: 'flu', cause });
    const parent = await s.viewQuery({ viewId: 'grid' });
    expect(parent.ok && parent.rows.map((r) => r['id'])).toEqual(['a', 'b']);
    // …and the neighbourhood the map names is the minted edge, walkable from the parent
    expect((await s.overview()).relations.map((r) => `${r.from.table}.${r.from.column}→${r.to.table}.${r.to.column}`)).toEqual(['cells.disease→by_disease.disease']);

    // REVERSE: a selection on the parent reaches the derived table as a HIGHLIGHT, not a filter
    await s.dispatch({ verb: 'select', viewId: 'bars', field: 'disease', value: null, cause });
    await s.dispatch({ verb: 'select', viewId: 'grid', field: 'disease', value: 'measles', cause });
    const back = await s.viewQuery({ viewId: 'bars', table: 'by_disease' });
    expect(back.ok && back.clauses.map((c) => [c.from, c.response])).toContainEqual(['grid', 'highlight']);
    expect(back.ok && back.rows).toHaveLength(2); // a highlight never removes a row
  });
});

describe('an aggregate can be a parent in turn', () => {
  it('a second act reads the first table’s columns and lands its own — grouped by nothing, so keyed by nothing', async () => {
    const s = buildDashboard(defWith({
      ...byDisease(),
      grand: { builtin: 'aggregate', table: 'by_disease', name: 'grand', ops: 1, groupBy: [], measures: [{ as: 'everything', expr: sum('total') }] },
    })).createSession();

    await s.declareAnalysis('by_disease', { cause });
    const made = await s.declareAnalysis('grand', { table: 'by_disease', cause });
    expect(made.result.ok).toBe(true);
    expect(await rowsOf(s, 'grand')).toEqual([{ everything: 42 }]);

    const o = await s.overview();
    const row = o.tables.find((t) => t.name === 'grand')!;
    expect(row.derived).toEqual({ of: 'by_disease', groupBy: [], measures: ['everything'], at: made.commit!.id });
    // a tuple of no columns is no row identity, so no key and NO relation — said out loud, not guessed around
    expect(row.key).toBeUndefined();
    expect(o.relations.map((r) => r.to.table)).toEqual(['by_disease']);
    expect(s.tablesAt()).toEqual(['cells', 'by_disease', 'grand']);
  });

  it('a derived COLUMN lands on a derived table', async () => {
    const s = buildDashboard(defWith({
      ...byDisease(),
      half: { builtin: 'derive', table: 'by_disease', name: 'half', column: { ops: 1, kind: 'row', expr: { op: 'div', args: [{ col: 'total' }, { lit: 2 }] } } },
    })).createSession();

    await s.declareAnalysis('by_disease', { cause });
    const made = await s.declareAnalysis('half', { table: 'by_disease', cause });
    expect(made.materialized).toEqual(['half']);
    expect(made.gap).toBeUndefined();
    expect(await rowsOf(s, 'by_disease')).toEqual([
      { disease: 'flu', total: 30, half: 15 },
      { disease: 'measles', total: 12, half: 6 },
    ]);
  });

  it('the rows the store holds are its own — writing into the answer the act handed back changes nothing', async () => {
    const s = buildDashboard(defWith(byDisease())).createSession();
    const made = await s.declareAnalysis('by_disease', { cause });
    const answered = made.result.ok && made.result.output.as === 'table' ? made.result.output.rows : [];
    (answered[0] as Record<string, unknown>)['total'] = 'FORGED';

    expect(await rowsOf(s, 'by_disease')).toEqual([
      { disease: 'flu', total: 30 },
      { disease: 'measles', total: 12 },
    ]);
  });
});

describe('the three outcomes stay distinct', () => {
  it('a parent whose engine refuses the read is UNAVAILABLE — the engine’s own rejection, never a fabricated degenerate fit', async () => {
    const s = buildDashboard(defWith(byDisease(), { engine: 'wasm' }), noSqlConnection).createSession();
    const made = await s.declareAnalysis('by_disease', { cause });

    expect(made.result).toEqual({ ok: false, reason: 'unavailable', rejection: { ok: false, engine: 'wasm', operation: 'columns', reason: 'no-backend-connection', detail: expect.any(String) } });
    expect(made.commit).toBeUndefined();
    expect(made.gap!.code).toBe('derive-source-refused');
    expect(s.tablesAt()).toEqual(['cells']); // nothing landed
  });

  it('a declaration the parent cannot honour is REFUSED, in a sentence, before anything moves', async () => {
    const s = buildDashboard(defWith({
      ghost: { builtin: 'aggregate', table: 'cells', name: 'ghost', ops: 1, groupBy: ['nowhere'], measures: [TOTAL] },
      shadow: { builtin: 'aggregate', table: 'cells', name: 'cells', ops: 1, groupBy: ['disease'], measures: [TOTAL] },
    })).createSession();

    const refused = await s.declareAnalysis('ghost', { cause });
    expect(refused.result).toEqual({ ok: false, reason: 'degenerate-fit', n: 0, fitDegenerate: true });
    expect(refused.gap!.code).toBe('derive-invalid');
    expect(refused.gap!.detail).toContain('groups by "nowhere", which table "cells" does not have');
    expect(s.log.records).toHaveLength(0); // nothing landed

    // …a table nothing provides is refused too, and it is NOT unavailable: no engine
    // rejected anything, because there was no engine to ask
    const nowhere = await s.declareAnalysis('ghost', { table: 'ghost', cause });
    expect(nowhere.result).toEqual({ ok: false, reason: 'degenerate-fit', n: 0, fitDegenerate: true });
    expect(nowhere.gap!.detail).toContain('no provider for table "ghost"');

    // …and a name the MAP already holds is refused where the write happens, after the act really ran
    const shadow = await s.declareAnalysis('shadow', { cause });
    expect(shadow.result.ok).toBe(true);
    expect(shadow.gap!.code).toBe('derive-invalid');
    expect(shadow.gap!.detail).toContain('a computed table may not take a declared table\'s name');
    expect(s.tablesAt()).toEqual(['cells']);
  });
});

describe('what a replay could not cut, it says', () => {
  it('a commit id that cannot name a slot lands nothing and quotes the id — the replayed-log id no session mints', async () => {
    const def = defWith(byDisease());
    const source = buildDashboard(def).createSession();
    const landed = await source.declareAnalysis('by_disease', { cause });
    // a foreign log: `parseCommitLog` judges shape and lineage, never the character set, so an
    // id carrying the slot grammar's reserved marker reaches `writeTable` intact
    const wire = source.log.records.map((r) => (r.id === landed.commit!.id ? { ...r, id: 'a@b' } : r));

    const fresh = buildDashboard(def).createSession();
    const replayed = await fresh.replay(JSON.stringify(wire));
    expect(replayed.ok).toBe(true);
    expect(fresh.gaps().at(-1)).toMatchObject({ code: 'guard-failed', target: 'by_disease' });
    expect(fresh.gaps().at(-1)!.detail).toContain('"a@b"');
    fresh.seek('a@b');
    expect(fresh.tablesAt()).toEqual(['cells']);
  });

  it('an act that lands a TABLE and does not say which table it read is refused before anything moves', async () => {
    const def = defWith(byDisease());
    const source = buildDashboard(def).createSession();
    await source.declareAnalysis('by_disease', { cause });
    const wire = JSON.parse(JSON.stringify(source.log.records)) as { value: unknown }[];
    wire[0]!.value = 'by_disease'; // the shape before the law: the id alone

    const s = buildDashboard(def).createSession();
    const res = await s.replay(JSON.stringify(wire));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.gap.detail).toContain('writes a table, and the record does not say which table it read');
    expect(s.log.records).toHaveLength(0);
  });

  it('an act that declares columns and answers with a table is named, not guessed at', async () => {
    const def = defWith({ shifty: columnAnalysis('shifty') });
    const source = buildDashboard(def).createSession();
    await source.declareAnalysis('shifty', { cause });

    const fresh = buildDashboard(def).createSession();
    // the same id, re-registered to answer on the OTHER channel — the shape a module can take
    fresh.registerAnalysis('shifty', {
      ...columnAnalysis('shifty'),
      run: async () => ({ result: { ok: true, output: { as: 'table', name: 'shifty', schema: {}, rows: [] } } }),
    });
    const res = await fresh.replay(JSON.stringify(source.log.records));
    expect(res.ok && res.reran).toBe(0);
    expect(fresh.gaps().at(-1)!.detail).toContain('a table no declaration on the commit could cut');
    expect(fresh.tablesAt()).toEqual(['cells']);
  });
});

describe('a refresh of the parent takes the table with it', () => {
  it('the rows it was cut from are gone, so the table is dropped and the loss is reported by name', async () => {
    let version = 'v1';
    const rows: Record<string, unknown>[] = ROWS.map((r) => ({ ...(r as unknown as Record<string, unknown>) }));
    const moving: SourceAdapter = {
      via: 'http',
      open: async () => ({
        capabilities: { live: false, pushdown: false as const },
        snapshot: async () => ({ rows: [...rows], version, retrievedAt: 'now' }),
        close: async () => {},
      }),
    };
    const def: DashboardDef = {
      ...defWith({
        ...byDisease(),
        grand: { builtin: 'aggregate', table: 'by_disease', name: 'grand', ops: 1, groupBy: [], measures: [{ as: 'everything', expr: sum('total') }] },
      }),
      data: { cells: { source: { format: 'rows', via: 'http', at: 'https://example.test/cells' }, key: 'id' } },
    };
    const dash = await buildDashboardAsync(def, { sources: [moving] });
    const s = dash.createSession();
    await s.declareAnalysis('by_disease', { cause });
    await s.declareAnalysis('grand', { table: 'by_disease', cause });
    expect(s.tablesAt()).toEqual(['cells', 'by_disease', 'grand']);

    version = 'v2';
    rows.push({ id: 'e', disease: 'flu', kind: 'state', cases: 100 });
    const out = (await dash.refresh(['cells'])).tables['cells']!;
    // both generations go: `grand` was cut from `by_disease`, which was cut from these bytes
    expect('changed' in out && out.derivedLost).toEqual(['by_disease', 'grand']);

    expect(s.tablesAt()).toEqual(['cells']);
    expect(await rowsOf(s, 'by_disease')).toEqual(['REFUSED: no table "by_disease" here — the tables at this point are cells']);
    // …and the act is still on the trace: re-running it is what brings the table back, over the new rows
    expect(s.log.records).toHaveLength(2);
    await s.declareAnalysis('by_disease', { cause });
    expect(await rowsOf(s, 'by_disease')).toEqual([
      { disease: 'flu', total: 130 },
      { disease: 'measles', total: 12 },
    ]);
  });
});
