# prose — the fourth plane

A view's **words** — title, caption, a short alt that identifies the chart, a long alt that carries the data, how to read it — as declared data with a cause. Every slot is a **record, never a string**: who wrote it, what kind of claim it makes, and what it was written against.

```ts
prose: [
  {
    viewId: 'map',
    slots: {
      title: { text: 'Pertussis by state, this week', author: { kind: 'human', by: 'sanjay' } },
      altShort: { text: 'A US map shaded by reported pertussis cases per state.', author: { kind: 'human' }, levels: ['construction'] },
      caption: {
        text: 'Oklahoma reports 502 cases, the most of any state.',
        author: { kind: 'agent', model: 'claude-opus-4-8', at: '2026-09-02T10:00:00Z' },
        levels: ['statistic'],
        basis: { encodings: { region: 'jurisdiction' }, filters: {}, columns: ['jurisdiction', 'cases'] },
      },
      howToRead: { author: { kind: 'derived' } },   // the library writes "a map with jurisdiction on region"
    },
  },
]
```

## The laws

- **Agent-written words state a basis.** Without one, a model's words are indistinguishable from stated fact.
- **An agent never states a cause.** Construction, statistics and trends are its levels; `causal` is refused with a sentence.
- **A basis names only what exists**: columns on the branch, analyses that are declared.
- **A derived slot has no text of its own**: the library writes the construction line from the encoding surface, every read, so it can never go stale.
- **Staleness is derived at read, never stored.** A slot whose basis no longer matches what is on screen renders as `stale` and names what moved (`encodings`, `filters`, `columns`, `analysis`). Shown, never hidden, never rewritten.

## Three doors, one validator

| Door | When | What happens |
|---|---|---|
| build | `buildDashboard(def)` | a `prose[]` entry that breaks a law throws with the sentence |
| dispatch | `describe` | the record is refused as a gap with the sentence; nothing lands |
| lint | `dashboard.lint()` | every declared slot judged with the data's real columns |

## What is not here yet

- **The author port**: a model proposes, a person accepts, both as commits in a proposal lane.
- **Refs**: spans of a text that point at a saved interaction — a commit or a beat — so a hover shows the act and a click seeks to it; an agent's summary in the chat becomes prose whose sentences each carry the position they were computed at.
- `why()` over a slot.
- The in-place affordances (a title edited on the chart, a caption under the plot) as their own `vizfootprint-ui` entry.

See the build order on the Interaction Grammar page.

## Files

`types.ts` the vocabulary · `sentences.ts` templates · `validate.ts` the validator, both doors · `status.ts` staleness and the construction line
