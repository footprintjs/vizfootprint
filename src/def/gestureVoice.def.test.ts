/**
 * A BAND IS A RANGE TOO (law 13) — the DEF DOOR's half: a def that says a view
 * emits an `interval` when the mark for that view draws no interval brush on
 * the scale kind its own x is DECLARED to have is refused by name, at the
 * `capabilities[]` key an author fixes.
 *
 * THE MEASURED DEFECT this law came from: the protein desk's biggest chart
 * declared `{ viewId, canProbe: true, encodings: ['interval'] }`, its x was a
 * band (two chains share one residue-number axis, so a slot holds a residue of
 * each), and the chart drew no brush at all — no brush element of any kind in
 * the DOM, and 185 dots before a drag and 185 after. The page promised a drag,
 * a caption told the reader to drag, and nothing happened.
 *
 * WHAT THIS DOOR CAN AND CANNOT KNOW is the whole design of this suite, and
 * the third describe below is the half it cannot: a field is a band because of
 * its DATA, and a declared table's types are the PROVIDER's — so where the def
 * types nothing the door declines (law 11b's own discipline: refused on
 * evidence, never on ignorance) and the CHART is what delivers the gesture.
 */
import { describe, it, expect } from 'vitest';
import { buildDashboard, validateDashboardDef, drawsIntervalBrush, intervalGestureRefusal } from './index.js';
import type { DashboardDef } from './index.js';

const ROWS = [
  { residue: 'A12', phi: -60, psi: -45 },
  { residue: 'A13', phi: -70, psi: -40 },
];

/** A one-view def, its capability and its mark to taste; `columns` is the evidence this door judges on. */
function surfaceDef(over: {
  readonly chartKind: string;
  readonly initial: Readonly<Record<string, string>>;
  readonly encodings?: readonly string[];
  readonly canProbe?: boolean;
  readonly columns?: Readonly<Record<string, { readonly type: string }>>;
  readonly layers?: readonly unknown[];
}): DashboardDef {
  return {
    meta: { title: 'surface' },
    data: { prot: { rows: ROWS, ...(over.columns === undefined ? {} : { columns: over.columns }) } },
    actors: { surface: { actor: 'user', label: 'The surface' } },
    capabilities: [{ viewId: 'surface', canProbe: over.canProbe ?? true, ...(over.encodings === undefined ? {} : { encodings: over.encodings }) }],
    encodings: [{
      viewId: 'surface',
      chartKind: over.chartKind,
      channels: Object.keys(over.initial),
      initial: over.initial,
      ...(over.layers === undefined ? {} : { layers: over.layers }),
    }],
    defaultTable: 'prot',
  } as unknown as DashboardDef;
}

/** The types the protein desk's own table declares: the residue axis is a STRING, so its x is a band. */
const TYPED = { residue: { type: 'string' }, phi: { type: 'number' }, psi: { type: 'number' } } as const;

