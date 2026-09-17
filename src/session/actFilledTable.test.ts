/**
 * A TABLE DECLARED WITH NO CARRIER, FILLED BY AN ACT — from the outside, which
 * is where the capability either exists or does not.
 *
 * The law under test (`../def/actFilled.ts`): the rows arrive from the act and
 * NOTHING else does. Its columns, its key, its absence vocabulary, its grain
 * and — the whole point — its RELATIONS are declared like any other table's, at
 * the same door, by the same validator. So the things this file proves are
 * things nobody wrote code for: a clause travels INTO it as a semi-join, a
 * neighbourhood travels OUT of it by identity, a window reads it, the chip and
 * the Sheet say where the clause reached, and a replay rebuilds its rows from
 * the log without them ever being in the log.
 *
 * The case that makes it worth having is the one declared here: an EDGE table,
 * computed from the node table, related to it TWICE — once per endpoint. The
 * minted door cannot express that at all (it mints one edge from one group
 * column), which is why the second door is a def entry and not a record.
 *
 * The def-door half — the seven refusals, the provider, the `refresh` answer —
 * is `../def/actFilled.def.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard, buildDashboardAsync, layerAddress, validateDashboardDef } from '../def/index.js';
import type { DashboardDef, RelationDecl, SourceAdapter } from '../def/index.js';
import type { Cause } from '../cause/index.js';
import { defineAnalysis } from '../analysis/index.js';
import type { AnalysisModule, AnalysisOutput, DataRow, ScalarOutput, TableOutput } from '../analysis/index.js';
import { flowChart } from 'footprintjs';
import type { Row } from '../data/index.js';

const cause: Cause = { requestedBy: 'user', computedBy: 'user', intent: 'a test' };
const id = (r: { ok: boolean; commit?: { id: string } }): string => (r.ok && r.commit ? r.commit.id : '');

/** Three diseases in two groups. */
const NODES: readonly Row[] = [
  { id: 'flu', size: 12, group: 'viral' },
  { id: 'cold', size: 7, group: 'viral' },
  { id: 'strep', size: 3, group: 'bacterial' },
];

/** …and the two ties the act computes from them: consecutive nodes, weighted by position. */
const TIES: readonly Row[] = [
  { source: 'flu', target: 'cold', weight: 1 },
  { source: 'cold', target: 'strep', weight: 2 },
];

const MAP = layerAddress('map', 'nodes');
const TIES_AT = layerAddress('ties', 'edges');

/**
 * THE ACT: node rows in, edge rows out. A MODULE, so nothing about it can ride
 * on a commit — which is the harder replay case, and the honest one for an act
 * that is code.
 *
 * Its answer calls itself `ties`, and the declared table is `edges`: the name on
 * the answer is IGNORED on purpose (`./session.ts` · `writeFilledTable`). The
 * def says which table this act fills; nothing about that table is inferred
 * from what arrives.
 */
function edgeBuilder(opts: { readonly id?: string; readonly rows?: readonly Row[] } = {}): AnalysisModule<readonly DataRow[], TableOutput> {
  return defineAnalysis<readonly DataRow[], TableOutput>({
    id: opts.id ?? 'buildEdges',
    kind: 'transform',
    produces: 'table',
    inputs: [{ column: 'id', role: 'group' }],
    build: () =>
      flowChart<Record<string, unknown>>(
        'ties',
        (scope) => {
          const ids = scope.$getArgs<{ readonly ids: readonly string[] }>().ids;
          scope.$setValue('ties', ids.slice(1).map((to, i) => ({ source: ids[i], target: to, weight: i + 1 })));
        },
        'load',
      ).build(),
    toRunInput: (rows) => ({ ids: rows.map((row) => row['id']) }),
    readOutput: ({ snapshot }) => ({
      ok: true,
      output: {
        as: 'table',
        name: 'ties',
        schema: { source: 'string', target: 'string', weight: 'int' },
        rows: (opts.rows ?? (snapshot.sharedState['ties'] as readonly Row[])) as Array<Record<string, unknown>>,
      },
    }),
  });
}

