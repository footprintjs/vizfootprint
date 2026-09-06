/**
 * CLAUSE 5 — the answer owes the reader control over how much of it they get,
 * and a list of what they did not.
 *
 * Two laws, both from the family vocabulary, and every test here is one of
 * them: **a Lens may omit, but it may not deny** (an omission is listed, never
 * silent, and never dressed as absence) and **position narrows attention,
 * never capability** (what is left out stays reachable, and the answer says
 * how).
 */
import { describe, it, expect } from 'vitest';
import { buildDashboard, vizAsTools, SURFACE_PARTS, SURFACE_PART_NAMES, cacheClassOf, applySurfaceDelta, isListDelta, ENVELOPE_KEYS, PART_SCOPES, PART_STABILITIES, CACHE_CLASSES } from './index.js';
import { LENS_MEMO_DEPTH } from './vizAsTools.js';
import { narrowParts } from './narrow.js';
import { basisOf, dataVersionsOf } from './basis.js';
import { defRevision, stableJson } from '../def/revision.js';
import { makeDashboardDef } from '../session/dashboard.fixture.js';
import type { DashboardDef, VizToolResult, VizToolsPort } from './index.js';

const answer = (r: VizToolResult): Record<string, unknown> => r as Record<string, unknown>;
const portOf = (def: DashboardDef = makeDashboardDef()): VizToolsPort => vizAsTools(buildDashboard(def).createSession({ as: 'agent' }), { as: 'agent' });
const here = async (p: VizToolsPort, args?: Record<string, unknown>): Promise<Record<string, unknown>> => answer(await p.call('viz.whats_here', args));

// ── the pin: no argument, no change ──────────────────────────────────────────

describe('no argument, no change', () => {
  it('the no-argument answer carries EVERY part — nothing narrows unless the reader asks', async () => {
    const a = await here(portOf());
    for (const part of SURFACE_PARTS) expect(part.part in a).toBe(true);
    expect('omitted' in a).toBe(false);
    expect('since' in a).toBe(false);
  });

  it('…and is byte-identical to the same call made with an empty payload, or none at all', async () => {
    const p = portOf();
    const bare = JSON.stringify(await here(p));
    expect(JSON.stringify(await here(p, {}))).toBe(bare);
    expect(JSON.stringify(answer(await p.call('viz.whats_here')))).toBe(bare);
    // and `of` naming every part is the same answer with nothing omitted
    const all = await here(p, { of: SURFACE_PARTS.map((s) => s.part) });
    expect('omitted' in all).toBe(false);
    expect(JSON.stringify(all)).toBe(bare);
  });

  it('the parts table names exactly the answer’s parts — a new part with no row fails here', async () => {
    const a = await here(portOf());
    const served = Object.keys(a).filter((k) => !ENVELOPE_KEYS.has(k));
    expect(served).toEqual(SURFACE_PARTS.map((s) => s.part));
  });
});

// ── `of` and `omitted` ───────────────────────────────────────────────────────

