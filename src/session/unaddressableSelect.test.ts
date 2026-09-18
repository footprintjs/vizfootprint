/**
 * THE PROBE DOOR'S VALUE-LEVEL FENCE — law 13 one tier in, for the point, the
 * match AND the interval: a clause whose values cannot address the column they
 * name is refused BY NAME, under a code an agent can branch on, instead of
 * landing a commit that keeps nothing.
 *
 * THE DEFECT, measured end to end before this step existed: a drag across a
 * band drawn over a column of numbers emitted a set of SPELLINGS, the door
 * took it, and the record gained a commit (4 → 5) while the refusal ledger
 * stood still at 3 and every picture emptied (185 marks in force → 0, a
 * companion bar chart 372 rects → 2). A landed clause that kept nothing is
 * worse than a refusal AND worse than the dead gesture it replaced, because
 * the record now claims the question was answered.
 *
 * The door already read the column list and used it only for the NAME
 * (`needs-column`); the type was right there. What it does with it is the
 * library's, not a consumer's: nothing about this is specific to a page, and a
 * consumer cannot see that the clause it landed was unanswerable.
 */
import { describe, it, expect } from 'vitest';
import { buildDashboard } from '../def/index.js';
import type { DashboardDef } from '../def/index.js';
import { makeDashboardDef, SAMPLE_ROWS } from './dashboard.fixture.js';
import type { Cause } from '../cause/index.js';

const userCause = (intent?: string): Cause => ({ requestedBy: 'user', computedBy: 'user', ...(intent ? { intent } : {}) });
const freshSession = () => buildDashboard(makeDashboardDef()).createSession();
/**
 * The fixture with a real DATE column beside it. The memory engine types a column as `date` only
 * when every cell is a `Date` instance (`TypeTally`), and the ANALYSIS row type the fixture takes is
 * `number | string` — hence the one cast, which is about the fixture's signature and not about the
 * rows the engine holds.
 */
const datedSession = () =>
  buildDashboard(makeDashboardDef({ rows: SAMPLE_ROWS.map((r, i) => ({ ...r, when: new Date(Date.UTC(2026, 0, 1 + i)) })) as unknown as typeof SAMPLE_ROWS })).createSession();

/** The prices in the fixture, as the column holds them — numbers. */
const prices = [...new Set(SAMPLE_ROWS.map((r) => Number(r['price'])))];
const [P, Q] = [prices[0]!, prices[1]!];
const categories = [...new Set(SAMPLE_ROWS.map((r) => String(r['category'])))];