/** The same act, lying about its channel: it declares `table` and answers with a scalar. Only a replay can hear it. */
function liar(): AnalysisModule<readonly DataRow[], AnalysisOutput> {
  return defineAnalysis<readonly DataRow[], AnalysisOutput>({
    id: 'buildEdges',
    kind: 'transform',
    produces: 'table',
    inputs: [{ column: 'id', role: 'group' }],
    build: () => flowChart<Record<string, unknown>>('one', (scope) => { scope.$setValue('out', 1); }, 'load').build(),
    toRunInput: (rows) => ({ n: rows.length }),
    readOutput: () => ({ ok: true, output: { as: 'scalar', name: 'n', value: 1 } as ScalarOutput }),
  });
}

/** The two relations that make `edges` an EDGE table: each end names the node table's declared key. */
const BOTH_ENDS: readonly RelationDecl[] = [
  { from: { table: 'edges', column: 'source' }, to: { table: 'nodes', column: 'id' }, label: 'one end of the tie' },
  { from: { table: 'edges', column: 'target' }, to: { table: 'nodes', column: 'id' }, label: 'the other end' },
];

/** The declared node-link: a node layer, an edge layer on a table with NO CARRIER, and the act that fills it. */
function network(extra: Partial<DashboardDef> = {}, analyses?: DashboardDef['analyses']): DashboardDef {
  return {
    meta: { title: 'a node-link whose edges are computed' },
    data: {
      nodes: { rows: [...NODES], key: 'id', columns: { id: { role: 'identifier' }, size: { role: 'measure' }, group: { role: 'dimension' } } },
      edges: { filledBy: 'buildEdges', columns: { source: { role: 'dimension' }, target: { role: 'dimension' }, weight: { role: 'measure' } } },
    },
    actors: { map: { actor: 'user', label: 'The map' }, ties: { actor: 'user', label: 'The ties' } },
    encodings: [
      { viewId: 'map', chartKind: 'point', channels: ['x', 'y'], layers: [{ layerId: 'nodes', table: 'nodes', chartKind: 'point', channels: ['x', 'y'], initial: { x: 'size' } }] },
      { viewId: 'ties', chartKind: 'line', channels: ['x', 'y'], layers: [{ layerId: 'edges', table: 'edges', chartKind: 'line', channels: ['x', 'y'], initial: { x: 'weight' } }] },
    ],
    capabilities: [{ viewId: 'ties', canProbe: true, encodings: ['point', 'interval', 'match', 'neighbourhood'] }],
    analyses: analyses ?? { buildEdges: edgeBuilder() },
    relations: [...BOTH_ENDS],
    defaultTable: 'nodes',
    ...extra,
  } as DashboardDef;
}

type Session = ReturnType<ReturnType<typeof buildDashboard>['createSession']>;
const fresh = (extra: Partial<DashboardDef> = {}, analyses?: DashboardDef['analyses']): Session => buildDashboard(network(extra, analyses)).createSession();

/** One table's rows at the cursor, or the sentence the read was refused with. */
async function rowsOf(s: Session, table = 'edges'): Promise<unknown[]> {
  const res = await s.viewQuery({ table, limit: 40 });
  return res.ok ? [...res.rows] : [`REFUSED: ${res.rejected}`];
}

/**
 * …and the rows one VIEW sees — which is where a travelled clause is judged. A
 * window asked with no `viewId` is the whole-dashboard truth, and a clause
 * travels to a CONSUMER: it is the consumer's window that carries it.
 */
async function viewRowsOf(s: Session, viewId: string): Promise<unknown[]> {
  const res = await s.viewQuery({ viewId, limit: 40 });
  return res.ok ? [...res.rows] : [`REFUSED: ${res.rejected}`];
}

/** THE READ REFUSAL before the act, once. */
const UNFILLED =
  '"edges" declares no carrier — the act "buildEdges" fills it, and it has not landed on this path: every read of "edges" is refused in these words. ' +
  'Perform "buildEdges" to fill it — it takes the act\'s rows only if they carry the columns this table declares; its columns, its key and its relations are declared, and do not wait for it.';

/** …and after a refresh has taken the rows away, which is a different history and a different repair. */
const WITHDRAWN =
  '"edges" declares no carrier — the act "buildEdges" filled it, and the rows it landed were withdrawn when "nodes" was refreshed: every read of "edges" is refused in these words. ' +
  'They were computed from data that no longer exists, so nothing serves them; perform "buildEdges" again to fill it from the data as it stands.';

