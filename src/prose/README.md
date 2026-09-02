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

## The author port — propose, accept, decline, all as commits

A `describe` with `proposal: true` lands the record in the slot's **proposal lane** (`prose:<view>`, field `<slot>:proposal`), never as the live words, so a draft can never become the caption by last-wins. A person **accepts** it (`describe` with `accept: <the proposing commit's id>`): the record lands on the slot with `author.acceptedFrom` and `acceptedBy`, one commit, and the proposal reads *accepted* — derived from the live words, never stored. A person **declines** it (`describe` with `decline: { proposal, reason }`): the reason lands in the lane. Undo the accept and the proposal reads open again.

The model's permission follows the kind of claim: a **statistic** may be stated with a basis; a **trend** an agent perceived must be proposed (`agentTrend`); a **cause** is never an agent's to claim. The overview serves `views[].proposals`, one per slot, with the derived status.

## Refs

A record's `refs` are spans of its text that point at a commit the log holds or a beat by its label: a span inside the text, exactly one target, a target that exists. The UI renders them as small corner anchors (`ProseText`).

## What is not here yet

- A person's edit of an agent's words keeps the basis but is not re-judged for staleness against a new basis.

See the build order on the Interaction Grammar page.

## Files

`types.ts` the vocabulary · `sentences.ts` templates · `validate.ts` the validator, both doors · `status.ts` staleness and the construction line

## Shipped after the first cut

- **`why()` over a slot** — `why({ kind: 'prose', viewId, slot })`: the `describe` commit that landed the words anchors the answer; the selections live at that commit are its input; the proposal it was accepted from (`proposal`), the commit its basis names (`basis`) and the commits its spans cite (`ref`) ride as related commits, each checked against the log; a basis that quotes an analysis lends that analysis's run and ledger row. Words the declaration itself carries answer `declared-in-def` — no commit landed them.
- **The accessible name** — every chart takes `ariaLabel`; a host passes the slot `altShort` so the graphic is named by the prose plane, and a chart with no words names itself from its bindings.
- **A person's edit of an agent's words** (`author.kind: 'humanEdited'`) is judged on the screen it was made on: the basis keeps the keys the agent stated, re-stamped to now (`encodings` = the effective bindings, `filters` = the live selections, `atCommit` = the cursor). The edit reads fresh, and goes stale on its own terms when the screen moves again.
