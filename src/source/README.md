# source — where a table's rows come from

Three independent tags on a table, stated as data, and one small port — and the same three tags on a RESOURCE, which is a declared source that is not a table (its own section below). A **format** says what shape the bytes are (`rows`, `csv`, `json`); a **via** says how they travel (`inline`, `file`, `http`); **at** says where. The query port (`DataProvider`) is untouched: a source produces rows, the provider judges clauses over them.

```ts
data: {
  cells: { source: { format: 'csv', via: 'file', at: './data/nndss/snapshot.csv' }, absence, columns },
  geo:   { source: { format: 'json', via: 'file', at: new URL('./us-states.geo.json', import.meta.url).href, options: { as: 'one-row' } } },
  small: { source: { format: 'rows', via: 'inline', at: [{ a: 1 }] } },   // the same thing `rows: [...]` says
}
const dashboard = await buildDashboardAsync(def, { sources: [fileSource] });
dashboard.sources.cells   // { format, via, at, version: 'mtime:…;size:…', retrievedAt, rows }
```

## The port

`SourceAdapter { via; open(decl, { table }) → SourceHandle }` and `SourceHandle { capabilities; snapshot() → { rows, version, retrievedAt }; close() }`. One file per carrier: `inline` ships in the barrel, `file` is its own module (`src/source/file.ts`, it needs node), `http` arrives with step 5. A carrier never learns a format: `decodeRows(format, payload)` is the one decoder.

The port has a SECOND, optional door — `openResource(decl, { resource }) → ResourceHandle` — which is the same transport and the same version with the decode step skipped. Its read takes one option a table's does not (`ResourceSnapshotOptions.onProgress`: tell me how it is going), because its body may be 169 MB. It is the whole of "a resource is a declared source that is not a table" (its own section below).

A resource handle has a second door of its own — `fold(folds, options) → ResourceFoldResult` — for the computations that can run on a PREFIX even when the answer cannot, and for the resource that then never has to be held at all. That is its own layer, with its own folder and its own README: [`./fold/README.md`](./fold/README.md), "a computation declares where it may attach".

## The laws

