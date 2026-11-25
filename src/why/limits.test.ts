/**
 * THE KERNEL SLICE SAYS WHERE ITS PROOF STOPS.
 *
 * `why()` used to keep the commit ids of the record reader's slice and drop
 * everything the reader said it could not establish: a slice cut by its budget,
 * a commit fed by an untracked input, a value from before the run. Each came
 * back as a clean list of commits. These tests hold the answer to carrying all
 * of it, and to reporting that a limit exists.
 */
import { describe, expect, it } from 'vitest';
import { FlowChartExecutor } from 'footprintjs';
import { keysReadFromExecutionTree, sliceForKey, sliceToJSON, type SliceJSON } from 'foottrace';
import { CauseSelectionSession } from '../log/index.js';
import { why } from './index.js';
import { buildKernelChart, runKernel } from './kernel.fixture.js';
import { resolveKernelTier, sliceHasLimits, sliceLimits } from './resolvers.js';

/** A viz log holding one brush commit. */
function oneCommit(id: string) {
  const viz = new CauseSelectionSession();
  viz.commit({ id, parent: null, viewId: 'B', actorMeta: { actor: 'user', label: 'Amount brush' }, kind: 'interval', field: 'amount', value: [10, 20], cause: { requestedBy: 'user', computedBy: 'user' } });
  return viz.records;
}

const NONE = { truncated: null, readsKind: 'execution-tree', readsCoverage: { steps: 2, stepsWithReads: 1 }, untracked: [], preRun: [], uncertainEdges: 0, notes: [] };
const clean = { keysReadKind: 'execution-tree', readsCoverage: { steps: 2, stepsWithReads: 1 }, nodes: { 'a#0': {}, 'b#1': {} }, edges: [{}] };

describe('sliceLimits — everything the reader reported, nothing inferred', () => {
  it('a slice with nothing to report has no limits', () => {
    expect(sliceLimits(clean)).toEqual(NONE);
    expect(sliceHasLimits(sliceLimits(clean))).toBe(false);
  });

  it.each([
    ['a budget cut by nodes', { truncated: { byDepth: false, byNodes: true } }, { truncated: { byDepth: false, byNodes: true } }],
    ['a budget cut by depth', { truncated: { byDepth: true, byNodes: false } }, { truncated: { byDepth: true, byNodes: false } }],
    ['an untracked input', { nodes: { 'a#0': { incompleteSources: ['args', 'env'] }, 'b#1': { incompleteSources: [] } } }, { untracked: [{ commitId: 'a#0', sources: ['args', 'env'] }] }],
    [
      'values from before the run, by any of the three routes, each key once',
      { nodes: { 'a#0': { preRunReads: { keys: ['x', 'w'] }, preRunBase: { keys: ['x', 'y'] } }, 'b#1': { preRunView: { keys: ['z'] } } } },
      { preRun: [{ commitId: 'a#0', keys: ['x', 'w', 'y'] }, { commitId: 'b#1', keys: ['z'] }] },
    ],
    ['a possible edge', { edges: [{}, { overlap: 'some' }, { overlap: { kind: 'partial' } }] }, { uncertainEdges: 2 }],
    ['an edge resting on nested rows', { edges: [{}, { basis: 'nested-rows' }, { builtOn: 'partial-write' }] }, { uncertainEdges: 1 }],
    ['no step with a recorded read', { readsCoverage: { steps: 3, stepsWithReads: 0 } }, { readsCoverage: { steps: 3, stepsWithReads: 0 } }],
    // one step is where the reader prints no warning of its own, and a read from before the run vanishes with tracking off
    ['a single step with no recorded read', { readsCoverage: { steps: 1, stepsWithReads: 0 } }, { readsCoverage: { steps: 1, stepsWithReads: 0 } }],
    ['a note', { notes: [{ code: 'redacted', detail: 'a value was redacted', extra: 1 }] }, { notes: [{ code: 'redacted', detail: 'a value was redacted' }] }],
    ['reads nobody counted', { readsCoverage: undefined, keysReadKind: 'custom-fn' }, { readsCoverage: null, readsKind: 'custom-fn' }],
  ])('%s is carried, and counts as a reported limit', (_case, reported, expected) => {
    const limits = sliceLimits({ ...clean, ...reported } as Parameters<typeof sliceLimits>[0]);
    expect(limits).toEqual({ ...NONE, ...expected });
    expect(sliceHasLimits(limits)).toBe(true);
  });

  it('a slice with no nodes and no edges at all still answers, with empty lists', () => {
    expect(sliceLimits({ keysReadKind: 'execution-tree' })).toEqual({ ...NONE, readsCoverage: null });
  });

  it('agrees with the reader on a slice the reader really cut', async () => {
    const { snapshot } = await runKernel({ correlationId: 'cut', field: 'amount', range: [10, 20] });
    const reads = keysReadFromExecutionTree(snapshot.executionTree);
    const cut = sliceToJSON(sliceForKey(snapshot.commitLog, 'rowCount', reads, { maxNodes: 1 }));
    expect(Object.keys(cut.nodes ?? {})).toEqual(['count#3']);
    expect(sliceLimits(cut).truncated).toEqual({ byDepth: false, byNodes: true });
    expect(sliceHasLimits(sliceLimits(cut))).toBe(true);
  });
});

