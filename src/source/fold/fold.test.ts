/**
 * fold.test.ts — A COMPUTATION DECLARES WHERE IT MAY ATTACH.
 *
 * The pure core, with no wire anywhere near it: the three positions over the
 * body that forced them (a Stockholm alignment's header, its depth, its width),
 * a head fold whose bytes arrive every way they can arrive, the refusal a
 * declared head the body never delivered earns, several folds composing over
 * one resource, and residency DERIVED from the declarations.
 *
 * Every fold here is one a host could write, because that is the point: the
 * library ships the port and the positions, not the biology.
 */
import { describe, it, expect } from 'vitest';
import { declareFolds, residencyOf } from './declare.js';
import { answersOf, foldOver, reportAnswer } from './run.js';
import type { DeclaredFold, FoldAnswer, ResourceFold } from './types.js';

const DECODE = new TextDecoder();
const ENCODE = new TextEncoder();
const bytes = (text: string): Uint8Array => ENCODE.encode(text);

/** The measured body in miniature: a Stockholm header, then sequences, then the terminator. */
const HEADER = '# STOCKHOLM 1.0\n#=GF AC   PF00545.26\n#=GF SQ   3982\n';
const SEQS = 'UniRef/1-9        ACDEFGHIK\nUniRef/2-9        ACDEFGHIL\nUniRef/3-9        ACDEFGHIM\n';
const BODY = `${HEADER}${SEQS}//\n`;

/** `head` — the accession, which is structurally present in the first bytes and nothing later can touch. */
const accession: ResourceFold<string, string | undefined> = {
  name: 'accession',
  at: 'head',
  headBytes: 48,
  start: () => '',
  take: (_seen, head) => DECODE.decode(head),
  finish: (text) => /#=GF AC\s+(\S+)/.exec(text)?.[1],
};

/** `incremental` — sequences seen SO FAR, which later bytes can add to and never overturn. */
const seenSoFar: ResourceFold<number, number> = {
  name: 'sequences',
  at: 'incremental',
  start: () => 0,
  take: (n, chunk) => n + chunk.reduce((seen, byte) => (byte === 0x0a ? seen + 1 : seen), 0),
  finish: (n) => n,
};

/** `whole` — the widest line, which is not known until the last one has been seen. */
const widest: ResourceFold<{ readonly best: number; readonly run: number }, number> = {
  name: 'width',
  at: 'whole',
  start: () => ({ best: 0, run: 0 }),
  take: (state, chunk) =>
    chunk.reduce((s, byte) => (byte === 0x0a ? { best: Math.max(s.best, s.run), run: 0 } : { best: s.best, run: s.run + 1 }), state),
  finish: (state) => Math.max(state.best, state.run),
};

/** The body in `size`-byte pieces — the one thing a host never controls. */
function pieces(text: string, size: number): readonly Uint8Array[] {
  const whole = bytes(text);
  const out: Uint8Array[] = [];
  for (let at = 0; at < whole.byteLength; at += size) out.push(whole.subarray(at, Math.min(at + size, whole.byteLength)));
  return out;
}

/** The answers, or the sentence saying there were none. */
function answered(folds: readonly DeclaredFold[], chunks: readonly Uint8Array[]): Readonly<Record<string, unknown>> {
  const out = foldOver('alignment', folds, chunks);
  if ('refused' in out) throw new Error(`unexpected refusal: ${out.refused}`);
  return out.answers;
}

/** …and the refusal, or a sentence saying it answered. */
function refusalOf(folds: readonly DeclaredFold[], chunks: readonly Uint8Array[]): string {
  const out = foldOver('alignment', folds, chunks);
  return 'refused' in out ? out.refused : `no refusal: ${JSON.stringify(out.answers)}`;
}

