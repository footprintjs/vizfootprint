/**
 * findInView — WHERE IS THE NEXT MATCH, through the same eyes the window uses.
 *
 * The laws pinned here:
 *
 *   - a find is a READ: nothing lands on the log, and the rows do not move;
 *   - it sees exactly what the WINDOW sees — one owner of the reaching clauses
 *     (`viewClauses`), so a filter act changes what a find sees and seeking back
 *     changes it back;
 *   - the position it answers IS the offset a window opens at to show that row,
 *     and the row identity it mints is the one the window mints;
 *   - the default columns are the TEXT ones at the cursor;
 *   - an engine that cannot answer it is refused in words, never scanned around.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard } from '../def/index.js';
import { reject, type DataProvider } from '../data/index.js';
import { makeDashboardDef, SAMPLE_ROWS } from './dashboard.fixture.js';
import type { Cause } from '../cause/index.js';
import type { FindQuery, FindInViewResult } from './types.js';

const userCause = (intent?: string): Cause => ({ requestedBy: 'user', computedBy: 'user', ...(intent ? { intent } : {}) });
const fresh = () => buildDashboard(makeDashboardDef()).createSession();
const ask = (over: Partial<FindQuery> = {}): FindQuery => ({ text: 'form', from: 0, direction: 'forward', ...over });
/** The answer, or a failure quoting the refusal — a refused find is never read as "no match". */
const answered = (found: FindInViewResult): Extract<FindInViewResult, { ok: true }> => {
  if (!found.ok) throw new Error(`refused: ${found.rejected}`);
  return found;
};

/** The source-order indices of the rows whose category is Formal — what the fixture's default text columns hold. */
const FORMAL = SAMPLE_ROWS.map((r, i) => [r, i] as const).filter(([r]) => r.category === 'Formal').map(([, i]) => i);

describe('findInView — the position, the count, and the row it names', () => {
  it('answers the first match at or after `from`, with its ordinal, the whole view\'s count, the version and the cursor — and lands NOTHING on the log', async () => {
    const s = fresh();
    const before = s.log.records.length;
    const first = answered(await s.findInView(ask()));
    expect([first.position, first.ordinal, first.matches]).toEqual([FORMAL[0], 1, FORMAL.length]);
    expect(first.rowId).toBe(`${first.version ?? 'inline'}#${FORMAL[0]}`); // positional table: the window's own identity
    expect(first.cursor).toBeNull();
    expect(s.log.records.length).toBe(before); // a find is a READ
    const next = answered(await s.findInView(ask({ from: FORMAL[0]! + 1 })));
    expect([next.position, next.ordinal]).toEqual([FORMAL[1], 2]);
  });

  it('BACKWARD walks the other way, and both ends are honest: no match that way, the matches still counted, and no row named', async () => {
    const s = fresh();
    const back = answered(await s.findInView(ask({ from: FORMAL[2]!, direction: 'backward' })));
    expect([back.position, back.ordinal]).toEqual([FORMAL[2], 3]);
    const end = answered(await s.findInView(ask({ from: 0, direction: 'backward' })));
    expect(end.position).toBeNull();
    expect(end.matches).toBe(FORMAL.length); // the matches are all ahead — the CALLER decides to wrap
    expect(end.rowId).toBeUndefined();
    expect(end.ordinal).toBeUndefined();
  });

  it('the position IS the offset a window opens at — the same row, in both answers', async () => {
    const s = fresh();
    const sort = [{ field: 'price' as const, dir: 'desc' as const }];
    const found = answered(await s.findInView(ask({ text: 'd39', sort })));
    const window = await s.viewQuery({ sort, offset: found.position!, limit: 1 });
    expect(window.ok && window.rows[0]!['id']).toBe('d39');
    expect(window.ok && window.rowIds[0]).toBe(found.rowId);
    expect(found.position).toBe(0); // d39 is the priciest row, so it is where a descending window starts
  });

  it('a DECLARED KEY is the identity a find names, exactly as a window names it', async () => {
    const def = makeDashboardDef();
    const keyed = buildDashboard({ ...def, data: { data: { ...def.data['data']!, key: 'id' } } }).createSession();
    const found = answered(await keyed.findInView(ask({ text: 'summer' })));
    expect(found.rowId).toBe(SAMPLE_ROWS.find((r) => r.category === 'Summer')!.id);
    expect(found.position).toBe(SAMPLE_ROWS.findIndex((r) => r.category === 'Summer'));
  });

  it('the DEFAULT columns are the text ones at the cursor — a number column is searched only when it is named', async () => {
    const s = fresh();
    // 53 is a price, never an id or a category: invisible to the default columns
    expect(answered(await s.findInView(ask({ text: '53' }))).matches).toBe(0);
    expect(answered(await s.findInView(ask({ text: '53', columns: ['price'] }))).matches).toBe(1);
    // and the text columns really are BOTH of them: an id matches as readily as a category
    expect(answered(await s.findInView(ask({ text: 'd7' }))).position).toBe(7);
  });
});