describe('law 13 — the def door refuses a declared interval a mark will not draw', () => {
  it('THE MEASURED DEFECT, refused at the door: a LINE whose declared x is a category column', () => {
    const problems = validateDashboardDef(surfaceDef({ chartKind: 'line', initial: { x: 'residue', y: 'phi' }, encodings: ['interval'], columns: TYPED }));
    expect(problems).toEqual([
      'capabilities[0].encodings: view "surface" declares it emits an interval, but its x is the category column "residue" — a band has no between for an interval, so a drag across a line\'s slots is a RUN of them; declare encodings: ["match"], or bind x to a date or a number',
    ]);
    // …and the build door throws on the same sentence, so a lying def never reaches a session
    expect(() => buildDashboard(surfaceDef({ chartKind: 'line', initial: { x: 'residue', y: 'phi' }, encodings: ['interval'], columns: TYPED }))).toThrow(/declare encodings: \["match"\]/);
  });

  it('declaring the MATCH it actually lands is accepted — the repair the sentence names', () => {
    expect(validateDashboardDef(surfaceDef({ chartKind: 'line', initial: { x: 'residue', y: 'phi' }, encodings: ['match'], columns: TYPED }))).toEqual([]);
    // and so is the same line over a NUMBER x, which is a run and does brush an interval
    expect(validateDashboardDef(surfaceDef({ chartKind: 'line', initial: { x: 'phi', y: 'psi' }, encodings: ['interval'], columns: TYPED }))).toEqual([]);
  });

  it('the SECOND arm: a mark that draws no interval brush AT ALL is told to drop the key, not to declare another', () => {
    // a TABLE: its gesture is a row click, and nothing about its x is refused by the channel-requirements
    // door — so this is the arm said on its own, with no other law firing beside it
    expect(validateDashboardDef(surfaceDef({ chartKind: 'table', initial: { x: 'phi', y: 'psi' }, encodings: ['interval'], columns: TYPED }))).toEqual([
      'capabilities[0].encodings: view "surface" declares it emits an interval, but a table draws no interval brush at all — declare the kinds its own gestures emit, or drop "interval"',
    ]);
  });

  it('a SCATTER on a band is refused too, and a histogram\'s bins folded as categories with it', () => {
    // these two are ALSO refused by the channel-requirements door (a point's x and a histogram's bins
    // need a number or a date), which is why the law-13 sentence is asserted among the problems rather
    // than as the only one — the LINE is the mark whose x may legitimately be a category, and it is the
    // one this law exists for
    for (const chartKind of ['point', 'scatter', 'histogram'] as const) {
      const problems = validateDashboardDef(surfaceDef({ chartKind, initial: { x: 'residue', y: 'phi' }, encodings: ['interval'], columns: TYPED }));
      expect(problems).toContain(`capabilities[0].encodings: view "surface" declares it emits an interval, but its x is the category column "residue" — a band has no between for an interval, so a drag across a ${chartKind}'s slots is a RUN of them; declare encodings: ["match"], or bind x to a date or a number`);
    }
  });

  it('it is judged per LAYER too — the frame\'s capability is the layers\' capability, so the refusal names the layer', () => {
    const problems = validateDashboardDef(surfaceDef({
      chartKind: 'line',
      initial: { y: 'phi' },
      encodings: ['interval'],
      columns: TYPED,
      layers: [{ layerId: 'band', table: 'prot', chartKind: 'line', channels: ['x', 'y'], initial: { x: 'residue', y: 'phi' } }],
    }));
    expect(problems).toEqual([
      'capabilities[0].encodings: layer "band" declares it emits an interval, but its x is the category column "residue" — a band has no between for an interval, so a drag across a line\'s slots is a RUN of them; declare encodings: ["match"], or bind x to a date or a number',
    ]);
  });
});

