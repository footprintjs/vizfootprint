/**
 * DEFECT 3 — "commit identities collide across sessions on one dashboard" —
 * pinned.
 *
 * THE LAW: a commit id is unique per DASHBOARD, not per session.
 *
 * The reproduction: two sessions created from the same `buildDashboard` both
 * minted `s1`. Bookmarks and saved pictures live in a DASHBOARD-level store
 * and name commit ids, so a bookmark made in session A was visible in session
 * B, and seeking it there silently landed on B's different `s1` — the same
 * name meant one act in A and another in B, with no error anywhere.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard } from '../def/index.js';
import { makeDashboardDef } from './dashboard.fixture.js';
import type { Cause } from '../cause/index.js';

const userCause = (intent?: string): Cause => ({ requestedBy: 'user', computedBy: 'user', ...(intent ? { intent } : {}) });

describe('a commit id is unique per dashboard', () => {
  it('two sessions on one dashboard never mint the same id', async () => {
    const dash = buildDashboard(makeDashboardDef());
    const a = dash.createSession();
    const b = dash.createSession();

    await a.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: userCause('A picks Casual') });
    await b.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('B picks Formal') });
    await a.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause: userCause('A picks Party') });
    await b.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Work', cause: userCause('B picks Work') });

    const idsA = a.log.records.map((r) => r.id);
    const idsB = b.log.records.map((r) => r.id);
    expect(idsA).toEqual(['s1', 's3']); // GAPS, and that is correct — the counter is the dashboard's
    expect(idsB).toEqual(['s2', 's4']);
    expect(idsA.filter((id) => idsB.includes(id))).toEqual([]);
  });

  it('ids keep their spelling: `s` and a number', async () => {
    const dash = buildDashboard(makeDashboardDef());
    const s = dash.createSession();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: userCause() });
    expect(s.log.records[0]!.id).toMatch(/^s\d+$/);
  });

  it('the counter is scoped to the dashboard, the same scope as the stores that name commits', async () => {
    // two separate dashboards are two separate identity spaces, and that is
    // right: their bookmark and picture stores are separate too.
    const one = buildDashboard(makeDashboardDef()).createSession();
    const two = buildDashboard(makeDashboardDef()).createSession();
    await one.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: userCause() });
    await two.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: userCause() });
    expect(one.log.records[0]!.id).toBe('s1');
    expect(two.log.records[0]!.id).toBe('s1');
  });
});

describe('the bookmark that used to land on the wrong act', () => {
  it('a bookmark made in A is visible in B and no longer resolves to a DIFFERENT act there', async () => {
    const dash = buildDashboard(makeDashboardDef());
    const a = dash.createSession();
    const b = dash.createSession();

    const landedA = await a.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: userCause('A picks Casual') });
    expect(landedA.ok).toBe(true);
    const idA = landedA.ok ? landedA.commit!.id : '';
    a.bookmark('the moment', idA);

    const landedB = await b.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause: userCause('B picks Party') });
    const idB = landedB.ok ? landedB.commit!.id : '';

    // the store is the dashboard's, so B sees the bookmark…
    expect(b.bookmarks().map((t) => t.name)).toEqual(['the moment']);
    // …and it names A's act, which is NOT B's own first act
    expect(idA).not.toBe(idB);
    expect(b.bookmarks()[0]!.commitId).toBe(idA);

    // Seeking it in B is now an HONEST refusal — a commit B's log does not
    // hold. Before the fix this silently succeeded and landed on B's own `s1`,
    // showing a filter nobody had bookmarked.
    const seeked = b.seek(idA);
    expect(seeked.ok).toBe(false);
    if (!seeked.ok) expect(seeked.gap.detail).toContain(`no commit "${idA}"`);

    // and in A, where the act really happened, it still resolves
    expect(a.seek(idA).ok).toBe(true);
  });

  it('a saved picture records the commits it came from, and those ids mean one act dashboard-wide', async () => {
    const dash = buildDashboard(makeDashboardDef());
    const a = dash.createSession();
    const b = dash.createSession();
    await a.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: userCause() });
    a.saveSelection('coastal', { live: 'all' });
    await b.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause: userCause() });

    const from = b.saved()[0]!.from!; // B reads the dashboard's picture store
    expect(from).toEqual(a.log.records.map((r) => r.id));
    expect(b.log.records.some((r) => from.includes(r.id))).toBe(false); // never another session's act by the same name
  });
});

describe('a number a restored record already points at is never minted again', () => {
  it('a bookmark restored at dashboard level pushes the commit counter past the moment it names', async () => {
    // The host persisted a bookmark on `s7` from an earlier run and puts it
    // back into a FRESH dashboard, whose counter starts at 0. Without raising
    // the counter, this dashboard would happily mint `s7` again and the
    // bookmark would silently start resolving to a real but WRONG act.
    const dash = buildDashboard(makeDashboardDef());
    const put = dash.restoreBookmarks([{ name: 'from last week', commitId: 's7', by: 'user', at: '2026-09-01T00:00:00.000Z' }]);
    expect(put.restored).toEqual(['from last week']);

    const s = dash.createSession();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: userCause() });
    expect(s.log.records[0]!.id).toBe('s8'); // never s1…s7
  });

  it('a saved picture restored at dashboard level does the same for the commits it came from', async () => {
    const dash = buildDashboard(makeDashboardDef());
    const put = dash.restoreSaved([{
      name: 'coastal',
      conditions: [{ viewId: 'bar', kind: 'point', field: 'category', value: 'Casual' }],
      from: ['s3', 's11'],
      by: 'user',
      at: '2026-09-01T00:00:00.000Z',
    }]);
    expect(put.restored).toEqual(['coastal']);

    const s = dash.createSession();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: userCause() });
    expect(s.log.records[0]!.id).toBe('s12');
  });

  it('a refused record spends nothing', () => {
    const dash = buildDashboard(makeDashboardDef());
    const put = dash.restoreBookmarks([{ name: '', commitId: 's9', by: 'user', at: 'now' }]);
    expect(put.restored).toEqual([]);
    const s = dash.createSession();
    void s;
    expect(dash.bookmarks()).toEqual([]);
  });

  it('a session restore raises it too, through the same door', async () => {
    const dash = buildDashboard(makeDashboardDef());
    const s = dash.createSession();
    const landed = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: userCause() });
    const id = landed.ok ? landed.commit!.id : '';
    // a session refuses a commit its own log does not hold, so this restores the real one
    expect(s.restoreBookmarks([{ name: 'here', commitId: id, by: 'user', at: 'now' }]).restored).toEqual(['here']);
    const next = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause: userCause() });
    expect(next.ok && next.commit!.id).toBe('s2'); // unchanged: the number it names was already spent
  });
});
