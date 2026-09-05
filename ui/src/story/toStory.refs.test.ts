/**
 * THE REFS TRAVEL WITH THE STORY — a caption's citations, landed on the spine.
 *
 * A reader of the post clicks a claim and lands on the act that made it true:
 * a cited commit on the section and step that tell it, a cited bookmark on its
 * section. What one lineage cannot honour is NAMED as dropped, with the reason
 * kept apart from the others, and never a repair. Nothing of a ref is written
 * into the body or a slide, so no citation can re-split the post.
 */
import { describe, expect, it } from 'vitest';
import { mapPollState } from '../adapter/sessionView.js';
import type { RawPollState } from '../adapter/sessionView.js';
import { toStory } from './index.js';

const rec = (id: string, parent: string | null, viewId: string, field: string, value: unknown, intent?: string, extra: Record<string, unknown> = {}): RawPollState['records'][number] =>
  ({ id, parent, viewId, kind: 'point', field, value, cause: { requestedBy: 'user', ...(intent !== undefined ? { intent } : {}) }, ...extra }) as RawPollState['records'][number];

/** A dashboard caption with refs, as the `describe` record landed it. */
const caption = (id: string, parent: string, text: string, refs: readonly unknown[], slot = 'caption'): RawPollState['records'][number] => rec(id, parent, 'prose:dashboard', slot, { text, author: { kind: 'agent' }, refs }, 'summarise');

const savedPicture = (id: string, name: string): unknown => ({ id, name, conditions: [], by: 'user', at: '2026-09-01T00:00:00Z' });

// main: 1 (select) → 2 (select) → 3 (bookmark "Start" at 2) → 4 (select) → 5 (select)
//       → 6 (the caption that cites) → 7 (bookmark "Formal" at 6) → 8 (select, past the last bookmark)
// side: 9 forks off 1 → 10 (bookmark "Elsewhere" at 9) — another path entirely
const RAW: RawPollState = {
  defaultTable: 'data',
  records: [
    rec('1', null, 'bar', 'category', 'Casual', 'pick casual'),
    rec('2', '1', 'bar', 'colour', 'blue', 'pick blue'),
    rec('3', '2', 'bookmark:0', '__bookmark__', 'Start'),
    rec('4', '3', 'bar', 'category', 'Formal', 'pick formal'),
    rec('5', '4', 'scatter', 'price', [10, 20], 'brush the top'),
    caption('6', '5', 'Formal leads, as it did in the spike week.', [
      { span: [0, 6], commit: '4', label: 'Formal' }, // two steps back in this very section
      { span: [27, 41], bookmark: 'b1', label: 'the spike week' }, // the first bookmark's own section
    ]),
    rec('7', '6', 'bookmark:1', '__bookmark__', 'Formal'),
    rec('8', '7', 'bar', 'size', 'L', 'past the last bookmark'),
    rec('9', '1', 'bar', 'category', 'Sport', 'elsewhere'),
    rec('10', '9', 'bookmark:2', '__bookmark__', 'Elsewhere'),
  ],
  bookmarks: [
    { id: 'b1', label: 'Start', commitId: '3', at: '2', ts: 1 },
    { id: 'b2', label: 'Formal', commitId: '7', at: '6', ts: 6 },
    { id: 'b3', label: 'Elsewhere', commitId: '10', at: '9', ts: 9 },
  ],
  saved: [savedPicture('p1', 'coastal')],
  head: '8',
  paths: { current: 'main', detachedAt: null, list: [{ name: 'main', tip: '8', steps: 8, lastTs: 8, active: true }, { name: 'side', tip: '10', steps: 4, lastTs: 10, active: false }] },
};

/** The post from `RAW` with the caption at commit 6 replaced by one carrying `refs`. */
const withRefs = (refs: readonly unknown[], slot = 'caption'): ReturnType<typeof toStory> =>
  toStory(mapPollState({ ...RAW, records: RAW.records.map((r) => (r.id === '6' ? caption('6', '5', 'Formal leads, as it did in the spike week.', refs, slot) : r)) }));