describe('law 13 — what the def door is NOT asked, and why', () => {
  it('a view that declares NO capability is not judged: nothing was claimed in these words (the assumed voice)', () => {
    expect(validateDashboardDef({
      meta: { title: 'surface' },
      data: { prot: { rows: ROWS, columns: TYPED } },
      actors: { surface: { actor: 'user', label: 'The surface' } },
      encodings: [{ viewId: 'surface', chartKind: 'line', channels: ['x', 'y'], initial: { x: 'residue', y: 'phi' } }],
      defaultTable: 'prot',
    } as unknown as DashboardDef)).toEqual([]);
  });

  it('a view that cannot be probed is not judged: it emits nothing, so its `encodings` name no gesture', () => {
    expect(validateDashboardDef(surfaceDef({ chartKind: 'line', initial: { x: 'residue', y: 'phi' }, encodings: ['interval'], canProbe: false, columns: TYPED }))).toEqual([]);
  });

  it('a capability that declares kinds WITHOUT the interval is byte-identical everywhere — no new sentence, no new key', () => {
    for (const encodings of [['point'], ['match'], ['point', 'cell'], []]) {
      expect(validateDashboardDef(surfaceDef({ chartKind: 'line', initial: { x: 'residue', y: 'phi' }, encodings, columns: TYPED }))).toEqual([]);
    }
  });

  it('a mark that binds NOTHING to x carries no column, so there is no scale kind to judge', () => {
    expect(validateDashboardDef(surfaceDef({ chartKind: 'line', initial: { y: 'phi' }, encodings: ['interval'], columns: TYPED }))).toEqual([]);
  });

  it('THE ONE THING THIS DOOR CANNOT KNOW: whether the x column is a band, where the def types nothing', () => {
    // the SAME def, the same band in the data — but with no declared column types the provider owns them,
    // so the door declines and the CHART is where the reader meets the answer: `VizLine`'s band brush
    // delivers the match, and the session's probe guard is what says a def declaring only `interval`
    // cannot hold it ("view \"surface\" does not encode a match selection")
    expect(validateDashboardDef(surfaceDef({ chartKind: 'line', initial: { x: 'residue', y: 'phi' }, encodings: ['interval'] }))).toEqual([]);
    // an explicitly UNKNOWN-typed column is the same ignorance, said out loud
    expect(validateDashboardDef(surfaceDef({ chartKind: 'line', initial: { x: 'residue', y: 'phi' }, encodings: ['interval'], columns: { residue: { type: 'unknown' } } }))).toEqual([]);
  });

  it('…and the reader still gets a SENTENCE rather than silence: the match the chart lands meets the declared voice', async () => {
    // the def the door had to accept (no declared column types), the chart delivering the gesture it
    // can — a `match` over the slots the drag crossed — and the session's probe guard saying, in words,
    // that this view's own declaration cannot hold it. Either the gesture or a sentence, never silence.
    const session = buildDashboard(surfaceDef({ chartKind: 'line', initial: { x: 'residue', y: 'phi' }, encodings: ['interval'] })).createSession();
    const res = await session.dispatch({
      verb: 'select',
      viewId: 'surface',
      field: 'residue',
      values: ['A12', 'A13'],
      cause: { requestedBy: 'user', computedBy: 'user', intent: 'drag across two slots' },
    });
    expect(res.ok).toBe(false);
    expect(res.ok ? undefined : res.rejection).toMatchObject({ code: 'guard-failed', detail: 'view "surface" does not encode a match selection' });
  });
});

describe('law 13 — the ONE predicate and the ONE sentence both twins ask', () => {
  it('drawsIntervalBrush: the three marks that brush, on every scale kind but a band', () => {
    for (const kind of ['scatter', 'point', 'line', 'histogram']) {
      expect(drawsIntervalBrush(kind, 'quantitative')).toBe(true);
      expect(drawsIntervalBrush(kind, 'temporal')).toBe(true);
      expect(drawsIntervalBrush(kind, 'categorical')).toBe(false);
    }
    for (const kind of ['bar', 'boxplot', 'heatmap', 'map', 'table', 'network']) {
      expect(drawsIntervalBrush(kind, 'quantitative')).toBe(false);
      expect(drawsIntervalBrush(kind, 'categorical')).toBe(false);
    }
    // a hand-written def's `__proto__` answers NO, it does not reach Object.prototype
    expect(drawsIntervalBrush('__proto__', 'quantitative')).toBe(false);
  });

  it('intervalGestureRefusal: the two arms, verbatim, with no address in front of them (the renderer\'s form)', () => {
    expect(intervalGestureRefusal('layer "a"', 'histogram', 'categorical', 'shelf')).toBe(
      'layer "a" declares it emits an interval, but its x is the category column "shelf" — a band has no between for an interval, so a drag across a histogram\'s slots is a RUN of them; declare encodings: ["match"], or bind x to a date or a number',
    );
    expect(intervalGestureRefusal('view "v"', 'bar', 'quantitative', 'price')).toBe(
      'view "v" declares it emits an interval, but a bar draws no interval brush at all — declare the kinds its own gestures emit, or drop "interval"',
    );
  });
});
