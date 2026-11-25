/**
 * THE KERNEL SLICE SAYS WHERE ITS PROOF STOPS.
 *
 * `why()` used to keep the commit ids of the record reader's slice and drop
 * everything the reader said it could not establish: a slice cut by its budget,
 * a commit fed by an untracked input, a value from before the run. Each came
 * back as a clean list of commits. These tests hold the answer to carrying all
 * of it, and to never calling such a chain complete.
 */
import { describe, expect, it } from 'vitest';
import { keysReadFromExecutionTree, sliceForKey, sliceToJSON } from 'foottrace';
import { CauseSelectionSession } from '../log/index.js';
import { why } from './index.js';
import { runKernel } from './kernel.fixture.js';
import { resolveKernelTier, sliceIsComplete, sliceLimits } from './resolvers.js';

/** A viz log holding one brush commit. */
function oneCommit(id: string) {
  const viz = new CauseSelectionSession();
  viz.commit({ id, parent: null, viewId: 'B', actorMeta: { actor: 'user', label: 'Amount brush' }, kind: 'interval', field: 'amount', value: [10, 20], cause: { requestedBy: 'user', computedBy: 'user' } });
  return viz.records;
}

const NONE = { truncated: null, readsKind: 'execution-tree', readsCoverage: { steps: 2, stepsWithReads: 1 }, untracked: [], preRun: [], uncertainEdges: 0, notes: [] };
const clean = { keysReadKind: 'execution-tree', readsCoverage: { steps: 2, stepsWithReads: 1 }, nodes: { 'a#0': {}, 'b#1': {} }, edges: [{}] };

describe('sliceLimits — everything the reader reported, nothing inferred', () => {
  it('a slice with nothing to report has no limits and is complete', () => {
    expect(sliceLimits(clean)).toEqual(NONE);
    expect(sliceIsComplete(sliceLimits(clean))).toBe(true);
  });

  it.each([
    ['a budget cut by nodes', { truncated: { byDepth: false, byNodes: true } }, { truncated: { byDepth: false, byNodes: true } }],
    ['a budget cut by depth', { truncated: { byDepth: true, byNodes: false } }, { truncated: { byDepth: true, byNodes: false } }],
    ['an untracked input', { nodes: { 'a#0': { incompleteSources: ['args', 'env'] }, 'b#1': { incompleteSources: [] } } }, { untracked: [{ commitId: 'a#0', sources: ['args', 'env'] }] }],
    [
      'values from before the run, by any of the three routes, each key once',
      { nodes: { 'a#0': { preRunReads: { keys: ['x'] }, preRunBase: { keys: ['x', 'y'] } }, 'b#1': { preRunView: { keys: ['z'] } } } },
      { preRun: [{ commitId: 'a#0', keys: ['x', 'y'] }, { commitId: 'b#1', keys: ['z'] }] },
    ],
    ['a possible edge', { edges: [{}, { overlap: 'some' }, { overlap: { kind: 'partial' } }] }, { uncertainEdges: 2 }],
    ['a note', { notes: [{ code: 'redacted', detail: 'a value was redacted', extra: 1 }] }, { notes: [{ code: 'redacted', detail: 'a value was redacted' }] }],
    ['reads nobody counted', { readsCoverage: undefined, keysReadKind: 'custom-fn' }, { readsCoverage: null, readsKind: 'custom-fn' }],
  ])('%s is carried, and the chain is not called complete', (_case, reported, expected) => {
    const limits = sliceLimits({ ...clean, ...reported } as Parameters<typeof sliceLimits>[0]);
    expect(limits).toEqual({ ...NONE, ...expected });
    expect(sliceIsComplete(limits)).toBe(false);
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
    expect(sliceIsComplete(sliceLimits(cut))).toBe(false);
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
    expect(answer.flags.kernelSliceComplete).toBe(false);
  });

  it('with no kernel slice there is nothing to call complete', async () => {
    const records = oneCommit('viz-q2');
    const answer = why({ kind: 'column', column: 'rowCount' }, { vizRecords: records, declaringCommitId: records[0]!.id, inputSelectionCommitIds: [] });
    if (!answer.ok) throw new Error('expected an answer');
    expect(answer.kernel).toBeNull();
    expect(answer.flags.kernelSliceComplete).toBe(false);
  });
});
