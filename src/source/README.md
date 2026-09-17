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

The port has a SECOND, optional door — `openResource(decl, { resource }) → ResourceHandle` — which is the same transport and the same version with the decode step skipped. It is the whole of "a resource is a declared source that is not a table" (its own section below).

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

`httpSource({ fetch?, timeoutMs?, headers?, maxBytes? })` (its own module, `src/source/http.ts`) fetches `at` with the caller's abort signal and its own timeout over headers AND body; a 2xx with an empty body is `unavailable` (the place answered without data); the version is the server's ETag as sent (a weak `W/` stays weak), else Last-Modified, else a hash of the bytes; it declares `{ live: false, pushdown: false }`.

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

**What a resource is NOT, and not in this version:** decoding one into a table (a structure is not a table — that is the point); a resource as an ANALYSIS input; a byte-range or streaming read; caching policy beyond the carrier's own conditional read. A renderer offered the bytes still paints what the ROWS say — computing a value out of a resource and drawing it as data would be an aggregation the host does not own and no commit records.

One more thing it is not, because a reader will look for it: **`resources` has no row in the agent surface's parts table** (`../agent/surfaceParts.ts` · `SURFACE_PARTS`), so `whats_here { of: ['resources'] }` is refused by name. It rides an unnarrowed answer and it takes part in a `since` delta correctly — `narrowParts` walks the answer's own keys, not that table — but it cannot be ASKED for on its own, because every row of that table is a part the no-argument answer always carries, and this key is deliberately absent when a def declares no resource. Giving the table a notion of a part that may be absent is an agent-surface change with its own measured cost, not a line in this one.

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

The streaming carrier, and only that: `snapshot(options)` already takes an abort signal, and a delta channel gated by `live` arrives with it. (A resource's own four exclusions are listed with its law above, and they are exclusions by DESIGN rather than work outstanding — a resource decoded into a table would be the one thing the law forbids.)

Everything else this list used to name has SHIPPED, and the section above is where each one now lives — the row key and its exact delta (`data[t].key`, `deltaByKey`), the version stamp every commit carries (`CommitRecord.data`, from the log's `stampData` hook), and the package `exports` map: `vizfootprint/source` and `vizfootprint/source/file` are real specifiers in `package.json`, so a host no longer reaches the file carrier by path. A "not yet" that outlives the work is worse than no list at all — it tells a reader to go build what is already under their hand — so `notYet.test.ts` pins this paragraph against the code that proves each one landed.
