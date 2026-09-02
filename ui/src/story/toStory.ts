/**
 * THE STORY BRIDGE — one lineage of a session told as a storydeck post.
 *
 * A story is the beats a person NAMED along one path, in the order the path
 * walked them (lineage order, never arrival order — a beat named on an
 * abandoned branch is elsewhere, not earlier). One beat = one section; the
 * commits since the previous beat = the steps of that section; the words of
 * a beat = the dashboard's own prose as it stood AT the beat (`describe`
 * with viewId `'dashboard'`, folded along the lineage). Read / Scroll /
 * Watch all come from this ONE export: storydeck's `assemblePost` takes it
 * as-is ({ meta, sections, bodyMd, deckSlides }).
 *
 * The library renders nothing: the host brings `figure(beat)` — the HTML of
 * what the dashboard showed at that beat — and every slide carries an audit
 * envelope (`data-vzf-*`: the commit the beat names, the path, the data
 * versions it was true of) so a slide can always be traced back to the
 * position it shows. Everything the library writes is escaped — attributes
 * and text in the slides, and storydeck's own `<!--section:…-->` marker in
 * the Markdown body, so no caption can re-split the post; the figure is the
 * host's own markup, inserted verbatim (escape at the seam is the host's
 * duty for its own HTML). Pure: the state in, a plain JSON-safe post out.
 */
import { BEAT_VIEW_PREFIX, PROSE_VIEW_PREFIX } from '../../../src/branches/fold.js';
import { DASHBOARD_PROSE_ID, PROSE_SLOTS } from '../../../src/prose/index.js';
import type { ProseSlot } from '../../../src/prose/index.js';
import type { CheckpointView, CommitView, SessionViewState } from '../adapter/types.js';
import { pathToRoot } from '../adapter/stepNav.js';
import { beatTarget, orderedCheckpoints } from '../time/presentBeat.js';

/** The dashboard's words at one beat — the slots a `describe` on `'dashboard'` may set, as plain text. */
export type StoryWords = Readonly<Partial<Record<ProseSlot, string>>>;

/** One commit between two beats, as a sentence: the person's intent when the cause carried one, else the ledger's label. */
export interface StoryStep {
  readonly commitId: string;
  readonly sentence: string;
  readonly actor: CommitView['actor'];
  readonly viewId: string;
}

/** One named beat on the spine, with everything a section needs. */
export interface StoryBeat {
  /** 0-based position on the spine (root → tip). */
  readonly index: number;
  /** The section key AND the slide's join key — unique on the spine even when two beats share a label. */
  readonly key: string;
  readonly label: string;
  /** The beat commit (the act of naming), when the wire carried it. */
  readonly commitId: string | null;
  /** The position the beat NAMES — the commit whose state the figure shows (every beat on the spine names one). */
  readonly at: string;
  /** The commits since the previous beat (or since the root), up to and including the named position; beat commits themselves are not steps. */
  readonly steps: readonly StoryStep[];
  /** The dashboard's own words as they stood at the beat. */
  readonly words: StoryWords;
  /** The data versions the named position was true of (table → version), when the tables declare sources. */
  readonly data?: Readonly<Record<string, string>>;
}

export interface StoryOptions {
  /** The named path whose lineage is the spine; default = the head's lineage (not the cursor's). An unknown name is refused (TypeError), never guessed at. */
  readonly path?: string;
  /** The figure of one beat: the host's HTML of what the dashboard showed at `beat.at` (inserted verbatim). Default: no figure. */
  readonly figure?: (beat: StoryBeat) => string;
  /** The words a beat falls back to when no `describe` reached it on the lineage — the def's DECLARED dashboard prose, never the live words (those would misdate every earlier beat). */
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
  /** storydeck's eyebrow above the heading: `Beat <n>`. */
  readonly label: string;
  /** The beat's label — the heading a reader scans by (the dashboard title heads the post, not every section). */
  readonly heading: string;
  /** The deck slides this section plays — by KEY, storydeck's join key (labels may repeat; keys never do). */
  readonly slides: readonly string[];
}

export interface StorySlide {
  /** The join key (`beat.key`), not the human label — two beats may share a label. */
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
  readonly beatCount: number;
}

