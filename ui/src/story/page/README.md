# story/page — the whole desk, its story and its data, as ONE file

`toStory` writes a post. [`stage/`](../stage/README.md) mounts that post over a live session inside a
running cockpit. This is the third thing: a host runs a build and gets **one HTML file** a person can
send or drop on a static host. It opens from `file://` with no server, and it carries the definition,
the serialized log, the bookmarks, the saved pictures, the story, the engine, the charts, storydeck's
scroll lens and the data.

Scrolling it replays the acts on live charts; every citation seeks; and every beat has a door —
**explore from here** — that forks a new path at that commit and switches the page to the cockpit, so
the reader's own acts land on their own branch and never on the author's.

```tsx
// the host's page entry — file one of the recipe
import { StoryPage } from 'vizfootprint-ui/story/page';

<StoryPage
  open={(payload) => buildDashboard(myDef(tablesFrom(payload.data))).createSession()}
  story={{ declared: MY_DECLARED_WORDS, author: 'the desk' }}
  figure={(lens) => <MyCharts lens={lens} />}   /* the story lens: pinned, read-only */
  explore={(lens) => <MyCockpit lens={lens} />} /* the explore lens: where acts land */
/>
```

## Why it is a BUILD and not a button in the cockpit

Everything in a `DashboardDef` is data **except the analyses, which are code with a `run()`**. A page
cannot carry a function in a script block, so it cannot carry its own definition. It has to import
it — which means a host-authored entry file and a bundler.

That one fact decides the whole shape of this module: the library ships the *page*, the host owns the
*Vite invocation*, and the recipe below is two files the host writes rather than a function this
package exports. A "download this dashboard" button in the cockpit could only ever produce a page
whose definition had been guessed at.

## The boot, in the one order that works

```
readStoryPayload(document)   the block the build wrote
  → open(payload)            the HOST's: its def is code, so only it can build a session
  → restoreSaved(…)          the PICTURES first
  → replay(log)              the trace, verbatim
  → restoreBookmarks(…)      the BEATS last
  → toStory(state)           the post
```

**The order is not a preference.**

- Pictures first, because a commit's words may cite one (`@[the coastal states]`) and the session
  judges that citation against the pictures it holds. Replay a log that cites a picture that is not
  there yet and the replay refuses — correctly.
- Bookmarks last, because a bookmark names a commit and the session refuses to name one its log does
  not hold.

**All-or-nothing governs the boot itself** (`src/session/README.md`, law 1). A payload whose replay is
refused leaves NO session on screen: the one this boot opened is dropped unmounted, and the reader
gets the session's own refusal sentence and no story — never an empty stage, which reads as a story
with nothing in it rather than as a page that failed to open. The page has exactly three states, and
only one of them shows a story:

| state | what the reader sees |
|---|---|
| replaying | *"Replaying this page's story onto its own charts…"* — and no way in |
| ready | the front matter, the lens toggle, and the story |
| refused | the sentence, in the session's own words, and nothing else |

A restore that refused a RECORD is not fatal and not silent either: each one rides out on
`StoryFront.refused` and is printed under the front matter. A bookmark that could not come back is a
beat the story does not tell, and a reader is owed the reason.

## Two lenses, one session, and the door between them

The story lens is the [stage](../stage/README.md): the reader scrolls, the session seeks, the charts
move, and every gesture on those charts is swallowed in the capture phase. The explore lens is the
host's cockpit over the *same* session, where gestures land.

**explore from here** is one act — `newPathAt(<the commit that beat names>)` — and it is what makes
two lenses safe in one page: the reader's acts extend a NEW named path from the moment they were
reading, so the author's lineage is never added to. Switch back and the story is exactly the story
that was published. The session judges the door like any other act; a refusal is printed and **the
lens does not change**, because a page that opened the cockpit anyway would be showing a desk
standing somewhere nobody agreed to.