describe('findInView — whose eyes: one owner of the reaching clauses', () => {
  it('a filter act changes what a find sees, and seeking back changes it back', async () => {
    const s = fresh();
    const picked = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick') });
    expect(picked.ok).toBe(true);
    // the whole-dashboard truth is now the 8 Formal rows, so every row of the view matches
    const all = answered(await s.findInView(ask()));
    expect([all.matches, all.position]).toEqual([FORMAL.length, 0]);
    const narrowed = await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 100], cause: userCause('brush') });
    expect(narrowed.ok).toBe(true);
    const fewer = answered(await s.findInView(ask()));
    expect(fewer.matches).toBeLessThan(all.matches);
    expect(fewer.matches).toBe(SAMPLE_ROWS.filter((r) => r.category === 'Formal' && (r.price as number) >= 60 && (r.price as number) <= 100).length);
    // seek back to before the brush: the find sees what it saw then, and its positions are those positions
    expect(s.seek(picked.ok ? picked.commit!.id : '').ok).toBe(true);
    expect(answered(await s.findInView(ask()))).toMatchObject({ matches: all.matches, position: 0 });
  });

  it('a VIEW\'s eyes exclude its own clause — the same rule the window keeps', async () => {
    const s = fresh();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick') });
    // the bar's own clause never reaches the bar: it still sees all 40 rows
    expect(answered(await s.findInView(ask({ viewId: 'bar' }))).matches).toBe(FORMAL.length);
    const window = await s.viewQuery({ viewId: 'bar' });
    expect(window.ok && window.count).toBe(SAMPLE_ROWS.length);
    // …and the scatter, which the clause DOES reach, sees only the 8
    const scatter = answered(await s.findInView(ask({ viewId: 'scatter' })));
    expect(scatter.matches).toBe(FORMAL.length);
    expect(scatter.position).toBe(0); // every row it can see is a Formal row
  });

  it('a DERIVED column is searchable by the name the trace gave it — the same logical/physical translation a window gets', async () => {
    const s = fresh();
    expect((await s.declareAnalysis('clustering')).materialized).toEqual(['cluster_id']); // an act landed a column
    // the derived column lives in a slot spelled by its act; a find names it the way a person does
    const found = answered(await s.findInView(ask({ text: '3', columns: ['cluster_id'] })));
    expect(found.matches).toBeGreaterThan(0);
    const window = await s.viewQuery({ offset: found.position!, limit: 1, columns: ['cluster_id'] });
    expect(window.ok && String(window.rows[0]!['cluster_id'])).toContain('3'); // the row the find named holds it
    expect(window.ok && window.rowIds[0]).toBe(found.rowId);
    // and the text columns still default to the DECLARED text ones beside it
    expect(answered(await s.findInView(ask())).matches).toBe(FORMAL.length);
    // a MISS and a REFUSAL travel back through the same translation, unchanged
    expect(answered(await s.findInView(ask({ text: 'zzzz', columns: ['cluster_id'] }))).position).toBeNull();
    const ghost = await s.findInView(ask({ columns: ['ghost'] }));
    expect(!ghost.ok && [ghost.reason, ghost.engineReason]).toEqual(['engine', 'unknown-column']);
    // …and a SORTED find translates the sort key into the act's slot too: the top
    // cluster is 3, so a descending search for it starts at the very first row
    const sorted = answered(await s.findInView(ask({ text: '3', columns: ['cluster_id'], sort: [{ field: 'cluster_id', dir: 'desc' }] })));
    expect(sorted.position).toBe(0);
    // and a live FILTER rides through the same translation: the clause's own
    // column is spelled the store's way for the engine and the answer still
    // counts positions over the rows the filter kept
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'cluster_id', value: 3, cause: userCause('the top cluster') });
    const inside = answered(await s.findInView(ask({ text: '3', columns: ['cluster_id'] })));
    expect(inside.position).toBe(0); // every row the view holds is in cluster 3
    expect(inside.matches).toBeLessThan(SAMPLE_ROWS.length);
  });
});

