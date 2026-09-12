# bench/via — what a clause's travel costs, and what the set weighs on the wire

A clause reaching a view whose table lacks its column travels a declared
relation as a semi-join computed by the source's engine
(`src/session/README.md`, "A clause travels a relation"; `session.ts` ·
`travelOf`): at dispatch, ONE projection of the near column under the clause
per near column, and the deduplicated near values ride the wire as the far
column's IN-list (`SelectionInfo.travelled`). Two numbers had to exist before
any ceiling could be discussed, and this bench produces both:

    npm run bench:via                  # writes results.json + table.md here
    node bench/via/run.mjs /tmp        # …or the report anywhere else
    VIA_REPS_EXO=20 VIA_REPS_1M=5 npm run bench:via   # a longer run

**(a)** the set's size on the wire — `JSON.stringify(activeSelections[0].travelled).length`,
the bytes `whats_here` and the adapter carry for the one selection's travelled
consumers; **(b)** the dispatch's added latency — the same gesture on the same
rows with the relation declared (the clause travels) and with none (the reach
law declines the default edge, nothing travels), on both engines, under
`bench/step0-wasm`'s one clock (`measure.ts` · `createHarness`, the 40 ms
control read first).

Two shapes. The exoplanet desk's size — 20,598 planets citing 2,000 references
uniformly (seeded, `bench-entry.ts` · `exoRows`), a scatter layer over
`planets` and a year chart layer over `references`, relation
`planets.radius_ref → references.ref` — picked by 1, 100, 1,000 and 10,000
planets, and brushed whole. And `bench/step0`'s 1,000,000-row CDC cells table
beside a 70-row `places` table keyed by `code` — the jurisdiction under a name
the cells do not carry, so a disease pick must travel `cells.jurisdiction →
places.code`. Both engines are opened the way a session opens them
(`buildDashboard` with `engine: 'wasm'` and the shipped `duckdbConnection`
opener), so the 1M row on the wasm engine IS the step0-wasm table through the
real engine, not a memory stand-in.

## The numbers (2026-09-12, `1cc5b13+dirty`, node v22.16.0, `node bench/via/run.mjs`; n = 7 at 20k, 3 at 1M — the spread is the MAX, `bench/step0-wasm/README.md` law 6)

Dispatch latency in ms, median (max):

| engine | rows | no relation, 100 picked | travels, 1 picked | 100 picked | 1,000 picked | 10,000 picked | brush over every row |
|---|---|---|---|---|---|---|---|
| memory | 20,598 planets | 0.2 (0.4) | 0.5 (1.7) | 2.1 (2.2) | 16.6 (16.7) | 184.7 (209.8) | 1.5 (4.2) |
| wasm | 20,598 planets | 0.2 (0.2) | 2.1 (2.2) | 3.2 (3.3) | 9.1 (10.1) | 62.4 (62.8) | 14.2 (14.6) |

| engine | rows | no relation, one disease picked | travels, one disease picked |
|---|---|---|---|
| memory | 1,000,000 cells | 0.1 (0.5) | 26.3 (27.2) |
| wasm | 1,000,000 cells | 0.1 (0.2) | 20.3 (21.5) |

The set on the wire:

| shape | gesture | far values | bytes |
|---|---|---|---|
| 20,598 planets → 2,000 references | 1 planet picked | 1 | 294 |
| | 100 picked | 97 | 1,305 |
| | 1,000 picked | 791 | 8,560 |
| | 10,000 picked | 1,989 | 21,064 |
| | brush over every planet | 2,000 | 21,179 |
| 1,000,000 cells → 70 places | one disease picked | 70 | 969 |

(Identical bytes on both engines — the set is the same set; `table.md` lists every cell.)

## How to read them

- **A travel costs one projection under the clause, and nothing else.** The
  "no relation" control is the dispatch's own cost (guards, commit): 0.1–0.2 ms.
  Everything above it is the source engine evaluating the clause with the near
  column projected — which is why the 1M row costs 20–26 ms (one scan of a
  million rows for one disease) and a one-planet pick at 20k costs 0.5 ms in
  memory and 2.1 ms in DuckDB (two statements, the rows and the count).
- **The memory engine's IN-list is the cost, not the travel.** 10,000 picked
  planets cost 185 ms in memory and 62 ms in DuckDB — the clause itself
  (`memoryProvider`'s match tests every row against every value), paid once
  by the travel's ask. A brush over every planet — one interval test per row
  — folds the same 2,000 references in 1.5 ms. So a wide IN-list is expensive
  wherever it is judged; the travel merely judges it one more time on the
  source. That is a fact about the match predicate, and its packet is the
  memory engine's, not this one.
- **The set's weight is the far column's cardinality, capped by the pick.**
  ~10.5 bytes per reference id on this desk; 2,000 distinct references is 21 KB
  on the wire whatever the gesture, and 70 places is under 1 KB at a million
  rows. The wire carries the set once per (selection, consumer); two consumers
  over one far table carry it twice.

## No ceiling — and the honest alternative, decided by the number, later

Nothing in this packet caps the set: a set of 2,000 ids is 21 KB — for scale,
`bench/surface/surface-table.md` (2026-09-11) measured a `whats_here` answer
at 10,043 bytes on its small shape and 49,055 on its realistic one, so a
whole-desk brush over 2,000 references would double the small answer and add
two fifths to the realistic one, per travelled consumer. If a desk
appears whose far cardinality makes the set too heavy for the wire — say a
relation onto a million-row identity brushed whole — the honest alternative is
stated here so it is not invented under pressure: **the engine keeps the set,
the wire carries its COUNT and a HANDLE** (the landing commit id and the
consumer address are already the key the session holds it under,
`session.ts` · `travelledByCommit`), and a consumer that needs the values asks
the read door for them. The chip's sentence ("reached the years through … ·
2,000 ref values") needs only the count; the render tier's fold needs the
values or the engine — which is exactly the line a ceiling would draw. The
number that draws it is a set past a measured size on a real desk, not this
bench's guess.

## What this bench does not measure

The overview's re-fold when the rows move (`retravelStale`) — one travel per
stale live clause, the same projection as above, paid at the next engine-side
door; and the render tier's fold of the travelled match, which is the match
predicate `ui/src/contract/selection.ts` already had. Neither is a new cost.
