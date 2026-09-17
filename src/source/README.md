# source — where a table's rows come from

Three independent tags on a table, stated as data, and one small port. A **format** says what shape the bytes are (`rows`, `csv`, `json`); a **via** says how they travel (`inline`, `file`, `http`); **at** says where. The query port (`DataProvider`) is untouched: a source produces rows, the provider judges clauses over them.

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

## Provenance on the wire

`overview().sources` carries each declared table's `SourceInfo` (format, via, locator, version, retrieval time, row count), so `whats_here` and a cockpit can say what the data is and when it was read.

## A row key, a conditional read, a refresh with a delta, a stamp on every commit

- **`data[t].key`** names the row identity column. With it a refresh says exactly what was added, updated and removed (`deltaByKey`, which now lives in `src/data/delta.ts` — it is the shape the data port answers — and is still exported here); without it a refreshed table is **replaced** and nothing is guessed — the no-row-key law. A key that names an undeclared column is refused at the def door.
- **`snapshot({ sinceVersion })`** is a conditional read: the file carrier answers by a stat (mtime and size), the http carrier by `If-None-Match` / `If-Modified-Since` (a 304 is `{ unchanged }`) or, when the server vouches for nothing, by comparing the hash after the read; the inline carrier by its own version.
- **`dashboard.refresh(tables?)`** (the async builder) re-reads every declared source with the version held: unchanged moves nothing; changed hands the rows to the engine that holds the table, which replaces them in place and computes the delta where the rows live — the memory engine over its arrays, the wasm engine in its SQL backend (`DataProvider.replaceRows`; the law and both strategies are in [`../data/README.md`](../data/README.md)) — so every session sees them on its next query and the door reports `{ from, to, rows, delta }`; a carrier's refusal is reported by its reason, never thrown. Columns an analysis materialised on a replaced table are gone with the old rows: re-run the analysis. A table on an engine that cannot re-land is refused `not-reloadable`, and "close and build again" is the remedy for that case only. A synchronous dashboard answers unchanged for its inline sources.
- **The http version's spelling changed in Round 5**: an ETag is kept exactly as the server sent it (`etag:W/"abc123"`, marker and quotes), where an earlier build stripped both. A version persisted before that — a stored `SourceInfo`, an old commit stamp — no longer compares equal, so the first refresh after the change reports `changed` once on an unmoved resource, and commits stamped with the old spelling read as moved. One-time, and honest: the bytes were never compared, the spelling was.
- **Every commit carries `data`**: table → the version the engine held when it landed, for tables with a source. The ui marks a commit whose table has since moved (`dataMoved`), so a number it shows is never mistaken for reproducible; a replay against another version is labelled, not silently re-answered.

## Not yet

The streaming carrier, and only that: `snapshot(options)` already takes an abort signal, and a delta channel gated by `live` arrives with it.

Everything else this list used to name has SHIPPED, and the section above is where each one now lives — the row key and its exact delta (`data[t].key`, `deltaByKey`), the version stamp every commit carries (`CommitRecord.data`, from the log's `stampData` hook), and the package `exports` map: `vizfootprint/source` and `vizfootprint/source/file` are real specifiers in `package.json`, so a host no longer reaches the file carrier by path. A "not yet" that outlives the work is worse than no list at all — it tells a reader to go build what is already under their hand — so `notYet.test.ts` pins this paragraph against the code that proves each one landed.