describe('findInView — refused with a sentence, never a fabricated position', () => {
  it('the window\'s own refusals, from the one helper both doors share', async () => {
    const s = fresh();
    expect(await s.findInView(ask({ table: 'ghost' }))).toEqual({ ok: false, reason: 'unknown-table', rejected: 'no table "ghost" here — the tables at this point are data' });
    const view = await s.findInView(ask({ viewId: 'ghost' }));
    expect(!view.ok && [view.reason, view.rejected.startsWith('no declared view "ghost" — the views are ')]).toEqual(['unknown-view', true]);
    const sort = await s.findInView(ask({ sort: [{ field: 'ghost', dir: 'asc' }] }));
    expect(sort).toEqual({ ok: false, reason: 'engine', engineReason: 'unknown-column', rejected: 'table "data" has no column "ghost" to sort by' });
  });

  it('a malformed ask is the ENGINE\'s `bad-find`, in the words both engines refuse in', async () => {
    const s = fresh();
    expect(await s.findInView(ask({ text: '   ' }))).toEqual({ ok: false, reason: 'engine', engineReason: 'bad-find', rejected: 'a find needs something to look for — the text was empty' });
    expect(await s.findInView(ask({ from: -1 }))).toEqual({ ok: false, reason: 'engine', engineReason: 'bad-find', rejected: 'from must be a whole number at or above zero (got -1)' });
    const column = await s.findInView(ask({ columns: ['ghost'] }));
    expect(column).toEqual({ ok: false, reason: 'engine', engineReason: 'unknown-column', rejected: 'table "data" has no column "ghost" to look in' });
  });

  it('an engine that cannot find says so and names the alternative — the session never walks the rows itself', async () => {
    const stub = buildDashboard(makeDashboardDef({ engine: 'server' })).createSession();
    expect(await stub.findInView(ask())).toEqual({ ok: false, reason: 'unsupported-find', rejected: 'the server engine cannot find — filter instead' });
  });

  it('a table with no TEXT column to look in is refused rather than searched entirely', async () => {
    const numbers = buildDashboard(makeDashboardDef({ rows: Array.from({ length: 4 }, (_, i) => ({ price: i, rating: i / 2 })) })).createSession();
    expect(await numbers.findInView(ask())).toEqual({ ok: false, reason: 'no-columns', rejected: 'no text column to look in on table "data" — name the columns to search' });
    // …and naming a column is how a person searches the digits anyway
    expect(answered(await numbers.findInView(ask({ text: '2', columns: ['price'] }))).position).toBe(2);
  });

  it('a provider whose SCHEMA cannot be read is refused in the engine\'s own words, before any text is looked for', async () => {
    const s = fresh();
    const provider = (s as unknown as { runtime: { providerFor(t: string): DataProvider } }).runtime.providerFor('data');
    provider.columns = async () => reject('memory', 'columns', 'no-backend-connection', 'the table store is offline');
    const found = await s.findInView(ask());
    expect(found).toEqual({ ok: false, reason: 'no-columns', rejected: 'the table store is offline' });
  });

  it('a refresh landing while the find is answered is a moved version, refused — never a position in a table that has moved on', async () => {
    const s = fresh();
    const rt = (s as unknown as { runtime: { sources: Record<string, { version: string } | undefined>; providerFor: (t: string) => { find: (...a: unknown[]) => Promise<unknown> } } }).runtime;
    const provider = rt.providerFor('data');
    const realFind = provider.find.bind(provider);
    provider.find = async (...args: unknown[]) => {
      rt.sources['data'] = { version: 'moved-under-us' }; // the refresh lands while the engine is answering
      return realFind(...args);
    };
    const found = await s.findInView(ask());
    expect(found).toEqual({ ok: false, reason: 'version-moved', rejected: 'table "data" was refreshed while the find was answered — ask again' });
  });
});