- **A def with a non-inline source is built with `buildDashboardAsync`**; the synchronous builder refuses it with a sentence rather than pretending.
- **Capabilities are declared at open and only what is declared may be relied on**; `pushdown` is `false` for every adapter today.
- **What the adapter can vouch for is the version**: a file's mtime and size (taken after the bytes, never before), an inline payload's size and content hash (`inline:<size>-<hash>`, the same words from both builders). A commit stamping that version is step 7.
- **A document is never a table by accident** — two guards, two owners, each judging only what it can see (its own section below).
- **A JSON object is a table only when the def says so** (`options: { as: 'one-row' }`, the FeatureCollection case); a payload that says `rows` is judged on what it says. An error envelope from a door is never a one-row table by accident.
- **A refusal names the table**: every carrier sentence starts with `table "<name>"`, and the async builder raises it as a `DashboardDefError` — the same shape the sync door uses.
- **A source table runs where its rows are landed** — in memory (the default), or on the wasm engine when it says so (`buildDashboardAsync` lands the carrier's rows in the SQL backend); any other `engine` beside a `source` is refused at the def door rather than silently overridden.
- **`engine: 'auto'` resolves to memory with a note** until a measured bench exists; the placeholder thresholds are not a capacity claim.

## Refusals, typed

Every way a source can fail has one name from a closed vocabulary, `SOURCE_REFUSALS`, thrown as a `SourceRefusal` with the table and via it names and one sentence: `no-adapter` · `malformed` (the locator or the payload) · `unavailable` (the place answered without data: a missing file, a 404, a 500) · `unauthorized` (401, 403) · `disconnected` · `timeout` · `cancelled` (the caller's signal) · `too-large` (over the carrier's byte cap). `isSourceRefusal` is a brand check (name + a reason from the vocabulary), so a refusal from a second copy of the module or another realm still reads as one (a structured clone degrades to a plain `Error`, so cross a wire with `toJSON()`); `DashboardDefError.reason` carries it out of the async builder. A capability declared false names the refusal a caller gets for ignoring it: `CAPABILITY_REFUSALS = { live: 'no-live', pushdown: 'no-pushdown' }`. The async builder turns a refusal into the def's own error sentence.

## The http carrier

`httpSource({ fetch?, timeoutMs?, headers?, maxBytes? })` (its own module, `src/source/http.ts`) fetches `at` with the caller's abort signal and its own timeout over headers AND body; a RESOURCE read that carries an `onProgress` observer is read through the response's own stream instead, reported as it arrives and landed only when it is whole ("Bytes may arrive progressively", below); a 2xx with an empty body is `unavailable` (the place answered without data); the version is the server's ETag as sent (a weak `W/` stays weak), else Last-Modified, else a hash of the bytes; it declares `{ live: false, pushdown: false }`.

## A document is never a table by accident

A `csv` source pointed at a protein structure file **produced a 2,090-row table**, its single column named after the file's 80-character `HEADER` line, a version stamped beside it and no refusal anywhere:

```ts
decodeRows('csv', <1ay7.pdb text>)   // ACCEPTED, rows: 2090
// column names: ["HEADER    COMPLEX (ENZYME/INHIBITOR)              14-NOV-97   1AY7              "]
```

`json` and `rows` refuse that same file properly, and the `json` arm already stated the law the `csv` arm lacked — *an error envelope is never a table by accident*. Worse, a `text/html` error page answered for a declared `csv` became a table of HTML lines, which is why a broken dev-server data route went unnoticed across three desks: every loader parsed the fallback page into a dataset rather than refusing.

**The decoder is not the judge, and no syntactic rule there would be honest.** `decodeRows`' `csv` arm knows text, a header row and a consistent field count — and a document satisfies all three. A legitimate one-column table exists, so a rule that refused one would refuse the other. What the arm has instead is the sentence saying so, and a pointer to the two judges that hold evidence it does not.

**Guard 1 — the carrier judges what the SERVER SAID.** A response whose content type is an HTML document (`text/html`, `application/xhtml+xml`; the essence is compared, so `; charset=utf-8` changes nothing) answered for a source declared `csv` or `json` is `malformed`, refused by name before a byte of the body is read (`./http.ts` · `documentForATable`):

```
malformed: table "cells" http source https://viz.example/data.csv: the server answered content-type
  "text/html; charset=utf-8" for a source declared csv — a document is never a table by accident;
  point `at` at the data route, or find out why this one answers a page (an error page, an SPA's index.html)
```

Narrow on purpose: a server may legitimately serve CSV as `text/csv`, `text/plain` or `application/octet-stream`, or send no content type at all, so this refuses a **contradiction** and never a non-match — refuse on evidence, never on ignorance. A declared `rows` keeps its own sentence, because its arm already names an HTML body ("format rows needs a JSON list of row objects, and the body is not JSON").

**Guard 2 — the door judges agreement with the DECLARATION.** A def that names columns for a table has said what that table is, so bytes carrying **none** of them are not a missing column — they are not this table. That judgement belongs to the act that lands a source, so it lives with the build and refresh doors ([`../def/README.md`](../def/README.md), "A landing is judged against the declaration"; `../def/declaredTable.ts` · `notTheDeclaredTable`), and it judges only bytes that ARRIVED: an inline payload is the def's own text, judged with the def.

## A resource is a declared source that is not a table

Some bytes are not rows and never will be. A protein structure file is what a 3D view DRAWS; a map's outline is geometry, not data. The source port's `format` says `rows | csv | json` — a structure is none of them — so two real desks fetched those bytes **by hand**, beside the session: the protein desk with its own `fetch`, the map renderer taking its GeoJSON as a factory option (`mapRenderer({ geo })`, "geometry is host data, not chart data"). In both, **the bytes were on no commit, in no `overview().sources`, carried no version, and were invisible to time travel.** Every number a later stage computed from that file was true *of those bytes*, and nothing recorded which bytes they were. Only the library can close that: a host cannot stamp a commit, fill `sources`, or make time travel honest.

**THE LAW: a resource is a declared source that is not a table. It lands as bytes, it carries a version, the record says which version a commit was true of, and a renderer is offered it — but it is never rows, never decoded, and its bytes never ride a wire that a value may not ride.**

```ts
const def = {
  data: { atoms: { rows } },
  resources: { structure: { format: 'text', via: 'http', at: 'https://files.rcsb.org/download/1AY7.pdb' } },
};
const dashboard = await buildDashboardAsync(def, { sources: [httpSource()] });
dashboard.resources.structure  // { format: 'text', via: 'http', at: '…', version: 'etag:"…"', retrievedAt, bytes: <the size that landed> }
dashboard.resource('structure') // { format: 'text', body: '<the file>', version, retrievedAt }  ← in-process ONLY
```

- **Declared beside the data, not inside it.** `DashboardDef.resources` is `name → { format: 'bytes' | 'text', via, at?, options? }` — the same `via` vocabulary a table's source uses (`SOURCE_VIAS`), judged at the def door in the same shape and refused in the same words (`../def/validate.ts` · `validateResourceDecl`). A resource name that is also a table name is refused: **one namespace per question**, because a commit stamps table versions under `data` and resource versions under `resources`, and a name meaning both would let a reader ask the wrong one and still get an answer.
- **Carried by the carriers we already have, with the decode step SKIPPED.** `SourceAdapter.openResource` is the second door on the same port (optional, so a carrier written before resources is still valid — a host that declares a resource on such a via is refused `no-adapter` by name). `decode.ts` is for tables: a resource has no columns to judge, so `decodeRows` never runs and **guard 2** (a landing judged against a table's declaration) cannot and must not apply. `bytes` answers a `Uint8Array`, `text` a string; both carry the carrier's own `version` and `retrievedAt` exactly as a table's snapshot does, from exactly the same code.
- **`malformed` is the LOCATOR only.** The refusal vocabulary is one list (`SOURCE_REFUSALS`, shared), thrown as a `ResourceRefusal` — its own class, because `table` is a declared table's name everywhere else it is read and putting a resource's name there would be the very category error this law forbids. An HTTP error is `unavailable`, a size cap `too-large`, the caller's signal `cancelled`. Nothing is `malformed` for its CONTENT: nothing is decoded, so no body has a shape to contradict. **And guard 1 means nothing here** — it refuses a content type that CONTRADICTS a declared format, and no content type contradicts a declaration that asks for bytes: a structure file served as `text/html` is still those bytes.
- **On the overview, as facts and never as values.** `overview().resources` is `name → { format, via, at, version, retrievedAt, bytes }` — `bytes` is the SIZE, which is the one thing a reader can be told about a body it may not be handed. The payload is not there, and there is no arm that could put it there. The key is **absent** when the def declares none, so a def without resources answers an overview byte-identical to one from before they existed.
- **On the record, as a parallel map.** A commit carries `resources` (name → version) beside `data`, never folded into it: a reader that found a structure file's version under `data` would be entitled to think it could ask for its rows. Read back the same way — a commit true of a version the resource has since left is marked (`../../ui/src/adapter/sessionView.ts` · `resourcesMovedSince`, the twin of `movedSince`, over the one comparison `versionsLeft`). The stamp is EVERY declared resource's version, which is the honest narrowing: `stampData` can name the default table because a selection acts on a table, and nothing in this version binds a resource to a view — so the commit says what the dashboard HELD.
- **Offered to a renderer on the handshake.** `HostHandshake.resources` (protocol 1.10) hands a third-party chart its geometry through the protocol instead of a factory option no commit can name. At MOUNT and deliberately NOT on `RenderState`: state is pushed on every update, bytes are fetched once. Host-side only — the bytes reach a host through `Dashboard.resource(name)`, which is a METHOD and not a field beside `resources` precisely because a resource's facts ride every wire this library has and its bytes ride none of them. A session's runtime holds the facts and not the body, so nothing a session serves can reach it.
- **Refreshable by the same door.** `dashboard.refresh()` asks every table AND every declared resource; `refresh(['structure'])` asks one by name. The answers ride `RefreshResult.resources`, a map of its own — a resource has no rows and no delta, so folding it into `tables` would be a shape that promised both. An unchanged resource moves nothing; a changed one replaces the bytes a host hands out next; **a refused re-fetch leaves yesterday's bytes exactly where they are and says so** in the carrier's own reason (the table door's law, unchanged).

**What a resource is NOT, and not in this version:** decoding one into a table (a structure is not a table — that is the point); a resource as an ANALYSIS input; a byte-range or resumable read; caching policy beyond the carrier's own conditional read; and the progressive USE of a partial one, which the next section forbids outright. (Its bytes may now ARRIVE progressively — that is the section below.) A renderer offered the bytes still paints what the ROWS say — computing a value out of a resource and drawing it as data would be an aggregation the host does not own and no commit records.

One more thing it is not, because a reader will look for it: **`resources` has no row in the agent surface's parts table** (`../agent/surfaceParts.ts` · `SURFACE_PARTS`), so `whats_here { of: ['resources'] }` is refused by name. It rides an unnarrowed answer and it takes part in a `since` delta correctly — `narrowParts` walks the answer's own keys, not that table — but it cannot be ASKED for on its own, because every row of that table is a part the no-argument answer always carries, and this key is deliberately absent when a def declares no resource. Giving the table a notion of a part that may be absent is an agent-surface change with its own measured cost, not a line in this one.

## Bytes may arrive progressively — and a resource is not landed until it is whole

A curated protein-family alignment, measured live:

```
PF00545 seed      27,581 bytes     283 sequences
PF00545 full   2,943,028 bytes   3,982 sequences
PF00005 seed       8,980 bytes                  ← a huge family whose SEED is smaller than ours
PF00005 full 168,891,129 bytes                  ← and it had NOT finished after 60 seconds
```

A 169 MB body read the way a resource was read before this section blocks until it is done: one `res.text()`, one frame that never comes back. The worker-and-chunk machinery this library already has (`../data/duckdbConnection.ts`) lands **rows** into the wasm engine — a resource is bytes that are not a table, which is the tier that never got it.

**THE LAW: bytes may arrive progressively, and a host may be told how it is going. A resource is not LANDED until it is whole, and no act may read a partial one.**

```ts
const dashboard = await buildDashboardAsync(def, {
  sources: [httpSource()],
  onResourceProgress: (p) => show(p.resource, p.bytes, progressFraction(p)),   // fraction may be undefined: unknown total
});
await dashboard.refresh(['structure'], { onResourceProgress, signal: stop.signal });
```

### The first half is plumbing; the second half is the honesty

A Stockholm alignment half-arrived is **not a shallower alignment**. It is the first N sequences in file order — a biased subset, ordered by whatever the curator's file happened to list first — and a conservation score computed from it would be wrong *in a way no reader could see*: it would carry a version, a size and a retrieval time, and look exactly like an answer. So partial bytes are **never** readable, never a shorter version of the answer, and never land a version:

- a read that does not finish lands **nothing** — `landResource` is reached only by a landing that arrived (`../def/buildDashboard.ts`), so `dashboard.resource(name)` still hands out yesterday's bytes and `overview().resources` still names yesterday's version;
- it is refused **by name**, from the same closed vocabulary: `cancelled` (the caller's signal, honoured mid-stream), `disconnected` (the body ended before it was whole), `too-large` (the cap, asked of what arrives);
- and the accumulated chunks are dropped with the frame that held them, so there is no door to reach them through — not a partial snapshot, not a partial body, not a size.

A stream that ends **cleanly** short of a total the reader can trust is that refusal in its plainest form (`./http.ts` · `readProgressively`):

```
disconnected: resource "structure" http source https://…/PF00005.full: disconnected — the body ended
  after 1024 bytes of the 2048 the server declared; a resource is not landed until it is whole, so nothing moved
```

…and where there is **no** trustworthy total there is nothing to compare, so the reader claims nothing: a truncated body then arrives as the transport's own fault, which is `disconnected` too. The law is enforced where it can be proved and stated where it cannot.

### Progress is a REPORT, not a record

`ResourceProgress { resource, bytes, total? }` says how a fetch is going. It is transient, it reaches no commit, it rides no wire a session serves, it is not evidence, and **nothing computes from it** (`./progress.ts`). An observer that throws is swallowed — nothing about the read may turn on a report — and reports already made are not retracted when a read is refused: each said what had arrived, which was true when it was said. A visible act that claims nothing.

**What the overview carries is different, and IS a fact: the resource's STATE.** `ResourceInfo.state === 'arriving'` while a read for it is in flight, and the key is **absent** when the bytes are simply held. Every other field on that row still describes the bytes the dashboard HOLDS — yesterday's, during a re-read — which is the honesty: a partially arrived resource lands no version, so there is nothing newer to describe. Two words and not four: no `'refused'` (a refused re-fetch is reported in `RefreshResult.resources` and the journal, where a refusal belongs, and would otherwise need something to clear it) and no `'absent'` (a dashboard does not exist until every declared resource has landed, so no reader can ask about one that has not). The payload stays off the overview exactly as before — at every point in a fetch, `JSON.stringify(overview())` carries a size and a state word and no bytes.

### The trap, measured: do NOT compute a percentage from `content-length`

That 169 MB response came back `content-encoding: gzip`. So `content-length` was the **compressed** size while the bytes a reader accumulates are **decoded** — pinned here against a real server and a real gzip frame, as `content-length: 183` while 37,000 bytes arrive (`./resourceProgress.test.ts`). A percentage from that pair races past 100%; `content-length` may also be absent entirely (a chunked response) or simply wrong.

So **bytes-so-far is reported always**, because that is a fact the reader holds, and a **total only when the declaration counts the bytes being counted** — `declaredLength` answers `total` (a run of digits, and nothing recoding the body), `other-bytes` (a real count, of other bytes: a `content-encoding` or a `transfer-encoding`) or `none` (absent, or not a count). The last two are both "unknown total", which is **a first-class answer and never a zero**: the `total` key is absent and `progressFraction` returns `undefined`. A spinner that admits it does not know beats a bar that lies, and `progressFraction` is the ONE owner of that division so no host writes `bytes / total` over a pair that does not compare — it also clamps at 1, because with a trusted total more bytes than declared means the server declared wrongly.

**A pre-existing bug this found, and fixed** (`./progress.ts` · `tooLargeOnArrival`): the same pair feeds the `too-large` guard, and the arrival check's sentence said *"(the server declared no length)"* whenever arrival exceeded the cap — **including when the server had declared one**, which is exactly the gzip case: the compressed declaration passes the pre-read guard, and the arrival check is the one that fires. The tail now tells the truth in each of the three cases, and the words for a server that declared nothing are unchanged:

```
too-large — 37000 UTF-16 units arrived (the server declared 183 bytes, but the body arrived
  content-encoding: gzip — that count is not these bytes), the cap is 1000
```

The pre-read guard itself is unchanged and stays: over the cap compressed is over the cap decoded too, so refusing on a declaration can only ever be right. What such a declaration cannot do is *admit* a body safely — which is why the cap is asked again of what arrives, chunk by chunk, so a body over it **stops** instead of finishing.

### Where the read runs, and why there is no worker

On **this thread**, through the response's own `ReadableStream`. Accumulating bytes is not work — a chunk is pushed onto a list and counted — and a worker would add a transfer of every chunk plus a message hop for every report, while the bytes still have to end up in this heap to be handed to a renderer. The one real cost, decoding **text**, is done incrementally here (`./http.ts` · `textSink`, a `TextDecoder` with `{ stream: true }`), which is precisely what a worker would have been for: the thing that blocks a frame is one 169 MB decode, not a thousand 64 KiB ones.

### Two strategies behind one door

A host asks for a resource the same way it always did, and may add an observer and a signal (`ResourceSnapshotOptions`). A read that carries **no observer** is the read this carrier always made — the whole body in one act, `res.body` never touched — and that is a pinned test, not a hope. A read that carries one goes through the stream. The verdicts cannot diverge: the cap's last word is taken over whatever reaches `versionOfBody`, in the same unit (`bytes` for a `bytes` landing, UTF-16 units for `text`), so the progressive read's early refusal only ever spares the wire, and it says that it *stopped there* rather than quoting a count that could be read as the body's size.

`onProgress` is a REQUEST, not a guarantee. Only the **http** carrier reports today: `file` reads through node's `readFile`, which hands back a whole body, and an `inline` payload is the def's own text — it never arrives over anything. Silence is not a stall. A streamed file read is a carrier change and not a port change, because the port is already asked.

**Not in this packet, deliberately:** a byte-range or resumable read (a resumed transfer needs a range request and a way to vouch that the two halves are the same body); caching beyond the carrier's own conditional read; the progressive USE of a partial resource, which the law above forbids; and streaming for **table** sources, which land rows into an engine and have their own path and their own honesty (the row key).

## A computation declares where it may attach — and a resource nobody needs whole is never held

`whole` and `progressive` are not opposites: the alignment above carries its accession and its depth in the first couple of hundred bytes, while the per-column score needs all 169 MB. So a computation declares WHERE it attaches — `head` (a declared number of leading bytes), `incremental` (a growing prefix, monotone facts only), `whole` (everything) — and **residency is then DERIVED from those declarations rather than asked for**: a body no declared fold needs whole streams through, folded chunk by chunk, and stops having a size limit.

```ts
const out = await handle.fold!([accession, seenSoFar], { onFoldValue: (a) => show(a.fold, a.value, a.bytes) });
out.answers;     // { accession: 'PF00545.26', sequences: 3982 }
out.residency;   // 'streamed' — no `whole` fold, so the 169 MB body was never a buffer
out.version;     // the same version those bytes would have landed under
```

The law above is untouched — a `whole` fold still gets whole bytes, a landing still lands whole, a body that ended short is still refused by name — and **values still never ride the overview**: a fold answer reaches the host that asked for it and never `overview().resources`, which carries facts and a state word and no payload. The whole layer, with an example per position, the automate/declare line, why purity makes it portable and the check that falsifies a false monotone claim, is in [`./fold/README.md`](./fold/README.md).

## A table with no carrier — what the overview says, and what it does not

A table may be declared with **no carrier at all** and filled by a declared act: `data: { edges: { filledBy: 'buildEdges', columns, key } }` ([`../def/README.md`](../def/README.md), "A table filled by an act"). Nothing in this folder carries it — there is no `format`, no `via`, no `at`, no adapter, no version, and no `sources` entry, because **nothing vouched for rows that a computation produced in this process**. A `SourceInfo` minted for it would be the one untrue record on the tab.

What the Sources row says instead is the two things that ARE true of it:

```ts
(await session.overview()).tables.at(-1);
// before the act: { name: 'edges', source: { computed: 'act', by: 'buildEdges', landed: false }, engine: 'memory', declaredColumns: 3 }
// after it:       { name: 'edges', source: { computed: 'act', by: 'buildEdges', landed: true, at: 's7' }, … }
```

`by` is the act that fills it — the repair, if a reader finds no rows — `landed` is whether that act has landed at this cursor, and `at` is the COMMIT that filled it, present exactly when it has. Everything else on the row is the def's, exactly as a sourced table's is: its key, its grain, its absence vocabulary, its declared column count. `computed` is the discriminant the two carrier arms do not have, and it is shared with the aggregate's minted row (`{ computed: 'aggregate' }`), so a reader branches once on "no carrier" and then on which door.

**The row CAN date its rows, and it has to.** A carrier arm dates itself with a `version` and the minted row with `derived.at`; without `at` this row said only that rows were there, and two runs of one act land two different tables under one name (a slot per act, on a branch). The commit is the one fact that says which run a reader is looking at. It is a commit id, like `derived.at` — the arms are discriminated, so it cannot be read as the carrier arm's locator — and the parent's own data version stays on the record rather than on this row, where a reader would have to ask which table it belonged to.

Three consequences that belong here rather than in the def folder:

- **`refresh()` has nothing to move**, and says so in the `no-source` reason with a tail that is true of this table: `data["edges"] declares no source — the act "buildEdges" fills it, and an act is performed, never refreshed`. (A refresh of its PARENT does move it — the rows were computed from bytes that no longer exist, so they are dropped, reported as `filledLost`, and every read then says they were WITHDRAWN rather than never landed.)
- **The version a commit stamps for it is its PARENT's** — the version the act's input was true of, recorded on the fill and read back by the same `dataVersionOf` a derived table's is. A table nothing versions (an inline parent) stamps nothing, which is the honest answer.
- **Guard 2 still applies, at the other landing.** The rows an act lands are judged against the declaration by the same rule a carrier's bytes are (`../def/declaredTable.ts` · `notTheDeclaredTable`) — zero overlap is not this table — with its own sentence, because there is no document, no bytes to vouch for and no source to re-point.

## Provenance on the wire

`overview().sources` carries each declared table's `SourceInfo` (format, via, locator, version, retrieval time, row count), so `whats_here` and a cockpit can say what the data is and when it was read.

## A row key, a conditional read, a refresh with a delta, a stamp on every commit

- **`data[t].key`** names the row identity column. With it a refresh says exactly what was added, updated and removed (`deltaByKey`, which now lives in `src/data/delta.ts` — it is the shape the data port answers — and is still exported here); without it a refreshed table is **replaced** and nothing is guessed — the no-row-key law. A key that names an undeclared column is refused at the def door.
- **`snapshot({ sinceVersion })`** is a conditional read: the file carrier answers by a stat (mtime and size), the http carrier by `If-None-Match` / `If-Modified-Since` (a 304 is `{ unchanged }`) or, when the server vouches for nothing, by comparing the hash after the read; the inline carrier by its own version.
- **`dashboard.refresh(tables?)`** (the async builder) re-reads every declared source with the version held: unchanged moves nothing; changed hands the rows to the engine that holds the table, which replaces them in place and computes the delta where the rows live — the memory engine over its arrays, the wasm engine in its SQL backend (`DataProvider.replaceRows`; the law and both strategies are in [`../data/README.md`](../data/README.md)) — so every session sees them on its next query and the door reports `{ from, to, rows, delta }`; a carrier's refusal is reported by its reason, never thrown. Columns an analysis materialised on a replaced table are gone with the old rows: re-run the analysis. A table on an engine that cannot re-land is refused `not-reloadable`, and "close and build again" is the remedy for that case only. A synchronous dashboard answers unchanged for its inline sources.
- **The http version's spelling changed in Round 5**: an ETag is kept exactly as the server sent it (`etag:W/"abc123"`, marker and quotes), where an earlier build stripped both. A version persisted before that — a stored `SourceInfo`, an old commit stamp — no longer compares equal, so the first refresh after the change reports `changed` once on an unmoved resource, and commits stamped with the old spelling read as moved. One-time, and honest: the bytes were never compared, the spelling was.
- **Every commit carries `data`**: table → the version the engine held when it landed, for tables with a source. The ui marks a commit whose table has since moved (`dataMoved`), so a number it shows is never mistaken for reproducible; a replay against another version is labelled, not silently re-answered.

## Not yet

The streaming carrier for a TABLE's rows, and only that: `snapshot(options)` already takes an abort signal, and a delta channel gated by `live` arrives with it. (A RESOURCE's bytes already arrive progressively — its own section above, with the law that a partial one is never landed. Its remaining exclusions are listed there, and they are exclusions by DESIGN rather than work outstanding — a resource decoded into a table would be the one thing the law forbids.)

Everything else this list used to name has SHIPPED, and the section above is where each one now lives — the row key and its exact delta (`data[t].key`, `deltaByKey`), the version stamp every commit carries (`CommitRecord.data`, from the log's `stampData` hook), and the package `exports` map: `vizfootprint/source` and `vizfootprint/source/file` are real specifiers in `package.json`, so a host no longer reaches the file carrier by path. A "not yet" that outlives the work is worse than no list at all — it tells a reader to go build what is already under their hand — so `notYet.test.ts` pins this paragraph against the code that proves each one landed.
