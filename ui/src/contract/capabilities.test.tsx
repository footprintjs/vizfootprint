// @vitest-environment jsdom
/**
 * THE CAPABILITY-HONESTY LAW, pinned (see this folder's README.md): a
 * capability flag is `true` only when the BOUND renderer actually delivers
 * that behaviour THROUGH the contract — not when the chart underneath could
 * deliver it if a host wired it by hand.
 *
 * Each test below is one half of a declaration: what the flag says, and what
 * the mount does when a host pushes the state the flag is about. They fail
 * together, which is the point — a future edit that flips a flag without
 * wiring the behaviour (or wires behaviour without flipping the flag) is
 * caught here rather than by a user who believed the claim.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent } from '@testing-library/dom';
import { act } from '@testing-library/react';
import {
  barRenderer,
  boxPlotRenderer,
  heatmapRenderer,
  histogramRenderer,
  lineRenderer,
  mapRenderer,
  scatterRenderer,
  tableRenderer,
} from './renderers.js';
import { emptySelection, selfSelectedSet } from './index.js';
import { selectedSet, inSet, markClass, useBrightPredicate, matchEmission, toggleInSetEmission, clickEmission } from '../primitives/index.js';
import {
  RENDERER_PROTOCOL_VERSION,
  type MountedRenderer,
  type Renderer,
  type RendererCallbacks,
  type RenderRow,
  type RenderSelection,
  type RenderState,
} from './types.js';

afterEach(() => {
  document.body.innerHTML = '';
});

function callbacks(): RendererCallbacks {
  return { emit: vi.fn(), hover: vi.fn(), reencodeRequest: vi.fn(), navigate: vi.fn() };
}

function mounted(renderer: Renderer, cbs: RendererCallbacks = callbacks()): { el: HTMLElement; m: MountedRenderer; cbs: RendererCallbacks } {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const m = renderer.mount(el, { protocolVersion: RENDERER_PROTOCOL_VERSION, viewId: 'v', callbacks: cbs });
  return { el, m, cbs };
}

/** A LIVE highlight clause from another view — Layer 4's "dim them, keep them" response. */
function highlightFromOther(): RenderSelection {
  return {
    clauses: new Map([
      [
        'other',
        {
          kind: 'point' as const,
          field: 'region',
          value: 'North',
          response: 'highlight' as const,
          predicate: (row: RenderRow) => row['region'] === 'North',
        },
      ],
    ]),
    resolve: 'intersect',
    selfClauseId: 'v',
  };
}

function state(rows: readonly RenderRow[], selection: RenderSelection = emptySelection('v'), encodings: Readonly<Record<string, string>> = {}): RenderState {
  return { rows, encodings, selection, hover: null, theme: {}, size: { width: 400, height: 300 } };
}

// ── canHighlight — the bar, the chart with no rows on screen to dim ───────────

describe('canHighlight is a promise about the BOUND renderer (the bar)', () => {
  const ROWS: RenderRow[] = [
    { category: 'A', count: 10, bright: 4, region: 'North' },
    { category: 'B', count: 6, bright: 0, region: 'South' },
  ];

  it('with no highlightCountField: declares FALSE — and under a live highlight clause draws neither a dim nor an overlay', () => {
    const { el, m } = mounted(barRenderer());
    expect(m.hello.capabilities.canHighlight).toBe(false);
    m.update(state(ROWS, highlightFromOther()));
    // the declaration and the behaviour agree: an aggregate chart has no rows to
    // dim, and with no host-computed share there is nothing to overlay
    expect(el.querySelectorAll('.vzf-dim')).toHaveLength(0);
    expect(el.querySelectorAll('.vzf-barhl')).toHaveLength(0);
    expect(el.querySelectorAll('rect.vzf-barrect')).toHaveLength(2);
    m.unmount();
  });

  it('with highlightCountField: declares TRUE — and draws the host-aggregated bright share as an inner bar', () => {
    const { el, m } = mounted(barRenderer({ highlightCountField: 'bright' }));
    expect(m.hello.capabilities.canHighlight).toBe(true);
    m.update(state(ROWS, highlightFromOther()));
    const overlays = el.querySelectorAll('rect.vzf-barhl');
    expect(overlays).toHaveLength(2);
    // the share is drawn to scale: 4 of a 10-max bar is shorter than its base bar
    const share = Number(overlays[0]!.getAttribute('height'));
    const base = Number(el.querySelectorAll('rect.vzf-barrect')[0]!.getAttribute('height'));
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(base);
    m.unmount();
  });

  it('a frame whose rows carry no share draws NO overlay: an absent highlight stays an absence, never a bar of zeros', () => {
    const { el, m } = mounted(barRenderer({ highlightCountField: 'bright' }));
    m.update(state([{ category: 'A', count: 10 }, { category: 'B', count: 6 }]));
    expect(el.querySelectorAll('rect.vzf-barhl')).toHaveLength(0);
    m.unmount();
  });

  it('the table declares TRUE and really dims — the other half of the same law', () => {
    const { el, m } = mounted(tableRenderer({ columns: ['id', 'region'] }));
    expect(m.hello.capabilities.canHighlight).toBe(true);
    m.update(state([{ id: 'a', region: 'North' }, { id: 'b', region: 'South' }], highlightFromOther()));
    expect(el.querySelectorAll('tr.vzf-dim')).toHaveLength(1); // the row the clause excludes, dimmed not hidden
    m.unmount();
  });
});

