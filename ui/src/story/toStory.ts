/**
 * THE STORY BRIDGE — one lineage of a session told as a storydeck post.
 *
 * A story is the bookmarks a person NAMED along one path, in the order the path
 * walked them (lineage order, never arrival order — a bookmark named on an
 * abandoned branch is elsewhere, not earlier). One bookmark = one section; the
 * commits since the previous bookmark = the steps of that section; the words of
 * a bookmark = the dashboard's own prose as it stood AT the bookmark (`describe`
 * with viewId `'dashboard'`, folded along the lineage). Read / Scroll /
 * Watch all come from this ONE export: storydeck's `assemblePost` takes it
 * as-is ({ meta, sections, bodyMd, deckSlides }).
 *
 * The library renders nothing: the host brings `figure(bookmark)` — the HTML of
 * what the dashboard showed at that bookmark — and every slide carries an audit
 * envelope (`data-vzf-*`: the commit the bookmark names, the path, the data
 * versions it was true of) so a slide can always be traced back to the
 * position it shows. Everything the library writes is escaped — attributes
 * and text in the slides, and storydeck's own `<!--section:…-->` marker in
 * the Markdown body, so no caption can re-split the post; the figure is the
 * host's own markup, inserted verbatim (escape at the seam is the host's
 * duty for its own HTML). Pure: the state in, a plain JSON-safe post out.
 */
import { BOOKMARK_VIEW_PREFIX, PROSE_VIEW_PREFIX } from 'vizfootprint/branches';
import { DASHBOARD_PROSE_ID, PROSE_SLOTS } from 'vizfootprint/prose';
import type { ProseSlot } from 'vizfootprint/prose';
import type { BookmarkView, CommitView, SessionViewState } from '../adapter/types.js';
import { pathToRoot } from '../adapter/stepNav.js';
import { bookmarkTarget, orderedBookmarks } from '../time/presentBookmark.js';

/** The dashboard's words at one bookmark — the slots a `describe` on `'dashboard'` may set, as plain text. */
export type StoryWords = Readonly<Partial<Record<ProseSlot, string>>>;

/** One commit between two bookmarks, as a sentence: the person's intent when the cause carried one, else the ledger's label. */
export interface StoryStep {
  readonly commitId: string;
  readonly sentence: string;
  readonly actor: CommitView['actor'];
  readonly viewId: string;
}

/** One named bookmark on the spine, with everything a section needs. */
export interface StoryBookmark {
  /** 0-based position on the spine (root → tip). */
  readonly index: number;
  /** The section key AND the slide's join key — unique on the spine even when two bookmarks share a label. */
  readonly key: string;
  readonly label: string;
  /** The bookmark commit (the act of naming), when the wire carried it. */
  readonly commitId: string | null;
  /** The position the bookmark NAMES — the commit whose state the figure shows (every bookmark on the spine names one). */
  readonly at: string;
  /** The commits since the previous bookmark (or since the root), up to and including the named position; bookmark commits themselves are not steps. */
  readonly steps: readonly StoryStep[];
  /** The dashboard's own words as they stood at the bookmark. */
  readonly words: StoryWords;
  /** The data versions the named position was true of (table → version), when the tables declare sources. */
  readonly data?: Readonly<Record<string, string>>;
}

export interface StoryOptions {
  /** The named path whose lineage is the spine; default = the head's lineage (not the cursor's). An unknown name is refused (TypeError), never guessed at. */
  readonly path?: string;
  /** The figure of one bookmark: the host's HTML of what the dashboard showed at `bookmark.at` (inserted verbatim). Default: no figure. */
  readonly figure?: (bookmark: StoryBookmark) => string;
  /** The words a bookmark falls back to when no `describe` reached it on the lineage — the def's DECLARED dashboard prose, never the live words (those would misdate every earlier bookmark). */
  readonly declared?: StoryWords;
  /** The post's title; default = the tip's dashboard title, else "Untitled story". */
  readonly title?: string;
  /** The post's slug; default = the title slugified. */
  readonly slug?: string;
  /** The post's date as storydeck prints it (`YYYY-MM-DD`; its PostView parses it) — the library keeps no clock, so the host passes it. */
  readonly date?: string;
  /** The byline storydeck's PostView prints. */
  readonly author?: string;
  /** The standfirst storydeck's PostView prints; default = the tip's dashboard caption. */
  readonly description?: string;
}

