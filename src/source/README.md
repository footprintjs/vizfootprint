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
- **A JSON object is a table only when the def says so** (`options: { as: 'one-row' }`, the FeatureCollection case); a payload that says `rows` is judged on what it says. An error envelope from a door is never a one-row table by accident.
- **A refusal names the table**: every carrier sentence starts with `table "<name>"`, and the async builder raises it as a `DashboardDefError` — the same shape the sync door uses.
- **A source table runs in memory**; an `engine` beside a `source` is refused at the def door rather than silently overridden.
- **`engine: 'auto'` resolves to memory with a note** until a measured bench exists; the placeholder thresholds are not a capacity claim.

## Not yet

HTTP and streaming carriers (`snapshot(options)` already takes an abort signal; a conditional read `sinceVersion` and a delta channel gated by `live` arrive with them), time-aware refusals, the row key and the version stamp on commits, snapshot plus delta, and a package `exports` map (`./source`, `./source/file`) — today the library is consumed by path, so a host imports the file carrier from `src/source/file`.
