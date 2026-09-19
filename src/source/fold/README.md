# fold — a computation declares WHERE it may attach

`whole` and `progressive` are not opposites. A curated protein family's alignment carries its accession and its depth in the **first couple of hundred bytes** — `#=GF AC PF00545.26`, `#=GF SQ 3982` — while the per-column conservation score genuinely needs all **168,891,129** of them (measured; it had not finished after 60 seconds). One resource, two computations, two honest moments. The page can say *"PF00545.26 · 3,982 sequences · reading…"* in the first second, so **the provenance is known before the data is**.

## THE LAW

> **A computation declares where it may attach, and may attach before completion only if bytes that have not arrived cannot invalidate its answer.**

| position | sees | may claim |
|---|---|---|
| `head` | a **declared** number of leading bytes | facts structurally present in the head |
| `incremental` | a growing prefix | only **monotone** facts — ones later bytes can add to but never overturn |
| `whole` | everything | anything |

It is the same axis as a source's own kind, one level down: not *is the source partial* but **is this computation monotone over the prefix**.

## The port

A fold is a plain object of three small pure functions — begin, take the bytes that just arrived, answer — plus its declared `at`. Nothing more; a fold that needs a lifecycle is a fold that is doing too much, and several folds compose over one resource rather than one fold growing.

```ts
const handle = await openResource({ format: 'text', via: 'http', at }, 'alignment', [httpSource()]);
const out = await handle.fold!([accession, seenSoFar], { onFoldValue: (a) => show(a.fold, a.value, a.bytes) });
out.answers;     // { accession: 'PF00545.26', sequences: 3982 }
out.residency;   // 'streamed' — nobody declared they need these bytes whole
out.version;     // 'etag:"…"' — the same version those bytes would have landed under
```

…or through the door that opens, folds and closes in one call (`../open.ts` · `foldResource`).

### `head` — and the bound is DECLARED

"The head" is not a natural quantity, so a `head` fold says how many bytes it needs — in the type, not in a runtime check: `at: 'head'` without `headBytes` does not compile.

```ts
const accession: ResourceFold<string, string | undefined> = {
  name: 'accession', at: 'head', headBytes: 512,
  start: () => '',
  take: (_seen, head) => new TextDecoder().decode(head),   // exactly 512 bytes, contiguous, once
  finish: (text) => /#=GF AC\s+(\S+)/.exec(text)?.[1],
};
```

Two things follow, and both are the strategy's job (`./positions.ts` · `headRun`):

- **a head that arrives across several chunks is still ONE contiguous head.** A parser handed `#=GF AC PF00` and then `545.26` would answer a plausible wrong thing, so it is never handed either half. Pinned over every chunk size from one byte upward.
- **a head fold that never receives its declared bytes SAYS SO**, rather than answering from what it got — a short body is not a small header:

```
malformed: resource "alignment" http source https://…/PF00545.full: the fold "accession" declared it needs
  the first 512 bytes and the body ended after 139; a short body is not a small header, so nothing was folded
```

That refusal is the one place a resource's **bytes** can be `malformed`, and it is the declaration's own doing (`../types.ts` · `SOURCE_REFUSALS`). A head fold folds its head once and releases it, so a head fold over 169 MB costs the head.

### `incremental` — and the claim is monotone

```ts
const seenSoFar: ResourceFold<number, number> = {
  name: 'sequences', at: 'incremental',
  start: () => 0,
  take: (n, chunk) => n + newlinesIn(chunk),
  finish: (n) => n,
};
```

It answers after every chunk, and every answer carries the **extent** it is true of (`FoldAnswer.bytes`). That is what makes it honest: *"3,982 sequences so far, over 2.9 MB"* is a claim; *"3,982 sequences"* is not. A count of lines seen only rises. A per-column entropy does not, and declaring it here would be a lie the next section exists to catch.

### `whole` — everything, once

```ts
const entropy: ResourceFold<Columns, readonly number[]> = { name: 'entropy', at: 'whole', /* … */ };
```

It answers once, at the end, and only over a body that arrived whole. It is also the one declaration that makes the bytes RESIDENT.

## RESIDENCY IS DERIVED, NOT DECLARED

**If no declared fold over a resource is `whole`, the bytes need not be retained.** So the library computes that from the declarations and never asks for it (`./declare.ts` · `residencyOf`):

```ts
residencyOf([accession, seenSoFar]);   // 'streamed'  — the body goes THROUGH and is never held
residencyOf([accession, entropy]);     // 'retained'  — one `whole` fold, so it lands as it always did
```

A streamed read still vouches for what went past it: it counts the bytes and **folds the hash** as they go (`../hash.ts` · `fnv1aFold` — the whole-body hash IS that fold run to the end), so its `version` is byte-identical to the version those bytes would have landed under. Residency therefore cannot change what a number means, which is the only kind of thing this library decides for itself.

And the payoff is bigger than the memory: **the byte cap is this library's retention budget, so a read that retains nothing has none to spend** (`../http.ts` · `NO_CAP`). A 169 MB body nobody declared they need whole is not refused `too-large` and is not refused by its declared `content-length` either — while the same body with a `whole` fold is refused at exactly the threshold it always was. A body nobody needs whole stops having a size limit.

**Where it is reported:** on the read's own answer (`ResourceFoldResult.residency`), because it is a fact about a READ and its declarations — the same resource folded twice may be resident once and not the other time. It is not on `ResourceInfo`, which is the record.

