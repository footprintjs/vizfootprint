/**
 * Layers in the link graph: a layer is its own node under its address, the
 * default rule writes no edge within a frame (a view and its layers, two
 * layers of one view), every other pair follows the rule, and a declared edge
 * may name a layer address on either end — an undeclared layer or an encoding
 * edge onto a layer is refused with the existing sentences. A graph with no
 * layers is written exactly as before.
 */
import { describe, it, expect } from 'vitest';
import { materializeLinks } from './materialize.js';
import { validateLinks } from './validate.js';
import type { LinkView } from './types.js';
import { buildDashboard, validateDashboardDef, layerAddress } from '../def/index.js';
import { layerLinkViewOf, layerLinkViewsOf } from '../def/layers.js';
import { makeNetworkDef, nodesLayer } from '../def/network.fixture.js';
import { makeDashboardDef } from '../session/dashboard.fixture.js';

const VOICE: LinkView['voice'] = ['point', 'interval', 'cell', 'match', 'encoding'];
const NET: LinkView = { viewId: 'net', voice: VOICE, channels: ['x', 'y'] };
const NODES = layerLinkViewOf('net', nodesLayer, VOICE);
const EDGES = layerLinkViewOf('net', { layerId: 'edges', table: 'edges', chartKind: 'line', channels: ['x', 'y'] }, VOICE);
const BAR: LinkView = { viewId: 'bar', voice: ['point', 'match'] };

describe('layers — nodes of the link graph', () => {
  it('a layer node speaks its view voice minus encoding, under its address', () => {
    expect(NODES).toEqual({ viewId: layerAddress('net', 'nodes'), voice: ['point', 'interval', 'cell', 'match'] });
    expect(NODES).not.toHaveProperty('channels');
  });

  it('the default rule writes no edge within a frame, and every edge across frames', () => {
    const g = materializeLinks([NET, NODES, EDGES, BAR]);
    const ids = g.edges.map((e) => e.id);
    // nothing among net, net~nodes, net~edges
    expect(ids.some((id) => id.startsWith('net') && id.includes('→net'))).toBe(false);
    // bar ↔ each of the three, in view order, source's voice minus encoding
    expect(ids.filter((id) => id.endsWith('→bar'))).toEqual(['net:point→bar', 'net:interval→bar', 'net:cell→bar', 'net:match→bar', 'net~nodes:point→bar', 'net~nodes:interval→bar', 'net~nodes:cell→bar', 'net~nodes:match→bar', 'net~edges:point→bar', 'net~edges:interval→bar', 'net~edges:cell→bar', 'net~edges:match→bar']);
    expect(ids.filter((id) => id.startsWith('bar:'))).toEqual(['bar:point→net', 'bar:point→net~nodes', 'bar:point→net~edges', 'bar:match→net', 'bar:match→net~nodes', 'bar:match→net~edges']);
    expect(g.edges.every((e) => e.origin === 'default' && e.response === 'filter')).toBe(true);
  });

  it('a declared edge between siblings routes, in place of no default; the frame stays silent otherwise', () => {
    const g = materializeLinks([NET, NODES, EDGES], [{ source: 'net~nodes', kind: 'point', target: 'net~edges', response: 'highlight' }]);
    expect(g.edges).toEqual([{ id: 'net~nodes:point→net~edges', source: 'net~nodes', kind: 'point', target: 'net~edges', response: 'highlight', origin: 'declared' }]);
  });

  it('a graph with no layers is written exactly as before (a plain viewId is its own frame)', async () => {
    const plain = [{ viewId: 'a', voice: ['point'] as const }, { viewId: 'b', voice: ['point'] as const }];
    expect(materializeLinks(plain).edges.map((e) => e.id)).toEqual(['a:point→b', 'b:point→a']);
    const o = (await buildDashboard(makeDashboardDef()).createSession().overview()).links;
    expect(o.views.map((v) => v.viewId)).toEqual(['scatter', 'bar', 'cluster', 'display']);
    expect(JSON.stringify(o)).not.toContain('~');
  });

  it('validateLinks judges a layer address as a declared node; an undeclared layer and an encoding edge onto a layer are refused', () => {
    const views = [NET, NODES, EDGES];
    const judge = (link: unknown): string[] => {
      const problems: string[] = [];
      validateLinks([link], undefined, views, problems);
      return problems;
    };
    expect(judge({ source: 'net~nodes', kind: 'point', target: 'net~edges', response: 'highlight' })).toEqual([]);
    expect(judge({ source: 'net~nodes', kind: 'point', target: 'net~ghost', response: 'filter' })).toEqual(['links[0].target "net~ghost" is not a declared view']);
    expect(judge({ source: 'net~nodes', kind: 'encoding', target: 'net', response: 'follow' })).toEqual(['links[0]: view "net~nodes" declares no encoding surface — it has no binding to follow']);
    expect(judge({ source: 'net', kind: 'encoding', target: 'net~edges', response: 'follow' })).toEqual(['links[0]: view "net~edges" declares no encoding surface — nothing to follow into']);
  });

  it('the def door accepts a declared edge naming layers on both ends, and the built graph carries it and nothing else within the frame', async () => {
    const def = makeNetworkDef(undefined, { links: [{ source: 'net~nodes', kind: 'point', target: 'net~edges', response: 'highlight' }] });
    expect(validateDashboardDef(def)).toEqual([]);
    const g = (await buildDashboard(def).createSession().overview()).links;
    expect(g.views.map((v) => v.viewId)).toEqual(['net', 'net~nodes', 'net~edges']);
    expect(g.edges.map((e) => [e.id, e.origin])).toEqual([['net~nodes:point→net~edges', 'declared']]);
    expect(validateDashboardDef(makeNetworkDef(undefined, { links: [{ source: 'net~ghost', kind: 'point', target: 'net~edges', response: 'filter' }] }))).toEqual(['links[0].source "net~ghost" is not a declared view']);
  });

  it('layerLinkViewsOf skips a malformed entry, a malformed layer, and a view the door refused by name', () => {
    const voiceOfView = (viewId: string) => (viewId === 'net' ? VOICE : undefined);
    const encodings = [
      'nope',
      { viewId: 'ghost', layers: [nodesLayer] },
      { viewId: 'net', layers: 'nope' },
      { viewId: 'net', layers: [{ layerId: 'bad' }, nodesLayer] },
    ];
    expect(layerLinkViewsOf(encodings, voiceOfView)).toEqual([NODES]);
  });
});
