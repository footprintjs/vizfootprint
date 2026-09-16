# editor — edit where the interaction happened

`vizfootprint-ui/editor` is its own entry point: a **chart editor** with one chart's editable fields, and a floating **side drawer** for a host without a cockpit. Inside the cockpit, prefer its `aside` prop: the panel pushes the dashboard aside and animates, so the charts stay in view and a change is seen happening — never a modal. Every edit is an act the **host** lands as a commit — the component never talks to a session, the same law as the link matrix — so undo, time travel and compare carry the edits for free.

```tsx
import { EditorDrawer, ChartEditor } from 'vizfootprint-ui/editor';

<EditorDrawer open={editing !== null} title={`Edit ${editing}`} onClose={() => setEditing(null)}>
  <ChartEditor
    view={state.views.find((v) => v.viewId === editing)!}
    links={state.links}
    by="ana"
    onDescribe={(id, slot, record) => void view.describe(id, slot, record)}
    onReencode={(id, ch, field) => void view.reencode(id, ch, field)}
    onLink={(edge) => void view.link(edge)}
  />
</EditorDrawer>
```

Three sections, three planes: **Words** (the prose plane: save is `describe`, "back to the declaration" is `describe` with null; a derived slot reads only; editing the analyst's words keeps their basis and marks the author as a person editing an agent's draft), **Channels** (the encoding plane: the columns that fit, refused ones greyed with the session's sentence; a followed channel belongs to its edge), **Links** (the data plane: the edges into and out of this chart, with the responses each kind allows).

## The Links list covers every address the chart draws at

A layered view that binds nothing at its own level is a **frame**: no edge lands
at its bare address, and its layers' edges live at `viewId~layerId`
(`vizfootprint/def` "Layers" law 6a). So the list is built over the view's own
address *and* one per `ViewView.layers` entry — joined with `layerAddress`, the
marker's one owner — and each row names its own two ends, so a layer's edge
reads as itself. An editor that asked only about `view.viewId` showed a
node-link an empty list.

## And the edges the map DECLINED are shown, as notes

The default crossfilter rule never mints an edge it could not keep: two places
no relation joins and no column shares cannot filter one another, so the map
RECORDS the refusal with its reason (`LinkGraph.declined`, `src/links/README.md`
— "a declined edge is a fact, not a silence") rather than leaving an absence.
Each one touching this chart is a `role="note"` line beneath the rows, in the
map's own sentence, quoted and never re-worded (`ChartEditor.tsx` ·
`declinedWords`):

```
the map declined The ties → Every published value (point): view "net~edges" draws table "edges" and view "sheet" draws table "measurements" — no relation joins those tables and they share no column, so nothing this edge carries could be judged there
```

The two ends are named through the `labels` prop, exactly as the rows name
theirs; the **sentence itself is untouched** — it speaks addresses, and
re-wording it would print something the map never said.

**No control beside it**, and that is the point: a declined edge is not an edge
to edit — nothing on this panel could mint it, a declared relation or a shared
column would. A reader who watches a brush reach nothing at a chart learns here
that the map declined that edge, instead of reading the silence as a fault.
Nothing is drawn when the map declined nothing.
