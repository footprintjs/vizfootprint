# links — the edge layer of the interaction grammar

A **view** has a **voice**: the emission kinds it can produce (`point`,
`interval`, `cell`, `match`; a declared `point` implies `match`). An **edge**
says what one view's emission does to another: `filter` drops rows there,
`highlight` dims them and keeps them, `navigate` moves the target's viewport
and claims nothing about data, `mirror` outlines the same value there, `none`
says the link is deliberately off. A **graph** is the edges plus a default
rule.

Three laws, stated once here:

- **Nothing implicit.** The default rule (`crossfilter`: every view filters
  every other, self excluded — today's behaviour) is *materialized* into
  explicit edges at declaration. A declared edge replaces the default edge with
  the same `(source, kind, target)` in place. An absent edge under default
  `none` is a silence; a declared `none` is a fact. The matrix shows both.
- **Refused at declaration.** An edge whose kind is not in its source's voice,
  whose ends are not declared views, that links a view to itself, or that
  repeats another edge is refused with a sentence before any session exists.
- **One pass, no cycles.** One emission runs one pass over the edges in graph
  order; a response never re-emits. Filter runs before highlight before
  navigate. (The pass itself lives in the consumer: the ui adapter's
  `selectionForView` reads `edgesInto(target)`.)

Not enforced yet, said plainly: the aggregation-crossing rule (an emission over
an aggregate reaching raw rows must state its `fold`). The def does not carry
each view's grain, so the field is accepted and ignored. `onClear` is carried
and not yet applied; every clear behaves as `showAll`.

| file | one job |
|---|---|
| `types.ts` | the vocabulary and the `LinkGraph` shape; `edgeId` |
| `voice.ts` | `voiceOf(capability)` / `impliedKinds` — the ONE owner of "what can this view emit" |
| `materialize.ts` | default rule → edges; declared edges override in place; `edgesInto` / `edgesFrom` |
| `validate.ts` | the refusals, as sentences, for `validateDashboardDef` |
| `mermaid.ts` | `linksToMermaid(graph)` — declared === drawn |

Declared on the dashboard def:

```ts
links: [
  { source: 'map', kind: 'point', target: 'diseases', response: 'highlight' },
  { source: 'weeks', kind: 'interval', target: 'trend', response: 'navigate' },
  { source: 'table', kind: 'point', target: 'diseases', response: 'none' },
],
linkDefault: 'crossfilter', // the default; 'none' starts from silence
```

Read back through `session.overview().links` (and the agent's `whats_here`).
