# Data arrival: how a source that takes time stays honest

A proposal. **Steps 1 and 3 are BUILT** — progressive arrival (`src/source/README.md`, "Bytes may arrive progressively") and attachment points (`src/source/fold/README.md`, "a computation declares where it may attach"). Steps 2 and 4 are not.

## The measurement that forced it

A consumer needed a curated protein-family alignment from a public service. Measured live:

```
PF00545 seed      27,581 bytes      283 sequences
PF00545 full   2,943,028 bytes    3,982 sequences
PF00005 seed       8,980 bytes                     ← a much larger family; its SEED is smaller
PF00005 full 168,891,129 bytes    — had NOT finished after 60 seconds
```

Read the way this library reads a resource today — `res.text()`, one await — the last one blocks until it is done. Grepped across `src/source/`: no `getReader`, no `ReadableStream`, no chunking, no progress of any kind. `content-length` is consulted only to enforce a size cap.

The worker and chunked-landing machinery this library does have (`src/data/duckdbConnection.ts`) lands **rows** into the wasm engine. A resource is bytes that are not a table, and that tier never got it.

So the immediate need is a progressive read. The proposal is about what has to be true for one to be honest.

## 1 · Different types of data, and the one question that separates them

"Add streaming" looks like one feature and is three. The axis is not the transport. It is:

> **Is a partial answer a usable answer?**

| declared kind | a partial answer is | examples | what a number over it must say |
|---|---|---|---|
| `whole` | **not an answer** | an alignment, a structure file, a shapefile | which version — as today |
| `growing` | **an answer over a prefix** | paginated rows, a database cursor, a chunked CSV, an append-only log | **which extent** |
| `live` | **the only answer there is** | telemetry, server-sent events, a sensor | **as of when** |

Half a Stockholm alignment is worthless — it is the first N sequences **in file order**, a biased subset, and a conservation score computed from it would be wrong in a way no reader could see. But the first thousand rows of a time series *are* a real picture, if the number says it is over a thousand. And a live feed is never complete; "as of 09:42" is not an excuse, it is the answer.

This is a **declaration**, not a transport detail, for the same reason everything else here is declared: a source may not be vague about whether its partial state is usable.

## 2 · Progressive handling, and why the record already nearly does it

The library's claim is that a number says which bytes it came from. Arrival extends the stamp rather than replacing it:

- `whole` → one version. Unchanged.
- `growing` → a version **plus an extent**, and a commit records the extent it was true of. Time travel then does the right thing for nothing: step back and you see the number over the prefix that existed *then*, which is correct and is currently impossible.
- `live` → a version **is** a moment, and the commit records it.

A `growing` source is close to the refresh machinery that already exists, with the delta always "added" and the extent on the record. `SourceInfo` already carries `version`, `retrievedAt` and a row count; a refresh already reports a keyed delta; a commit already names the version it was true of.

### The constraint that dictates the design

**The cursor depends on the record being immutable.** A live source must therefore never mutate a landed table, or time travel breaks and every guarantee on a desk goes with it.

So a feed **accumulates outside the record, and landing is an act at a declared moment.** Between moments the screen says bytes are arriving; at a moment an act lands them and stamps it. That is the same shape as an analysis act, so it composes with the commit log, `why()`, the cursor and the crossfilter instead of needing a parallel world. The rest is plumbing.

### And the law of the first step

**Bytes may arrive progressively; a `whole` resource is not landed until it is whole, and no act may read a partial one.** Progress is a **report** — transient, reaching no commit, never evidence, nothing computes from it. The resource's *state* (arriving / landed / refused) is a different thing and is a fact, so it belongs on the overview; the payload never does.

### One measured trap

That 169 MB response arrived `content-encoding: gzip`. So `content-length` is the **compressed** size while the bytes a reader accumulates are **decoded**: a percentage from that pair races past 100%. It may also be absent (a chunked response) or wrong.

Report **bytes so far** always, because that is a fact you hold. Report a total only when the declaration can be trusted for the bytes being counted, and make **"unknown total" a first-class answer rather than a zero**. A progress bar that lies about how far along it is is worse than a spinner that admits it does not know.

The same pair feeds the existing `too-large` guard, which may therefore be comparing a compressed declaration against decoded bytes — refusing a body that fits, or admitting one that does not. Worth checking before anything is built on it.

## 3 · Metadata: a computation declares WHERE it may attach — BUILT

