/**
 * R5 (SPEC.md §3) strengthened: "interval commits carry DATA-space values …
 * replay rebuilds identical predicate SQL in a fresh selection." The spike
 * proved determinism of a SINGLE authored value under replay
 * (log.test.ts "replay is deterministic"); this file strengthens that into
 * the claim SPEC.md §3 itself flags as unproven — "Viewport/library
 * independence is asserted via SQL determinism, not yet across two
 * rendering libraries" — by proving the DATA-space-in half explicitly:
 * commit the SAME logical selection as resolved by two DIFFERENT simulated
 * "viewports" (pixel<->data scales), then replay into a THIRD context that
 * carries no viewport at all, and assert byte-identical resolved state.
 *
 * This is only possible because of this packet's R3 emission contract
 * (`../mosaic/index.js` ChartEmission/causeClauseFromEmission, R3): a
 * viewport can only ever produce a `rawValue` (already DATA space) before
 * crossing into vizfootprint — the viewport itself is never serialized, so
 * it cannot leak into replay.
 */
import { describe, it, expect } from 'vitest';
import { CauseSelectionSession, replayLog, serializeLog } from './log.js';
import type { Cause } from '../cause/index.js';

interface Viewport {
  readonly widthPx: number;
  readonly domain: readonly [number, number];
  toData(px: readonly [number, number]): [number, number];
}
const makeViewport = (widthPx: number, domain: readonly [number, number]): Viewport => ({
  widthPx,
  domain,
  toData([loPx, hiPx]) {
    const [dMin, dMax] = domain;
    const scale = (dMax - dMin) / widthPx;
    return [dMin + loPx * scale, dMin + hiPx * scale];
  },
});

const CAUSE: Cause = { requestedBy: 'user', computedBy: 'user', intent: 'brush amount' };

describe('R5 strengthened — commit + replay are independent of the authoring viewport', () => {
  it('two viewports resolving to the same data value commit byte-identical records', () => {
    const narrow = makeViewport(400, [0, 100]);
    const wide = makeViewport(800, [0, 100]);

    const rawFromNarrow = narrow.toData([40, 80]); // -> [10, 20]
    const rawFromWide = wide.toData([80, 160]); // -> [10, 20], different pixels

    const sessionA = new CauseSelectionSession();
    sessionA.registry.register('brush', { actor: 'user' });
    const commitA = sessionA.commit({
      id: 'c1',
      parent: null,
      viewId: 'brush',
      actorMeta: { actor: 'user' },
      kind: 'interval',
      field: 'amount',
      value: rawFromNarrow,
      cause: CAUSE,
    });

    const sessionB = new CauseSelectionSession();
    sessionB.registry.register('brush', { actor: 'user' });
    const commitB = sessionB.commit({
      id: 'c1',
      parent: null,
      viewId: 'brush',
      actorMeta: { actor: 'user' },
      kind: 'interval',
      field: 'amount',
      value: rawFromWide,
      cause: CAUSE,
    });

    expect(commitA.record.value).toEqual([10, 20]);
    expect(commitA.record.value).toEqual(commitB.record.value);
    expect(commitA.record.predicateSQL).toBe(commitB.record.predicateSQL);
  });

  it('replay into a FRESH context with no viewport at all resolves to identical state (data-space in, identical resolved state out)', () => {
    const narrow = makeViewport(400, [0, 100]);
    const raw = narrow.toData([40, 80]); // authored under "viewport A"

    const live = new CauseSelectionSession();
    live.registry.register('brush', { actor: 'user' });
    live.commit({
      id: 'c1',
      parent: null,
      viewId: 'brush',
      actorMeta: { actor: 'user' },
      kind: 'interval',
      field: 'amount',
      value: raw,
      cause: CAUSE,
    });

    const serialized = serializeLog(live.records);
    // Replay: a brand-new session — no Viewport object, no scale, no pixels
    // anywhere in scope. If the resolved state matches, it can only have
    // come from the logged DATA value.
    const replayed = replayLog(serialized);

    expect(replayed.records[0]!.value).toEqual(live.records[0]!.value);
    expect(replayed.records[0]!.value).toEqual([10, 20]);
    expect(replayed.records[0]!.predicateSQL).toBe(live.records[0]!.predicateSQL);

    // and replaying under yet a DIFFERENT simulated "target viewport" (a
    // wider chart) changes nothing about the resolved SQL/value — the log
    // has no viewport-shaped field to reinterpret.
    const wide = makeViewport(800, [0, 100]);
    void wide; // present only to make explicit: nothing below consults it
    expect(replayed.selection.clauses[0]!.value).toEqual([10, 20]);
  });
});