// ── the removed canRearrange — a visible act that reaches nothing claims nothing ──

describe('no renderer declares a rearrange capability (the flag nothing honoured)', () => {
  const factories: readonly (readonly [string, Renderer])[] = [
    ['scatter', scatterRenderer()],
    ['line', lineRenderer()],
    ['bar', barRenderer()],
    ['map', mapRenderer({ geo: { type: 'FeatureCollection', features: [] } })],
    ['table', tableRenderer({ columns: ['id'] })],
    ['histogram', histogramRenderer()],
    ['heatmap', heatmapRenderer()],
    ['boxplot', boxPlotRenderer()],
  ];

  it('the hello of all eight carries no canRearrange key at all', () => {
    for (const [name, renderer] of factories) {
      const { m } = mounted(renderer);
      expect(`${name}: ${String('canRearrange' in m.hello.capabilities)}`).toBe(`${name}: false`);
      m.unmount();
    }
  });

  it('the table still sorts, and the sort stays LOCAL: the rows reorder, and not one outbound verb is spoken', () => {
    const cbs = callbacks();
    const { el, m } = mounted(tableRenderer({ columns: ['id', 'n'] }), cbs);
    m.update(state([{ id: 'b', n: 2 }, { id: 'a', n: 1 }]));
    const idsBefore = [...el.querySelectorAll('tbody tr')].map((tr) => tr.getAttribute('aria-label'));
    // act() flushes the component's own state update: the sort lives in React
    // state, not in a host push, so nothing else would settle it
    act(() => {
      fireEvent.click(el.querySelector('th')!);
    });
    const idsAfter = [...el.querySelectorAll('tbody tr')].map((tr) => tr.getAttribute('aria-label'));
    expect(idsBefore).toEqual(['row b', 'row a']);
    expect(idsAfter).toEqual(['row a', 'row b']); // the visible reordering really happens
    // …and nothing left the renderer: no emission, no navigate. The contract
    // makes no claim about it, so nobody can believe it was recorded.
    expect(cbs.emit).not.toHaveBeenCalled();
    expect(cbs.navigate).not.toHaveBeenCalled();
    expect(cbs.reencodeRequest).not.toHaveBeenCalled();
    m.unmount();
  });
});

// ── hover — declared, deliberately unspoken, and deliberately unflagged ───────

describe('hover is the channel that records nothing (so it carries no capability)', () => {
  it('no first-party renderer speaks hover, and none claims a canHover flag', () => {
    const cbs = callbacks();
    const { el, m } = mounted(tableRenderer({ columns: ['id'] }), cbs);
    m.update(state([{ id: 'a' }]));
    fireEvent.mouseOver(el.querySelector('tbody tr')!);
    fireEvent.mouseOut(el.querySelector('tbody tr')!);
    expect(cbs.hover).not.toHaveBeenCalled();
    expect('canHover' in m.hello.capabilities).toBe(false);
    m.unmount();
  });

  it('a host may push RenderState.hover at any renderer: it is accepted and ignored, never a crash and never a claim', () => {
    const { el, m } = mounted(scatterRenderer());
    m.update({ ...state([{ id: 'a', x: 1, y: 2 }]), hover: ['a'] });
    expect(el.querySelectorAll('circle.vzf-dot')).toHaveLength(1);
    m.update({ ...state([{ id: 'a', x: 1, y: 2 }]), hover: null });
    expect(el.querySelectorAll('circle.vzf-dot')).toHaveLength(1);
    m.unmount();
  });
});

// ── the barrels — a law nobody can apply is a law nobody obeys ────────────────

describe('the SET-1 surface is reachable from the barrels', () => {
  it('selfSelectedSet ships from the contract barrel beside its three siblings', () => {
    const sel: RenderSelection = {
      clauses: new Map([['v', { kind: 'match' as const, field: 'category', value: { values: ['A', 'B'] }, predicate: () => true }]]),
      resolve: 'intersect',
      selfClauseId: 'v',
    };
    expect(selfSelectedSet(sel)).toEqual({ values: ['A', 'B'], exclude: false });
  });

  it('the chart-side SET-1 helpers ship from the primitives barrel', () => {
    const set = selectedSet(undefined, undefined);
    expect(set).toEqual({ values: [], exclude: false });
    expect(inSet('A', { values: ['A'], exclude: false })).toBe(true);
    expect(markClass('A', { values: ['A'], exclude: true })).toBe(' vzf-excluded');
    expect(typeof useBrightPredicate).toBe('function');
    expect(matchEmission('category', ['A'])).toEqual({ rawValue: { values: ['A'] }, encoding: { kind: 'match', field: 'category' } });
    expect(toggleInSetEmission('category', 'B', { values: ['A'], exclude: false })).toEqual({ rawValue: { values: ['A', 'B'] }, encoding: { kind: 'match', field: 'category' } });
    expect(clickEmission('category', 'A', { values: [], exclude: false })).toEqual({ rawValue: 'A', encoding: { kind: 'point', field: 'category' } });
  });
});