describe('head — a DECLARED number of leading bytes', () => {
  it('answers the accession over a head that arrives in ONE chunk, and stamps the extent it is true of', () => {
    const out = foldOver('alignment', [accession], [bytes(BODY)]);
    expect(out).toEqual({
      answers: { accession: 'PF00545.26' },
      delivered: [{ resource: 'alignment', fold: 'accession', at: 'head', bytes: 48, value: 'PF00545.26' }],
    });
  });

  it('…and the SAME answer over a head split across chunks, every size, down to one byte at a time', () => {
    for (const size of [1, 2, 7, 16, 47, 48, 49, 1000]) {
      expect(answered([accession], pieces(BODY, size)), `${String(size)}-byte chunks`).toEqual({ accession: 'PF00545.26' });
    }
  });

  it('answers on the chunk that COMPLETED the head — while the rest of the body is still to come', () => {
    const chunks = pieces(BODY, 16); // 48 declared bytes = the third chunk
    const declared = declareFolds('alignment', [accession]);
    if ('rejected' in declared) throw new Error(declared.rejected);
    const when: number[] = [];
    let arrived = 0;
    chunks.forEach((chunk, index) => {
      arrived += chunk.byteLength;
      for (const _answer of declared.tap.push(chunk, arrived)) when.push(index);
    });
    expect(when).toEqual([2]); // the third chunk, and no other
    expect(chunks.length).toBeGreaterThan(3); // …with the body still arriving after it
  });

  it('sees EXACTLY its declared bytes, whatever chunk the bound falls inside', () => {
    // a fold that reports the head it was handed, so the trim is measured rather than assumed
    const asGiven: ResourceFold<Uint8Array, string> = {
      name: 'head',
      at: 'head',
      headBytes: 20,
      start: () => new Uint8Array(0),
      take: (_seen, head) => head,
      finish: (head) => `${String(head.byteLength)}:${DECODE.decode(head)}`,
    };
    for (const size of [1, 3, 20, 512]) {
      expect(answered([asGiven], pieces(BODY, size)), `${String(size)}-byte chunks`).toEqual({ head: `20:${BODY.slice(0, 20)}` });
    }
  });

  it('folds the head ONCE and lets the rest of the body go by — a head fold over 169 MB costs the head', () => {
    let took = 0;
    const counted: ResourceFold<number, number> = {
      name: 'head',
      at: 'head',
      headBytes: 4,
      start: () => 0,
      take: (n, head) => {
        took += 1;
        return n + head.byteLength;
      },
      finish: (n) => n,
    };
    expect(answered([counted], pieces(BODY, 4))).toEqual({ head: 4 });
    expect(took).toBe(1);
  });

  it('A HEAD FOLD THAT NEVER GETS ITS BYTES SAYS SO, rather than answering from what it got', () => {
    // a short body is not a small header: the accession regex would have matched nothing and
    // `undefined` would have looked like an answer
    expect(refusalOf([accession], pieces(HEADER.slice(0, 30), 8))).toBe(
      'the fold "accession" declared it needs the first 48 bytes and the body ended after 30; a short body is not a small header, so nothing was folded',
    );
  });

  it('…and it is the WHOLE read that is refused: no answer from any fold rides a body that could not satisfy a declaration', () => {
    expect(refusalOf([seenSoFar, accession], pieces(HEADER.slice(0, 30), 8))).toContain('a short body is not a small header');
  });
});

describe('incremental — a growing prefix, and only monotone facts', () => {
  it('answers after EVERY chunk, each stamped with the prefix it is true of', () => {
    const out = foldOver('alignment', [seenSoFar], pieces(BODY, 48));
    if ('refused' in out) throw new Error(out.refused);
    // the extent is what makes "so far" honest: the value AND the bytes it was true of
    expect(out.delivered.map((a) => [a.bytes, a.value])).toEqual([
      [48, 2],
      [96, 4],
      [139, 7],
    ]);
    expect(out.delivered.every((a) => a.at === 'incremental')).toBe(true);
    // …and the answer a caller that ignored the channel is handed is the one over the whole body
    expect(out.answers).toEqual({ sequences: 7 });
  });

  it('is a function of the BYTES and not their framing: every chunking answers the same', () => {
    for (const size of [1, 5, 48, 1000]) expect(answered([seenSoFar], pieces(BODY, size))).toEqual({ sequences: 7 });
  });
});

describe('whole — everything, once, at the end', () => {
  it('answers once, over all the bytes', () => {
    const out = foldOver('alignment', [widest], pieces(BODY, 16));
    if ('refused' in out) throw new Error(out.refused);
    expect(out.delivered).toEqual([{ resource: 'alignment', fold: 'width', at: 'whole', bytes: 139, value: 27 }]);
  });
});