export interface StorySection {
  readonly key: string;
  /** storydeck's eyebrow above the heading: `Bookmark <n>`. */
  readonly label: string;
  /** The bookmark's label — the heading a reader scans by (the dashboard title heads the post, not every section). */
  readonly heading: string;
  /** The deck slides this section plays — by KEY, storydeck's join key (labels may repeat; keys never do). */
  readonly slides: readonly string[];
}

export interface StorySlide {
  /** The join key (`bookmark.key`), not the human label — two bookmarks may share a label. */
  readonly label: string;
  readonly html: string;
}

export interface StoryMeta {
  readonly title: string;
  readonly slug: string;
  /** Absent when the host passed none — storydeck's PostView prints it, so pass one for a post that will be read there. */
  readonly date?: string;
  readonly author?: string;
  readonly description?: string;
  readonly source: 'vizfootprint';
  /** The named path told, or null for the head's lineage. */
  readonly path: string | null;
  /** The tip of the lineage told, or null when the session has no commits yet. */
  readonly tip: string | null;
  readonly bookmarkCount: number;
}

/** storydeck's `assemblePost` input, plus the structured bookmarks it was built from. */
export interface StoryPost {
  readonly meta: StoryMeta;
  readonly sections: readonly StorySection[];
  readonly bodyMd: string;
  readonly deckSlides: readonly StorySlide[];
  readonly bookmarks: readonly StoryBookmark[];
}

const DASHBOARD_PROSE_VIEW = `${PROSE_VIEW_PREFIX}${DASHBOARD_PROSE_ID}`;

export function toStory(state: SessionViewState, options: StoryOptions = {}): StoryPost {
  const tip = spineTip(state, options.path);
  const lineage = pathToRoot(state.commits, tip); // root-first
  const position = new Map(lineage.map((c, i) => [c.id, i] as const));
  const bookmarks = tip === null ? [] : orderedBookmarks(state.bookmarks, state.commits, tip);
  const declared = options.declared ?? {};
  const storyBookmarks: StoryBookmark[] = [];
  let since = 0; // the first lineage index not yet told
  let words: StoryWords = declared; // the fold carried forward — a bookmark's words are the prefix's, never re-walked
  bookmarks.forEach((bookmark, index) => {
    const at = bookmarkTarget(bookmark) as string; // ordered bookmarks all name a position on the lineage
    const end = position.get(at)! + 1;
    const span = lineage.slice(since, end);
    words = foldWords(words, span, declared);
    const named = lineage[end - 1]!;
    storyBookmarks.push({
      index,
      key: sectionKey(index, bookmark),
      label: bookmark.label,
      commitId: bookmark.commitId,
      at,
      steps: span.filter((c) => !c.viewId.startsWith(BOOKMARK_VIEW_PREFIX)).map((c) => ({ commitId: c.id, sentence: c.intent ?? c.label, actor: c.actor, viewId: c.viewId })),
      words,
      ...(named.data !== undefined ? { data: named.data } : {}),
    });
    since = end;
  });
  const atTip = foldWords(words, lineage.slice(since), declared);
  const title = options.title ?? atTip.title ?? 'Untitled story';
  const description = options.description ?? atTip.caption;
  const pathName = options.path ?? null;
  return {
    meta: {
      title,
      slug: options.slug ?? (slugify(title) || 'story'),
      ...(options.date !== undefined ? { date: options.date } : {}),
      ...(options.author !== undefined ? { author: options.author } : {}),
      ...(description !== undefined ? { description } : {}),
      source: 'vizfootprint',
      path: pathName,
      tip,
      bookmarkCount: storyBookmarks.length,
    },
    // storydeck prints `label` as an eyebrow above `heading` — the bookmark's name heads the section, its number is the eyebrow
    sections: storyBookmarks.map((b) => ({ key: b.key, label: `Bookmark ${b.index + 1}`, heading: b.label, slides: [b.key] })),
    bodyMd: storyBookmarks.map(sectionMd).join('\n'),
    deckSlides: storyBookmarks.map((b) => ({ label: b.key, html: slideHtml(b, pathName, options.figure) })),
    bookmarks: storyBookmarks,
  };
}