The door is drawn by the stage's `beatDoor` prop, in the strip under the figure and *outside* the
read-only guard. The two are not in tension: the guard swallows gestures on the CHARTS, because a
brush there would author the story a reader came to read. A door is not a gesture on the charts — it
is the reader saying they would like to stop reading.

## The ceiling, and what happens at it

The payload is a `<script type="application/vnd.vizfootprint.story+json">` block: **gzip, then
base64**, unpacked in the browser with the platform's own `DecompressionStream('gzip')` and no
library shipped to read it. base64's alphabet has no `<`, so the block needs no escaping and cannot
end itself early — a property of the encoding, not a promise kept by hand — and the type is one no
browser executes, so a log, a bookmark's name or a table's rows can never become code.

**Past ten megabytes COMPRESSED (`STORY_PAYLOAD_CEILING_BYTES`), `encodeStoryPayload` refuses.** It
is a ceiling on the compressed size because that is what the file costs to send; past it a
single-file page stops being the thing it is for — something you can mail. The refusal names the
number, the ceiling, and the one thing to do instead:

> this page's data is 14.2 MB compressed, past the 10.00 MB a single file inlines — leave the table
> where it is and declare it `via: 'http'` beside the page, so the file carries the story and
> fetches the rows

A host with a smaller budget passes its own `{ ceiling }`; the refusal then names the number that
actually applies rather than one nobody is holding to. **The page's front matter states which it is**,
with the sizes measured off the file itself rather than written down:

> This page carries its data — the committed CDC snapshot, 90300 rows, and the state outlines,
> 8.58 MB unpacked. Its payload is 1.28 MB of this file. 32 acts replayed, 6 beats named.
> Built 2026-09-05.

## Two doors, and why the codec is on its own

| door | what it is | who loads it |
|---|---|---|
| `vizfootprint-ui/story/page` | `StoryPage`, `bootStory`, and the ports they drive | the browser |
| `vizfootprint-ui/story/payload` | the codec: `encodeStoryPayload` / `decodeStoryPayload` / `storyPayloadScript` / `readStoryPayload` | the BUILD, in plain Node — and the page |

The build writes what the page reads, so both need the codec and only one of them can load a
renderer. `story/page` pulls React and storydeck; a Vite config runs in plain Node, where storydeck's
bundler-only ESM does not even resolve. So the codec is split off — the same rule the library states
for its node carrier (`PACKAGING.md`, law 3): *a subpath is for a symbol whose presence on the barrel
would change what the barrel costs to load.* One module, two doors onto it, split by which runtime is
asking; nothing is duplicated, so the id the build writes and the id the page looks for cannot drift.

## The recipe — two files the host writes

`vite-plugin-singlefile` is the standard for inlining and it is used as-is; hand-rolling the inlining
of a hashed asset graph is how a build starts quietly dropping a chunk. **This package does not depend
on Vite** — the recipe is documentation, and the demo is its test.

**1. the page entry** (`web/story/entry.tsx`) — imports the def, builds a session, hands over two lenses:

```tsx
import { createRoot } from 'react-dom/client';
import { buildDashboard } from 'vizfootprint/agent';
import { StoryPage } from 'vizfootprint-ui/story/page';
import 'vizfootprint-ui/styles.css';
import 'storydeck/storydeck.css';
import { myDef, DECLARED } from '../../src/def.js';
import { tablesFromCsv } from '../../src/etl.js';   // pure — a browser runs this ETL

let desk: ReturnType<typeof tablesFromCsv> | null = null;

createRoot(document.getElementById('root')!).render(
  <StoryPage<{ csv: string }>
    open={(payload) => {
      desk = tablesFromCsv(payload.data!.csv);          // the page's own data, out of the block
      return buildDashboard(myDef(desk)).createSession();
    }}
    story={{ declared: DECLARED, author: 'the desk' }}
    figure={(lens) => <MyCharts lens={lens} tables={desk!} pinned />}
    explore={(lens) => <MyCockpit lens={lens} tables={desk!} />}
  />,
);
```