describe('`of` — the parts this reader wants, and a list of what they did not get', () => {
  it('carries only the parts asked for, plus the basis, and names every part left out', async () => {
    const a = await here(portOf(), { of: ['views', 'columns'] });
    expect(Object.keys(a)).toEqual(['ok', 'views', 'columns', 'basis', 'omitted']);
    const omitted = a['omitted'] as { part: string; reason: string }[];
    expect(omitted.every((o) => o.reason === 'not-asked')).toBe(true);
    // every part that is not here is on the list — omitted, never denied
    expect([...omitted.map((o) => o.part), 'views', 'columns'].sort()).toEqual(SURFACE_PARTS.map((s) => s.part).sort());
  });

  it('an empty `of` is honoured, not ignored: the basis and the whole omission list, and nothing else', async () => {
    const a = await here(portOf(), { of: [] });
    expect(Object.keys(a)).toEqual(['ok', 'basis', 'omitted']);
    expect((a['omitted'] as unknown[]).length).toBe(SURFACE_PARTS.length);
  });

  it('what was left out stays reachable — asking again without `of` gets it back', async () => {
    const p = portOf();
    const narrow = await here(p, { of: ['views'] });
    expect('links' in narrow).toBe(false);
    expect('links' in (await here(p))).toBe(true);
  });

  it('an unknown part name is REFUSED in a sentence naming the parts that exist', async () => {
    const refusal = await here(portOf(), { of: ['viewz'] });
    expect(refusal['ok']).toBe(false);
    expect(refusal['reason']).toBe('PAYLOAD_INVALID');
    expect(refusal['detail']).toContain('"viewz", which is not a part of this answer');
    expect(refusal['detail']).toContain('views');
    expect(refusal['detail']).toContain('columns');
  });

  it('`of` that is not a list of names, and a `since` that is not a string, are refused the same way', async () => {
    const p = portOf();
    expect((await here(p, { of: 'views' }))['detail']).toContain('must be an array of part names');
    expect((await here(p, { of: ['views', 7] }))['detail']).toContain('must be an array of part names');
    expect((await here(p, { since: 7 }))['detail']).toBe('whats_here `since` must be a string: an `asOf` from an earlier whats_here answer');
  });
});

// ── `basis` ──────────────────────────────────────────────────────────────────

describe('`basis` — what the answer was true as of', () => {
  it('rides on every answer, however narrow, and names the position, the definition, the data and the session', async () => {
    const p = portOf();
    for (const args of [undefined, { of: [] }, { of: ['views'] }]) {
      const basis = (await here(p, args))['basis'] as Record<string, unknown>;
      expect(Object.keys(basis)).toEqual(['asOf', 'revision', 'data', 'session']);
    }
    const a = await here(p);
    const basis = a['basis'] as { asOf: string; revision: string; data: unknown; session: string };
    expect(basis.asOf).toBe(a['asOf']);
    expect(basis.revision).toMatch(/^r-[0-9a-f]{8}$/);
    expect(basis.session).toBe('sess1');
    // the fixture's table is declared inline, so no source vouched for a version — and none is invented
    expect(basis.data).toEqual({});
  });

  it('the session id is minted per DASHBOARD, so two sessions on one dashboard never claim the same basis', async () => {
    const dash = buildDashboard(makeDashboardDef());
    const one = vizAsTools(dash.createSession());
    const two = vizAsTools(dash.createSession());
    expect(((await here(one))['basis'] as { session: string }).session).toBe('sess1');
    expect(((await here(two))['basis'] as { session: string }).session).toBe('sess2');
    // …and both were built from the same definition
    expect(((await here(one))['basis'] as { revision: string }).revision).toBe(dash.revision);
  });

  it('the revision moves when the definition does, and not when it is merely written differently', () => {
    const a = buildDashboard(makeDashboardDef()).revision;
    expect(buildDashboard({ ...makeDashboardDef() }).revision).toBe(a);
    expect(buildDashboard({ ...makeDashboardDef(), meta: { title: 'other' } }).revision).not.toBe(a);
  });

  it('a declared SOURCE puts its version on the basis, table by table', () => {
    const sources = { data: { format: 'csv' as const, via: 'inline' as const, version: 'v-1', retrievedAt: 'x', rows: 3 } };
    expect(dataVersionsOf(sources)).toEqual({ data: 'v-1' });
    expect(basisOf({ asOf: 'o-1', revision: 'r-1', session: 'sess1', sources })).toEqual({ asOf: 'o-1', revision: 'r-1', data: { data: 'v-1' }, session: 'sess1' });
  });
});

