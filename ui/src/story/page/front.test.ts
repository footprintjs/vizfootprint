/**
 * THE FRONT MATTER'S SENTENCE — one line, and the four things it may leave out.
 *
 * It is tested on its own because it is the one place two pages agree about
 * what a file carries, and because every clause of it is conditional: a page
 * may fetch rather than carry, may say what its data is or not, may hold data
 * at all or not. A page that quietly dropped the "unpacked" clause would read
 * as a page with no data in it.
 */
import { describe, it, expect } from 'vitest';
import { frontMatterLine } from './front.js';
import type { StoryFront } from './boot.js';

const base: StoryFront = {
  data: { via: 'inline', label: '40 rows' },
  size: '8.58 MB',
  payload: '1.28 MB',
  landed: 32,
  bookmarks: 6,
  refused: [],
  notes: [],
  builtAt: '2026-09-05',
};

describe('frontMatterLine', () => {
  it('says what the page carries, what it cost, and what came back', () => {
    expect(frontMatterLine(base, 'beats')).toBe(
      'This page carries its data — 40 rows, 8.58 MB unpacked. Its payload is 1.28 MB of this file. 32 acts replayed, 6 beats named. Built 2026-09-05.',
    );
  });

  it('names the word the page uses for a named moment, and nothing else changes', () => {
    expect(frontMatterLine({ ...base, bookmarks: 0 }, 'bookmarks')).toContain('32 acts replayed, 0 bookmarks named');
  });

  it('a page that FETCHES says where from — and says so even when the payload did not name a place', () => {
    // a fetching page carries no data, so there is nothing "unpacked" to report — the clause is left out
    expect(frontMatterLine({ ...base, data: { via: 'http', at: 'https://example.test/rows.csv' }, size: undefined }, 'beats')).toContain('This page fetches its data from https://example.test/rows.csv.');
    expect(frontMatterLine({ ...base, data: { via: 'http' }, size: undefined }, 'beats')).toContain('This page fetches its data from where the definition says.');
  });

  it('leaves out what it was not told: no label, and no data at all', () => {
    const bare = frontMatterLine({ ...base, data: { via: 'inline' }, size: undefined }, 'beats');
    expect(bare).toBe('This page carries its data. Its payload is 1.28 MB of this file. 32 acts replayed, 6 beats named. Built 2026-09-05.');
  });
});