describe('the probe door refuses a clause its column cannot answer — and NOTHING lands', () => {
  it('a MATCH of spellings on a column of numbers: refused, with the column, the kind and what it was handed', async () => {
    const s = freshSession();
    const res = await s.dispatch({ verb: 'select', viewId: 'scatter', field: 'price', values: [String(P), String(Q)], cause: userCause('the band drag') });
    expect(res.ok).toBe(false);
    // the code is its OWN — an agent reading `guard-failed` would re-read a definition that is correct
    expect(s.gaps().at(-1)?.code).toBe('unaddressable-value');
    expect(s.gaps().at(-1)?.op).toBe('select');
    expect(s.gaps().at(-1)?.target).toBe('price');
    expect(s.gaps().at(-1)?.detail).toBe(
      `view "scatter" delivered the match ${JSON.stringify([String(P), String(Q)])} on "price", whose scale is quantitative — numeric values address that column, so no row can answer the clause; a selection addresses the column it was drawn on`,
    );
    // NOTHING LANDED: no commit, no live selection, every row still kept — the whole point of the fence
    expect(s.log.records).toHaveLength(0);
    expect((await s.overview()).activeSelections).toEqual([]);
    expect((await s.selectedRows()).length).toBe(SAMPLE_ROWS.length);
  });

  it('a POINT of a spelling on a column of numbers: refused the same way, by the same owner', async () => {
    const s = freshSession();
    const res = await s.dispatch({ verb: 'select', viewId: 'scatter', field: 'price', value: String(P), cause: userCause('a bar click') });
    expect(res.ok).toBe(false);
    expect(s.gaps().at(-1)?.code).toBe('unaddressable-value');
    expect(s.gaps().at(-1)?.detail).toContain(`delivered the point ${JSON.stringify(String(P))} on "price"`);
    expect(s.log.records).toHaveLength(0);
  });

  it('an INTERVAL of string bounds on a column of numbers: the finding the sibling packet recorded and did not take, now taken — and the sentence is the shipped one', async () => {
    const s = freshSession();
    const res = await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: ['100', '103'] as unknown as [number, number], cause: userCause() });
    expect(res.ok).toBe(false);
    expect(s.gaps().at(-1)?.code).toBe('unaddressable-value');
    expect(s.gaps().at(-1)?.op).toBe('filter');
    expect(s.gaps().at(-1)?.detail).toBe(
      'view "scatter" delivered the interval ["100","103"] on "price", whose scale is quantitative — numeric bounds address that axis, so no row can answer the clause; an interval addresses the axis it was drawn on',
    );
    // it used to return ok and land a commit whose Mosaic SQL named two columns that do not exist
    expect(s.log.records).toHaveLength(0);
  });

  it('a MATCH is judged strictly: one unanswerable member refuses the set, because a commit has nowhere to record what it lost', async () => {
    const s = freshSession();
    const res = await s.dispatch({ verb: 'select', viewId: 'scatter', field: 'price', values: [P, String(Q)], cause: userCause() });
    expect(res.ok).toBe(false);
    expect(s.gaps().at(-1)?.code).toBe('unaddressable-value');
  });
});