describe('the definition digest', () => {
  it('sorts keys, drops undefined, reads a toJSON, and names a function it cannot digest', () => {
    expect(stableJson({ b: 1, a: 2 })).toBe(stableJson({ a: 2, b: 1 }));
    expect(stableJson({ a: 1, b: undefined })).toBe(stableJson({ a: 1 }));
    expect(stableJson(new Date('2026-01-01T00:00:00.000Z'))).toBe('"2026-01-01T00:00:00.000Z"');
    expect(stableJson([1, 'x', null, true])).toBe('[1,"x",null,true]');
    expect(stableJson(undefined)).toBe('null');
    // a function is not data: only its NAME rides, which is what the module header says out loud
    expect(stableJson({ run: function named() {} })).toBe('{"run":"[function named]"}');
    expect(stableJson({ run: (): void => {} })).toContain('[function');
    expect(stableJson({ run: { toString: () => 'x' }['toString'] })).toBe('{"run":"[function toString]"}');
  });

  it('an anonymous function still digests, under a name that says it had none', () => {
    const anon = Object.defineProperty(() => {}, 'name', { value: '' });
    expect(stableJson({ run: anon })).toBe('{"run":"[function anonymous]"}');
  });

  it('the revision is prefixed so a reader can tell it from a commit id or an asOf', () => {
    expect(defRevision(makeDashboardDef())).toMatch(/^r-[0-9a-f]{8}$/);
  });
});

// ── the parts table ──────────────────────────────────────────────────────────

describe('volatility, as data', () => {
  it('every row carries the cacheClass its two axes derive, and the derivation is one function', () => {
    for (const row of SURFACE_PARTS) {
      expect(PART_SCOPES).toContain(row.scope);
      expect(PART_STABILITIES).toContain(row.stability);
      expect(CACHE_CLASSES).toContain(row.cacheClass);
      expect(row.cacheClass).toBe(cacheClassOf(row.scope, row.stability));
    }
    expect(SURFACE_PART_NAMES.size).toBe(SURFACE_PARTS.length);
  });

  it('the derivation: a claim about a position, or a value with nothing to compare, may not be kept', () => {
    expect(cacheClassOf('turn', 'immutable')).toBe('volatile');
    expect(cacheClassOf('global', 'volatile')).toBe('volatile');
    expect(cacheClassOf('session', 'versioned')).toBe('session');
    expect(cacheClassOf('principal', 'immutable')).toBe('session');
    expect(cacheClassOf('global', 'versioned')).toBe('stable');
    expect(cacheClassOf('global', 'immutable')).toBe('stable');
  });

  it('the rows a reader relies on: the declaration is stable, the position is volatile, the ledgers are this session’s', () => {
    const of = (name: string): { scope: string; stability: string; cacheClass: string } => SURFACE_PARTS.find((p) => p.part === name)!;
    expect(of('rules')).toMatchObject({ scope: 'global', stability: 'immutable', cacheClass: 'stable' });
    expect(of('encodingPolicy').cacheClass).toBe('stable');
    expect(of('offers').cacheClass).toBe('stable');
    expect(of('sources')).toMatchObject({ stability: 'versioned', cacheClass: 'stable' });
    expect(of('activeSelections')).toMatchObject({ scope: 'turn', cacheClass: 'volatile' });
    expect(of('asOf').cacheClass).toBe('volatile');
    expect(of('views').cacheClass).toBe('volatile');
    expect(of('columns')).toMatchObject({ scope: 'turn', stability: 'versioned' });
    expect(of('fdr')).toMatchObject({ scope: 'session' });
    expect(of('journal')).toMatchObject({ scope: 'global', stability: 'volatile' });
    expect(of('parts')).toMatchObject({ scope: 'global', stability: 'immutable', cacheClass: 'stable' });
  });

  it('the table is served whole, byte-stable, under its own key — a client learns the policy once', async () => {
    const p = portOf();
    const first = JSON.stringify((await here(p))['parts']);
    await p.call('viz.dispatch', { verb: 'select', viewId: 'bar', field: 'category', value: 'Formal' });
    expect(JSON.stringify((await here(p))['parts'])).toBe(first);
    expect(JSON.parse(first)).toEqual(SURFACE_PARTS);
  });
});

