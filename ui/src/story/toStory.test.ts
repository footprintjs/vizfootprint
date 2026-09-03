/**
 * The story bridge: one lineage, its named bookmarks in lineage order, one
 * section per bookmark with the steps since the previous one, the dashboard's
 * words as they stood at the bookmark, an audit envelope on every slide, and
 * everything the library writes escaped — including storydeck's own marker.
 */
import { describe, expect, it } from 'vitest';
import { mapPollState } from '../adapter/sessionView.js';
import type { RawPollState } from '../adapter/sessionView.js';
import { toStory } from './index.js';

const rec = (id: string, parent: string | null, viewId: string, field: string, value: unknown, intent?: string, extra: Record<string, unknown> = {}): RawPollState['records'][number] =>
  ({ id, parent, viewId, kind: 'point', field, value, cause: { requestedBy: 'user', ...(intent !== undefined ? { intent } : {}) }, ...extra }) as RawPollState['records'][number];

// main: 1 (select) → 2 (bookmark "Start" at 1) → 3 (describe the dashboard caption) → 4 (select, stamped) → 5 (bookmark "Formal" at 4) → 6 (select)
// side: 7 forks off 1 → 8 (bookmark "Elsewhere" at 7) — not on main's lineage
const RAW: RawPollState = {
  defaultTable: 'data',
  records: [
    rec('1', null, 'bar', 'category', 'Casual', 'pick casual'),
    rec('2', '1', 'bookmark:0', '__bookmark__', 'Start'),
    rec('3', '2', 'prose:dashboard', 'caption', { text: 'Casual wear, "the basics".', author: { kind: 'agent' } }, 'summarise'),
    rec('4', '3', 'bar', 'category', 'Formal', undefined, { data: { data: 'v2' } }),
    rec('5', '4', 'bookmark:1', '__bookmark__', 'Formal <b>wear</b>'),
    rec('6', '5', 'scatter', 'price', [10, 20], 'brush'),
    rec('7', '1', 'bar', 'category', 'Sport', 'elsewhere'),
    rec('8', '7', 'bookmark:2', '__bookmark__', 'Elsewhere'),
  ],
  bookmarks: [
    { label: 'Start', commitId: '2', at: '1', ts: 1 },
    { label: 'Formal <b>wear</b>', commitId: '5', at: '4', ts: 4 },
    { label: 'Elsewhere', commitId: '8', at: '7', ts: 7 },
  ],
  head: '6',
  paths: { current: 'main', detachedAt: null, list: [{ name: 'main', tip: '6', steps: 6, lastTs: 6, active: true }, { name: 'side', tip: '8', steps: 4, lastTs: 8, active: false }] },
};