describe('several folds over ONE resource, at different positions', () => {
  it('compose: the early answer early, the running one per chunk, the last one last — in declaration order', () => {
    const out = foldOver('alignment', [accession, seenSoFar, widest], pieces(BODY, 64));
    if ('refused' in out) throw new Error(out.refused);
    expect(out.delivered.map((a) => `${a.fold}@${String(a.bytes)}`)).toEqual([
      'accession@48', // the first chunk carried the declared head
      'sequences@64',
      'sequences@128',
      'sequences@139',
      'width@139', // …and the one that needed everything answered when there was everything
    ]);
    expect(out.answers).toEqual({ accession: 'PF00545.26', sequences: 7, width: 27 });
  });

  it('the answer a caller is handed is the LAST each fold gave', () => {
    const rows: readonly FoldAnswer[] = [
      { resource: 'alignment', fold: 'sequences', at: 'incremental', bytes: 10, value: 1 },
      { resource: 'alignment', fold: 'sequences', at: 'incremental', bytes: 20, value: 2 },
    ];
    expect(answersOf(rows)).toEqual({ sequences: 2 });
  });
});

describe('a declaration is judged before a byte moves', () => {
  const rejectedFor = (folds: readonly DeclaredFold[]): string => {
    const out = declareFolds('alignment', folds);
    return 'rejected' in out ? out.rejected : 'accepted';
  };

  it('a read that folds nothing is a snapshot', () => {
    expect(rejectedFor([])).toBe('no fold was declared, and a read that folds nothing is `snapshot()` — which lands the bytes');
    // …and a driver handed the same declaration answers the same sentence rather than folding nothing quietly
    expect(refusalOf([], pieces(BODY, 8))).toBe('no fold was declared, and a read that folds nothing is `snapshot()` — which lands the bytes');
  });

  it('a fold must be named, because a name is how its answer is told apart', () => {
    expect(rejectedFor([{ ...seenSoFar, name: '' }])).toBe("a fold's name is how its answer is told apart, so it must be a non-empty string, and this one declares \"\"");
    expect(rejectedFor([{ ...seenSoFar, name: 7 } as unknown as DeclaredFold])).toContain('and this one declares 7');
  });

  it('…and two folds may not answer under one name', () => {
    expect(rejectedFor([seenSoFar, { ...seenSoFar, at: 'whole' }])).toBe('two folds are both named "sequences" — a fold\'s name is how its answer is told apart');
  });

  it('a head fold DECLARES ITS BOUND, and a bound that is not a count declares nothing', () => {
    const withBound = (headBytes: unknown): string => rejectedFor([{ ...accession, headBytes } as unknown as DeclaredFold]);
    expect(withBound(0)).toBe(
      'the fold "accession" attaches at head, so it must declare how many bytes the head is — the head is not a natural quantity — and `headBytes` is 0',
    );
    expect(withBound(48.5)).toContain('`headBytes` is 48.5');
    expect(withBound(undefined)).toContain('`headBytes` is undefined');
    expect(withBound(-1)).toContain('`headBytes` is -1');
    expect(withBound(48)).toBe('accepted');
  });

  it('a position must be one of the three', () => {
    expect(rejectedFor([{ ...seenSoFar, at: 'middle' } as unknown as DeclaredFold])).toBe(
      'the fold "sequences" declares it attaches at "middle", and the positions are head, incremental, whole',
    );
  });

  it('and half a fold is not a fold', () => {
    expect(rejectedFor([{ ...seenSoFar, take: undefined } as unknown as DeclaredFold])).toBe(
      'the fold "sequences" must declare start, take and finish — three small pure functions — and `take` is undefined',
    );
  });
});

describe('RESIDENCY IS DERIVED, NOT DECLARED', () => {
  it('a `whole` fold is what makes a resource resident — and nothing else is asked', () => {
    expect(residencyOf([widest])).toBe('retained');
    expect(residencyOf([accession, seenSoFar, widest])).toBe('retained');
  });

  it('…so a body every declared fold can read as it goes need not be held', () => {
    expect(residencyOf([accession])).toBe('streamed');
    expect(residencyOf([accession, seenSoFar])).toBe('streamed');
    // the same rule and not a special case: nobody declared they need it whole
    expect(residencyOf([])).toBe('streamed');
  });
});

describe('an answer is delivered, and nothing turns on the delivery', () => {
  it('an observer that THROWS cannot change what was computed', () => {
    const answer: FoldAnswer = { resource: 'alignment', fold: 'accession', at: 'head', bytes: 48, value: 'PF00545.26' };
    expect(() =>
      reportAnswer(() => {
        throw new Error("the host's own render blew up");
      }, answer),
    ).not.toThrow();
    const told: FoldAnswer[] = [];
    reportAnswer((a) => told.push(a), answer);
    expect(told).toEqual([answer]);
  });
});