describe('a run whose reads were not recorded', () => {
  it('is never reported as a chain with no limits', async () => {
    const chart = buildKernelChart();
    const tracked = new FlowChartExecutor(chart);
    await tracked.run({ input: { correlationId: 'q', field: 'amount', range: [10, 20] } });
    const blind = new FlowChartExecutor(chart);
    blind.setReadTracking('off');
    await blind.run({ input: { correlationId: 'q', field: 'amount', range: [10, 20] } });

    const seen = resolveKernelTier('rowCount', tracked.getSnapshot());
    const unseen = resolveKernelTier('rowCount', blind.getSnapshot());
    if ('miss' in seen || 'miss' in unseen) throw new Error('expected two slices');
    // with reads recorded the chain is three commits; without them the reader sees the writer alone
    expect(seen.commitIds).toHaveLength(3);
    expect(unseen.commitIds).toEqual(['count#3']);
    expect(unseen.limits.readsCoverage).toEqual({ steps: 4, stepsWithReads: 0 });
    // every caveat that depends on reads went with them, so zero coverage is the only sign left
    expect(unseen.limits.untracked).toEqual([]);
    expect(sliceHasLimits(unseen.limits)).toBe(true);
  });
});

describe('the reader\u2019s slice shape is the one the limits were written against', () => {
  it('fails to compile when the reader adds, renames or removes a field', () => {
    // `sliceLimits` reads the reader's JSON through a structural type, so a new honesty field
    // would be ignored without an error. These three lists are every key of the installed
    // reader's slice, node and edge. A reader that changes one stops this file compiling, and
    // whoever updates the list decides whether the new field is a limit.
    type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
    type Node = NonNullable<SliceJSON['nodes']>[string];
    type Edge = NonNullable<SliceJSON['edges']>[number];
    const root: Same<keyof SliceJSON, 'key' | 'before' | 'missing' | 'keysReadKind' | 'readsCoverage' | 'writerId' | 'nodes' | 'edges' | 'truncated' | 'notes'> = true;
    const node: Same<keyof Node, 'stageId' | 'stageName' | 'keysWritten' | 'depth' | 'incompleteSources' | 'preRunReads' | 'preRunBase' | 'preRunView'> = true;
    const edge: Same<keyof Edge, 'from' | 'to' | 'kind' | 'key' | 'weight' | 'basis' | 'overlap' | 'builtOn'> = true;
    // …and the two objects `sliceLimits` copies field by field
    const cut: Same<keyof NonNullable<SliceJSON['truncated']>, 'byDepth' | 'byNodes'> = true;
    const coverage: Same<keyof NonNullable<SliceJSON['readsCoverage']>, 'steps' | 'stepsWithReads'> = true;
    expect([root, node, edge, cut, coverage]).toEqual([true, true, true, true, true]);
  });
});

describe('why() — the answer carries the limits', () => {
  it('a kernel run that read its input from args says so, and is not complete', async () => {
    const { snapshot } = await runKernel({ correlationId: 'q1', field: 'amount', range: [10, 20] });
    const resolved = resolveKernelTier('rowCount', snapshot);
    if ('miss' in resolved) throw new Error('expected a slice');
    // the fixture's first stage reads the correlation id, the field and the range from the run's
    // args: the chain ends there, and what came in through the args is not in it
    expect(resolved.limits).toEqual({
      truncated: null,
      readsKind: 'execution-tree',
      readsCoverage: { steps: 4, stepsWithReads: 3 },
      untracked: [{ commitId: 'load#0', sources: ['args'] }],
      preRun: [],
      uncertainEdges: 0,
      notes: [],
    });

    const records = oneCommit('viz-q1');
    const answer = why({ kind: 'column', column: 'rowCount' }, { vizRecords: records, declaringCommitId: records[0]!.id, inputSelectionCommitIds: [], kernelSnapshot: snapshot, kernelKey: 'rowCount' });
    if (!answer.ok) throw new Error('expected an answer');
    expect(answer.kernel!.limits).toEqual(resolved.limits);
    expect(answer.flags.kernelLimitsReported).toBe(true);
  });

  it('with no kernel slice there is nothing to call complete', async () => {
    const records = oneCommit('viz-q2');
    const answer = why({ kind: 'column', column: 'rowCount' }, { vizRecords: records, declaringCommitId: records[0]!.id, inputSelectionCommitIds: [] });
    if (!answer.ok) throw new Error('expected an answer');
    expect(answer.kernel).toBeNull();
    // no slice, so no limit of one; the miss itself is in `misses`
    expect(answer.flags.kernelLimitsReported).toBe(false);
    expect(answer.misses).toContainEqual({ tier: 'kernel', missing: 'no-kernel-snapshot' });
  });
});
