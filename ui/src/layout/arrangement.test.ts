// @vitest-environment node
/**
 * THE COCKPIT'S ARRANGEMENT — the codec, the identity, and the SLOT LAW with
 * the algebra that proves it, none of which needs a browser.
 *
 * The browser half is `VizCockpit.layout.test.tsx`, which asserts the law on
 * the rendered grid: a focus change moves exactly two cells, every home is
 * where the recorded order put it, and the lifted cell's home says so. This
 * file is the half a renderer cannot state cleanly — that the homes are a
 * function of the ORDER ALONE, which is the whole reason the rendered numbers
 * come out the way they do.
 */
import { describe, it, expect } from 'vitest';
import {
  COCKPIT_LAYOUT_SCOPE,
  COCKPIT_ORDER_PROP,
  COCKPIT_ORDER_SEPARATOR,
  LAYOUT_SCOPE_PREFIX,
  cockpitSlots,
  homeSaid,
  layoutViewId,
  cellOrderFromLayoutValue,
  cellOrderToLayoutValue,
} from './arrangement.js';

describe('the identity is the library’s own, and cannot drift from it', () => {
  it('LAYOUT_SCOPE_PREFIX is byte-for-byte the src namespace, and the cockpit’s scope composes the dashboard identity', async () => {
    // test-only value import of the src constant (production ui code stays type-only)
    const { LAYOUT_VIEW_PREFIX } = await import('vizfootprint/branches');
    expect(LAYOUT_SCOPE_PREFIX).toBe(LAYOUT_VIEW_PREFIX);
    expect(layoutViewId(COCKPIT_LAYOUT_SCOPE)).toBe(`${LAYOUT_VIEW_PREFIX}dashboard`);
    const { LAYOUT_DASHBOARD_VIEW_ID } = await import('../adapter/sessionView.js');
    expect(layoutViewId(COCKPIT_LAYOUT_SCOPE)).toBe(LAYOUT_DASHBOARD_VIEW_ID);
    expect(COCKPIT_ORDER_PROP).toBe('order');
  });
});

describe('THE CODEC — one grammar, and the joined bytes every older trace holds', () => {
  it('BYTE IDENTITY: an order whose ids hold no separator lands exactly what it landed before the codec existed', () => {
    for (const order of [['bar'], ['bar', 'scatter'], ['a', 'b', 'c', 'd'], ['residue-view', 'contact_table']]) {
      // what `setLayout` used to write, verbatim
      expect(cellOrderToLayoutValue(order)).toBe(order.join(','));
    }
    // and no order is still the cleared string, not "[]"
    expect(cellOrderToLayoutValue([])).toBe('');
  });

  it('and the joined form still READS — every trace this library ever wrote', () => {
    expect(cellOrderFromLayoutValue('bar, scatter ,,map,')).toEqual(['bar', 'scatter', 'map']);
    expect(cellOrderFromLayoutValue('')).toEqual([]);
    expect(cellOrderFromLayoutValue(undefined)).toEqual([]);
  });

  it('A NAME HOLDING THE SEPARATOR now ROUND-TRIPS, where the joined list would have made it two cells', () => {
    const order = ['a,b', 'map'];
    const value = cellOrderToLayoutValue(order);
    expect(value).toBe('["a,b","map"]');
    expect(cellOrderFromLayoutValue(value)).toEqual(order);
    // the hazard itself, named: the joined form is what a consumer had to refuse
    expect(cellOrderFromLayoutValue(order.join(COCKPIT_ORDER_SEPARATOR))).toEqual(['a', 'b', 'map']);
  });

  it('the writer’s test is the READER, so it can never land bytes the reader would read as something else', () => {
    // a name the joined reader would TRIM
    expect(cellOrderFromLayoutValue(cellOrderToLayoutValue([' a', 'b']))).toEqual([' a', 'b']);
    // a name that would be mistaken for the JSON arm
    expect(cellOrderToLayoutValue(['["a"]'])).toBe('["[\\"a\\"]"]');
    expect(cellOrderFromLayoutValue(cellOrderToLayoutValue(['["a"]']))).toEqual(['["a"]']);
    // a name that is only a separator has no content the joined form could carry
    expect(cellOrderFromLayoutValue(cellOrderToLayoutValue([',']))).toEqual([',']);
  });

  it('a value that OPENS with a bracket and is not a name list this version knows reads as the joined list it is', () => {
    expect(cellOrderFromLayoutValue('[foo')).toEqual(['[foo']); // not JSON at all
    expect(cellOrderFromLayoutValue('[]')).toEqual(['[]']); // JSON, but no names
    expect(cellOrderFromLayoutValue('[1,2]')).toEqual(['[1', '2]']); // JSON, but not names
    expect(cellOrderFromLayoutValue('["a",""]')).toEqual(['["a"', '""]']); // a blank name is no name
    expect(cellOrderFromLayoutValue('{"a":1}')).toEqual(['{"a":1}']); // never reaches the JSON arm at all
  });
});