## Automate what cannot change the answer. Declare what can.

That sentence sorts every decision the library might want to make on its own.

- **Stream or read whole, hold or don't** — automate freely. The two yield *identical bytes* and an identical version, so it is an optimisation: choose by what was declared and what the transport can do, record nothing, tell nobody. (A response with no readable stream cannot be folded *through*; the folds see the body as the one chunk it is, and the answers are the same.)
- **Which data, or which fold** — never automatic. Those change the number.

## Purity is why this layer is portable

A fold touches no DOM, no `fetch`, no timer, no clock, no environment — and nothing in this folder imports anything outside it. That is **asserted by reading the imports** (`./purity.test.ts`), the way the selection layer asserts its own boundary against a peer.

It matters for a reason this repo can already show: the progressive read's own tests run under `node:http` with a real gzip frame, and Node 22 gives `Response.body` a `getReader()` — the same API a browser gives. So this core already executes on both sides of the wire, and a pure fold is what keeps **moving a computation between them from changing what a number means**. The same fold in a browser and on a server is not merely code reuse; it is the reason a number computed in one place means what it meant in the other.

What the test cannot assert is a HOST's own fold: nothing stops an author reading a clock inside `take`. That claim is declared and falsified, like the monotone one — a fold that is not a function of the bytes fails the framing check below.

## Keeping a monotone claim honest

The library **cannot check** that a fold is really monotone; that is the author's claim. So: declare it, and let a conformance check falsify it (`./conformance.ts` · `falsifyMonotone`). The precedent is not theoretical — the renderer layer's `declared-delivered` conformance step caught a capability lie introduced by the next packet, hours after it was added.

```ts
falsifyMonotone({ fold: seenSoFar, chunks });                    // { ok: true }
falsifyMonotone({ fold: budgetLeft, chunks });                   // { failed: '…went from 27 over 1 chunks to 4 over 2' }
falsifyMonotone({ fold: labelsSeen, chunks, grew: isPrefixOf }); // an answer that GROWS says what growing means
```

Two properties. **The bytes, not their framing** — for every position: a fold that answers one thing over three chunks and another over the same bytes in one was never an answer about the bytes, and this is the failure real folds actually have. **The monotone claim** — for `incremental` only: its answer over each growing prefix must be one later bytes could have added to, under an order the author may declare (`grew`; the default is the strictest honest reading, so a fold whose answer genuinely grows says so rather than being assumed).

### Two monotone claims composed: an `incremental` fold over a `growing` source

They are the same idea one level apart, and they compose exactly. A `growing` source claims **the ROWS only ever extend** (`../README.md`, "How the data ARRIVES"); an `incremental` fold claims **the ANSWER only ever extends** over the bytes it has seen. Put one on the other and the second claim survives the first — a count of sequences seen so far over a body that only ever grows is still a count of sequences seen so far — which is why a growing source's extent and a fold's position never have to know about each other.

What does NOT compose is the other direction, and it is worth saying because the symmetry invites it: a `whole` fold over a `growing` source is honest only about the extent it ran on, so its answer is a number like any other and states the extent it was computed over. The falsifier below and `notGrowing` (`../../def/growing.ts`) are the same move at two levels — a declaration checked rather than trusted — and neither can stand in for the other: this one runs a fold over prefixes of one body, that one judges one reading against the last.

**What it cannot catch**, stated because a check whose limits are unstated gets trusted past them: it is a spot check over the chunks it was given, not a proof over every body; a fold can be monotone and still wrong; a `head` bound that is too small for a *different* file passes here; and an author who declares `grew: () => true` has falsified nothing. The first-party suite runs it over its own folds so a false claim fails in CI rather than on somebody's screen.

## Where a head answer goes, and the one place it may not

A head fold's answer reaches the host **as soon as it is computed** (`ResourceFoldOptions.onFoldValue`), so a screen can show it while bytes are still arriving. It also rides `ResourceFoldResult.answers` at the end, so a host that ignores the channel loses nothing, and an observer that throws changes neither (`./run.ts` · `reportAnswer`) — the value is already computed, so the delivery is a courtesy.

**But values never ride the overview.** `overview().resources` keeps carrying the resource's declared tags, its version, its retrieval time, its SIZE and its state word, and no payload — at every point in a fetch (`../../def/resourceFold.def.test.ts`). The temptation to put a nice early accession on a provenance row that is already on screen is exactly the mistake: it would be a computed value on the record's facts wire, where every other number has to come from an act. **If a host wants a head fact on the record, it lands it the way every other computed answer lands: as an act.**

## The previous law is untouched

**Bytes may arrive progressively, and a resource is not LANDED until it is whole** (`../README.md`). Nothing here weakens it:

- a `whole` fold still gets whole bytes, and a resource that lands still lands whole — byte-identically, version and all;
- a fold read whose body ends short of a total the reader can trust is still refused by name, and its `whole` fold never answers;
- an answer already given is **not retracted** — a head answer was true of a head that *did* arrive, for the reason a progress report that has been made is not withdrawn;
- and a resource with no declared fold behaves exactly as it did before this folder existed: `snapshot()` is untouched, and a read that declares nothing takes no different path.

What it adds is that a resource **nobody needs whole** no longer has to be held to be read.
