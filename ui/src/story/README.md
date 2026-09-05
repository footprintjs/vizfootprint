# story — the story bridge

The sixth layer: a session's named bookmarks, told as a [storydeck](https://github.com/footprintjs/storydeck) post. One function, pure:

```ts
import { toStory } from 'vizfootprint-ui/story';

const post = toStory(state, {
  figure: (bookmark) => svgOfWhatTheDashboardShowedAt(bookmark.at), // the host's own markup
  declared: { title: 'Weekly desk', caption: 'Reported cases by state.' }, // the def's DECLARED dashboard prose
  date: '2026-09-02', author: 'the desk', // what storydeck's PostView prints
});
// post = { meta, sections, bodyMd, deckSlides, bookmarks } — storydeck's assemblePost takes the first four as-is
```

## The laws

- **The spine is one lineage.** The head's (not the cursor's), or a named path's (`path`); an unknown name is a `TypeError`, never a guess. Bookmarks are ordered along it (root → tip) — a bookmark named on an abandoned branch is elsewhere, not earlier. No commits yet ⇒ an empty story with `meta.tip === null`.
- **One bookmark = one section, joined by key.** A section's `key` is unique on the spine (`bookmark-<n>-<slug>`) and is also the slide's join key (`deckSlides[].label`), because bookmark labels may repeat and storydeck joins slides by label. The section's `heading` is the bookmark's label and its `label` (storydeck's eyebrow) is `Bookmark <n>`; the dashboard title heads the post.
- **The steps are the commits since the previous bookmark** up to and including the position the bookmark names, as sentences (the person's intent when the cause carried one, else the ledger's label); bookmark commits are not steps.
- **The words of a bookmark are the dashboard's own, at the bookmark.** `describe` with viewId `'dashboard'` folds along the lineage (last wins per slot; `null` = back to `declared`). Pass the def's DECLARED words as `declared`, never the live ones — the live words would misdate every earlier bookmark. The `caption` is the figure's caption and the body's first paragraph; `howToRead` follows it; the words at the tip give `meta.title` and `meta.description`.
- **The library renders nothing.** `figure(bookmark)` is the host's HTML, inserted verbatim; everything the library writes is escaped — attributes and text in the slides, and storydeck's `<!--section:key-->` marker in the body (a caption or an intent that carries `<!--` is kept as words, so no one can re-split the post).
- **Every slide carries its audit envelope.** `data-vzf-bookmark` (index), `data-vzf-commit` (the position named), `data-vzf-bookmark-commit` (the act of naming), `data-vzf-path`, `data-vzf-data` (the data versions the position was true of) — a slide can always be traced to what it shows. The slide holds only the figure and its caption: storydeck renders slides into a fixed, `aria-hidden` canvas, so the words a reader needs live in the body.
- **Captions are Markdown in the Read lens.** storydeck renders the body as Markdown, so a caption's emphasis is kept; only the section marker is neutralised.
- **The refs travel with the words.** A slot's `refs` — the spans that cite a commit, a bookmark or a saved picture — ride the same `describe` record its words do, so the fold carries them and every section says what the words it shows point at. A section carries the refs of the slots it PRINTS (`caption`, `howToRead`); a span counts characters in `bookmarks[i].words[slot]`, exactly as the writer wrote them, and the page does the drawing. **Landing is a projection, not a second door** — the session judged each ref at the describe door (`src/prose/README.md`), and this re-judges nothing, not even a span: it only asks where, in a post that tells one lineage, the thing named now stands. A cited commit lands on the section and the step that tell it (a bookmark commit lands on its section, with no step); a cited bookmark lands on its section; a saved picture lands nowhere at all — a picture is dashboard-wide logic and stands at no moment on the spine, so it is carried with no position rather than sent somewhere arbitrary. The declaration's fallback words carry no refs: a declaration stands at no commit, so it cites none.
- **A ref the story cannot honour is `dropped`, with a reason — never silently omitted.** `off-path`: the session holds it, but not on the lineage this story tells. `untold`: on this lineage, but past the last bookmark — no section reaches it. `not-held`: the session does not hold it at all (a forgotten bookmark, a picture that is gone). Three, kept apart, because they send a reader to different places — the restraint `CrossTierSlice.dropped` keeps. The row names what was cited and stops: no repair is offered and no position is given, because this post declined to vouch for that citation and a link would hand it back.
- **A ref cannot re-split the post.** Refs are DATA — nothing of a ref is ever written into `bodyMd` or a slide, so no label, span or id can forge a section marker or inject markup. The words go on being escaped exactly as before.
- **The post is plain data.** JSON-safe, no live references; `bookmarks` keeps the structured form the sections were built from; `meta.bookmarkCount` is the count (storydeck spreads `meta` onto the post, so it never shadows `bookmarks`).

### A caption that cites, worked through

```ts
// the dashboard's caption at bookmark 2, described at commit 7:
//   "Oklahoma leads, as it did in the spike week."
//                  ^^^^ cites commit 4        ^^^^^^^^^^ cites bookmark b1
const post = toStory(state);

post.sections[1];
// {
//   key: 'bookmark-2-formal', label: 'Bookmark 2', heading: 'Formal', slides: ['bookmark-2-formal'],
//   refs: [
//     { slot: 'caption', span: [0, 8], commit: '4', label: 'Oklahoma',
//       at: { section: 'bookmark-2-formal', step: 1 } },   // ← the beat that made it true
//     { slot: 'caption', span: [24, 38], bookmark: 'b1', label: 'the spike week',
//       at: { section: 'bookmark-1-start' } },             // ← that bookmark's own section
//   ],
// }

// the same caption written on a branch this story does not tell:
post.sections[1].dropped;
// [{ slot: 'caption', span: [0, 8], commit: 'x9', label: 'Oklahoma', reason: 'off-path' }]

// the span counts in the words the section shows — the page draws from these two together
post.bookmarks[1].words.caption; // 'Oklahoma leads, as it did in the spike week.'
```

## Not here, on purpose

No story-editing UI, no auto-segmentation, no storydeck rendering — storydeck owns Read / Scroll / Watch; this module owns the honest export. No notes: the story tells the DASHBOARD's words, so a note's refs stay with the note. And no ref-drawing: the post says where every citation lands and the page draws the anchors, the way `<ProseText>` draws a slot's.