/** The tip of the lineage told: a named path's, else the head's. */
function spineTip(state: SessionViewState, path: string | undefined): string | null {
  if (path === undefined) return state.head;
  const all = [...state.paths.list, ...state.paths.archivedList];
  const named = all.find((p) => p.name === path);
  if (named === undefined) throw new TypeError(`toStory: no path named "${path}" — the paths are ${all.map((p) => `"${p.name}"`).join(', ') || 'none'}`);
  return named.tip;
}

/** The dashboard's words after folding a span of `describe` commits on the dashboard subject onto `before`: last wins per slot, null = back to the declared words. */
function foldWords(before: StoryWords, span: readonly CommitView[], declared: StoryWords): StoryWords {
  const words: Partial<Record<ProseSlot, string>> = { ...before };
  for (const c of span) {
    if (c.viewId !== DASHBOARD_PROSE_VIEW || !(PROSE_SLOTS as readonly string[]).includes(c.field)) continue; // a proposal-lane field is not a slot
    const slot = c.field as ProseSlot;
    const text = typeof c.value === 'object' && c.value !== null && typeof (c.value as { text?: unknown }).text === 'string' ? (c.value as { text: string }).text : undefined;
    if (c.value === null) {
      if (declared[slot] !== undefined) words[slot] = declared[slot];
      else delete words[slot];
    } else if (text !== undefined) words[slot] = text;
  }
  return words;
}

function sectionKey(index: number, bookmark: BookmarkView): string {
  return `bookmark-${index + 1}-${slugify(bookmark.label) || 'unnamed'}`;
}

/** One deck slide: the audit envelope, the host's figure with the bookmark's caption — everything the library writes escaped. */
function slideHtml(bookmark: StoryBookmark, path: string | null, figure: StoryOptions['figure']): string {
  const attrs = [
    `data-vzf-bookmark="${bookmark.index}"`,
    `data-vzf-commit="${escapeHtml(bookmark.at)}"`,
    ...(bookmark.commitId !== null ? [`data-vzf-bookmark-commit="${escapeHtml(bookmark.commitId)}"`] : []),
    ...(path !== null ? [`data-vzf-path="${escapeHtml(path)}"`] : []),
    ...(bookmark.data !== undefined ? [`data-vzf-data="${escapeHtml(JSON.stringify(bookmark.data))}"`] : []),
  ];
  const caption = bookmark.words.caption ?? bookmark.label;
  return `<section class="vzf-slide" ${attrs.join(' ')}>\n<figure class="vzf-figure">${figure?.(bookmark) ?? ''}<figcaption class="vzf-caption">${escapeHtml(caption)}</figcaption></figure>\n</section>`;
}

/** One section's Markdown: the caption, then the steps since the previous bookmark — under storydeck's `<!--section:key-->` marker, which no words may forge. */
function sectionMd(bookmark: StoryBookmark): string {
  const lines = [`<!--section:${bookmark.key}-->`];
  if (bookmark.words.caption !== undefined) lines.push(noMarkers(bookmark.words.caption), '');
  if (bookmark.words.howToRead !== undefined) lines.push(noMarkers(bookmark.words.howToRead), '');
  if (bookmark.steps.length > 0) {
    lines.push(bookmark.index === 0 ? 'How we got here:' : 'Since the previous bookmark:', '');
    for (const s of bookmark.steps) lines.push(`- ${noMarkers(s.sentence)}${s.actor === 'user' ? '' : ` (${noMarkers(s.actor)})`}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** storydeck splits the body on `<!--section:key-->` BEFORE rendering — words that carry the opener are kept as words. */
function noMarkers(text: string): string {
  return text.replace(/<!--/g, '<\\!--');
}

function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // the accents NFKD split off
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string);
}