// ── `since` ──────────────────────────────────────────────────────────────────

describe('`since` — only what moved', () => {
  it('carries the parts that changed and lists the rest as unchanged-since', async () => {
    const p = portOf();
    const before = await here(p);
    await p.call('viz.dispatch', { verb: 'select', viewId: 'bar', field: 'category', value: 'Formal' });
    const delta = await here(p, { since: before['asOf'] as string });

    expect(delta['since']).toEqual({ requested: before['asOf'], served: 'delta' });
    const omitted = delta['omitted'] as { part: string; reason: string }[];
    expect(omitted.every((o) => o.reason === 'unchanged-since')).toBe(true);
    // the declaration did not move; the position did
    expect(omitted.map((o) => o.part)).toContain('rules');
    expect(omitted.map((o) => o.part)).toContain('columns');
    expect('activeSelections' in delta).toBe(true);
    expect('asOf' in delta).toBe(true);
    // and it is smaller than the answer it stands for
    expect(JSON.stringify(delta).length).toBeLessThan(JSON.stringify(before).length);
  });

  it('a `since` naming the position you are already at carries nothing but the basis', async () => {
    const p = portOf();
    const first = await here(p);
    const again = await here(p, { since: first['asOf'] as string });
    expect(Object.keys(again)).toEqual(['ok', 'basis', 'since', 'omitted']);
    expect((again['omitted'] as unknown[]).length).toBe(SURFACE_PARTS.length);
  });

  it('`views` narrows PER VIEW — a rebind moves one view, and the delta says which and in what order', async () => {
    const p = portOf();
    const before = await here(p);
    const res = await p.call('viz.dispatch', { verb: 'reencode', viewId: 'scatter', channel: 'color', field: 'category' });
    expect((res as { ok: boolean }).ok).toBe(true);
    const delta = await here(p, { since: before['asOf'] as string });
    const views = delta['views'] as { delta: string; by: string; order: string[]; changed: { viewId: string }[] };
    expect(isListDelta(views)).toBe(true);
    expect(views.by).toBe('viewId');
    expect(views.order).toEqual((before['views'] as { viewId: string }[]).map((v) => v.viewId));
    expect(views.changed.map((v) => v.viewId)).toEqual(['scatter']);
  });

  it('a position this port no longer holds is SAID, never guessed — the answer comes back whole', async () => {
    const p = portOf();
    const delta = await here(p, { since: 'o-deadbeef' });
    expect(delta['since']).toMatchObject({ requested: 'o-deadbeef', served: 'full', reason: 'not-held' });
    expect((delta['since'] as { detail: string }).detail).toContain(`last ${LENS_MEMO_DEPTH} positions`);
    expect('omitted' in delta).toBe(false);
    for (const part of SURFACE_PARTS) expect(part.part in delta).toBe(true);
  });

  it('a position that fell out of the memo is the same honest answer', async () => {
    const p = portOf();
    const first = await here(p);
    for (const value of ['Formal', 'Party', 'Work', 'Summer', 'Casual']) {
      await p.call('viz.dispatch', { verb: 'select', viewId: 'bar', field: 'category', value });
      await here(p);
    }
    const delta = await here(p, { since: first['asOf'] as string });
    expect(delta['since']).toMatchObject({ served: 'full', reason: 'not-held' });
  });

  it('a position that named TWO answers cannot be delta’d from, and says exactly that', async () => {
    const p = portOf();
    const first = await here(p);
    // a bookmark lands no commit and moves no cursor — so the position stays put while the answer moves
    await p.call('viz.bookmark', { label: 'the spike' });
    await here(p);
    const delta = await here(p, { since: first['asOf'] as string });
    expect(delta['since']).toMatchObject({ served: 'full', reason: 'not-held' });
    expect((delta['since'] as { detail: string }).detail).toContain('named more than one answer');
    for (const part of SURFACE_PARTS) expect(part.part in delta).toBe(true);
  });

  it('`of` and `since` compose, and the reader’s own instruction wins the reason', async () => {
    const p = portOf();
    const before = await here(p);
    await p.call('viz.dispatch', { verb: 'select', viewId: 'bar', field: 'category', value: 'Formal' });
    const delta = await here(p, { of: ['activeSelections', 'rules'], since: before['asOf'] as string });
    const omitted = delta['omitted'] as { part: string; reason: string }[];
    expect('activeSelections' in delta).toBe(true);          // asked for, and it moved
    expect('rules' in delta).toBe(false);                     // asked for, and it did not
    expect(omitted.find((o) => o.part === 'rules')!.reason).toBe('unchanged-since');
    expect(omitted.find((o) => o.part === 'views')!.reason).toBe('not-asked');
  });
});

