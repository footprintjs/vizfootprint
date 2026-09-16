// @vitest-environment jsdom
/**
 * THE PROJECTION, ASKED BY ADDRESS — `bound` and `fitsOf` answer for a LAYER
 * under `viewId~layerId`, not only for a view under its id.
 *
 * WHY it matters to the desk rather than to the library: a cell that draws a
 * layer holds ONE id, the address it emits and binds at. Before the session's
 * encoding fold was keyed by address, a layered desk had to carry its layers'
 * axes as literals of its own — the exact re-derivation `./README.md` exists to
 * forbid. The verdicts follow the same rule, and a FRAME has none of its own:
 * it draws no rows, so its layers are where the answer is.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { buildDashboard, layerAddress } from 'vizfootprint/def';
import { createSessionView, sessionSource } from 'vizfootprint-ui';
import type { FitView } from 'vizfootprint-ui';
import { useDeskProjection } from './projection.js';
import type { DeskProjection } from './types.js';

afterEach(cleanup);

const NET = 'net';
const NODES = layerAddress(NET, 'nodes');
const EDGES = layerAddress(NET, 'edges');

/** A node-link: one frame, two layers, each over its OWN table — `nodes` is the default one. */
function openNetwork(): ReturnType<typeof createSessionView> {
  const dash = buildDashboard({
    meta: { title: 'a node-link' },
    data: {
      nodes: { source: { format: 'rows', via: 'inline', at: [{ id: 'flu', size: 12, group: 'viral' }] } },
      edges: { source: { format: 'rows', via: 'inline', at: [{ source: 'flu', target: 'flu', weight: 5 }] } },
    },
    actors: { net: { actor: 'user', label: 'Disease network' } },
    encodings: [
      {
        viewId: NET,
        chartKind: 'network',
        channels: ['x', 'y'],
        layers: [
          { layerId: 'nodes', table: 'nodes', chartKind: 'point', channels: ['x', 'y', 'size'], initial: { size: 'size' } },
          { layerId: 'edges', table: 'edges', chartKind: 'line', channels: ['x', 'y', 'size'], initial: { size: 'weight' } },
        ],
      },
    ],
    defaultTable: 'nodes',
  });
  return createSessionView(sessionSource(dash.createSession()), { as: 'user' });
}

/** The projection itself, out of a component body — the desk builds it with a hook, so a probe is the way in. */
async function projectionOf(): Promise<DeskProjection> {
  const view = openNetwork();
  await act(async () => {
    await view.refresh();
  });
  let desk: DeskProjection | undefined;
  function Probe(): null {
    desk = useDeskProjection({ view, state: view.getState(), readOnly: true, acts: { openAside: () => undefined, editChart: () => undefined } }).desk;
    return null;
  }
  await act(async () => {
    render(<Probe />);
  });
  return desk!;
}

describe('the projection answers at an ADDRESS', () => {
  it("`bound` reads a layer's declared axes off the fold — the fallback is never reached", async () => {
    const desk = await projectionOf();
    expect(desk.bound(NODES, 'size', 'WRONG')).toBe('size');
    expect(desk.bound(EDGES, 'size', 'WRONG')).toBe('weight');
    // the frame binds nothing of its own, so ITS bare address is where a fallback is honest
    expect(desk.bound(NET, 'x', 'fallback')).toBe('fallback');
  });

  it("`fitsOf` answers a layer's verdicts, judged against the LAYER's table; a frame has none and an unknown address has none", async () => {
    const desk = await projectionOf();
    const names = (fits: Readonly<Record<string, readonly FitView[]>> | undefined, channel: string): readonly string[] => (fits?.[channel] ?? []).map((f) => f.field);
    expect(names(desk.fitsOf(NODES), 'size')).toEqual(['size', 'id', 'group']);
    expect(names(desk.fitsOf(EDGES), 'size')).toEqual(['weight', 'source', 'target']); // the EDGES table's columns, nobody else's
    expect(desk.fitsOf(EDGES)!['size']!.find((f) => f.field === 'source')!.because).toBe('"source" is string; the size channel of a line needs a number');
    expect(desk.fitsOf(NET)).toBeUndefined(); // a frame draws no rows — its layers carry the verdicts
    expect(desk.fitsOf(layerAddress(NET, 'ghost'))).toBeUndefined();
    expect(desk.fitsOf('nobody')).toBeUndefined();
  });
});