/**
 * THE ALGEBRA, and it is pinned as algebra rather than as an outcome.
 *
 * A future reader who thinks the obvious model would do must fail a test here
 * rather than re-derive the three-cycle on a live page.
 */
describe('THE SLOT LAW — and the model that is provably wrong', () => {
  /**
   * THE REJECTED MODEL, written out so the test can disprove it: put the
   * focused cell in slot 0 by swapping it with whatever the recorded order has
   * there. Pure, obvious, and wrong.
   */
  const transposed = (order: readonly string[], focus: string): readonly string[] => {
    const i = order.indexOf(focus);
    const next = [...order];
    next[i] = next[0]!;
    next[0] = focus;
    return next;
  };

  it('THE TRANSPOSITION MOVES A THIRD CELL on consecutive focus changes — the three-cycle, as algebra', () => {
    const order = ['P0', 'P1', 'P2'];
    const atP1 = transposed(order, 'P1');
    const atP2 = transposed(order, 'P2');
    expect(atP1).toEqual(['P1', 'P0', 'P2']);
    expect(atP2).toEqual(['P2', 'P1', 'P0']);
    // moving the focus from P1 to P2 should move TWO cells; it moves three
    const moved = order.filter((id) => atP1.indexOf(id) !== atP2.indexOf(id));
    expect(moved).toEqual(['P0', 'P1', 'P2']);
    // and P0 — which nobody touched, and which neither focus names — is one of them
    expect(moved).toContain('P0');
    expect(atP1.indexOf('P0')).not.toBe(atP2.indexOf('P0'));
  });

  it('THE HOME MODEL DOES NOT: the homes are a function of the ORDER ALONE, so no focus can move one', () => {
    const order = ['P0', 'P1', 'P2', 'P3'];
    const at = (focus: string | null): Readonly<Record<string, number>> => cockpitSlots(order, focus).homes;
    for (const focus of [...order, null, 'a-cell-that-has-gone']) {
      expect(at(focus), `focusing ${String(focus)} moved a home`).toEqual(at('P0'));
    }
  });

  it('for EVERY pair of focuses, exactly two things change: one lifts, one settles back', () => {
    const order = ['P0', 'P1', 'P2', 'P3', 'P4'];
    /** What a reader SEES at one focus: every cell's slot, and whether it holds its picture or the marker. */
    const seen = (focus: string): Readonly<Record<string, string>> => {
      const slots = cockpitSlots(order, focus);
      return Object.fromEntries(order.map((id) => [id, `${slots.homes[id]!}:${id === slots.focus ? 'home-marker' : 'picture'}`]));
    };
    for (const from of order) {
      for (const to of order) {
        if (from === to) continue;
        const a = seen(from);
        const b = seen(to);
        const changed = order.filter((id) => a[id] !== b[id]);
        expect(changed.sort(), `moving the focus from ${from} to ${to} changed ${changed.join(', ') || 'nothing'}`).toEqual([from, to].sort());
        // …and not one cell changed the SLOT it lives in
        for (const id of order) expect(a[id]!.split(':')[0]).toBe(b[id]!.split(':')[0]);
      }
    }
  });

  it('every cell has exactly one home, one-based and in the recorded order — and the rail has one more box than it has pictures', () => {
    const slots = cockpitSlots(['a', 'b', 'c'], 'b');
    expect(slots.homes).toEqual({ a: 1, b: 2, c: 3 });
    expect(slots.columns).toBe(3); // three homes for two pictures + one lift: THE PRICE
    expect(slots.focus).toBe('b');
    expect(slots.markerAt).toBe(2);
  });

  it('nothing is lifted when nothing is focused, or when the focus names a cell this cockpit has not got', () => {
    for (const focus of [null, 'ghost']) {
      const slots = cockpitSlots(['a', 'b'], focus);
      expect(slots.focus).toBeNull();
      expect(slots.markerAt).toBeNull();
    }
    expect(cockpitSlots([], null)).toEqual({ columns: 0, homes: {}, focus: null, markerAt: null });
  });

  it('a repeated id keeps its FIRST home — one cell cannot live in two slots', () => {
    expect(cockpitSlots(['a', 'b', 'a'], 'a').homes).toEqual({ a: 1, b: 2 });
  });

  it('a home says whose it is, in the register the marker is read in', () => {
    expect(homeSaid('scatter')).toBe('scatter is in the focus — this is where it sits when something else is');
  });
});