/** A carrier for the PARENT that can be moved — the refresh fixture (`../def/declaredTable.def.test.ts`'s twin). */
function movingNodes(initial: { rows: readonly Row[]; version: string }): { readonly adapter: SourceAdapter; move(next: { rows: readonly Row[]; version: string }): void } {
  let current = initial;
  return {
    adapter: {
      via: 'http',
      open: async () => ({
        capabilities: { live: false, pushdown: false as const },
        snapshot: async () => ({ rows: [...current.rows], version: current.version, retrievedAt: 'now' }),
        close: async () => {},
      }),
    },
    move: (next) => {
      current = next;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('unlanded is a STATE: the table is declared, and the read says which act it is waiting for', () => {
  it('before the act: the name IS a table (it is declared), the read is refused, and the Sources row says what is true of it', async () => {
    const s = fresh();
    // A DECLARED table is at every cursor — which is the whole difference from a MINTED one, whose
    // name is not a table until its act runs (`./aggregateTable.test.ts`). So the cursor question is
    // not "is this a table" but "have its rows landed", and the READ is where that is answered.
    expect(s.tablesAt()).toEqual(['nodes', 'edges']);
    expect(await rowsOf(s)).toEqual([`REFUSED: ${UNFILLED}`]);

    const o = await s.overview();
    expect(o.tables).toEqual([
      { name: 'nodes', source: { inline: 'rows', rows: 3 }, engine: 'memory', key: 'id', declaredColumns: 3 },
      { name: 'edges', source: { computed: 'act', by: 'buildEdges', landed: false }, engine: 'memory', declaredColumns: 3 },
    ]);
    // no `via`, no `at`, no `version`: nothing carried these rows, and a field claiming one would be
    // the only untrue thing on the tab
    expect(JSON.stringify(o.tables[1])).not.toContain('via');
    expect(o.relations).toEqual(BOTH_ENDS.map((r) => ({ ...r, kind: 'many-to-one' })));
  });

  it('after the act: the rows are readable, the columns are the DECLARED ones, and the row says it landed', async () => {
    const s = fresh();
    const made = await s.declareAnalysis('buildEdges', { cause });
    expect([made.result.ok, made.gap]).toEqual([true, undefined]);
    expect(s.log.records).toHaveLength(1); // ONE cause-tagged commit for the act, exactly as any other

    expect(await rowsOf(s)).toEqual(TIES);
    const win = await s.viewQuery({ table: 'edges' });
    expect(win.ok && [win.count, win.positional]).toEqual([2, true]); // no declared key: positional rows, nothing guessed
    const o = await s.overview();
    // …and the row DATES the rows a reader is looking at: the commit that filled them, which is
    // the only thing on this row that can say which run they came from (the minted row's `derived.at`)
    expect(o.tables.at(-1)).toEqual({ name: 'edges', source: { computed: 'act', by: 'buildEdges', landed: true, at: made.commit!.id }, engine: 'memory', declaredColumns: 3 });
    // the columns a reader is offered are the ones the DEF declares, in declaration order
    expect(o.columns['edges']!.map((c) => c.field)).toEqual(['source', 'target', 'weight']);
  });

  it('the rows are nowhere in the overview, landed or not — a projection of the map never carries data', async () => {
    const s = fresh();
    const before = JSON.stringify(await s.overview());
    await s.declareAnalysis('buildEdges', { cause });
    const after = JSON.stringify(await s.overview());
    for (const text of [before, after]) {
      expect(text).not.toContain('flu'); // no row of either table, by any spelling
      expect(text).not.toContain(JSON.stringify(TIES[0]));
    }
  });

  it('the CURSOR: refused at a commit before the act, read at one after — the law every landed column keeps', async () => {
    const s = fresh();
    const root = await s.dispatch({ verb: 'select', viewId: MAP, field: 'group', value: 'viral', cause });
    await s.declareAnalysis('buildEdges', { cause });
    // …and it filled the table from the rows visible at ITS OWN cursor: the pick was live, so `strep`
    // was never in the input and its tie was never computed. The aggregate's law, one door along.
    expect(await rowsOf(s)).toEqual([TIES[0]]);

    s.seek(id(root));
    // …and the sentence at the earlier commit is the SAME sentence, because it is the same provider:
    // "on this path" is doing real work here
    expect(await rowsOf(s)).toEqual([`REFUSED: ${UNFILLED}`]);
    const o = await s.overview();
    expect(o.tables.at(-1)!.source).toEqual({ computed: 'act', by: 'buildEdges', landed: false });
  });
});

describe('TWO relations to one parent — the capability this door exists for', () => {
  it('a clause travels INTO the computed table as a semi-join, and arrives as a match on the far column', async () => {
    const s = fresh();
    await s.declareAnalysis('buildEdges', { cause });
    const pick = await s.dispatch({ verb: 'select', viewId: MAP, field: 'group', value: 'bacterial', cause });
    expect(pick.ok).toBe(true);

    // the edges table has no `group` column, so the clause is re-phrased by the engine that holds the
    // NODES rows — a semi-join — over the FIRST declared relation whose far column the table has
    const reaching = s.clausesFor(TIES_AT);
    expect(reaching).toEqual([
      {
        from: MAP,
        fromLabel: 'The map',
        response: 'filter',
        clause: { kind: 'match', field: 'source', values: ['strep'] },
        via: { path: [{ from: { table: 'edges', column: 'source' }, to: { table: 'nodes', column: 'id' } }], label: 'one end of the tie', rows: 1, from: { kind: 'point', field: 'group', value: 'bacterial' } },
      },
    ]);
    expect('narrowed' in reaching[0]!).toBe(false); // a travelled clause was JUDGED — it is never "filtered nothing"
    // …and the consumer's window judges it as any match: no tie leaves strep
    expect(await viewRowsOf(s, TIES_AT)).toEqual([]);
  });

  it('…and the SECOND relation carries the same clause to the other endpoint — one identity, two columns', async () => {
    // the pair is read in DECLARATION order (`../def/relations.ts`, law 7), so the def that declares
    // `target` first is the one that travels `target`. Both relations are real, and each carries a
    // clause: the ONE thing that decides which is the order the author wrote them in.
    const s = fresh({ relations: [BOTH_ENDS[1]!, BOTH_ENDS[0]!] });
    await s.declareAnalysis('buildEdges', { cause });
    await s.dispatch({ verb: 'select', viewId: MAP, field: 'group', value: 'bacterial', cause });
    const c = s.clausesFor(TIES_AT)[0]!;
    expect([c.clause, c.via?.label]).toEqual([{ kind: 'match', field: 'target', values: ['strep'] }, 'the other end']);
    // the same gesture, the other end: the tie INTO strep is the one that stays
    expect(await viewRowsOf(s, TIES_AT)).toEqual([TIES[1]]);
  });

  it('the chip and the Sheet say where the clause reached, in the words those owners already use', async () => {
    const s = fresh();
    await s.declareAnalysis('buildEdges', { cause });
    const pick = await s.dispatch({ verb: 'select', viewId: MAP, field: 'group', value: 'viral', cause });
    const via = { path: [{ from: { table: 'edges', column: 'source' }, to: { table: 'nodes', column: 'id' } }], label: 'one end of the tie', rows: 2 };

    // THE CHIP: the live selection's own row carries where it travelled, by consumer
    const o = await s.overview();
    expect(o.activeSelections).toEqual([
      {
        viewId: MAP,
        field: 'group',
        kind: 'point',
        value: 'viral',
        commitId: id(pick),
        travelled: { [TIES_AT]: { clause: { kind: 'match', field: 'source', values: ['flu', 'cold'] }, via, label: 'The ties' } },
      },
    ]);

    // THE SHEET: `why` on the computed table's view — the pick anchors, and the row says how it got there
    const why = s.why({ kind: 'chart', viewId: TIES_AT });
    expect(why.ok && why.commits).toEqual([{ tier: 'viz', id: id(pick), kind: 'declaring', response: 'filter', via: { ...via, values: 2 } }]);
  });

  it('a NEIGHBOURHOOD travels the other way by IDENTITY — the walk is over the computed edges, and the nodes hear it', async () => {
    const s = fresh();
    await s.declareAnalysis('buildEdges', { cause });
    // the walk reads the computed rows at this cursor and lands one commit carrying the question and its answer
    const walk = await s.dispatch({ verb: 'select', viewId: TIES_AT, field: 'source', seed: 'cold', cause });
    expect(walk.ok).toBe(true);
    expect(walk.ok && walk.commit!.value).toEqual({ seed: 'cold', derivation: 'ego', hops: 1, ids: ['cold', 'flu', 'strep'] });

    // …and it reaches the node map as a match on the KEY both relations point at — no engine asked,
    // because the ids ARE the far table's identities (law 7's pair, in declaration order)
    const c = s.clausesFor(MAP)[0]!;
    expect(c.clause).toEqual({ kind: 'match', field: 'id', values: ['cold', 'flu', 'strep'] });
    expect(c.via?.path).toEqual(BOTH_ENDS.map((r) => ({ from: r.from, to: r.to })));
    const win = await s.viewQuery({ viewId: MAP });
    expect(win.ok && win.rows.map((r) => r['id'])).toEqual(['flu', 'cold', 'strep']);
  });

  it('a fill belongs to the ACT that made it: two branches fill the same name, and each reads its own rows', async () => {
    const s = fresh();
    const root = await s.dispatch({ verb: 'select', viewId: MAP, field: 'group', value: 'viral', cause });
    await s.declareAnalysis('buildEdges', { cause }); // over the two viral nodes: one tie
    const narrow = await rowsOf(s);
    expect(narrow).toEqual([TIES[0]]);

    // …a sibling branch from the same moment, with the whole table visible, fills it again
    s.seek(id(root));
    await s.dispatch({ verb: 'select', viewId: MAP, field: 'group', value: null, cause });
    await s.declareAnalysis('buildEdges', { cause });
    expect(await rowsOf(s)).toEqual(TIES);
    // …and the first branch still reads what ITS act cut: a slot per act, never a slot per name
    s.seek(id(root));
    expect(await rowsOf(s)).toEqual([`REFUSED: ${UNFILLED}`]); // at the moment before either act
  });

  it('a replayed commit id that cannot name a slot lands nothing and quotes the id', async () => {
    const source = fresh();
    const landed = await source.declareAnalysis('buildEdges', { cause });
    // a foreign log: `parseCommitLog` judges shape and lineage, never the character set, so an id
    // carrying the slot grammar's reserved marker reaches the write intact
    const wire = source.log.records.map((r) => (r.id === landed.commit!.id ? { ...r, id: 'a@b' } : r));
    const replayed = fresh();
    expect((await replayed.replay(JSON.stringify(wire))).ok).toBe(true);
    expect(replayed.gaps().at(-1)).toMatchObject({ code: 'guard-failed', op: 'replay', target: 'edges' });
    expect(replayed.gaps().at(-1)!.detail).toBe('analysis "buildEdges" ran at commit "a@b", whose id cannot name a table slot — its rows were not landed');
    replayed.seek('a@b');
    expect(await rowsOf(replayed)).toEqual([`REFUSED: ${UNFILLED}`]);
  });

  it('an act-filled table takes its relations with NO new machinery: the def door judges them like every other', async () => {
    // the identity law: a relation points at the target's declared key
    expect(validateDashboardDef(network({ relations: [{ from: { table: 'edges', column: 'source' }, to: { table: 'nodes', column: 'size' } }] }))).toContain(
      'relations[0].to.column "size" is not the key of "nodes" — the key is "id"; a relation points at an identity',
    );
    // …and a source column the table does not declare is refused by name, on the computed side too
    expect(validateDashboardDef(network({ relations: [{ from: { table: 'edges', column: 'ghost' }, to: { table: 'nodes', column: 'id' } }] }))).toContain(
      'relations[0].from.column "ghost" is not a declared column of "edges"',
    );
    // the two ends, well declared, are accepted — and that is the whole edge-table capability
    expect(validateDashboardDef(network())).toEqual([]);
    // …and the post-build lint says nothing about a relation whose source column is on a table with
    // no carrier: what arrived is judged where it arrives, and an engine holding no rows yet
    // contradicts nothing (`../def/buildDashboard.ts` · `lintData`)
    expect(await buildDashboard(network()).lintData()).toEqual([]);
  });
});

describe('the rows are never on the record, and a replay rebuilds them', () => {
  it('the commit carries the act and the table it read — and no row of what it landed', async () => {
    const s = fresh();
    const made = await s.declareAnalysis('buildEdges', { cause });
    expect(made.commit!.value).toEqual({ id: 'buildEdges', table: 'nodes' });
    const log = JSON.stringify(s.log.records);
    expect(log).not.toContain('weight'); // no column of the landed table, so no row of it either
    expect(log).not.toContain('flu');
  });

  it('a replay of that log into a fresh dashboard puts the identical rows back', async () => {
    const source = fresh();
    await source.dispatch({ verb: 'select', viewId: MAP, field: 'group', value: 'viral', cause });
    await source.declareAnalysis('buildEdges', { cause });
    const landed = await rowsOf(source);

    const replayed = fresh();
    const out = await replayed.replay(JSON.stringify(source.log.records));
    expect(out.ok && [out.reran, out.filed]).toEqual([1, 0]);
    expect(await rowsOf(replayed)).toEqual(landed);
    // …and the Sources row says the same thing on the other side: it landed, which act landed it,
    // and at which commit — the replayed one, which is the id the log carried
    expect((await replayed.overview()).tables.at(-1)!.source).toEqual({ computed: 'act', by: 'buildEdges', landed: true, at: source.log.records.at(-1)!.id });
  });

  it('a recomputation that produces another CHANNEL refuses in the words the replay already has', async () => {
    const source = fresh();
    const made = await source.declareAnalysis('buildEdges', { cause });
    // the SAME id, declared as a table act and answering with a scalar: nothing is guessed at, because
    // guessing would put real values under real provenance
    const target = fresh({}, { buildEdges: liar() });
    const out = await target.replay(JSON.stringify(source.log.records));
    expect(out.ok && out.filed).toBe(1);
    expect(target.gaps().at(-1)!.detail).toBe(
      `commit ${made.commit!.id} ran analysis "buildEdges", but re-running it produced a scalar — what it landed could not be rebuilt`,
    );
    expect(await rowsOf(target)).toEqual([`REFUSED: ${UNFILLED}`]); // nothing landed, and the sentence says what to do
  });
});

describe('the arrived columns are judged at the landing, and a moved parent takes the rows away', () => {
  it('an answer carrying NONE of the declared columns is not this table: a gap with both lists, and nothing landed', async () => {
    const s = fresh({}, { buildEdges: edgeBuilder({ rows: [{ ref: 'a', year: 2011 }] }) });
    const made = await s.declareAnalysis('buildEdges', { cause });
    expect(made.result.ok).toBe(true); // the act really ran — what is refused is the LANDING
    expect(made.gap!.detail).toBe(
      'data["edges"]: the act "buildEdges" landed 1 rows and none of the columns this table declares — declared "source", "target", "weight", arrived "ref", "year". ' +
        'A computed table is never the declared table by accident, so these rows are not landed: "edges" stays unlanded and every read of it is refused in the words that name the act. ' +
        'Land this table\'s own columns from "buildEdges", or declare the columns it computes.',
    );
    expect(await rowsOf(s)).toEqual([`REFUSED: ${UNFILLED}`]);
  });

  it('a PARTIAL mismatch is today\'s law, byte for byte: it lands, and the read door narrows what it must', async () => {
    const s = fresh({}, { buildEdges: edgeBuilder({ rows: [{ source: 'flu', target: 'cold' }] }) });
    const made = await s.declareAnalysis('buildEdges', { cause });
    expect(made.gap).toBeUndefined();
    expect(await rowsOf(s)).toEqual([{ source: 'flu', target: 'cold' }]);
  });

  it('the parent\'s bytes move, so the rows computed from them go — and the table is UNLANDED again, saying so', async () => {
    const carrier = movingNodes({ rows: NODES, version: 'v1' });
    const def = network();
    const dash = await buildDashboardAsync(
      { ...def, data: { ...def.data, nodes: { source: { format: 'rows', via: 'http', at: 'https://viz.example/nodes.json' }, key: 'id', columns: def.data['nodes']!.columns } } } as DashboardDef,
      { sources: [carrier.adapter] },
    );
    const s = dash.createSession();
    await s.declareAnalysis('buildEdges', { cause });
    expect(await rowsOf(s)).toEqual(TIES);

    carrier.move({ rows: [...NODES, { id: 'measles', size: 4, group: 'viral' }], version: 'v2' });
    const out = await dash.refresh(['nodes']);
    expect('changed' in out.tables['nodes']! && out.tables['nodes'].filledLost).toEqual(['edges']);
    // the rows it computed from bytes that no longer exist are gone — and the read says THAT, not
    // "it has not landed": they landed and were withdrawn, and the repair is to perform the act again
    expect(await rowsOf(s)).toEqual([`REFUSED: ${WITHDRAWN}`]);
    expect((await s.overview()).tables.at(-1)!.source).toEqual({ computed: 'act', by: 'buildEdges', landed: false });
    // …and performing the act again fills it from the bytes that are there now
    await s.declareAnalysis('buildEdges', { cause });
    expect(await rowsOf(s)).toEqual([...TIES, { source: 'strep', target: 'measles', weight: 3 }]);
  });
});

describe('the OTHER door is untouched — two doors, two questions', () => {
  it("an aggregate still MINTS its table, its key and its relation, and its Sources row is byte-identical", async () => {
    // A def with no act-filled table anywhere: the aggregate exactly as it was before this door
    // existed. Its relation is MINTED from the grouping (nobody declared one), which is the whole
    // reason the two doors are two — an act-filled table's relations are DECLARED, at the def door,
    // where every relation is judged.
    const cells: DashboardDef = {
      meta: { title: 'the minted door' },
      data: { cells: { rows: [{ id: 'a', disease: 'flu', cases: 10 }, { id: 'b', disease: 'flu', cases: 20 }], key: 'id' } },
      actors: { grid: { actor: 'user', label: 'The grid' } },
      analyses: { byDisease: { builtin: 'aggregate', table: 'cells', name: 'by_disease', ops: 1, groupBy: ['disease'], measures: [{ as: 'total', expr: { op: 'sum', args: [{ col: 'cases' }] } }] } },
      defaultTable: 'cells',
    } as DashboardDef;
    const s = buildDashboard(cells).createSession();
    const made = await s.declareAnalysis('byDisease', { cause });
    const o = await s.overview();
    expect(o.tables.at(-1)).toEqual({
      name: 'by_disease',
      source: { computed: 'aggregate' },
      engine: 'memory',
      key: 'disease',
      derived: { of: 'cells', groupBy: ['disease'], measures: ['total'], at: made.commit!.id },
      declaredColumns: 2,
    });
    expect(o.relations).toEqual([{ from: { table: 'cells', column: 'disease' }, to: { table: 'by_disease', column: 'disease' }, kind: 'many-to-one' }]);
    // …and nothing about the new door appears anywhere in the projection
    for (const word of ['filledBy', 'landed']) expect(JSON.stringify(o)).not.toContain(word);
  });
});

describe('a refresh takes every generation with it — the cascade is a fixpoint over both registries', () => {
  /** A second table-channel act: it reads whatever table it is pointed at and lands one row saying how many it saw. */
  function counter(id: string): AnalysisModule<readonly DataRow[], TableOutput> {
    return defineAnalysis<readonly DataRow[], TableOutput>({
      id,
      kind: 'transform',
      produces: 'table',
      inputs: [{ column: 'source', role: 'group' }],
      build: () =>
        flowChart<Record<string, unknown>>(
          'count',
          (scope) => {
            scope.$setValue('stats', [{ tag: id, n: scope.$getArgs<{ readonly n: number }>().n }]);
          },
          'load',
        ).build(),
      toRunInput: (rows) => ({ n: rows.length }),
      readOutput: ({ snapshot }) => ({ ok: true, output: { as: 'table', name: 'stats', schema: { tag: 'string', n: 'int' }, rows: snapshot.sharedState['stats'] as Array<Record<string, unknown>> } }),
    });
  }

  const STATS_COLUMNS = { tag: { role: 'dimension' as const }, n: { role: 'measure' as const } };
  const AGGREGATE = { builtin: 'aggregate' as const, table: 'nodes', name: 'by_group', ops: 1, groupBy: ['group'], measures: [{ as: 'total', expr: { op: 'sum' as const, args: [{ col: 'size' }] } }] };

  /** The node-link on a carrier that can be moved, plus whatever second computed table a shape needs. */
  async function movable(extra: { readonly data?: DashboardDef['data']; readonly analyses?: DashboardDef['analyses'] } = {}) {
    const carrier = movingNodes({ rows: NODES, version: 'v1' });
    const base = network();
    const def = {
      ...base,
      data: {
        ...base.data,
        nodes: { source: { format: 'rows', via: 'http', at: 'https://viz.example/nodes.json' }, key: 'id', columns: base.data['nodes']!.columns },
        ...(extra.data ?? {}),
      },
      analyses: { ...base.analyses, ...(extra.analyses ?? {}) },
    } as DashboardDef;
    const dash = await buildDashboardAsync(def, { sources: [carrier.adapter] });
    return { dash, s: dash.createSession(), move: () => carrier.move({ rows: [...NODES, { id: 'measles', size: 4, group: 'viral' }], version: 'v2' }) };
  }

  it('a FILL computed from a FILL dies with its grandparent — the generation a level-counting cascade left serving stale rows', async () => {
    const { dash, s, move } = await movable({
      data: { edge_stats: { filledBy: 'edgeStats', columns: STATS_COLUMNS } },
      analyses: { edgeStats: counter('edgeStats') },
    });
    await s.declareAnalysis('buildEdges', { cause });
    await s.declareAnalysis('edgeStats', { table: 'edges', cause });
    expect(await rowsOf(s, 'edge_stats')).toEqual([{ tag: 'edgeStats', n: 2 }]);

    move();
    const out = await dash.refresh(['nodes']);
    // BOTH generations, in the order they fell: the fill cut from the carrier, then the fill cut from THAT
    expect('changed' in out.tables['nodes']! && out.tables['nodes'].filledLost).toEqual(['edges', 'edge_stats']);
    expect(await rowsOf(s, 'edge_stats')).toEqual([
      'REFUSED: "edge_stats" declares no carrier — the act "edgeStats" filled it, and the rows it landed were withdrawn when "nodes" was refreshed: every read of "edge_stats" is refused in these words. ' +
        'They were computed from data that no longer exists, so nothing serves them; perform "edgeStats" again to fill it from the data as it stands.',
    ]);
    // …and the Sources row does not go on claiming the rows are here
    expect((await s.overview()).tables.map((t) => [t.name, t.source])).toEqual([
      ['nodes', { format: 'rows', via: 'http', at: 'https://viz.example/nodes.json' }],
      ['edges', { computed: 'act', by: 'buildEdges', landed: false }],
      ['edge_stats', { computed: 'act', by: 'edgeStats', landed: false }],
    ]);
  });

  it('a FILL computed from a DERIVED table dies with it — the generation that crosses the two registries', async () => {
    const { dash, s, move } = await movable({
      data: { g_stats: { filledBy: 'countGroups', columns: STATS_COLUMNS } },
      analyses: { countGroups: counter('countGroups'), agg: AGGREGATE },
    });
    await s.declareAnalysis('agg', { table: 'nodes', cause });
    await s.declareAnalysis('countGroups', { table: 'by_group', cause });
    expect(await rowsOf(s, 'g_stats')).toEqual([{ tag: 'countGroups', n: 2 }]);

    move();
    const out = await dash.refresh(['nodes']);
    expect('changed' in out.tables['nodes']! && [out.tables['nodes'].derivedLost, out.tables['nodes'].filledLost]).toEqual([['by_group'], ['g_stats']]);
    // the aggregate's name stops being a table at all (it was minted); the DECLARED fill stays a
    // table and says its rows were withdrawn
    expect(s.tablesAt()).toEqual(['nodes', 'edges', 'g_stats']);
    expect(await rowsOf(s, 'g_stats')).toEqual([expect.stringContaining('the rows it landed were withdrawn when "nodes" was refreshed')]);
  });

  it('a DERIVED table cut from a FILL dies with it — the same crossing, the other way round', async () => {
    const { dash, s, move } = await movable({
      analyses: { byEnd: { builtin: 'aggregate', table: 'edges', name: 'by_end', ops: 1, groupBy: ['source'], measures: [{ as: 'ties', expr: { op: 'count', args: [{ col: 'target' }] } }] } },
    });
    await s.declareAnalysis('buildEdges', { cause });
    await s.declareAnalysis('byEnd', { table: 'edges', cause });
    expect(s.tablesAt()).toEqual(['nodes', 'edges', 'by_end']);

    move();
    const out = await dash.refresh(['nodes']);
    expect('changed' in out.tables['nodes']! && [out.tables['nodes'].derivedLost, out.tables['nodes'].filledLost]).toEqual([['by_end'], ['edges']]);
    expect(s.tablesAt()).toEqual(['nodes', 'edges']);
  });
});