// ── the narrowing, on its own ────────────────────────────────────────────────

describe('narrowParts', () => {
  it('serves a list WHOLE when every entry moved — a delta bigger than the list is no kindness', () => {
    const previous = { views: [{ viewId: 'a', n: 1 }] };
    const current = { views: [{ viewId: 'a', n: 2 }] };
    expect(narrowParts(current, { previous }).parts).toEqual(current);
  });

  it('narrows when some entries held still, and expresses a removal as an absence from `order`', () => {
    const previous = { views: [{ viewId: 'a', n: 1 }, { viewId: 'b', n: 1 }, { viewId: 'c', n: 1 }] };
    const current = { views: [{ viewId: 'a', n: 1 }, { viewId: 'b', n: 2 }] };
    const views = narrowParts(current, { previous }).parts['views'];
    expect(views).toEqual({ delta: 'by-id', by: 'viewId', order: ['a', 'b'], changed: [{ viewId: 'b', n: 2 }] });
    expect(applySurfaceDelta(previous, { views })).toEqual({ ok: true, answer: current });
  });

  it('narrows `links` at its EDGES and serves the rest of the graph whole', () => {
    const previous = { links: { default: 'crossfilter', views: [{ viewId: 'a' }], edges: [{ id: 'e1', r: 1 }, { id: 'e2', r: 1 }] } };
    const current = { links: { default: 'crossfilter', views: [{ viewId: 'a' }], edges: [{ id: 'e1', r: 1 }, { id: 'e2', r: 2 }] } };
    const links = narrowParts(current, { previous }).parts['links'] as { edges: unknown };
    expect(links.edges).toEqual({ delta: 'by-id', by: 'id', order: ['e1', 'e2'], changed: [{ id: 'e2', r: 2 }] });
    expect(applySurfaceDelta(previous, { links })).toEqual({ ok: true, answer: current });
  });

  it('serves whole rather than narrowing when the previous answer holds nothing to narrow against', () => {
    expect(narrowParts({ views: [{ viewId: 'a' }] }, { previous: { views: 'not a list' } }).parts).toEqual({ views: [{ viewId: 'a' }] });
    expect(narrowParts({ links: { edges: [{ id: 'e' }] } }, { previous: { links: 'not a graph' } }).parts).toEqual({ links: { edges: [{ id: 'e' }] } });
    expect(narrowParts({ links: { edges: [{ id: 'e' }] } }, { previous: { links: { edges: 'not a list' } } }).parts).toEqual({ links: { edges: [{ id: 'e' }] } });
  });

  it('a part the previous answer never held is served whole — there is nothing to narrow against', () => {
    expect(narrowParts({ views: [] }, { previous: {} }).parts).toEqual({ views: [] });
  });

  it('a list entry with no id of its own is counted as changed, never matched by position', () => {
    // a degenerate shape the real answer cannot produce, kept honest anyway: an entry an
    // overlay cannot key on is never quietly paired with whatever sat in the same slot
    const previous = { views: [{ viewId: 'a' }, { noId: 1 }, 'a scalar'] };
    const current = { views: [{ viewId: 'a' }, { noId: 2 }] };
    const views = narrowParts(current, { previous }).parts['views'];
    expect(views).toEqual({ delta: 'by-id', by: 'viewId', order: ['a', 'undefined'], changed: [{ noId: 2 }] });
    // …and applying it REFUSES rather than inventing the entry it cannot key
    const applied = applySurfaceDelta(previous, { views });
    expect(applied.ok).toBe(false);
    expect(applied.ok === false && applied.detail).toContain('holds no viewId "undefined"');
  });

  it('skips the envelope, so `ok` and `basis` are never a part and never omitted', () => {
    const out = narrowParts({ ok: true, basis: {}, omitted: [], since: {}, views: [] }, { wanted: new Set<string>() });
    expect(out.parts).toEqual({});
    expect(out.omitted).toEqual([{ part: 'views', reason: 'not-asked' }]);
  });
});