/** storydeck's `assemblePost` input, plus the structured beats it was built from. */
export interface StoryPost {
  readonly meta: StoryMeta;
  readonly sections: readonly StorySection[];
  readonly bodyMd: string;
  readonly deckSlides: readonly StorySlide[];
  readonly beats: readonly StoryBeat[];
}

const DASHBOARD_PROSE_VIEW = `${PROSE_VIEW_PREFIX}${DASHBOARD_PROSE_ID}`;

export function toStory(state: SessionViewState, options: StoryOptions = {}): StoryPost {
  const tip = spineTip(state, options.path);
  const lineage = pathToRoot(state.commits, tip); // root-first
  const position = new Map(lineage.map((c, i) => [c.id, i] as const));
  const beats = tip === null ? [] : orderedCheckpoints(state.checkpoints, state.commits, tip);
  const declared = options.declared ?? {};
  const storyBeats: StoryBeat[] = [];
  let since = 0; // the first lineage index not yet told
  let words: StoryWords = declared; // the fold carried forward — a beat's words are the prefix's, never re-walked
  beats.forEach((beat, index) => {
    const at = beatTarget(beat) as string; // ordered beats all name a position on the lineage
    const end = position.get(at)! + 1;
    const span = lineage.slice(since, end);
    words = foldWords(words, span, declared);
    const named = lineage[end - 1]!;
    storyBeats.push({
      index,
      key: sectionKey(index, beat),
      label: beat.label,
      commitId: beat.commitId,
      at,
      steps: span.filter((c) => !c.viewId.startsWith(BEAT_VIEW_PREFIX)).map((c) => ({ commitId: c.id, sentence: c.intent ?? c.label, actor: c.actor, viewId: c.viewId })),
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
      beatCount: storyBeats.length,
    },
    // storydeck prints `label` as an eyebrow above `heading` — the beat's name heads the section, its number is the eyebrow
    sections: storyBeats.map((b) => ({ key: b.key, label: `Beat ${b.index + 1}`, heading: b.label, slides: [b.key] })),
    bodyMd: storyBeats.map(sectionMd).join('\n'),
    deckSlides: storyBeats.map((b) => ({ label: b.key, html: slideHtml(b, pathName, options.figure) })),
    beats: storyBeats,
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

function sectionKey(index: number, beat: CheckpointView): string {
  return `beat-${index + 1}-${slugify(beat.label) || 'unnamed'}`;
}

/** One deck slide: the audit envelope, the host's figure with the beat's caption — everything the library writes escaped. */
function slideHtml(beat: StoryBeat, path: string | null, figure: StoryOptions['figure']): string {
  const attrs = [
    `data-vzf-beat="${beat.index}"`,
    `data-vzf-commit="${escapeHtml(beat.at)}"`,
    ...(beat.commitId !== null ? [`data-vzf-beat-commit="${escapeHtml(beat.commitId)}"`] : []),
    ...(path !== null ? [`data-vzf-path="${escapeHtml(path)}"`] : []),
    ...(beat.data !== undefined ? [`data-vzf-data="${escapeHtml(JSON.stringify(beat.data))}"`] : []),
  ];
  const caption = beat.words.caption ?? beat.label;
  return `<section class="vzf-slide" ${attrs.join(' ')}>\n<figure class="vzf-figure">${figure?.(beat) ?? ''}<figcaption class="vzf-caption">${escapeHtml(caption)}</figcaption></figure>\n</section>`;
}

/** One section's Markdown: the caption, then the steps since the previous beat — under storydeck's `<!--section:key-->` marker, which no words may forge. */
function sectionMd(beat: StoryBeat): string {
  const lines = [`<!--section:${beat.key}-->`];
  if (beat.words.caption !== undefined) lines.push(noMarkers(beat.words.caption), '');
  if (beat.words.howToRead !== undefined) lines.push(noMarkers(beat.words.howToRead), '');
  if (beat.steps.length > 0) {
    lines.push(beat.index === 0 ? 'How we got here:' : 'Since the previous beat:', '');
    for (const s of beat.steps) lines.push(`- ${noMarkers(s.sentence)}${s.actor === 'user' ? '' : ` (${noMarkers(s.actor)})`}`);
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
