import { describe, expect, it } from 'vitest';
import { buildDashboardAsync, layerAddress, type DashboardDef } from '../def/index.js';
import { createFieldNamespace, duckdbConnection, quoteIdent, resolvePredicateSQL } from './index.js';

const datasetRef = 'snapshot:"one"/雪';
const clients = createFieldNamespace({ datasetRef, table: 'clients', fields: ['p95_us'] });
const nodes = createFieldNamespace({ datasetRef, table: 'nodes', fields: ['p95_us'] });
const clientMetric = clients.field('p95_us').nativeField;
const nodeMetric = nodes.field('p95_us').nativeField;
const source = layerAddress('clientView', 'clients');
const target = layerAddress('nodeView', 'nodes');
const cause = { requestedBy: 'user', computedBy: 'user', intent: 'select client latency' } as const;

function definition(engine: 'memory' | 'wasm', related: boolean): DashboardDef {
  return {
    meta: { title: 'Qualified metrics' },
    data: {
      clients: { engine, key: 'client', rows: [{ client: 'a', node: 11, [clientMetric]: 150 }, { client: 'b', node: 12, [clientMetric]: 500 }], columns: { client: { role: 'identifier' }, node: { role: 'dimension' }, [clientMetric]: { role: 'measure' } } },
      nodes: { engine, key: 'node', rows: [{ node: 11, [nodeMetric]: 1200 }, { node: 12, [nodeMetric]: 150 }], columns: { node: { role: 'identifier' }, [nodeMetric]: { role: 'measure' } } },
    },
    actors: { clientView: { actor: 'user' }, nodeView: { actor: 'user' } },
    encodings: [
      { viewId: 'clientView', chartKind: 'point', channels: ['x', 'y'], layers: [{ layerId: 'clients', table: 'clients', chartKind: 'point', channels: ['x', 'y'], initial: { y: clientMetric } }] },
      { viewId: 'nodeView', chartKind: 'point', channels: ['x', 'y'], layers: [{ layerId: 'nodes', table: 'nodes', chartKind: 'point', channels: ['x', 'y'], initial: { y: nodeMetric } }] },
    ],
    ...(related ? { relations: [{ from: { table: 'clients', column: 'node' }, to: { table: 'nodes', column: 'node' } }] } : {}),
    defaultTable: 'clients',
  } as DashboardDef;
}

describe.each(['memory', 'wasm'] as const)('qualified native fields through the real %s session', engine => {
  it('keeps distinct fields whose source names differ only by case in the same physical table', async () => {
    const namespace = createFieldNamespace({ datasetRef: 'snapshot:case', table: 'observations', fields: ['x', 'X'] });
    const lower = namespace.field('x').nativeField;
    const upper = namespace.field('X').nativeField;
    const dashboard = await buildDashboardAsync({
      meta: { title: 'Case-distinct fields' },
      data: { observations: { engine, key: 'id', rows: [
        { id: 'a', [lower]: 1, [upper]: 10 }, { id: 'b', [lower]: 2, [upper]: 20 },
      ], columns: { id: { role: 'identifier' }, [lower]: { role: 'measure' }, [upper]: { role: 'measure' } } } },
      actors: { picker: { actor: 'user' } }, defaultTable: 'observations',
    } as DashboardDef, { openSqlConnection: duckdbConnection({ host: 'node' }) });
    try {
      const session = dashboard.createSession();
      expect((await session.dispatch({ verb: 'select', viewId: 'picker', field: lower, value: 1, cause })).ok).toBe(true);
      const lowerSelected = await session.viewQuery({ table: 'observations' });
      expect(lowerSelected.ok && lowerSelected.rows.map(row => [row['id'], row[lower], row[upper]])).toEqual([['a', 1, 10]]);
      expect((await session.dispatch({ verb: 'select', viewId: 'picker', field: upper, value: 20, cause })).ok).toBe(true);
      const upperSelected = await session.viewQuery({ table: 'observations' });
      expect(upperSelected.ok && upperSelected.rows.map(row => [row['id'], row[lower], row[upper]])).toEqual([['b', 2, 20]]);
    } finally { await dashboard.close(); }
  });

  it('filters the originating metric and semi-joins by the relation, never by the target metric sharing its original name', async () => {
    const dashboard = await buildDashboardAsync(definition(engine, true), { openSqlConnection: duckdbConnection({ host: 'node' }) });
    try {
      const session = dashboard.createSession();
      const dispatch = await session.dispatch({ verb: 'filter', viewId: source, field: clientMetric, range: [100, 200], cause });
      expect(dispatch.ok).toBe(true);
      const own = await session.viewQuery({ table: 'clients' });
      expect(own.ok && own.rows.map(row => row['client'])).toEqual(['a']);
      const linked = await session.viewQuery({ viewId: target });
      expect(linked.ok && linked.rows.map(row => [row['node'], row[nodeMetric]])).toEqual([[11, 1200]]);
      expect(session.clausesFor(target)[0]?.via?.path).toEqual([{ from: { table: 'clients', column: 'node' }, to: { table: 'nodes', column: 'node' } }]);
      expect(session.clausesFor(target)[0]?.clause).toEqual({ kind: 'match', field: 'node', values: [11] });
      const fieldSql = resolvePredicateSQL({ kind: 'interval', field: clientMetric, value: [100, 200] });
      expect(fieldSql).toContain(quoteIdent(clientMetric));
    } finally { await dashboard.close(); }
  });

  it('does not apply the other table metric when there is no declared relation, even though a plain node dimension is shared', async () => {
    const dashboard = await buildDashboardAsync(definition(engine, false), { openSqlConnection: duckdbConnection({ host: 'node' }) });
    try {
      const session = dashboard.createSession();
      expect((await session.dispatch({ verb: 'filter', viewId: source, field: clientMetric, range: [100, 200], cause })).ok).toBe(true);
      const linked = await session.viewQuery({ viewId: target });
      expect(linked.ok && linked.rows.map(row => row['node'])).toEqual([11, 12]);
      expect(linked.ok && linked.clauses[0]?.narrowed?.column).toBe(clientMetric);
      // Legacy shared dimension intent is still available through an explicitly chosen field.
      expect((await session.dispatch({ verb: 'select', viewId: source, field: 'node', value: 11, cause })).ok).toBe(true);
      const selected = await session.viewQuery({ viewId: target });
      expect(selected.ok && selected.rows.map(row => row['node'])).toEqual([11]);
    } finally { await dashboard.close(); }
  });
});