> Landed as `src/source/fold/` (the port, the three positions as strategies, the declaration door, the conformance falsifier) and the resource handle's second door, `fold(folds, options)`. The law, an example per position, the automate/declare line and what the falsifier cannot catch are in [`src/source/fold/README.md`](../../src/source/fold/README.md). Three things the section below under-specified, and how they were settled: a `head` fold declares its bound **in the type** (`at: 'head'` without `headBytes` does not compile) and is REFUSED rather than answered when the body cannot satisfy it; residency is reported on the READ (`ResourceFoldResult.residency`) and never on `ResourceInfo`, because it is a fact about a read's declarations rather than about the resource; and the byte cap goes with the retention it was a budget for, which is what makes "the size stops being a limit" true rather than merely said.

`whole` and `progressive` are not opposites. Some computations can run on a prefix even when the answer cannot.

The alignment's Stockholm header carries its accession and version — `#=GF AC PF00545.26` — and its depth, in the **first couple of hundred bytes**. So the accession, the version and the sequence count are knowable in the first second, while the per-column score genuinely needs all 169 MB. One resource, two computations, two honest moments.

| attaches | sees | may claim | on the alignment |
|---|---|---|---|
| **head** | a bounded prefix | facts structurally present in the head | the accession, the version, the declared depth, the alignment width |
| **incremental** | a growing prefix | only **monotone** facts — ones later bytes can add to but not overturn | sequences seen *so far*, bytes so far, a running maximum |
| **whole** | everything | anything | per-column entropy |

**The rule, in one sentence:** a computation may attach before completion only if bytes that have not arrived cannot invalidate its answer.

A header accession is safe — nothing later changes it. A count of sequences *seen so far* is monotone, and honest **only if labelled "so far"**. A per-column entropy is unsafe: every later sequence moves it. That is the same axis as §1, one level down — not *is the source partial* but **is this computation monotone over the prefix.**

### What this buys, which is more than a progress bar

**If every declared computation over a resource is monotone, the body never has to be resident.** A 169 MB alignment streams *through*, folded chunk by chunk, and never becomes a 169 MB buffer. A resource must be held whole only when some computation declares `whole`.

That is the memory-hierarchy argument, and it is a larger win than the status line: the ceiling stops being "how much can we hold" and becomes "what did anyone actually declare they need".

### Keeping the declaration honest

The library **cannot check** that a computation is really monotone; that is a claim its author makes. So use the answer this library already uses for renderer capabilities: **declare it, and let a conformance run falsify it.** Run the fold over a prefix and over the whole, and assert that a monotone declaration actually agrees. A false claim then fails in CI rather than producing a quietly wrong number on somebody's screen.

There is precedent worth citing: a conformance step added one evening — *every emission kind a renderer declares and this state can deliver must have been delivered* — caught a capability lie introduced by the next packet hours later, before it reached a page.

## 4 · Configurable: what a consumer declares, and what it picks

One resource, two attachments:

```
metadata   at: 'head'    → the accession, the version, the depth
the score  at: 'whole'   → per-column entropy
```

The page can then say *"PF00545.26 · 3,982 sequences · reading…"* within the first second — and **the provenance is known before the data is**, which is a better thing to show than a percentage.

Depth becomes the reader's choice rather than the library's guess: a seed alignment is bounded by curation (9 KB for one of the largest families in the database) while a full one is bounded by nothing. Either is legitimate; what is not legitimate is failing to say which was read and over how many sequences, because a score over 283 curated representatives is a different claim from one over 3,982 members.

So a consumer configures the part it cares about: which kind the source is, where each computation attaches, and what depth it wants — and the library holds it to what each of those can honestly claim.

## What this proposal deliberately does not add

**A generic `stream()` primitive that bypasses the source port.** It would be quicker and it would cost the thing that makes this library worth using: every number tracing to bytes with a version. Arrival is a property of a declared source, not an escape from one.

Also out: byte-range and resumable reads; caching beyond the carrier's own conditional read; progressive *use* of a partial `whole` resource, which §2's law forbids; and streaming for table sources, which land rows and have their own path.

## Order

1. **Progressive `whole`** — in flight. Bytes arrive with status; nothing reads them until complete.
2. **`growing`, with the extent on the record.** The highest-value step: it turns "we showed you a partial answer" from a lie into a stated claim, and it reuses refresh, delta and version.
3. **Attachment points** — `head`, `incremental`, `whole` — with the conformance check that falsifies a wrong monotone claim. **BUILT** (`src/source/fold/`), out of order: it needed only the progressive read beneath it, while step 2 needs the extent on the record. What it proved out of the bargain is that the memory argument is the real one — a body no declared fold needs whole is never held, and is not capped either.
4. **`live`, landing by an act.** Last, and only once the stamp is proven, because it is the one that can break the cursor if rushed.
