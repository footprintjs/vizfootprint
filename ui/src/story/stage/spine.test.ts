/**
 * The spine in beat coordinates: the translation between a post's own
 * coordinates (a section key, a step within it) and the flat sequence of beats
 * the reader scrolls through.
 */
import { describe, expect, it } from 'vitest';
import type { StoryBookmark, StoryPost } from '../toStory.js';
import { firstBeatIndexes, landRef, refName, refusalOf, replayPath, sectionIndexOf } from './spine.js';

const step = (commitId: string) => ({ commitId, sentence: `act ${commitId}`, actor: 'user' as const, viewId: 'bar' });

const bookmark = (index: number, key: string, at: string, steps: readonly string[]): StoryBookmark => ({
  index,
  key,
  label: key,
  commitId: null,
  at,
  steps: steps.map(step),
  words: {},
});

const POST = {
  meta: { title: 't', slug: 't', source: 'vizfootprint', path: null, tip: '6', bookmarkCount: 2 },
  sections: [
    { key: 'one', label: 'Bookmark 1', heading: 'One', slides: ['one'] },
    { key: 'two', label: 'Bookmark 2', heading: 'Two', slides: ['two'] },
  ],
  bodyMd: '',
  deckSlides: [],
  bookmarks: [bookmark(0, 'one', '2', ['1', '2']), bookmark(1, 'two', '6', ['4', '5', '6'])],
} as unknown as StoryPost;

describe('sectionIndexOf', () => {
  it('joins by the key toStory guarantees is unique on the spine, and says -1 for a key it does not tell', () => {
    expect(sectionIndexOf(POST, 'two')).toBe(1);
    expect(sectionIndexOf(POST, 'nowhere')).toBe(-1);
  });
});

describe('firstBeatIndexes', () => {
  it('gives each section its first beat — a section\'s beats are contiguous, so the first is all a scroll needs', () => {
    expect(firstBeatIndexes([1, 1, 1])).toEqual([0, 1, 2]);
    expect(firstBeatIndexes([2, 3, 1])).toEqual([0, 2, 5]);
    expect(firstBeatIndexes([])).toEqual([]);
  });
});

describe('replayPath', () => {
  it('is the acts since the previous bookmark, ending on the position named — the transition IS the record', () => {
    expect(replayPath(POST.bookmarks[1]!)).toEqual(['4', '5', '6']); // the last step is the position: seeked once, not twice
  });

  it('adds the named position when the steps stop short of it (a bookmark that names the act of naming)', () => {
    expect(replayPath(bookmark(0, 'one', '9', ['7', '8']))).toEqual(['7', '8', '9']);
  });

  it('never repeats a commit, so a stretch that touched one twice dwells on it once', () => {
    expect(replayPath(bookmark(0, 'one', '8', ['7', '7', '8']))).toEqual(['7', '8']);
  });
});

const BEATS = firstBeatIndexes([1, 1]);

describe('landRef', () => {
  it('names the step a citation landed on, or the section\'s own position when it landed on no step — with the beat that tells it', () => {
    expect(landRef(POST, { section: 'two', step: 1 }, BEATS)).toEqual({ commitId: '5', beat: 1 });
    expect(landRef(POST, { section: 'two' }, BEATS)).toEqual({ commitId: '6', beat: 1 });
  });

  it('answers nothing — never a guess — for a section this post does not tell, a step it does not have, or a beat map that does not reach it', () => {
    expect(landRef(POST, { section: 'nowhere', step: 0 }, BEATS)).toBeUndefined();
    expect(landRef(POST, { section: 'two', step: 9 }, BEATS)).toBeUndefined();
    expect(landRef(POST, { section: 'two' }, [0])).toBeUndefined(); // the section is told; the beat map stops short
  });
});

describe('refName', () => {
  it('says the words the writer typed, then the id, and never nothing but an empty string it can be honest about', () => {
    expect(refName({ slot: 'caption', span: [0, 1], commit: '4', label: 'Formal' })).toBe('Formal');
    expect(refName({ slot: 'caption', span: [0, 1], commit: '4' })).toBe('4');
    expect(refName({ slot: 'caption', span: [0, 1], bookmark: 'b1' })).toBe('b1');
    expect(refName({ slot: 'caption', span: [0, 1], saved: 'p1' })).toBe('p1');
    expect(refName({ slot: 'caption', span: [0, 1] })).toBe('');
  });
});

describe('refusalOf', () => {
  it('reads the session\'s own sentence off a refused seek, and calls a landed one nothing', () => {
    expect(refusalOf({ ok: false, sentence: 'no commit "9" to seek to' })).toBe('no commit "9" to seek to');
    expect(refusalOf({ ok: true })).toBeNull();
  });

  it('a refusal with no words says exactly that, rather than inventing a reason', () => {
    expect(refusalOf({ ok: false })).toBe('the seek was refused and the session gave no reason');
  });

  it('an answer these words cannot read is NOT a refusal — putting words in the session\'s mouth is the failure to avoid', () => {
    expect(refusalOf(undefined)).toBeNull();
    expect(refusalOf(null)).toBeNull();
    expect(refusalOf('landed')).toBeNull();
    expect(refusalOf({})).toBeNull();
  });
});
