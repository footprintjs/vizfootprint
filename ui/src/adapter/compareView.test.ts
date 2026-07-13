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

  it('defensive wire arms: missing viewId/analysisId/clause/channel and non-scalar values stay safe words', () => {
    expect(entryLabel({ kind: 'selection' })).toBe('view');
    expect(entryLabel({ kind: 'analysis' })).toBe('analysis');
    expect(entryDetail({ kind: 'selection' })).toBe('a selection'); // no clause on the wire
    expect(entryDetail({ kind: 'encoding', value: 'price' })).toBe('? axis shows price'); // no channel
    // word(): null/undefined → '—'; an object value never dumps
    expect(entryDetail({ kind: 'selection', clause: { kind: 'point', field: 'f', value: undefined } })).toBe('f is —');
    expect(entryDetail({ kind: 'selection', clause: { kind: 'point', field: 'f', value: { deep: true } } })).toBe('f is a value');
    expect(entryDetail({ kind: 'selection', clause: { kind: 'interval', field: 'f', value: [null, 9] } })).toBe('f between — and 9');
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
