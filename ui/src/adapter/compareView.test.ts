// @vitest-environment node
//
// The plain-language compare normalizer: every FoldEntry kind reads as words a
// non-developer understands, and every defensive wire arm (a compare arriving
// as poll JSON) is exercised — missing gap detail, absent diff arrays, unknown
// value shapes.
import { describe, it, expect } from 'vitest';
import { mapCompareResult, entryLabel, entryDetail } from './compareView.js';

const SEL_POINT = { kind: 'selection', viewId: 'bar', clause: { kind: 'point', field: 'category', value: 'Formal' }, commitId: 'c1' } as const;
const SEL_RANGE = { kind: 'selection', viewId: 'scatter', clause: { kind: 'interval', field: 'price', value: [30, 210] }, commitId: 'c2' } as const;
const SEL_CLEAR = { kind: 'selection', viewId: 'scatter', clause: { kind: 'interval', field: 'price', value: null }, commitId: 'c3' } as const;
const ENC = { kind: 'encoding', viewId: 'scatter', channel: 'x', field: 'x', value: 'price', commitId: 'c4' } as const;
const TEST = { kind: 'analysis', analysisId: 'correlation', field: 'pValue', value: 0.004, commitId: 'c5' } as const;
const TRANSFORM = { kind: 'analysis', analysisId: 'cluster', field: '__analysis__', value: 'done', commitId: 'c6' } as const;

describe('entryLabel / entryDetail — plain language for each fold-entry kind', () => {
  it('selections read as "field is value" / "field between lo and hi" / "filter cleared"', () => {
    expect(entryLabel(SEL_POINT)).toBe('bar');
    expect(entryDetail(SEL_POINT)).toBe('category is Formal');
    expect(entryDetail(SEL_RANGE)).toBe('price between 30 and 210');
    expect(entryDetail(SEL_CLEAR)).toBe('price filter cleared');
  });

  it('encodings read as "channel axis shows field"; analyses surface p when numeric', () => {
    expect(entryLabel(ENC)).toBe('scatter');
    expect(entryDetail(ENC)).toBe('x axis shows price');
    expect(entryLabel(TEST)).toBe('correlation');
    expect(entryDetail(TEST)).toBe('test ran (p = 0.004)');
    expect(entryDetail(TRANSFORM)).toBe('ran');
  });

  it('a tiny p rounds to 2 significant digits — plain words, never a float dump', () => {
    expect(entryDetail({ kind: 'analysis', analysisId: 'corr', field: 'pValue', value: 0.00001855381883775209 })).toBe('test ran (p = 0.000019)');
  });

  it('defensive wire arms: missing viewId/analysisId/clause/channel and non-scalar values stay safe words', () => {
    expect(entryLabel({ kind: 'selection' })).toBe('view');
    expect(entryLabel({ kind: 'analysis' })).toBe('analysis');
    expect(entryDetail({ kind: 'selection' })).toBe('a selection'); // no clause on the wire
    expect(entryDetail({ kind: 'encoding', value: 'price' })).toBe('? axis shows price'); // no channel
    // word(): null/undefined → '—'; an object value never dumps
    expect(entryDetail({ kind: 'selection', clause: { kind: 'point', field: 'f', value: undefined } })).toBe('f is —');
    expect(entryDetail({ kind: 'selection', clause: { kind: 'point', field: 'f', value: { deep: true } } })).toBe('f is a value');
    expect(entryDetail({ kind: 'selection', clause: { kind: 'interval', field: 'f', value: [null, 9] } })).toBe('f up to 9');
  });
});

describe('entryDetail — FILTER-1: half-open interval bounds read as "at least"/"up to"', () => {
  it('a lower-bound-only interval ([lo, null]) reads "at least lo"', () => {
    expect(entryDetail({ kind: 'selection', clause: { kind: 'interval', field: 'price', value: [150, null] } })).toBe('price at least 150');
  });

  it('an upper-bound-only interval ([null, hi]) reads "up to hi"', () => {
    expect(entryDetail({ kind: 'selection', clause: { kind: 'interval', field: 'price', value: [null, 150] } })).toBe('price up to 150');
  });

  it('a half-open DATE interval reads in the same words, with the date string verbatim', () => {
    expect(entryDetail({ kind: 'selection', clause: { kind: 'interval', field: 'date', value: [null, '2026-05-31'] } })).toBe('date up to 2026-05-31');
    expect(entryDetail({ kind: 'selection', clause: { kind: 'interval', field: 'date', value: ['2026-05-01', null] } })).toBe('date at least 2026-05-01');
  });

  it('a full [lo, hi] interval still reads "between lo and hi" (unchanged)', () => {
    expect(entryDetail({ kind: 'selection', clause: { kind: 'interval', field: 'date', value: ['2026-05-01', '2026-05-31'] } })).toBe(
      'date between 2026-05-01 and 2026-05-31',
    );
  });
});

