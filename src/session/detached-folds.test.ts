/**
 * DEFECT 2 — "fold results leak mutable backing objects" — pinned.
 *
 * THE LAW: a fold result is DETACHED. A reader never holds the object the
 * system is still using, so nothing on screen can change without a commit.
 *
 * Three reproductions, all real an hour before this was written:
 *   a) `dashboard.def` is documented as frozen and was not — `def.meta.title`
 *      could be rewritten to 'HIJACKED'.
 *   b) `session.viewEncodings('scatter')` handed back the live cached object;
 *      mutating it made the NEXT read say `x: 'FORGED'`.
 *   c) `applyLinkOverrides()` returned the base graph BY REFERENCE when there
 *      were no overrides, so pushing a forged edge into what `overview().links`
 *      returned made the next `overview()` report one more edge than the
 *      dashboard actually has — with zero commits in between.
 *
 * Plus the sweep: every other surface of the same shape (a getter handing back
 * a cached object, a store's own array, a graph by reference).
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard } from '../def/index.js';
import { makeDashboardDef } from './dashboard.fixture.js';
import type { InteractionSession } from './session.js';
import type { LinkEdge } from '../links/index.js';
import type { Cause } from '../cause/index.js';

const userCause = (intent?: string): Cause => ({ requestedBy: 'user', computedBy: 'user', ...(intent ? { intent } : {}) });

function open(): { dash: ReturnType<typeof buildDashboard>; s: InteractionSession } {
  const dash = buildDashboard(makeDashboardDef());
  return { dash, s: dash.createSession() };
}

describe('a) the def is frozen — the MAP is still', () => {
  it('`def.meta.title = "HIJACKED"` throws instead of sticking', () => {
    const { dash } = open();
    expect(Object.isFrozen(dash.def)).toBe(true);
    expect(Object.isFrozen(dash.def.meta)).toBe(true);
    expect(() => {
      (dash.def.meta as { title: string }).title = 'HIJACKED';
    }).toThrow(TypeError);
    expect((dash.def.meta as { title?: string }).title).toBe('dresses');
  });

  it('no table can be added, removed or re-pointed after the build', () => {
    const { dash } = open();
    expect(() => {
      (dash.def.data as Record<string, unknown>)['ghost'] = { rows: [] };
    }).toThrow(TypeError);
    expect(() => {
      (dash.def.data['data'] as { engine?: string }).engine = 'server';
    }).toThrow(TypeError);
  });

  it('the declared actors, encodings and fdr policy are frozen too', () => {
    const { dash } = open();
    expect(() => {
      (dash.def.actors['scatter'] as { label?: string }).label = 'FORGED';
    }).toThrow(TypeError);
    expect(() => {
      (dash.def.encodings![0]!.initial as Record<string, string>)['x'] = 'FORGED';
    }).toThrow(TypeError);
    expect(() => {
      (dash.def.fdr as { alpha: number }).alpha = 0.9;
    }).toThrow(TypeError);
  });

  it('but the BULK ROWS an author still owns are left writable, on purpose', () => {
    // The author declared `data: { data: { rows } }` and may still be drawing
    // its own chart from that same array (the analyst demo does exactly this,
    // writing a materialized cluster_id onto each row). The provider took its
    // own copy at build, so the dashboard reads none of it.
    const def = makeDashboardDef();
    const dash = buildDashboard(def);
    const rows = dash.def.data['data']!.rows as Record<string, unknown>[];
    expect(Object.isFrozen(rows)).toBe(false);
    rows[0]!['cluster_id'] = 3; // does not throw
    expect(rows[0]!['cluster_id']).toBe(3);
  });
});

describe('b) viewEncodings hands back something the system will not read back', () => {
  it('mutating what it returns does not change the next read', async () => {
    const { s } = open();
    const before = s.viewEncodings('scatter');
    expect(before['x']).toBe('price');
    expect(Object.isFrozen(before)).toBe(true);
    expect(() => {
      (before as Record<string, string>)['x'] = 'FORGED';
    }).toThrow(TypeError);
    expect(s.viewEncodings('scatter')['x']).toBe('price');
    expect((await s.overview()).encodings['scatter']!['x']).toBe('price');
  });

  it('a view with no encoding surface gets a frozen empty map, not a fresh writable one', () => {
    const { s } = open();
    const none = s.viewEncodings('cluster');
    expect(none).toEqual({});
    expect(Object.isFrozen(none)).toBe(true);
  });

  it('a real re-encode still moves it — frozen is not stuck', async () => {
    const { s } = open();
    const res = await s.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'color', field: 'category', cause: userCause() });
    expect(res.ok).toBe(true);
    expect(s.viewEncodings('scatter')['color']).toBe('category');
  });
});

describe('c) the link graph is never handed out by reference to a mutable object', () => {
  it('pushing a forged edge into `overview().links` throws, and the count does not move', async () => {
    const { s } = open();
    const first = await s.overview();
    const count = first.links.edges.length;

    expect(Object.isFrozen(first.links)).toBe(true);
    expect(Object.isFrozen(first.links.edges)).toBe(true);
    expect(() =>
      (first.links.edges as LinkEdge[]).push({
        id: 'FORGED', source: 'scatter', kind: 'point', target: 'bar', response: 'filter', origin: 'declared',
      } as LinkEdge),
    ).toThrow(TypeError);

    const second = await s.overview();
    expect(second.links.edges.length).toBe(count);
  });

  it('an individual edge cannot be re-pointed either', async () => {
    const { s } = open();
    const edge = (await s.overview()).links.edges[0]!;
    expect(() => {
      (edge as { response: string }).response = 'none';
    }).toThrow(TypeError);
  });

  it('a real link edit still lands, and the edited graph is frozen too', async () => {
    const { s } = open();
    const target = (await s.overview()).links.edges[0]!;
    const res = await s.dispatch({ verb: 'link', source: target.source, kind: target.kind, target: target.target, response: 'none', cause: userCause('mute this edge') });
    expect(res.ok).toBe(true);
    const after = await s.overview();
    expect(after.links.edges.find((e) => e.id === target.id)!.response).toBe('none');
    expect(Object.isFrozen(after.links.edges)).toBe(true);
  });
});

describe('detaching cuts BOTH ways — the trace never freezes the caller', () => {
  it('a multi-select does not freeze the array the caller handed in', async () => {
    const { s } = open();
    const values = ['Formal', 'Party'];
    const res = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', values, cause: userCause('two categories') });
    expect(res.ok).toBe(true);

    // the caller is still holding this array and may go on using it
    expect(Object.isFrozen(values)).toBe(false);
    expect(() => values.push('Casual')).not.toThrow();

    // …and history did not move with it
    const landed = s.log.records[0]!.value as { values: readonly string[] };
    expect(landed.values).toEqual(['Formal', 'Party']);
    expect(Object.isFrozen(landed.values)).toBe(true);
  });

  it('a filter does not freeze the range the caller handed in', async () => {
    const { s } = open();
    const range: [number, number] = [60, 120];
    expect((await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range, cause: userCause() })).ok).toBe(true);
    expect(Object.isFrozen(range)).toBe(false);
    range[1] = 999; // the caller's own tuple
    expect(s.log.records[0]!.value).toEqual([60, 120]);
  });
});

describe('the sweep — every other surface of the same shape', () => {
  it('the FDR ledger is a copy: a fabricated discovery cannot be pushed onto it', async () => {
    const { s } = open();
    await s.declareAnalysis('correlation');
    const ledger = s.ledger();
    expect(ledger.length).toBeGreaterThan(0);
    expect(Object.isFrozen(ledger)).toBe(true);
    expect(() => (ledger as unknown[]).push({ fabricated: true })).toThrow(TypeError);
    expect(s.ledger().length).toBe(ledger.length);
    expect(Object.isFrozen((await s.overview()).fdr.ledger)).toBe(true);
    // the ROWS are frozen too — the copied list shares them with `_ledger`
    expect(Object.isFrozen(ledger[0])).toBe(true);
    expect(() => {
      (ledger[0] as { reject: boolean }).reject = true;
    }).toThrow(TypeError);
  });

  it('the gap ledger is a copy: a gap nobody filed cannot be added, and a real one cannot be spliced away', async () => {
    const { s } = open();
    await s.dispatch({ verb: 'select', viewId: 'scatter', field: 'no_such_column', value: 1, cause: userCause() });
    const gaps = s.gaps();
    expect(gaps.length).toBe(1);
    expect(Object.isFrozen(gaps)).toBe(true);
    expect(() => (gaps as unknown[]).push({ code: 'needs-column' })).toThrow(TypeError);
    expect(() => {
      (gaps as unknown[]).length = 0;
    }).toThrow(TypeError);
    expect(s.gaps().length).toBe(1);
  });

  it('the ref-event journal is a copy', async () => {
    const { s } = open();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: userCause() });
    const events = (await s.overview()).paths.events;
    expect(events.length).toBeGreaterThan(0);
    expect(Object.isFrozen(events)).toBe(true);
  });

  it('the data journal and its entries are frozen', async () => {
    const { dash } = open();
    await dash.refresh();
    const journal = dash.journal();
    expect(journal.length).toBe(1);
    expect(Object.isFrozen(journal)).toBe(true);
    expect(Object.isFrozen(journal[0])).toBe(true);
    expect(Object.isFrozen(journal[0]!.tables)).toBe(true);
    expect(() => {
      (journal[0] as { at: string }).at = 'never';
    }).toThrow(TypeError);
  });

  it('`dashboard.sources` is a fresh frozen copy — and it still tracks a refresh', async () => {
    const { dash } = open();
    const a = dash.sources;
    expect(Object.isFrozen(a)).toBe(true);
    expect(dash.sources).not.toBe(a); // a copy per read, because a refresh replaces entries
  });

  it('the resolved engines and the declared keys are frozen', async () => {
    const { dash, s } = open();
    expect(Object.isFrozen(dash.engines)).toBe(true);
    expect(() => {
      (dash.engines as Record<string, string>)['data'] = 'server';
    }).toThrow(TypeError);
    expect(Object.isFrozen((await s.overview()).keys)).toBe(true);
  });

  it('the build notes are frozen', () => {
    const dash = buildDashboard(makeDashboardDef({ engine: 'auto' }));
    expect(Object.isFrozen(dash.notes)).toBe(true);
    expect(() => (dash.notes as string[]).push('fabricated note')).toThrow(TypeError);
  });

  it('the effective-encoding map handed out by overview() is frozen (it is a memo)', async () => {
    const { s } = open();
    const effective = (await s.overview()).views.find((v) => v.viewId === 'scatter')!.effective!;
    expect(Object.isFrozen(effective)).toBe(true);
    expect(Object.isFrozen(effective.bindings)).toBe(true);
    expect(() => {
      (effective.bindings as Record<string, string>)['x'] = 'FORGED';
    }).toThrow(TypeError);
    expect((await s.overview()).views.find((v) => v.viewId === 'scatter')!.effective!.bindings['x']).toBe('price');
  });

  it('saved pictures and bookmarks were already copies — the store\'s own objects never escape', async () => {
    const { s } = open();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: userCause() });
    s.saveSelection('coastal', { live: 'all' });
    s.bookmark('here');
    expect(s.saved()[0]).not.toBe(s.saved()[0]); // a fresh clone each read
    expect(s.bookmarks()[0]).not.toBe(s.bookmarks()[0]);
    (s.saved()[0] as { name: string }).name = 'FORGED';
    expect(s.saved()[0]!.name).toBe('coastal');
  });
});
