/**
 * conformance.test.ts — A FALSE MONOTONE CLAIM MUST FAIL IN CI, not on
 * somebody's screen.
 *
 * The library cannot check that a fold is really monotone. So the suite runs
 * the falsifier over its OWN folds — which is the whole point of building it as
 * a callable — and over two deliberately broken ones: a fold whose answer falls
 * as bytes arrive, and a fold that answers about the transport rather than the
 * bytes. Both must FAIL, or the check is decoration.
 */
import { describe, it, expect } from 'vitest';
import { falsifyMonotone } from './conformance.js';
import type { ResourceFold } from './types.js';

const ENCODE = new TextEncoder();
const DECODE = new TextDecoder();
const chunks = (...texts: readonly string[]): readonly Uint8Array[] => texts.map((text) => ENCODE.encode(text));

const ALIGNMENT = chunks('# STOCKHOLM 1.0\n#=GF AC   PF00545.26\n', 'UniRef/1-9   ACDEFGHIK\n', 'UniRef/2-9   ACDEFGHIL\n', 'UniRef/3-9   ACD\n');

/** MONOTONE and true: a count of lines seen so far only ever rises. */
const seenSoFar: ResourceFold<number, number> = {
  name: 'sequences',
  at: 'incremental',
  start: () => 0,
  take: (n, chunk) => n + chunk.reduce((seen, byte) => (byte === 0x0a ? seen + 1 : seen), 0),
  finish: (n) => n,
};

/** MONOTONE and true: a running maximum. */
const longestLine: ResourceFold<{ readonly best: number; readonly run: number }, number> = {
  name: 'width',
  at: 'incremental',
  start: () => ({ best: 0, run: 0 }),
  take: (state, chunk) => chunk.reduce((s, byte) => (byte === 0x0a ? { best: Math.max(s.best, s.run), run: 0 } : { best: s.best, run: s.run + 1 }), state),
  finish: (state) => Math.max(state.best, state.run),
};

/** A `head` fold, which claims nothing about prefixes — only that it is about the bytes. */
const accession: ResourceFold<string, string | undefined> = {
  name: 'accession',
  at: 'head',
  headBytes: 37,
  start: () => '',
  take: (_seen, head) => DECODE.decode(head),
  finish: (text) => /#=GF AC\s+(\S+)/.exec(text)?.[1],
};

/** A MONOTONE claim whose answer GROWS rather than rises — the case the default order will not pass on its own. */
const labelsSeen: ResourceFold<readonly string[], readonly string[]> = {
  name: 'labels',
  at: 'incremental',
  start: () => [],
  take: (seen, chunk) => [...seen, ...(DECODE.decode(chunk).match(/UniRef\/\d+/g) ?? [])],
  finish: (seen) => seen,
};

describe('the suite falsifies its OWN folds', () => {
  it('a count so far, a running maximum and a head fact all pass', () => {
    expect(falsifyMonotone({ fold: seenSoFar, chunks: ALIGNMENT })).toEqual({ ok: true });
    expect(falsifyMonotone({ fold: longestLine, chunks: ALIGNMENT })).toEqual({ ok: true });
    expect(falsifyMonotone({ fold: accession, chunks: ALIGNMENT })).toEqual({ ok: true });
  });

  it('…and an answer that GROWS passes once its author says what growing means', () => {
    const grew = (earlier: readonly string[], later: readonly string[]): boolean => earlier.every((label, i) => later[i] === label);
    expect(falsifyMonotone({ fold: labelsSeen, chunks: ALIGNMENT, grew })).toEqual({ ok: true });
    // the DEFAULT is the strictest honest reading, so the same fold without that sentence is not taken on trust
    expect(falsifyMonotone({ fold: labelsSeen, chunks: ALIGNMENT })).toEqual({
      failed: 'the fold "labels" attaches INCREMENTALLY, which claims only facts later bytes cannot overturn — and its answer went from [] over 1 chunks to ["UniRef/1"] over 2',
    });
  });
});

describe('a false claim FAILS', () => {
  it('an answer that falls as bytes arrive is falsified, and the sentence says which two answers disagreed', () => {
    // a plausible-looking number: how much of a 64-byte budget is left. It is a function of
    // the bytes, it is not a function of the framing, and later bytes OVERTURN it.
    const budgetLeft: ResourceFold<number, number> = {
      name: 'budget',
      at: 'incremental',
      start: () => 0,
      take: (n, chunk) => n + chunk.byteLength,
      finish: (n) => 64 - n,
    };
    expect(falsifyMonotone({ fold: budgetLeft, chunks: ALIGNMENT })).toEqual({
      failed: 'the fold "budget" attaches INCREMENTALLY, which claims only facts later bytes cannot overturn — and its answer went from 27 over 1 chunks to 4 over 2',
    });
  });

  it('a fold that answers about the TRANSPORT rather than the bytes is falsified before monotonicity is even asked', () => {
    const chunksSeen: ResourceFold<number, number> = {
      name: 'pieces',
      at: 'incremental',
      start: () => 0,
      take: (n) => n + 1,
      finish: (n) => n,
    };
    expect(falsifyMonotone({ fold: chunksSeen, chunks: ALIGNMENT })).toEqual({
      failed:
        'the fold "pieces" answers {"value":4} over 4 chunks and {"value":1} over the same bytes in one — an answer that turns on how the bytes were FRAMED is not an answer about the bytes',
    });
  });

  it('…including one that only breaks at a chunk boundary, which is the bug real folds have', () => {
    // reads the accession by decoding each chunk ALONE, so a header split in two loses it
    const perChunk: ResourceFold<string | undefined, string | undefined> = {
      name: 'accession',
      at: 'incremental',
      start: () => undefined,
      take: (found, chunk) => found ?? /#=GF AC\s+(\S+)/.exec(DECODE.decode(chunk))?.[1],
      finish: (found) => found,
    };
    const split = chunks('# STOCKHOLM 1.0\n#=GF AC   PF0', '0545.26\nUniRef/1-9   ACDEFGHIK\n');
    expect(falsifyMonotone({ fold: perChunk, chunks: split })).toEqual({
      failed:
        'the fold "accession" answers {"value":"PF0"} over 2 chunks and {"value":"PF00545.26"} over the same bytes in one — an answer that turns on how the bytes were FRAMED is not an answer about the bytes',
    });
  });

  it('a REFUSAL is an outcome a framing may not change either', () => {
    // a head fold whose bound no framing of this body can satisfy: it refuses both ways, which AGREES
    const tooBig: ResourceFold<number, number> = { ...seenSoFar, name: 'header', at: 'head', headBytes: 10_000 };
    expect(falsifyMonotone({ fold: tooBig, chunks: ALIGNMENT })).toEqual({ ok: true });
  });
});

describe('what the check needs, and says when it does not have it', () => {
  it('a prefix — so a body in one piece is not something it can falsify', () => {
    expect(falsifyMonotone({ fold: seenSoFar, chunks: ALIGNMENT.slice(0, 1) })).toEqual({
      failed: 'the fold "sequences" was checked over 1 chunk(s), and what this falsifies is what a PREFIX answers — give it the body in pieces',
    });
  });
});