describe('mapCompareResult', () => {
  it('normalizes a full ok result: sides, ancestor, changed with per-side words, only-lists', () => {
    const v = mapCompareResult({
      ok: true,
      a: { ref: 'main', tip: 't1', rows: 12 },
      b: { ref: 'premium', tip: 't2', rows: null },
      ancestor: 'c0',
      changed: [{ key: 'selection|scatter', a: SEL_RANGE, b: { ...SEL_RANGE, clause: { kind: 'interval', field: 'price', value: [120, 220] } } }],
      onlyA: [{ key: 'analysis|correlation', value: TEST }],
      onlyB: [{ key: 'encoding|scatter|x', value: ENC }],
    });
    expect(v).toEqual({
      ok: true,
      a: { ref: 'main', tip: 't1', rows: 12 },
      b: { ref: 'premium', tip: 't2', rows: null },
      ancestor: 'c0',
      changed: [{ key: 'selection|scatter', kind: 'selection', label: 'scatter', a: 'price between 30 and 210', b: 'price between 120 and 220' }],
      onlyA: [{ key: 'analysis|correlation', kind: 'analysis', label: 'correlation', detail: 'test ran (p = 0.004)' }],
      onlyB: [{ key: 'encoding|scatter|x', kind: 'encoding', label: 'scatter', detail: 'x axis shows price' }],
    });
  });

  it('fills absent diff arrays and a missing ancestor defensively (sparse poll JSON)', () => {
    const v = mapCompareResult({ ok: true, a: { ref: 'a', tip: 'a', rows: null }, b: { ref: 'b', tip: 'b', rows: null } });
    expect(v).toEqual({ ok: true, a: { ref: 'a', tip: 'a', rows: null }, b: { ref: 'b', tip: 'b', rows: null }, ancestor: null, changed: [], onlyA: [], onlyB: [] });
  });

  it('a rejected compare keeps the gap detail as the honest reason, with a fallback', () => {
    expect(mapCompareResult({ ok: false, gap: { detail: 'unknown path or commit id(s): zz' } })).toEqual({ ok: false, reason: 'unknown path or commit id(s): zz' });
    expect(mapCompareResult({ ok: false })).toEqual({ ok: false, reason: 'compare failed' });
  });
});

describe('D30 — a cell selection entry in plain words', () => {
  it('renders both sides joined with "and" (interval + point, half-open included)', () => {
    expect(
      entryDetail({
        kind: 'selection',
        viewId: 'heatmap',
        clause: { kind: 'cell', field: 'price × category', fields: ['price', 'category'], value: [[100, 150], 'Formal'] },
      }),
    ).toBe('price between 100 and 150 and category is Formal');
    expect(
      entryDetail({
        kind: 'selection',
        viewId: 'heatmap',
        clause: { kind: 'cell', field: 'price × category', fields: ['price', 'category'], value: [[150, null], 'Formal'] },
      }),
    ).toBe('price at least 150 and category is Formal');
    expect(
      entryDetail({
        kind: 'selection',
        viewId: 'heatmap',
        clause: { kind: 'cell', field: 'date × category', fields: ['date', 'category'], value: [[null, '2026-05-31'], 'Party'] },
      }),
    ).toBe('date up to 2026-05-31 and category is Party');
    expect(
      entryDetail({
        kind: 'selection',
        viewId: 'heatmap',
        clause: { kind: 'cell', field: 'category × rating', fields: ['category', 'rating'], value: ['Formal', 5] },
      }),
    ).toBe('category is Formal and rating is 5');
  });

  it('a cleared cell — or one that lost its pair — reads honestly, never a guessed split', () => {
    expect(
      entryDetail({ kind: 'selection', viewId: 'heatmap', clause: { kind: 'cell', field: 'price × category', fields: ['price', 'category'], value: null } }),
    ).toBe('price × category cell cleared');
    expect(
      entryDetail({ kind: 'selection', viewId: 'heatmap', clause: { kind: 'cell', field: 'price × category', value: [[1, 2], 'x'] } }),
    ).toBe('price × category cell cleared');
  });
});

describe('entryDetail — match (SET-1)', () => {
  const entry = (value: unknown) => ({ kind: 'selection' as const, viewId: 'bar', clause: { kind: 'match' as const, field: 'category', value }, commitId: 'c1' });
  it('reads "in {…}" / "not in {…}" — the chips\' and the commit log\'s own words; a cleared match says so', () => {
    expect(entryDetail(entry({ values: ['A', 'B'] }))).toBe('category in {A, B}');
    expect(entryDetail(entry({ values: ['A'], exclude: true }))).toBe('category not in {A}');
    expect(entryDetail(entry(null))).toBe('category match cleared');
    expect(entryDetail(entry({}))).toBe('category in {}');
  });
});

describe('entryDetail — a link entry (layer 4)', () => {
  it('names the edge; a bare link entry says so', () => {
    expect(entryDetail({ kind: 'link', edgeId: 'map:point→bar', link: { source: 'map', kind: 'point', target: 'bar', response: 'highlight' }, commitId: 'l1' })).toBe('map point → bar: highlight');
    expect(entryDetail({ kind: 'link', edgeId: 'map:point→bar', commitId: 'l1' })).toBe('a link edit');
  });
});
