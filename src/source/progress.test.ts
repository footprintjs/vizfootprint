/**
 * progress.test.ts — WHAT A DECLARED LENGTH MAY BE TRUSTED FOR, and what a
 * report may say.
 *
 * The measured trap (`./progress.ts`, `./README.md`): a 169 MB response came
 * back `content-encoding: gzip`, so its `content-length` counted COMPRESSED
 * bytes while the bytes a reader accumulates are DECODED. Every rule in this
 * file exists so that a pair like that can never become a percentage.
 */
import { describe, it, expect } from 'vitest';
import { declaredLength, progressFraction, reportProgress, tooLargeOnArrival, totalOf } from './progress.js';
import type { ResourceProgress } from './progress.js';

const headers = (h: Readonly<Record<string, string>>): Headers => new Headers(h);

describe('declaredLength — refuse on evidence, never on ignorance', () => {
  it('a plain count of these very bytes IS a total', () => {
    expect(declaredLength(headers({ 'content-length': '2048' }))).toEqual({ kind: 'total', bytes: 2048 });
    // whitespace is the wire's, not the number's
    expect(declaredLength(headers({ 'content-length': ' 2048 ' }))).toEqual({ kind: 'total', bytes: 2048 });
    // …and an explicit "no encoding" changes nothing, in either header and in either case
    expect(declaredLength(headers({ 'content-length': '7', 'content-encoding': 'identity' }))).toEqual({ kind: 'total', bytes: 7 });
    expect(declaredLength(headers({ 'content-length': '7', 'content-encoding': 'IDENTITY ' }))).toEqual({ kind: 'total', bytes: 7 });
  });

  it('NO DECLARATION, and anything that is not a count, is "none" — nothing to compare', () => {
    expect(declaredLength(headers({}))).toEqual({ kind: 'none' });
    expect(declaredLength(headers({ 'content-length': '' }))).toEqual({ kind: 'none' });
    expect(declaredLength(headers({ 'content-length': 'abc' }))).toEqual({ kind: 'none' });
    expect(declaredLength(headers({ 'content-length': '-5' }))).toEqual({ kind: 'none' });
    expect(declaredLength(headers({ 'content-length': '5.5' }))).toEqual({ kind: 'none' });
    // a proxy that doubled the header: two counts are not a count
    expect(declaredLength(headers({ 'content-length': '5, 5' }))).toEqual({ kind: 'none' });
  });

  it('THE GZIP TRAP: a real count, but OF OTHER BYTES — and it says which header proves it', () => {
    expect(declaredLength(headers({ 'content-length': '96', 'content-encoding': 'gzip' }))).toEqual({
      kind: 'other-bytes',
      bytes: 96,
      because: 'the body arrived content-encoding: gzip',
    });
    // a chain of encodings, and a transfer encoding, are the same fact
    expect(declaredLength(headers({ 'content-length': '96', 'content-encoding': 'gzip, br' })).kind).toBe('other-bytes');
    expect(declaredLength(headers({ 'content-length': '96', 'transfer-encoding': 'chunked' }))).toEqual({
      kind: 'other-bytes',
      bytes: 96,
      because: 'the body arrived transfer-encoding: chunked',
    });
  });

  it('BOTH ways of not knowing answer the same total: undefined, never a zero', () => {
    expect(totalOf({ kind: 'total', bytes: 5 })).toBe(5);
    expect(totalOf({ kind: 'none' })).toBeUndefined();
    expect(totalOf({ kind: 'other-bytes', bytes: 96, because: 'the body arrived content-encoding: gzip' })).toBeUndefined();
  });
});

describe('progressFraction — the ONE division, and it never lies', () => {
  const at = (bytes: number, total?: number): ResourceProgress => ({ resource: 'structure', bytes, ...(total === undefined ? {} : { total }) });

  it('an unknown total has NO fraction — an answer, not a zero', () => {
    expect(progressFraction(at(1024))).toBeUndefined();
    // …and neither does a total of nothing (a body with no bytes never lands: it is `unavailable`)
    expect(progressFraction(at(0, 0))).toBeUndefined();
  });

  it('a trusted total gives the fraction, and CLAMPS at 1 — a bar past 100% is the lie this exists to stop', () => {
    expect(progressFraction(at(512, 2048))).toBe(0.25);
    expect(progressFraction(at(2048, 2048))).toBe(1);
    // a server that declared wrongly and sent more: the answer is "at the end", never 8.5
    expect(progressFraction(at(35_000, 96))).toBe(1);
  });
});

describe('reportProgress — a report is not a record', () => {
  it('fires with the progress as given', () => {
    const seen: ResourceProgress[] = [];
    reportProgress((p) => seen.push(p), { resource: 'structure', bytes: 10, total: 20 });
    expect(seen).toEqual([{ resource: 'structure', bytes: 10, total: 20 }]);
  });

  it('an observer that THROWS changes nothing — nothing about the read may turn on a report', () => {
    expect(() =>
      reportProgress(() => {
        throw new Error('the host\'s own render blew up');
      }, { resource: 'structure', bytes: 10 }),
    ).not.toThrow();
  });
});

describe('tooLargeOnArrival — the tail that used to lie', () => {
  it('a server that declared NOTHING keeps the sentence it always had', () => {
    expect(tooLargeOnArrival(5, 'bytes', { kind: 'none' }, 2)).toBe('too-large — 5 bytes arrived (the server declared no length), the cap is 2');
  });

  it('a server that DID declare is quoted instead of contradicted', () => {
    expect(tooLargeOnArrival(5, 'bytes', { kind: 'total', bytes: 3 }, 2)).toBe('too-large — 5 bytes arrived (the server declared 3), the cap is 2');
  });

  it('…and a declaration OF OTHER BYTES says so, which is the gzip case the old sentence called "no length"', () => {
    expect(tooLargeOnArrival(35_000, 'UTF-16 units', { kind: 'other-bytes', bytes: 96, because: 'the body arrived content-encoding: gzip' }, 1000)).toBe(
      'too-large — 35000 UTF-16 units arrived (the server declared 96 bytes, but the body arrived content-encoding: gzip — that count is not these bytes), the cap is 1000',
    );
  });
});
