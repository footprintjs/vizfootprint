# story/stage — the figures are live because they are replayed

`toStory` tells one lineage of a session as a storydeck post, and its figures are HTML strings: a
picture of what the dashboard showed. This mounts the dashboard itself in their place. One session,
the host's real charts bound to it, and the reader's scroll moving the session from beat to beat.

```tsx
import { StoryStage } from 'vizfootprint-ui/story/stage';
import { toStory } from 'vizfootprint-ui/story';
import 'storydeck/storydeck.css';

const post = toStory(state, { declared, author: 'the desk', date: today });

<StoryStage post={post} session={view}>
  <MyDashboard />        {/* the same charts, bound to the same session */}
</StoryStage>
```

## Why a transition needs no animation

A beat is a position on the spine. Moving forward one beat seeks through each of that bookmark's
commits **in order**, holding each for a short dwell, so the reader watches the acts land one at a
time: the brush appears, the filter narrows, the encoding changes. Those are the acts that
happened. There is nothing to tween, because the transition *is* the record — and the only thing
that could be tweened (a chart morphing between two states) would be a picture of something nobody
did.

Backwards, or a jump of more than one, is a single seek. A story runs one way; replaying it
backwards would be a story nobody told, and a reader who dragged the scrollbar wants the
destination, not four hundred milliseconds of it per beat.

## The session judges; the stage carries the answer

A post is plain data and can outlive the session it was told from: a replayed log, a reset desk, a
story saved last week. So a beat can name a position this session cannot reach — and when it does,
the reader sees a **refusal, in the session's own sentence, under the figure**, with nothing moved.

The stage does not check that beforehand, and the difference matters. `seek` judges before it moves
and moves nothing when it refuses (`src/session/README.md`, law 1); the adapter carries that answer
out (`SessionView.seek` returns the shared `{ ok } | { ok, sentence }` shape over both sources). A
check performed *here* would be a second implementation of a rule the library already owns, and the
two would drift — which is exactly the scar `../../adapter/README.md`'s law 3 was written on. So
the only judgement in this module is the one the session made, printed as it was said.

Two sentences are still the stage's own, and both are facts about the **post** rather than the
session: a beat naming a section this story does not tell, and a citation landing in a part of the
story that is not here. Neither is a question the session could answer.

The one thing the stage reads off the snapshot is the **plan** for a replay: a waypoint the session
no longer holds is left out rather than asked for. That is planning, not judging — it produces no
sentence and refuses nothing, and the destination is always the last hop and always the session's
to answer for.

### Why the port is not `SessionLike`

```ts
interface StoryStageSession {
  getState(): { readonly commits: readonly { readonly id: string }[] };
  seek(commitId: string): Promise<DescribeOutcome> | DescribeOutcome;
}
```

Two doors, because the stage drives exactly two. It is deliberately not `SessionLike` and not an
`InteractionSession`: the stage's first real host has neither. Its session lives in a *server*, and
the cockpit holds a **polled** `SessionView`. A `SessionView` satisfies this port by construction
over either source — in-process or polled — and that is the whole argument for its shape: the
adapter has already done the normalizing, so the stage never learns which source it has, and a port
that demanded a live session would have shut out the one consumer that exists.

## Read-only, and why the guard lives here

A reader browsing a story must not author it. Every pointer and activation event on the charts is
swallowed in the **capture phase** — before the chart under it sees one — so a brush cannot start
and a click cannot land. The pinning test drives a real brush and asserts the commit log did not
grow.

**The cockpit's present mode does not give this**, and the guard must not be "simplified" away in
favour of it: present mode is `pointer-events: none` in a stylesheet plus a click/keydown pause, and
a pointer-driven brush can outrun both (a host stylesheet can also override the first). This
guarantee is in the code, which is the only place it can be one.

Hover is left alone on purpose: this library does not record transient state, so a crosshair costs
the trace nothing (`../../contract/README.md`, law 2).

## The citation strip

Under the charts goes a strip of the beat's citations — never the sentence they came from. The
scroll lens's own logic is that the prose lives in the flow and the figure stays pinned, so the
sentence belongs in the flow, once; what belongs under the figure is what that sentence **rests
on**. Each citation is numbered, named by the words the library already names it by (`refName` —
the writer's own label, else the id), and is an anchor: clicking it moves the session to the moment
cited and scrolls the narrative to the beat that tells it, so the words and the figure never
disagree about where the reader is.

A citation the story landed nowhere keeps its name and gets **no anchor** — that is a saved picture,
dashboard-wide logic standing at no moment on the spine, so there is nowhere honest to send anyone.
And what the story could not honour at all joins the same strip as one quiet line
(`storyDroppedNote`, on `vizfootprint-ui/story`), naming what was cited and stopping: no link, no
repair, because this post declined to vouch for that citation and a link would hand it back.

A beat that cites nothing shows nothing under the figure. The strip is the honesty made visible —
what these words rest on, and what they could not — and where there is none to show, it is empty.

## Worked example — five beats, one live desk

```ts
// three bookmarks along the head's lineage; the second one's stretch is three acts
post.bookmarks[1];
// { index: 1, key: 'bookmark-2-the-spike', at: '17',
//   steps: [{ commitId: '15', sentence: 'pick Pertussis' },
//           { commitId: '16', sentence: 'brush weeks 10–20' },
//           { commitId: '17', sentence: 'colour by region' }], … }

replayPath(post.bookmarks[1]);   // ['15', '16', '17']  — the transition, which is the record
```

Scrolling from beat 1 to beat 2 seeks `15`, waits, seeks `16`, waits, seeks `17`. Scrolling back to
beat 1 seeks its position once. Under the charts the reader sees `this beat cites: 1 Oklahoma
2 the spike week`; clicking the first seeks the commit that claim rests on and scrolls the narrative
to the beat that tells it, and that beat's own arrival does not re-seek on top of it (the citation
already settled it).

## The door on a beat

`beatDoor` is the host's own way OUT of the story at the beat the reader is standing on — the
single-file page ([`../page/README.md`](../page/README.md)) draws **explore from here** with it, and
forks a path of the reader's own at that moment.

It sits in the strip, beside the citations, and **outside the read-only guard**. The two are not in
tension: the guard swallows gestures on the CHARTS, because a brush there would author the story a
reader came to read. A door is not a gesture on the charts — it is the reader saying they would like
to stop reading, and where that leads is the host's to decide. A beat whose bookmark this story does
not carry gets no door rather than a broken one, the same restraint the strip already keeps for a
citation that landed nowhere.

## Not here, on purpose

No story editing, no bookmark authoring, and no charts. The stage draws the strip and the refusal;
the charts are the host's, through the renderer contract it already uses, because a component
library that guessed what a dashboard looks like would be guessing about the one thing the host
actually knows. And no Read or Watch lens: storydeck owns those, and they show the post's HTML
figures — the snapshot of the same beats.
