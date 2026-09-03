/**
 * Mentions resolve against what the session holds and report what they cannot,
 * with spans a validator can check and words left exactly as typed.
 */
import { describe, expect, it } from 'vitest';
import { mentionsToRefs } from './index.js';
import type { MentionWorld } from './index.js';

const WORLD: MentionWorld = {
  commits: new Map([
    ['s12', 'select map.state = TX'],
    ['s40', 'describe dashboard.caption'],
  ]),
  beats: new Map([['Start', 't1'], ['Formal wear', 't2']]),
  saved: new Map([['coastal', 'p1'], ['Formal wear', 'p2']]),
};

describe('mentionsToRefs', () => {
  it('resolves commits by id, saved selections and beats by NAME to the record\'s ID (the words ride along as the label) — bracketed or bare — with exact spans', () => {
    const text = 'See #s12 then @coastal and @[Formal wear], also @Start.';
    const { refs, unresolved } = mentionsToRefs(text, WORLD);
    expect(unresolved).toEqual([]);
    expect(refs).toEqual([
      { span: [4, 8], commit: 's12', label: 'select map.state = TX' },
      { span: [14, 22], saved: 'p1', label: 'coastal' },
      { span: [27, 41], saved: 'p2', label: 'Formal wear' }, // a name that is both resolves to the saved selection: the logic wins over the moment
      { span: [48, 54], beat: 't1', label: 'Start' },
    ]);
    for (const r of refs) expect(text.slice(r.span[0], r.span[1]).length).toBe(r.span[1] - r.span[0]);
    expect(text.slice(48, 54)).toBe('@Start'); // the trailing period is not part of the mention
  });
  it('reports what resolves to nothing, with the sentence and the span, and never invents', () => {
    const { refs, unresolved } = mentionsToRefs('#nope and @ghost and @[no such beat]', WORLD);
    expect(refs).toEqual([]);
    expect(unresolved).toEqual([
      { mention: '#nope', span: [0, 5], sentence: '#nope names no commit the log holds' },
      { mention: '@ghost', span: [10, 16], sentence: '@ghost is neither a saved selection nor a checkpoint' },
      { mention: '@[no such beat]', span: [21, 36], sentence: '@no such beat is neither a saved selection nor a checkpoint' },
    ]);
  });
  it('a quote or an apostrophe ends a bare mention: quoted words and a possessive link the name, not the punctuation', () => {
    const { refs, unresolved } = mentionsToRefs(`"@coastal" and @coastal's`, WORLD);
    expect(unresolved).toEqual([]);
    expect(refs).toEqual([
      { span: [1, 9], saved: 'p1', label: 'coastal' },
      { span: [15, 23], saved: 'p1', label: 'coastal' },
    ]);
    expect(mentionsToRefs('\u201c@coastal\u201d and @coastal\u2019s', WORLD).refs.map((r) => r.saved)).toEqual(['p1', 'p1']); // the curly ones too
    expect(mentionsToRefs('@[it\'s mine]', { ...WORLD, saved: new Map([["it's mine", 'p9']]) }).refs).toEqual([{ span: [0, 12], saved: 'p9', label: "it's mine" }]); // a name that really carries one is bracketed
  });
  it('plain words carry no mention; a marker inside a word is plain text (an email, issue#12), a marker after a boundary is a mention', () => {
    expect(mentionsToRefs('nothing to link here', WORLD)).toEqual({ refs: [], unresolved: [] });
    expect(mentionsToRefs('mail me@example.com', WORLD)).toEqual({ refs: [], unresolved: [] });
    expect(mentionsToRefs('see issue#12 and a_#s12', WORLD)).toEqual({ refs: [], unresolved: [] });
    expect(mentionsToRefs('(#s12) [@coastal] #s12,@coastal', WORLD).refs.map((r) => r.span)).toEqual([[1, 5], [8, 16], [18, 22], [23, 31]]); // punctuation is a boundary
    expect(mentionsToRefs('colour #fff', WORLD).unresolved.map((u) => u.mention)).toEqual(['#fff']); // a marker after a space IS read as a mention, and reported
  });
});