describe('toStory', () => {
  it('tells the head lineage: one section per bookmark in lineage order, the steps since the previous bookmark, the words at the bookmark', () => {
    const post = toStory(mapPollState(RAW), { declared: { title: 'Catalogue desk', caption: 'Every category.' }, date: '2026-09-02', author: 'the desk' });
    expect(post.meta).toEqual({ title: 'Catalogue desk', slug: 'catalogue-desk', date: '2026-09-02', author: 'the desk', description: 'Casual wear, "the basics".', source: 'vizfootprint', path: null, tip: '6', bookmarkCount: 2 });
    // sections head with the BOOKMARK's label; slides join by KEY (labels may repeat, keys never do)
    expect(post.sections).toEqual([
      { key: 'bookmark-1-start', label: 'Bookmark 1', heading: 'Start', slides: ['bookmark-1-start'] },
      { key: 'bookmark-2-formal-b-wear-b', label: 'Bookmark 2', heading: 'Formal <b>wear</b>', slides: ['bookmark-2-formal-b-wear-b'] },
    ]);
    expect(post.deckSlides.map((s) => s.label)).toEqual(['bookmark-1-start', 'bookmark-2-formal-b-wear-b']);
    expect(post.bookmarks.map((b) => [b.at, b.commitId, b.steps.map((s) => s.sentence)])).toEqual([
      ['1', '2', ['pick casual']],
      ['4', '5', ['summarise', 'category']], // the bookmark commit at 2 is not a step; the intent-less select gets the ledger's label (its field)
    ]);
    expect(post.bookmarks[0]!.words).toEqual({ title: 'Catalogue desk', caption: 'Every category.' }); // the describe at 3 is after bookmark 1
    expect(post.bookmarks[1]!.words).toEqual({ title: 'Catalogue desk', caption: 'Casual wear, "the basics".' });
    expect(post.bookmarks[1]!.data).toEqual({ data: 'v2' });
    expect(post.bookmarks[0]!.data).toBeUndefined();
    expect(post.bodyMd).toBe(
      [
        '<!--section:bookmark-1-start-->',
        'Every category.',
        '',
        'How we got here:',
        '',
        '- pick casual',
        '',
        '<!--section:bookmark-2-formal-b-wear-b-->',
        'Casual wear, "the basics".',
        '',
        'Since the previous bookmark:',
        '',
        '- summarise',
        '- category',
        '',
      ].join('\n'),
    );
  });

  it('every slide carries its audit envelope, the host figure verbatim, and escaped words; no words may forge a section marker', () => {
    const post = toStory(mapPollState(RAW), { figure: (b) => `<svg data-at="${b.at}"></svg>` });
    expect(post.deckSlides[1]!.html).toBe(
      '<section class="vzf-slide" data-vzf-bookmark="1" data-vzf-commit="4" data-vzf-bookmark-commit="5" data-vzf-data="{&quot;data&quot;:&quot;v2&quot;}">\n' +
        '<figure class="vzf-figure"><svg data-at="4"></svg><figcaption class="vzf-caption">Casual wear, &quot;the basics&quot;.</figcaption></figure>\n' +
        '</section>',
    );
    const first = post.deckSlides[0]!.html;
    expect(first).toContain('data-vzf-bookmark="0" data-vzf-commit="1" data-vzf-bookmark-commit="2">'); // no data stamp, no path
    expect(first).toContain('<figcaption class="vzf-caption">Start</figcaption>'); // no caption ⇒ the label
    expect(toStory(mapPollState(RAW)).deckSlides[0]!.html).toContain('<figure class="vzf-figure"><figcaption'); // no figure ⇒ empty
    // a caption (or an intent) that carries storydeck's marker cannot re-split the body
    const forged: RawPollState = {
      ...RAW,
      records: [...RAW.records, rec('9', '6', 'prose:dashboard', 'caption', { text: 'Look <!--section:bookmark-1-start--> here', author: { kind: 'agent' } }, 'say <!--section:x-->'), rec('10', '9', 'bookmark:3', '__bookmark__', 'End')],
      bookmarks: [...RAW.bookmarks!, { label: 'End', commitId: '10', at: '9', ts: 9 }],
      head: '10',
    };
    const body = toStory(mapPollState(forged)).bodyMd;
    expect(body).toContain('Look <\\!--section:bookmark-1-start--> here');
    expect(body).toContain('- say <\\!--section:x-->');
    expect(body.match(/<!--section:/g)).toHaveLength(3); // exactly the three real markers
  });

  it('a named path is its own spine; an unknown path is refused; the dashboard words fold null back to the declaration', () => {
    const side = toStory(mapPollState(RAW), { path: 'side', title: 'Side', slug: 'custom', description: 'A detour.' });
    expect(side.meta).toMatchObject({ title: 'Side', slug: 'custom', description: 'A detour.', path: 'side', tip: '8', bookmarkCount: 2 });
    // "Start" names commit 1, which side's lineage runs through — a bookmark stays on every lineage through its position
    expect(side.bookmarks.map((b) => [b.label, b.steps.map((s) => s.sentence)])).toEqual([
      ['Start', ['pick casual']],
      ['Elsewhere', ['elsewhere']],
    ]);
    expect(side.deckSlides[1]!.html).toContain('data-vzf-path="side"');
    expect(() => toStory(mapPollState(RAW), { path: 'nope' })).toThrow('toStory: no path named "nope" — the paths are "main", "side"');
    const reset: RawPollState = {
      ...RAW,
      records: [...RAW.records, rec('9', '6', 'prose:dashboard', 'caption', null), rec('10', '9', 'prose:dashboard', 'caption:proposal', { text: 'draft' }), rec('11', '10', 'bookmark:3', '__bookmark__', 'End')],
      bookmarks: [...RAW.bookmarks!, { label: 'End', commitId: '11', at: '10', ts: 10 }],
      head: '11',
    };
    const end = toStory(mapPollState(reset), { declared: { caption: 'Every category.' } });
    expect(end.bookmarks[2]!.words).toEqual({ caption: 'Every category.' }); // null = back to declared; a proposal is not the words
    expect(end.meta.description).toBe('Every category.'); // the description follows the caption at the tip
    expect(toStory(mapPollState(reset)).bookmarks[2]!.words).toEqual({}); // nothing declared ⇒ nothing
    expect(toStory(mapPollState(reset)).meta).not.toHaveProperty('description');
    expect(end.meta.title).toBe('Untitled story');
  });

  it('the description and title follow the words at the TIP, past the last bookmark', () => {
    const later: RawPollState = {
      ...RAW,
      records: [...RAW.records, rec('9', '6', 'prose:dashboard', 'title', { text: 'Renamed desk', author: { kind: 'human' } }), rec('10', '9', 'prose:dashboard', 'caption', { text: 'Now formal.', author: { kind: 'human' } })],
      head: '10',
    };
    const post = toStory(mapPollState(later));
    expect(post.meta.title).toBe('Renamed desk');
    expect(post.meta.description).toBe('Now formal.');
    expect(post.bookmarks[1]!.words.caption).toBe('Casual wear, "the basics".'); // the bookmarks keep the words of their own time
  });

  it('no commits ⇒ an empty story; a lineage with no bookmarks ⇒ no sections; the post is plain data', () => {
    const empty = toStory(mapPollState({ ...RAW, records: [], bookmarks: [], head: null, paths: { current: null, detachedAt: null, list: [] } }));
    expect(empty).toEqual({ meta: { title: 'Untitled story', slug: 'untitled-story', source: 'vizfootprint', path: null, tip: null, bookmarkCount: 0 }, sections: [], bodyMd: '', deckSlides: [], bookmarks: [] });
    const unnamed = toStory(mapPollState({ ...RAW, bookmarks: [], head: '6' }));
    expect(unnamed.sections).toEqual([]);
    expect(unnamed.meta.tip).toBe('6');
    expect(JSON.parse(JSON.stringify(toStory(mapPollState(RAW))))).toEqual(toStory(mapPollState(RAW))); // plain data
  });

  it("the edges: an older wire's bookmark without its commit, two bookmarks at one position, an agent step, howToRead, accented and symbol-only names", () => {
    const raw: RawPollState = {
      defaultTable: 'data',
      records: [
        { id: '1', parent: null, viewId: 'bar', kind: 'point', field: 'category', value: 'Casual', cause: { requestedBy: 'agent', intent: 'pick casual' } },
        rec('2', '1', 'bookmark:0', '__bookmark__', '!!!'),
        rec('3', '2', 'prose:dashboard', 'howToRead', { text: 'Read the map first.', author: { kind: 'human' } }),
        rec('4', '3', 'prose:dashboard', 'title', { author: { kind: 'human' } }), // a record with no text sets nothing
        rec('5', '4', 'prose:dashboard', 'weather', { text: 'sunny', author: { kind: 'human' } }), // not a slot
      ],
      bookmarks: [
        { label: '!!!', commitId: '2', at: '1', ts: 1 },
        { label: 'Again', commitId: null, at: '1', ts: 2 }, // the same position, named twice; no bookmark commit on this wire
        { label: 'Héllo,  World!!', commitId: null, at: '5', ts: 3 },
      ],
      head: '5',
      paths: { current: null, detachedAt: null, list: [] },
    };
    const post = toStory(mapPollState(raw), { title: '***' });
    expect(post.meta.slug).toBe('story');
    expect(post.sections.map((s) => s.key)).toEqual(['bookmark-1-unnamed', 'bookmark-2-again', 'bookmark-3-hello-world']);
    expect(post.bookmarks.map((b) => b.steps.map((s) => `${s.sentence}/${s.actor}`))).toEqual([['pick casual/agent'], [], ['describe dashboard.howToRead/user', 'describe dashboard.title/user', 'describe dashboard.weather/user']]);
    expect(post.bookmarks[2]!.words).toEqual({ howToRead: 'Read the map first.' });
    expect(post.deckSlides[1]!.html).toContain('<section class="vzf-slide" data-vzf-bookmark="1" data-vzf-commit="1">');
    expect(post.deckSlides[1]!.html).toContain('<figcaption class="vzf-caption">Again</figcaption>');
    expect(post.bodyMd).toContain('- pick casual (agent)');
    expect(post.bodyMd).toContain('<!--section:bookmark-2-again-->\n<!--section:bookmark-3-hello-world-->\nRead the map first.\n\nSince the previous bookmark:');
    expect(() => toStory(mapPollState(raw), { path: 'x' })).toThrow('the paths are none');
    expect(toStory(mapPollState(raw), { title: `<a href="x" title='y'>&</a>` }).meta.slug).toBe('a-href-x-title-y-a');
  });
});
