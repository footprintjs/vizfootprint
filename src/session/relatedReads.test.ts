/**
 * An analysis may read a table BESIDE its own — and only where a declared
 * relation joins the two. The relation is the permission: the door refuses in a
 * sentence and lands nothing; the rows come back through the ONE input path, at
 * the cursor, wearing their logical names, under that table's own clauses; the
 * replay arm reads them the same way; and `why()` names the brush that shaped
 * them, because a related table read under a selection really is a causal input.
 *
 * The laws are `../def/README.md` ("Relations", law 6) and `./README.md`, law 1.
 */

import { describe, expect, it } from 'vitest';
import { flowChart } from 'footprintjs';
import { buildDashboard, layerAddress } from '../def/index.js';
import type { DashboardDef, RelationDecl } from '../def/index.js';
import { defineAnalysis } from '../analysis/index.js';
import type { AnalysisModule, ColumnsOutput } from '../analysis/index.js';
import { reject, type DataProvider, type Row } from '../data/index.js';
import { makeNetworkDef } from '../def/network.fixture.js';
import type { Cause } from '../cause/index.js';

const cause: Cause = { requestedBy: 'user', computedBy: 'user', intent: 'a test' };
const EDGES_ADDRESS = layerAddress('net', 'edges');

/** `edges.source → nodes.id` and `edges.target → nodes.id` — the demo's own two edges. */
const RELATIONS: readonly RelationDecl[] = [
  { from: { table: 'edges', column: 'source' }, to: { table: 'nodes', column: 'id' } },
  { from: { table: 'edges', column: 'target' }, to: { table: 'nodes', column: 'id' } },
];

/**
 * A columns analysis on `nodes` that cannot be computed from `nodes` alone: the
 * pull on each node is the weight of the edges touching it, and the weights are
 * on the OTHER table. `weight` names the edge column to sum, so the same
 * analysis can be pointed at a column an earlier act derived.
 */
function pullAnalysis(opts: { id: string; weight: string; reads?: readonly string[] }): AnalysisModule<readonly Row[], ColumnsOutput> {
  return defineAnalysis<readonly Row[], ColumnsOutput>({
    id: opts.id,
    kind: 'transform',
    produces: 'columns',
    inputs: [{ column: 'id', role: 'group' }],
    reads: opts.reads ?? ['edges'],
    build: () =>
      flowChart<Record<string, unknown>>(
        'load the node ids and the edges',
        (scope) => {
          const args = scope.$getArgs<{ ids: string[]; ties: { s: string; t: string; w: number }[] }>();
          scope.$setValue('nodeIds', args.ids);
          scope.$setValue('edgeTies', args.ties); // a committed key is never an input key — footprintjs guards those as readonly
        },
        'load',
      )
        .addFunction(
          'sum the weight of the edges touching each node',
          (scope) => {
            const ids = scope.$getValue('nodeIds') as string[];
            const ties = scope.$getValue('edgeTies') as { s: string; t: string; w: number }[];
            scope.$setValue('pull', ids.map((id) => ties.filter((e) => e.s === id || e.t === id).reduce((sum, e) => sum + e.w, 0)));
          },
          'sum',
        )
        .build(),
    toRunInput: (rows, related) => ({
      ids: rows.map((r) => String(r['id'])),
      ties: (related['edges'] ?? []).map((e) => ({ s: String(e['source']), t: String(e['target']), w: Number(e[opts.weight] ?? 0) })),
    }),
    readOutput: () => ({ ok: true, output: { as: 'columns', table: 'nodes', columns: { pull: { type: 'int' } } } }),
  });
}

const netWith = (extra: Partial<DashboardDef>): DashboardDef => makeNetworkDef(undefined, extra);
const joined = (analyses: DashboardDef['analyses']): DashboardDef => netWith({ relations: RELATIONS, analyses });
const sessionOn = (def: DashboardDef) => buildDashboard(def).createSession();

/** The `pull` column as it now stands, in node order. */
async function pullOn(s: ReturnType<typeof sessionOn>): Promise<unknown[]> {
  const res = await s.viewQuery({ columns: ['id', 'pull'], limit: 20 });
  return res.ok ? res.rows.map((r) => r['pull']) : [`REJECTED: ${res.rejected}`];
}