describe('applySurfaceDelta — the door that makes a delta checkable rather than trusted', () => {
  it('keeps what the delta does not carry, replaces what it does, and never copies the delta’s own bookkeeping', () => {
    const previous = { ok: true, views: [{ viewId: 'a' }], rules: ['one'], basis: { asOf: 'o-1' } };
    const applied = applySurfaceDelta(previous, { ok: true, rules: ['two'], basis: { asOf: 'o-2' }, since: { served: 'delta' }, omitted: [{ part: 'views' }] });
    expect(applied).toEqual({ ok: true, answer: { ok: true, views: [{ viewId: 'a' }], rules: ['two'], basis: { asOf: 'o-2' } } });
  });

  it('drops the previous answer’s own bookkeeping too — a narrowed answer handed back is not a delta', () => {
    const previous = { ok: true, rules: ['a'], omitted: [{ part: 'views', reason: 'not-asked' }], since: { requested: 'o-1', served: 'delta' } };
    expect(applySurfaceDelta(previous, { rules: ['b'] })).toEqual({ ok: true, answer: { ok: true, rules: ['b'] } });
  });

  it('takes a part the previous answer never held, and walks into an object to find a nested overlay', () => {
    const applied = applySurfaceDelta({ ok: true }, { charts: [{ chartId: 'c1' }], links: { edges: { delta: 'by-id', by: 'id', order: ['e1'], changed: [{ id: 'e1' }] } } });
    expect(applied).toEqual({ ok: true, answer: { ok: true, charts: [{ chartId: 'c1' }], links: { edges: [{ id: 'e1' }] } } });
  });

  it('REFUSES with a sentence when the answer it is applied to cannot support the overlay', () => {
    const delta = { views: { delta: 'by-id', by: 'viewId', order: ['a', 'b'], changed: [{ viewId: 'b' }] } };
    const missing = applySurfaceDelta({ views: [] }, delta);
    expect(missing.ok).toBe(false);
    expect(missing.ok === false && missing.detail).toContain('holds no viewId "a"');
    expect(missing.ok === false && missing.detail).toContain('ask again without `since`');
    // and an entry with no id at all is simply not a thing an overlay can key on
    const unkeyed = applySurfaceDelta({ views: [{ noId: 1 }] }, delta);
    expect(unkeyed.ok).toBe(false);
  });

  it('isListDelta only says yes to a shape an overlay can actually use', () => {
    expect(isListDelta({ delta: 'by-id', by: 'id', order: [], changed: [] })).toBe(true);
    expect(isListDelta({ delta: 'by-id', by: 'id', order: [], changed: {} })).toBe(false);
    expect(isListDelta({ delta: 'by-id', by: 'id', order: {}, changed: [] })).toBe(false);
    expect(isListDelta({ delta: 'by-id', by: 7, order: [], changed: [] })).toBe(false);
    expect(isListDelta({ delta: 'other' })).toBe(false);
    expect(isListDelta(null)).toBe(false);
    expect(isListDelta([])).toBe(false);
  });
});
