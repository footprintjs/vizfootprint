# story — the story bridge

The sixth layer: a session's named beats, told as a [storydeck](https://github.com/footprintjs/storydeck) post. One function, pure:

```ts
import { toStory } from 'vizfootprint-ui/story';

const post = toStory(state, {
  figure: (beat) => svgOfWhatTheDashboardShowedAt(beat.at), // the host's own markup
  declared: { title: 'Weekly desk', caption: 'Reported cases by state.' }, // the def's DECLARED dashboard prose
  date: '2026-09-02', author: 'the desk', // what storydeck's PostView prints
});
// post = { meta, sections, bodyMd, deckSlides, beats } — storydeck's assemblePost takes the first four as-is
```

## The laws

- **The spine is one lineage.** The head's (not the cursor's), or a named path's (`path`); an unknown name is a `TypeError`, never a guess. Beats are ordered along it (root → tip) — a beat named on an abandoned branch is elsewhere, not earlier. No commits yet ⇒ an empty story with `meta.tip === null`.
- **One beat = one section, joined by key.** A section's `key` is unique on the spine (`beat-<n>-<slug>`) and is also the slide's join key (`deckSlides[].label`), because beat labels may repeat and storydeck joins slides by label. The section's `heading` is the beat's label and its `label` (storydeck's eyebrow) is `Beat <n>`; the dashboard title heads the post.
- **The steps are the commits since the previous beat** up to and including the position the beat names, as sentences (the person's intent when the cause carried one, else the ledger's label); beat commits are not steps.
- **The words of a beat are the dashboard's own, at the beat.** `describe` with viewId `'dashboard'` folds along the lineage (last wins per slot; `null` = back to `declared`). Pass the def's DECLARED words as `declared`, never the live ones — the live words would misdate every earlier beat. The `caption` is the figure's caption and the body's first paragraph; `howToRead` follows it; the words at the tip give `meta.title` and `meta.description`.
- **The library renders nothing.** `figure(beat)` is the host's HTML, inserted verbatim; everything the library writes is escaped — attributes and text in the slides, and storydeck's `<!--section:key-->` marker in the body (a caption or an intent that carries `<!--` is kept as words, so no one can re-split the post).
- **Every slide carries its audit envelope.** `data-vzf-beat` (index), `data-vzf-commit` (the position named), `data-vzf-beat-commit` (the act of naming), `data-vzf-path`, `data-vzf-data` (the data versions the position was true of) — a slide can always be traced to what it shows. The slide holds only the figure and its caption: storydeck renders slides into a fixed, `aria-hidden` canvas, so the words a reader needs live in the body.
- **Captions are Markdown in the Read lens.** storydeck renders the body as Markdown, so a caption's emphasis is kept; only the section marker is neutralised.
- **The post is plain data.** JSON-safe, no live references; `beats` keeps the structured form the sections were built from; `meta.beatCount` is the count (storydeck spreads `meta` onto the post, so it never shadows `beats`).

## Not here, on purpose

No story-editing UI, no auto-segmentation, no storydeck rendering — storydeck owns Read / Scroll / Watch; this module owns the honest export. Prose `refs` (the commit anchors inside a caption) are not carried yet; the post shows words, the session keeps the proof.
