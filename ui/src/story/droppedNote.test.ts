/**
 * What a STORY cited and could not show is SAID — and the three reasons are
 * different facts, kept apart, because a reader who confuses them goes looking
 * in the wrong place.
 *
 * These moved here from the demo with the sentence they pin: the line was
 * written in a consumer, and a second surface (the stage) would have copied it.
 */
import { describe, expect, it } from 'vitest';
import { storyDroppedNote } from './droppedNote.js';

describe('storyDroppedNote', () => {
  it('a citation on another path says the session holds it — on a lineage this story does not tell', () => {
    expect(storyDroppedNote([{ reason: 'off-path', commit: '9', label: 'the detour' }])).toBe('cited and not shown — "the detour" (9) is on another path');
    expect(storyDroppedNote([{ reason: 'off-path', commit: '9' }, { reason: 'off-path', bookmark: 'b3', label: 'Elsewhere' }])).toBe(
      'cited and not shown — 9, "Elsewhere" (b3) are on another path',
    );
  });

  it('a citation past the last bookmark says so — it is on THIS lineage, and a bookmark there would tell it', () => {
    expect(storyDroppedNote([{ reason: 'untold', commit: '8', label: 'later' }])).toBe('cited and not shown — "later" (8) is past the last bookmark');
    expect(storyDroppedNote([{ reason: 'untold', commit: '8' }, { reason: 'untold', commit: '9' }])).toBe('cited and not shown — 8, 9 are past the last bookmark');
  });

  it('a citation the session no longer holds is a different place to look again', () => {
    expect(storyDroppedNote([{ reason: 'not-held', saved: 'p9', label: 'coastal' }])).toBe('cited and not shown — this session no longer holds "coastal" (p9)');
  });

  it('all three in one section stay TOLD APART — the whole point of the disclosure', () => {
    const note = storyDroppedNote([
      { reason: 'off-path', commit: '9', label: 'the detour' },
      { reason: 'untold', commit: '8' },
      { reason: 'not-held', bookmark: 'b9', label: 'forgotten' },
    ]);
    expect(note).toBe('cited and not shown — "the detour" (9) is on another path; 8 is past the last bookmark; this session no longer holds "forgotten" (b9)');
    // and it neither offers a repair nor links what it just declined to vouch for
    expect(note).not.toMatch(/seek|bring over|fix|click|go to/i);
  });

  it('a reason NONE of the three covers names the citation, says the reason is unreadable, and STOPS', () => {
    const note = storyDroppedNote([{ reason: 'something-new', commit: 'c9' }]);
    expect(note).toBe('cited and not shown — c9, for a reason these words cannot read');
    // a malformed row is where a guess would be cheapest, so the clause claims nothing about WHERE it is
    expect(note).not.toMatch(/path|bookmark|no longer|does not hold|missing/i);
    // and it joins the readable ones without contaminating them
    expect(storyDroppedNote([{ reason: 'off-path', commit: '9' }, { reason: '?', commit: 'c9' }])).toBe(
      'cited and not shown — 9 is on another path; c9, for a reason these words cannot read',
    );
  });

  it('an empty label is the ID alone — an anchor that showed no words gets none put in its mouth, and a row naming nothing says nothing', () => {
    expect(storyDroppedNote([{ reason: 'not-held', bookmark: 'b9', label: '' }])).toBe('cited and not shown — this session no longer holds b9');
    expect(storyDroppedNote([{ reason: 'not-held' }])).toBe('cited and not shown — this session no longer holds ');
  });

  it('nothing to disclose costs nothing to say', () => {
    expect(storyDroppedNote(undefined)).toBeUndefined();
    expect(storyDroppedNote([])).toBeUndefined();
  });
});
