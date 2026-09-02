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