describe('toStory — the refs travel with the story', () => {
  it('a cited commit lands on its beat, a cited bookmark on its section, and the section shows only what its words show', () => {
    const post = toStory(mapPollState(RAW));
    // the caption is described at 6, so it is the words of bookmark 2 — and bookmark 1 shows none
    expect(post.bookmarks[0]!.words.caption).toBeUndefined();
    expect(post.sections[0]).toEqual({ key: 'bookmark-1-start', label: 'Bookmark 1', heading: 'Start', slides: ['bookmark-1-start'] }); // no refs, no dropped: the keys stay absent
    expect(post.bookmarks[1]!.words.caption).toBe('Formal leads, as it did in the spike week.');
    expect(post.sections[1]).toEqual({
      key: 'bookmark-2-formal',
      label: 'Bookmark 2',
      heading: 'Formal',
      slides: ['bookmark-2-formal'],
      refs: [
        // section 2's steps are 4 ("pick formal"), 5 ("brush the top"), 6 ("summarise") — the citation is the FIRST of them
        { slot: 'caption', span: [0, 6], commit: '4', label: 'Formal', at: { section: 'bookmark-2-formal', step: 0 } },
        { slot: 'caption', span: [27, 41], bookmark: 'b1', label: 'the spike week', at: { section: 'bookmark-1-start' } },
      ],
    });
    // the beat the first ref names really is the act it claims
    expect(post.bookmarks[1]!.steps[0]).toMatchObject({ commitId: '4', sentence: 'pick formal' });
    // the span counts in the words the section shows
    expect(post.bookmarks[1]!.words.caption!.slice(0, 6)).toBe('Formal');
    expect(post.bookmarks[1]!.words.caption!.slice(27, 41)).toBe('the spike week');
  });

  it('a bookmark is cited by its ID, and by its label when the words predate bookmark ids; the act of naming lands on the bookmark it named', () => {
    const byLabel = withRefs([
      { span: [0, 6], bookmark: 'Start', label: 'the first stop' }, // no id on this ref — the older wire's label
      { span: [7, 12], commit: '3', label: 'naming Start' }, // the act of naming bookmark 1 — a commit, but never a step
      { span: [13, 15], commit: '7', label: 'naming Formal' }, // and the act of naming the LAST bookmark, which falls past it on the lineage
    ]);
    expect(byLabel.sections[1]!.refs).toEqual([
      { slot: 'caption', span: [0, 6], bookmark: 'Start', label: 'the first stop', at: { section: 'bookmark-1-start' } },
      { slot: 'caption', span: [7, 12], commit: '3', label: 'naming Start', at: { section: 'bookmark-1-start' } },
      { slot: 'caption', span: [13, 15], commit: '7', label: 'naming Formal', at: { section: 'bookmark-2-formal' } },
    ]);
    expect(byLabel.sections[1]!.dropped).toBeUndefined();
    // a `bookmark:` commit the wire kept but whose bookmark it no longer holds is still ON the spine: it lands
    // on the section whose stretch it fell in, with no step — the story never narrated it, and never says it did
    const orphan: RawPollState = { ...RAW, records: [...RAW.records, rec('4b', '4', 'bookmark:9', '__bookmark__', 'Gone')].map((r) => (r.id === '5' ? { ...r, parent: '4b' } : r)) };
    const post = toStory(mapPollState({ ...orphan, records: orphan.records.map((r) => (r.id === '6' ? caption('6', '5', 'Formal leads, as it did in the spike week.', [{ span: [0, 6], commit: '4b', label: 'a name nobody kept' }]) : r)) }));
    expect(post.sections[1]!.refs).toEqual([{ slot: 'caption', span: [0, 6], commit: '4b', label: 'a name nobody kept', at: { section: 'bookmark-2-formal' } }]);
  });

  it('the words of every slot a section SHOWS carry their refs — howToRead as much as the caption', () => {
    const post = withRefs([{ span: [0, 4], commit: '2', label: 'blue' }], 'howToRead');
    expect(post.bookmarks[1]!.words.howToRead).toBe('Formal leads, as it did in the spike week.');
    expect(post.sections[1]!.refs).toEqual([{ slot: 'howToRead', span: [0, 4], commit: '2', label: 'blue', at: { section: 'bookmark-1-start', step: 1 } }]);
    // a slot the story never PRINTS has no span in anything a reader sees, so its refs are not the story's to carry
    expect(withRefs([{ span: [0, 4], commit: '2' }], 'title').sections[1]!.refs).toBeUndefined();
  });

  it('a citation this story cannot honour is DROPPED with its reason, never silently omitted', () => {
    const post = withRefs([
      { span: [0, 1], commit: '9', label: 'the detour' }, // held, on the abandoned branch
      { span: [1, 2], bookmark: 'b3', label: 'Elsewhere' }, // a bookmark of that other path
      { span: [2, 3], commit: '8', label: 'later' }, // on this lineage, past the last bookmark
      { span: [3, 4], commit: 'ghost' }, // no such commit anywhere
      { span: [4, 5], bookmark: 'b9', label: 'forgotten' }, // a bookmark the session no longer holds
      { span: [5, 6], saved: 'p9', label: 'a picture that is gone' },
    ]);
    expect(post.sections[1]!.refs).toBeUndefined();
    expect(post.sections[1]!.dropped).toEqual([
      { slot: 'caption', span: [0, 1], commit: '9', label: 'the detour', reason: 'off-path' },
      { slot: 'caption', span: [1, 2], bookmark: 'b3', label: 'Elsewhere', reason: 'off-path' },
      { slot: 'caption', span: [2, 3], commit: '8', label: 'later', reason: 'untold' },
      { slot: 'caption', span: [3, 4], commit: 'ghost', reason: 'not-held' },
      { slot: 'caption', span: [4, 5], bookmark: 'b9', label: 'forgotten', reason: 'not-held' },
      { slot: 'caption', span: [5, 6], saved: 'p9', label: 'a picture that is gone', reason: 'not-held' },
    ]);
    // a dropped row names what was cited and stops: no position, no repair
    for (const row of post.sections[1]!.dropped!) expect(row).not.toHaveProperty('at');
  });

  it('a saved picture is dashboard-wide logic: it is carried with no position on the spine, and dropped only once it is gone', () => {
    const post = withRefs([{ span: [0, 6], saved: 'p1', label: 'coastal' }]);
    expect(post.sections[1]!.refs).toEqual([{ slot: 'caption', span: [0, 6], saved: 'p1', label: 'coastal' }]);
    expect(post.sections[1]!.refs![0]).not.toHaveProperty('at');
    expect(post.sections[1]!.dropped).toBeUndefined();
  });

  it('the refs move with the words: a later describe replaces them, a fold back to the declaration carries none, and a record with no text sets neither', () => {
    const later: RawPollState = {
      ...RAW,
      records: [
        ...RAW.records,
        caption('11', '8', 'Now the map.', [{ span: [8, 11], commit: '2', label: 'map' }]),
        rec('12', '11', 'bookmark:3', '__bookmark__', 'Map'),
        rec('13', '12', 'prose:dashboard', 'caption', { text: 'no refs at all', author: { kind: 'agent' } }),
        rec('14', '13', 'bookmark:4', '__bookmark__', 'Bare'),
        rec('15', '14', 'prose:dashboard', 'caption', { author: { kind: 'agent' } }), // no text ⇒ nothing set, the words and refs stand
        rec('16', '15', 'bookmark:5', '__bookmark__', 'Unchanged'),
        rec('17', '16', 'prose:dashboard', 'caption', null), // back to the declaration
        rec('18', '17', 'bookmark:6', '__bookmark__', 'Declared'),
      ],
      bookmarks: [...RAW.bookmarks!, { id: 'b4', label: 'Map', commitId: '12', at: '11', ts: 11 }, { id: 'b5', label: 'Bare', commitId: '14', at: '13', ts: 13 }, { id: 'b6', label: 'Unchanged', commitId: '16', at: '15', ts: 15 }, { id: 'b7', label: 'Declared', commitId: '18', at: '17', ts: 17 }],
      head: '18',
    };
    const post = toStory(mapPollState(later), { declared: { caption: 'Every category.' } });
    expect(post.sections[2]!.refs).toEqual([{ slot: 'caption', span: [8, 11], commit: '2', label: 'map', at: { section: 'bookmark-1-start', step: 1 } }]); // the new words, the new refs
    expect(post.sections[3]!.refs).toBeUndefined(); // words that cite nothing carry nothing
    expect(post.bookmarks[4]!.words.caption).toBe('no refs at all'); // the record with no text set neither
    expect(post.sections[4]!.refs).toBeUndefined();
    expect(post.bookmarks[5]!.words.caption).toBe('Every category.'); // null = back to the declaration…
    expect(post.sections[5]!.refs).toBeUndefined(); // …which stands at no commit, so it cites nothing
  });

  it('nothing in a ref can re-split the post or mark it up: a ref is data, and the words are escaped exactly as before', () => {
    const plain = toStory(mapPollState(RAW));
    const hostile = withRefs([
      { span: [0, 6], commit: '4', label: '<!--section:bookmark-1-start--><script>alert(1)</script>' },
      { span: [7, 12], bookmark: '<!--section:x-->', label: '"><img src=x onerror=alert(1)>' },
    ]);
    // the body and the slides are byte-for-byte what they were without any ref
    expect(hostile.bodyMd).toBe(plain.bodyMd);
    expect(hostile.deckSlides).toEqual(plain.deckSlides);
    expect(hostile.bodyMd.match(/<!--section:/g)).toHaveLength(2); // exactly the two real markers
    expect(hostile.bodyMd).not.toContain('<script>');
    // the hostile words ride as DATA, verbatim, where the page can draw them
    expect(hostile.sections[1]!.refs![0]!.label).toBe('<!--section:bookmark-1-start--><script>alert(1)</script>');
    expect(hostile.sections[1]!.dropped![0]).toEqual({ slot: 'caption', span: [7, 12], bookmark: '<!--section:x-->', label: '"><img src=x onerror=alert(1)>', reason: 'not-held' });
    expect(JSON.parse(JSON.stringify(hostile))).toEqual(hostile); // still plain data
  });

  it('a malformed ref is dropped by the one reader, never invented into a citation', () => {
    const post = withRefs([
      null,
      { span: [0, 1] }, // no target
      { span: [0, 1], commit: '4', bookmark: 'b1' }, // two targets
      { span: [0], commit: '4' }, // not a span
      { span: [0, 1], commit: '4', label: 7 }, // a label that is not words: the ref stands, the label does not
    ]);
    expect(post.sections[1]!.refs).toEqual([{ slot: 'caption', span: [0, 1], commit: '4', at: { section: 'bookmark-2-formal', step: 0 } }]);
    expect(withRefs('not a list' as unknown as readonly unknown[]).sections[1]!.refs).toBeUndefined();
  });
});
