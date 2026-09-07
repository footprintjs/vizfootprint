# `vizfootprint-studio/cards` — the card a demo cannot get wrong

A gallery of demos needs to say what each one covers. Every such list ever
written by hand has gone stale: somebody adds a view, forgets the list, and the
gallery keeps advertising a dashboard that no longer exists — or, worse, stops
advertising one that does.

So the tags are **read off the demo**. This door is presentation over the
library's own two readers and holds no knowledge of its own:

| the question | the reader | what a chip means |
|---|---|---|
| what can this build DO? | `defFeatures(dashboard)` — `vizfootprint/def` | the build holds it |
| what did somebody actually DO? | `logFeatures(records, …)` — `vizfootprint/branches` | a commit proves it |
| which gesture makes which verb? | **nobody** — a person writes it | as true as its author |

```tsx
import { DemoGallery } from 'vizfootprint-studio/cards';

<DemoGallery
  heading="What the demos cover"
  surfaces={[
    { demo: 'CDC NNDSS', surface: 'desk',       declares: defFeatures(buildDashboard(nndssDef(tables, graph))), byHand: GESTURES },
    { demo: 'CDC NNDSS', surface: 'story page', declares: defFeatures(buildDashboard(nndssDef(tables))), walked: logFeatures(payload.log, payload) },
  ]}
/>
```

---

## The five laws

### 1. A chip is generated, never typed

Nothing in this folder writes a feature down. Every chip's **label** is a value
that came out of a reader; the only words this folder owns are the FACET names
(`chart`, `selection`, `verb`, `analysis`, `gesture` …) and the sentence that
says who vouched for the chip.

```ts
chipsOf(desk).map((chip) => chip.id);
// 'declares:chart:heatmap' · 'declares:selection:point' · 'walked:verb:reencode' · 'by hand:unwired:annotate'
```

Add a view to a definition and its chart kind is on the card that afternoon. To
add a FACET, add one line to the list in `declaresChipsOf` reading a field the
readers already answer — and if the fact is not on a reader, it does not belong
on a card: teach the reader first.

### 2. ONE DEMO IS NOT ONE DASHBOARD — a card is per SURFACE

The CDC demo's desk builds its definition **with** the co-occurrence graph; its
story page builds the same demo **without** it, and the captured trace never
touches the network at all. Two surfaces, two builds, two revisions, two cards.

```ts
narrowTo([cdcDesk, cdcStory], 'declares:chart:network');  // [cdcDesk] — one card, not "the CDC demo"
```

A card that merged the two would advertise a network view the page a reader
opens has never heard of. So the unit of narrowing is a surface, the count line
says surfaces before demos, and **every chip carries its own `demo` and
`surface`** — because a chip is liable to be read on its own, in a filter's
answer, far from the card that drew it.

### 3. A chip is a claim; a silence is a sentence

Three of the ten verbs land no commit — a pan/zoom `navigate`, `fork`, and
`bookmark` — so `logFeatures` answers `'unseen'` for them. This folder mints **no
chip** for those and prints the reader's own sentence instead:

> bookmark: cannot be seen in a log — a bookmark is a name on a moment, kept
> beside the log and never in it; bookmarking lands no commit

A card that simply had no `bookmark` chip would be read as "nobody bookmarked",
which is the one thing a commit log can never say.

### 4. A correlation id is not a signature

`walkReadoutOf` reports the two numbers `logFeatures` keeps apart, and says the
difference out loud:

> a correlation id sits on 5 commits, and not one of them names the agent — an
> id is a caller's join key, not a signature

On the CDC story trace those five ids sit on ordinary user selections. The
`walked:trace:agent acted` chip is minted only when a commit's own **cause**
names the agent.

### 5. What is hand-written is labelled as hand-written

Two facts are on no card the readers can produce, and both are on the CDC demo's
own grammar panel today:

- **which gesture produces which verb** in this build (`select` is a click on a
  mark here and a lasso somewhere else), and
- **which verbs the build leaves unwired** — a verb the definition declares and
  this cockpit gives nobody a way to reach.

They arrive as `GestureNote[]`, `gesture: null` for the second, and they are
drawn under a heading that says *nobody can derive this — it is written down,
and only as true as its author*. Do not try to derive them: a log showing no
`annotate` cannot tell "nobody annotated" from "there is no button".

```ts
const GESTURES: GestureNote[] = [
  { verb: 'select', gesture: 'click a mark; shift-click adds one' },
  { verb: 'annotate', gesture: null },   // declared, and unwired in this build
];
```

---

## Where the code lives

| file | one job |
|---|---|
| `types.ts` | the card's data: `DemoSurface` in, `FeatureChip` / `FeatureChoice` out, `GestureNote` for the hand-written half |
| `chips.ts` | the generator — `chipsOf` and its three grounds, plus the two things a card says in sentences (`unseenOf`, `walkReadoutOf`) |
| `filter.ts` | `narrowTo` / `holdsFeature` / `choicesOf` / `narrowRefusal` — the narrowing, as plain functions |
| `DemoCard.tsx` | one surface's card: the head, the three grounds, the silences |
| `DemoGallery.tsx` | the picker, the count line, the refusal, and the cards in a grid that puts two surfaces side by side |
| `cards.fixture.ts` | the suite's two surfaces — ONE `libraryDef(graph?)` called two ways, and four walks dispatched into real sessions |
| `index.ts` | the door |

The chips are data before they are a component: `chipsOf`, `choicesOf` and
`narrowTo` are exported so a host — or a test, or an agent — can ask what a demo
covers with no screen at all.