/** Reached the way `derivedColumns.session.test.ts` reaches it — there is no provider-injection seam. */
const providerOf = (s: unknown, table: string): DataProvider =>
  (s as { runtime: { providerFor(t: string): DataProvider } }).runtime.providerFor(table);

// ─────────────────────────────────────────────────────────────────────────────

describe('an analysis reads the table its relation names', () => {
  it('the related rows arrive, and the column is one the own table could not have produced', async () => {
    const s = sessionOn(joined({ pull: pullAnalysis({ id: 'pull', weight: 'weight' }) }));
    const out = await s.declareAnalysis('pull');
    expect(out.materialized).toEqual(['pull']);
    expect(out.gap).toBeUndefined();
    // flu—cold is 5, cold—strep is 1: flu 5, cold 6, strep 1.
    expect(await pullOn(s)).toEqual([5, 6, 1]);
  });

  it('a column an earlier act derived on the related table is visible, under its logical name', async () => {
    const s = sessionOn(joined({
      doubled: { builtin: 'formula', expression: 'weight * 2', name: 'weight2', table: 'edges' },
      pull: pullAnalysis({ id: 'pull', weight: 'weight2' }),
    }));
    const first = await s.declareAnalysis('doubled', { table: 'edges' });
    expect(first.materialized).toEqual(['weight2']);
    const out = await s.declareAnalysis('pull');
    expect(out.materialized).toEqual(['pull']);
    expect(await pullOn(s)).toEqual([10, 12, 2]); // the doubled weights, not the raw ones
  });

  it('the related table is read under ITS OWN clauses, so a brush on it changes the answer', async () => {
    const s = sessionOn(joined({ pull: pullAnalysis({ id: 'pull', weight: 'weight' }) }));
    await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'weight', value: 5, cause });
    await s.declareAnalysis('pull');
    expect(await pullOn(s)).toEqual([5, 5, 0]); // only flu—cold survives the brush; strep is touched by nothing
  });
});

describe('a caller that brings its own rows still reads the tables the def declared', () => {
  // WHY: `reads` is a promise about the ACT, not about where the own rows came
  // from. A caller that hands in its own node rows has not said the edges do
  // not exist — and an analysis handed `{}` for a table it declared would lay
  // out an edgeless graph and report success.
  it('the related rows arrive on the caller-supplied-input path too', async () => {
    const s = sessionOn(joined({ pull: pullAnalysis({ id: 'pull', weight: 'weight' }) }));
    const rows = await s.viewQuery({ columns: ['id'], limit: 20 });
    const input = rows.ok ? rows.rows : [];
    const out = await s.declareAnalysis('pull', { input });
    expect(out.gap).toBeUndefined();
    expect(out.materialized).toEqual(['pull']);
    expect(await pullOn(s)).toEqual([5, 6, 1]); // the same answer, not three zeroes
  });

  it('a backend that refuses a related table stops the act, even when the rows were brought in', async () => {
    const s = sessionOn(joined({ pull: pullAnalysis({ id: 'pull', weight: 'weight' }) }));
    providerOf(s, 'edges').evaluate = async () => reject('memory', 'evaluate', 'no-backend-connection', 'the edge store is offline');
    const out = await s.declareAnalysis('pull', { input: [{ id: 'flu' }] });
    expect(out.commit).toBeUndefined();
    expect(out.gap).toMatchObject({ code: 'needs-backend-data', op: 'declareAnalysis', target: 'pull' });
    expect(out.gap!.detail).toBe('related table "edges": the edge store is offline');
    expect(s.log.records).toHaveLength(0);
  });
});