describe('what the fence must NOT touch — refused on evidence, never on ignorance', () => {
  it('the column\'s OWN quantity still lands, point and match alike', async () => {
    const s = freshSession();
    expect((await s.dispatch({ verb: 'select', viewId: 'scatter', field: 'price', value: P, cause: userCause() })).ok).toBe(true);
    expect((await s.dispatch({ verb: 'select', viewId: 'scatter', field: 'price', values: [P, Q], cause: userCause() })).ok).toBe(true);
    expect((await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [P, Q], cause: userCause() })).ok).toBe(true);
    expect(s.gaps()).toEqual([]);
  });

  it('a CATEGORICAL column is not judged at all — its own fold names every cell it meets, so a column reported as text may honestly hold numbers, and a clause of numbers on one keeps rows', async () => {
    const s = freshSession();
    expect((await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', values: categories.slice(0, 2), cause: userCause() })).ok).toBe(true);
    // the shape the chart tier now lands for a band over a column of numbers REPORTED as text
    expect((await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', values: [1, 2], cause: userCause() })).ok).toBe(true);
    expect((await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: true, cause: userCause() })).ok).toBe(true);
    expect(s.gaps()).toEqual([]);
  });

  it('a CLEARED selection is never judged — `null` is the one spelling of cleared, for every kind', async () => {
    const s = freshSession();
    expect((await s.dispatch({ verb: 'select', viewId: 'scatter', field: 'price', value: null, cause: userCause() })).ok).toBe(true);
    expect((await s.dispatch({ verb: 'select', viewId: 'scatter', field: 'price', values: null, cause: userCause() })).ok).toBe(true);
    expect((await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: null, cause: userCause() })).ok).toBe(true);
    expect(s.gaps()).toEqual([]);
  });

  it('an OPEN interval side and an empty keep-list keep their own laws', async () => {
    const s = freshSession();
    expect((await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [P, null], cause: userCause() })).ok).toBe(true);
    expect((await s.dispatch({ verb: 'select', viewId: 'scatter', field: 'price', values: [], cause: userCause() })).ok).toBe(true);
    expect(s.gaps()).toEqual([]);
  });

  it('A DATE COLUMN READ BY ISO STRINGS STAYS ACCEPTED, byte for byte — the library\'s own deliberate cross-type read (a temporal axis answers either spelling of a date it carries), and the reason this rule is the interval evaluator\'s table rather than a fresh one', async () => {
    const s = datedSession();
    expect((await s.dispatch({ verb: 'select', viewId: 'scatter', field: 'when', value: '2026-01-01T00:00:00.000Z', cause: userCause() })).ok).toBe(true);
    expect((await s.dispatch({ verb: 'select', viewId: 'scatter', field: 'when', values: ['2026-01-01T00:00:00.000Z'], cause: userCause() })).ok).toBe(true);
    expect((await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'when', range: ['2026-01-01', '2026-01-09'] as unknown as [number, number], cause: userCause() })).ok).toBe(true);
    // an EPOCH too, and the `Date` a def written in TypeScript can hand over
    expect((await s.dispatch({ verb: 'select', viewId: 'scatter', field: 'when', value: Date.UTC(2026, 0, 1), cause: userCause() })).ok).toBe(true);
    expect((await s.dispatch({ verb: 'select', viewId: 'scatter', field: 'when', value: new Date(Date.UTC(2026, 0, 1)), cause: userCause() })).ok).toBe(true);
    expect(s.gaps()).toEqual([]);
    // …and a quantity a date is not is still refused
    expect((await s.dispatch({ verb: 'select', viewId: 'scatter', field: 'when', value: true, cause: userCause() })).ok).toBe(false);
    expect(s.gaps().at(-1)?.code).toBe('unaddressable-value');
  });

  it('THE DOOR READS THE PROVIDER\'S OWN TYPE, not the def\'s declaration — which is what makes this fence catch the defect instead of causing one', async () => {
    // `ColumnDecl.type` lets a def say what a column IS when the provider's inference is not the
    // truth ("an ISO-string column that is a date"), and the ENCODING PLANE honours it (`facets.ts`:
    // a declared type wins). This door does not see it: `columnsOf` is the provider's answer.
    //
    // THAT ASYMMETRY IS LOAD-BEARING, and it is the desk's own configuration. A column of NUMBERS
    // reported as text is what folds a band at all (`frameDomains` names every cell it is given), so
    // the FOLD reads `string` and draws slots — while the door reads `number` and judges. After the
    // chart tier's fix the band lands the rows' own numbers, and this door accepts them; the labels
    // it used to land are refused. If the door read the declaration instead, it would decline to
    // judge exactly the case the whole packet is about.
    const base = makeDashboardDef({ rows: SAMPLE_ROWS.map((r) => ({ ...r, resnum: Number(r['price']) })) });
    // the def says TEXT; the provider sees numbers, because every cell is one
    const def: DashboardDef = { ...base, data: { data: { ...base.data['data']!, columns: { resnum: { type: 'string' } } } } };
    const s = buildDashboard(def).createSession();
    const resnum = Number(SAMPLE_ROWS[0]!['price']);
    // THE PROOF is the pair: were the declaration what this door read, `'string'` would fold as
    // CATEGORIES and the door would judge nothing at all — so the spelling would be accepted.
    expect((await s.dispatch({ verb: 'select', viewId: 'scatter', field: 'resnum', values: [resnum], cause: userCause() })).ok).toBe(true);
    expect((await s.dispatch({ verb: 'select', viewId: 'scatter', field: 'resnum', values: [String(resnum)], cause: userCause() })).ok).toBe(false);
    expect(s.gaps().at(-1)?.code).toBe('unaddressable-value');
  });

  it('the earlier steps still answer first: an unknown column is `needs-column`, not this', async () => {
    const s = freshSession();
    expect((await s.dispatch({ verb: 'select', viewId: 'scatter', field: 'nope', value: '1', cause: userCause() })).ok).toBe(false);
    expect(s.gaps().at(-1)?.code).toBe('needs-column');
  });
});