**2. the Vite config** (`web/story.vite.config.ts`) — the plugin, plus one hook that writes the payload:

```ts
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { encodeStoryPayload, formatBytes, storyPayloadScript } from 'vizfootprint-ui/story/payload';

function storyPayload(): Plugin {
  return {
    name: 'my-story-payload',
    async transformIndexHtml(html) {
      const desk = JSON.parse(read('web/story/desk.json'));      // log + bookmarks + saved
      const encoded = await encodeStoryPayload({
        log: desk.log, bookmarks: desk.bookmarks, saved: desk.saved,
        meta: { builtAt: today(), data: { via: 'inline', label: 'the committed snapshot' }, notes: desk.notes },
        data: { csv: read('data/snapshot.csv') },
      });
      console.log(`payload: ${formatBytes(encoded.sizes.json)} → ${formatBytes(encoded.sizes.compressed)} gzipped → ${formatBytes(encoded.sizes.inlined)} inlined`);
      if (!encoded.ok) throw new Error(encoded.sentence);        // a file nobody can open is not a build that succeeded
      return html.replace('</body>', `${storyPayloadScript(encoded.text)}\n</body>`);
    },
  };
}

export default defineConfig({
  root: 'web/story',
  plugins: [react(), storyPayload(), viteSingleFile()],
  build: { outDir: 'dist/story', assetsInlineLimit: 100 * 1024 * 1024 },
});
```

`npm run story:page` → `dist/story/index.html`. That is the whole build.

**Where the log comes from is the host's business, and it should be its own step.** A build that
needed a live server would be a build nobody could run twice the same way; the demo captures the desk
once (`npm run story:capture`, GETs only — a capture that dispatched would be a reader changing the
thing it came to read) into a committed `desk.json`, and the build reads that.

## Worked example — the NNDSS desk, end to end

The demo (`vizfootprint-demo`) is the recipe's test. `npm run story:capture` reads a running desk's
`/api/state` and writes 32 commits, 6 bookmarks and 1 saved picture to `web/story/desk.json`;
`npm run story:page` builds `dist/story/index.html`, 2.15 MB, whose payload is 1.28 MB of that
(8.60 MB of JSON gzipped to 984 kB). Opened from `file://` with the network disabled:

- six beats render, and scrolling walks the session through the acts on the live charts;
- the last beat's strip reads *this beat cites: 1 California 2 the reencode*, and clicking the first
  seeks the stage to the commit that claim rests on;
- a click on a bar in the story lens lands nothing — the commit log still holds the author's 32;
- **explore from here** on *"Giardiasis, same weeks"* forks the path `switch-to-giardiasis`, the front
  matter says *"Your acts land on the path switch-to-giardiasis, never on the author's"*, a click on a
  bar there lands the 33rd commit, and switching back shows the same six beats and the same two
  citations.

Its front matter carries no note, and that is the point of `StoryFront.notes`: the slot is for what a
page cannot vouch for, and this one vouches for everything it carries. It did carry one — the desk's
`/api/state` served the cockpit's *view* of a bookmark, which had no author and no time, so the
capture stamped both and said so on the page rather than letting a reader take a stamped provenance
for a recorded one. Honest, and the wrong repair: `bookmarkViews()` carries the store's creation stamp
now (`by`, and the time as `madeAt`), the capture reads it, and the note is gone. A consumer writing a
fact the library already holds is the door's bug, not the consumer's
([`../../adapter/README.md`](../../adapter/README.md), law 3).

## Not here, on purpose

No Vite dependency, no bundler, no def serialization, and no charts. The page does not know how to
build a dashboard (`open` is the host's, because its def is code) and does not know what a chart
looks like (`figure` and `explore` are the host's, because that is the one thing the host actually
knows). And no story editing: this is a page for a reader, and the reader's half of it is a door out.