describe('the relation is the permission', () => {
  it('a table no declared relation joins is refused in a sentence, and nothing lands', async () => {
    const s = sessionOn(netWith({ analyses: { pull: pullAnalysis({ id: 'pull', weight: 'weight' }) } })); // no relations declared
    const out = await s.declareAnalysis('pull');
    expect(out.commit).toBeUndefined();
    expect(out.materialized).toBeUndefined();
    expect(out.gap).toMatchObject({ code: 'guard-failed', op: 'declareAnalysis', target: 'pull' });
    expect(out.gap!.detail).toBe('analysis "pull" reads table "edges", which no declared relation joins to "nodes" — declare the relation first');
    expect(s.log.records).toHaveLength(0);
    expect((await s.overview()).columns['nodes']!.map((c) => c.field)).not.toContain('pull');
  });

  it('a table the dashboard does not declare is refused by name, with the tables that ARE declared', async () => {
    const s = sessionOn(joined({ pull: pullAnalysis({ id: 'pull', weight: 'weight', reads: ['ghost'] }) }));
    const out = await s.declareAnalysis('pull');
    expect(out.gap!.detail).toBe('analysis "pull" reads table "ghost", which is not a declared data table — the tables are nodes, edges');
    expect(s.log.records).toHaveLength(0);
  });

  it('a backend that refuses the related table stops the act — half an input is not an input', async () => {
    const s = sessionOn(joined({ pull: pullAnalysis({ id: 'pull', weight: 'weight' }) }));
    providerOf(s, 'edges').evaluate = async () => reject('memory', 'evaluate', 'no-backend-connection', 'the edge store is offline');
    const out = await s.declareAnalysis('pull');
    expect(out.commit).toBeUndefined();
    expect(out.gap).toMatchObject({ code: 'needs-backend-data', op: 'declareAnalysis', target: 'pull' });
    expect(out.gap!.detail).toBe('related table "edges": the edge store is offline');
    expect(s.log.records).toHaveLength(0);
  });
});

describe('replay reads the related table the same way', () => {
  it('a session that declares the same analysis rebuilds the same numbers from the log', async () => {
    const def = joined({ pull: pullAnalysis({ id: 'pull', weight: 'weight' }) });
    const source = sessionOn(def);
    await source.declareAnalysis('pull');
    expect(await pullOn(source)).toEqual([5, 6, 1]);

    const fresh = sessionOn(def);
    const res = await fresh.replay(JSON.stringify(source.log.records));
    expect(res).toMatchObject({ ok: true, landed: 1, reran: 1, filed: 0 });
    expect(await pullOn(fresh)).toEqual([5, 6, 1]);
  });

  it('a brush that shaped the related table is replayed with it — the same rows, the same column', async () => {
    const def = joined({ pull: pullAnalysis({ id: 'pull', weight: 'weight' }) });
    const source = sessionOn(def);
    await source.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'weight', value: 5, cause });
    await source.declareAnalysis('pull');

    const fresh = sessionOn(def);
    const res = await fresh.replay(JSON.stringify(source.log.records));
    expect(res).toMatchObject({ ok: true, landed: 2, reran: 1 });
    expect(await pullOn(fresh)).toEqual([5, 5, 0]);
  });
});

describe('why() names the selection that shaped the related table', () => {
  it('the brush on the other table is an input-selection of the column, and an unrelated brush is not', async () => {
    const s = sessionOn(joined({ pull: pullAnalysis({ id: 'pull', weight: 'weight' }) }));
    const brush = await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'weight', value: 5, cause });
    const onNodes = await s.dispatch({ verb: 'select', viewId: layerAddress('net', 'nodes'), field: 'group', value: 'viral', cause });
    await s.declareAnalysis('pull');

    const why = s.why({ kind: 'column', column: 'pull' });
    expect(why.ok).toBe(true);
    if (!why.ok) return;
    const selections = why.commits.filter((c) => c.kind === 'input-selection').map((c) => c.id);
    expect(selections).toEqual([brush.ok ? brush.commit!.id : '']); // the edges brush, and only it
    expect(selections).not.toContain(onNodes.ok ? onNodes.commit!.id : ''); // the own table was read WHOLE
  });

  it('a one-table analysis still records no input selection at all', async () => {
    const s = sessionOn(joined({
      doubled: { builtin: 'formula', expression: 'weight * 2', name: 'weight2', table: 'edges' },
    }));
    await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'weight', value: 5, cause });
    await s.declareAnalysis('doubled', { table: 'edges' });
    const why = s.why({ kind: 'column', column: 'weight2' });
    expect(why.ok).toBe(true);
    if (why.ok) expect(why.commits.filter((c) => c.kind === 'input-selection')).toEqual([]);
  });
});
