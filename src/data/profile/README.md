# Profiling organized data

Profiling belongs to **Analytics**. It asks descriptive questions of data that
already has a schema, grain, identity and meaning. Structural organization—such
as linking flat records into requests, relations or an evidence graph—belongs
before this API, in the source adapter or its preparation step. A chart, table,
interaction session, agent or runbook can consume the answer; none is needed to
compute it.

The implementation lives under `data` and is exported through the existing
`vizfootprint/data` public entry point. It adds no package subpath and does not
change the existing interaction grammar or derived-column vocabulary. The
optional `where` tree uses Viz's existing `Expr` operations and `ops` version.
This profile plan is one analytical operation, not a general transformation or
runbook language.

## Public use

```js
import { profileData, createArrayProfileProvider } from 'vizfootprint/data';

const schema = {
  source: { id: 'example:requests', version: 'snapshot-1' },
  table: 'requests',
  grain: 'one saved request',
  columns: [{
    name: 'durationMs', type: 'number', role: 'measure', unit: 'ms',
    meaning: 'Known completed request duration',
  }],
};
const provider = createArrayProfileProvider(schema, [
  { durationMs: 0 }, { durationMs: 30 }, { durationMs: null },
]);
const result = await profileData(provider, {
  kind: 'profile', version: 1, ops: 1,
  source: schema.source,
  selectionRef: 'example:all-requests',
  fields: [{ field: 'durationMs', statistics: ['mean', 'p95'] }],
  quantileMethod: 'nearest-rank',
}, {
  operationId: 'example:profile-1',
  resultRef: 'example:result-1',
  onEvent(event) { console.log(event.status, event.scanned, event.selected); },
});
// Three selected rows, two known durations, one unknown; mean 15 ms, p95 30 ms.
```

From the source checkout, run `npm run build`, then `node examples/profile-data.mjs` for synthetic request
and disk-inventory examples. `node examples/profile-data.mjs --sqlite` also
checks an iterator over a temporary in-memory SQLite database using Node's
built-in `node:sqlite`. The latter needs a Node version providing that module.
It creates no file, opens no service and reads no customer data. All example
imports use the package's public entry point.

## Scope and numerical meaning

- A schema names the source snapshot, table, row grain, column types, roles,
  meanings and optional units. Row counts stay row counts; the profiler does
  not infer a distinct-entity population from an identifier or graph edge.
- Version 1 profiles number, string and Boolean fields. Numeric statistics
  require a `number` column with role `measure`. Requesting arithmetic over an
  identifier is not justified merely because its physical type is numeric.
- Only `null` and `undefined` are unknown. Zero and `false` remain known.
  Invalid values are refused rather than coerced into numbers or relabelled
  unknown.
- `where` selects only rows for which the existing expression evaluator returns
  `true`. The receipt reports scanned, selected and excluded rows, plus rows
  whose predicate answer was unknown. Each field separately reports known and
  unknown values in the selected population.
- Statistics are `sum`, `min`, `max`, `mean`, `stddevPopulation`, `stddevSample`,
  `median` and `p95`. Their population is the field's known selected values.
  Frequencies are requested separately and retain typed values and counts.
  Every requested statistic is null when no known value exists; sample standard
  deviation is also null with fewer than two known values.
- Median and p95 require an explicit `quantileMethod`. `nearest-rank` selects
  rank `ceil(p * n)` from sorted values, with ranks starting at one. `linear`
  uses Hyndman–Fan type 7 interpolation at zero-based position `(n - 1) * p`.
  For `[10, 20, 30, 40]`, their medians are 20 and 25 respectively. No method
  is silently substituted or inferred from a displayed label.

See [`types.ts`](types.ts) for the complete plan, schema, receipt and event
contracts. This operation provides descriptive statistics; it does not perform
hypothesis testing, infer causality, reorganize source records or choose an
investigation's next question.

## Streaming providers and limits

`ProfileProvider.describe(source, signal?)` returns the schema, synchronously or
through a promise. `scan(source, columns, signal)` returns a synchronous or asynchronous
iterable of projected row objects. The core owns the predicate and calculation;
an adapter must not quietly prefilter the population or substitute a preview.

The adapter is responsible for truthful snapshot identity throughout description
and scanning, projection, cancellation and iterator cleanup. For a changing
database, bind both calls to one stable read snapshot or reject a moved source.
An opaque version string alone does not make a live scan reproducible. The
SQLite example uses a fixed, in-memory fixture and is not a production snapshot
or authorization adapter.

`createArrayProfileProvider` snapshots declared primitive cells from an existing
array. Its fixed limits are 1,000,000 rows, 2,000,000 declared cells and 8,000,000
cumulative string characters. It is a convenience for bounded inputs, not a
streaming file loader; large sources should implement the provider directly.

Execution consumes the source in one pass. That does **not** promise constant
memory for every statistic: exact quantiles retain values and frequencies retain
distinct values. Scanned-row, per-field and combined retention limits bound this
work. Exceeding a limit is a refusal; partial numbers are never
returned as a complete profile. There is no approximate fallback, SQL aggregate
pushdown or multi-gigabyte performance claim in this slice.

| Limit | Default | Maximum override |
| --- | ---: | ---: |
| `maxScannedRows`: scanned source rows | 1,000,000 | 10,000,000 |
| `maxExactValues`: exact values per requested field | 100,000 | 1,000,000 |
| `maxDistinctValues`: frequency values per requested field | 128 | 4,096 |
| `maxRetainedValues`: combined retained value slots | 1,000,000 | 2,000,000 |
| `maxRetainedCharacters`: combined retained string characters | 1,000,000 | 8,000,000 |

`maxRetainedValues` counts numeric exact-buffer slots plus distinct frequency
keys across all requested fields. A value retained for both a quantile and a
frequency table consumes two slots. `maxRetainedCharacters` counts the distinct
string frequency values retained per field; the same string in two fields is
counted twice. These limits govern retained analytical values, not total process
memory or provider-owned buffers. The plan accepts at most 32 requested fields.
[`validate.ts`](validate.ts) owns the supported limits.

`execution.exact` means the selected population is unsampled and requested
quantiles use the named exact method. Arithmetic still uses IEEE 754 numbers;
it does not promise arbitrary precision or freedom from rounding error.

## Receipts and observation

The caller supplies `operationId`, `resultRef` and `selectionRef`. The result
retains the actual plan and schema as well as population, per-field coverage,
statistics, execution metadata and conventions. These references name the host's
objects; this function does not persist artifacts, authorize reference reads or
create interaction-history commits.

`onEvent` is a **synchronous** observer of `started`, `progress` and terminal
`completed`, `failed` or `cancelled` statuses. It should finish quickly: time
spent inside synchronous callback code cannot be preempted. Thrown exceptions
are counted as observer failures. Returning a promise or other thenable also
counts as an observer failure immediately; its rejection is consumed and it is
not awaited. Asynchronous observers therefore cannot delay completion or change
the computed answer. `progressEvery` controls the row interval for progress
events. The host must transport and retain events if a
remote UI or agent needs them; a callback is not a shared job-status service.
The profile operation neither creates views nor modifies presentation state.
Malformed declarations may be rejected before `started`, because the core cannot
emit an event under invalid or invented source/operation identities.

`signal` requests cancellation. The core stops waiting for a pending description
or iterator `next()` and requests iterator cleanup through `return()` when an
iterator exists. An adapter that ignores the signal can still hold its underlying
resource until its pending I/O finishes. Prompt cancellation of the profile
does not prove that an uncooperative provider has released that resource.

## Package boundary check

The development check `node scripts/check-profile-package.mjs` builds and packs this checkout, extracts
only the package into a fresh consumer, and runs all three synthetic examples
through `vizfootprint/data` with no installed runtime or optional dependencies.
The example is read from the packed archive, so a missing shipped example fails
the check. The development checker itself requires the source checkout and its
development dependencies.
The check uses an isolated offline npm cache and removes its temporary files.

It also bundles only `profileData` and `createArrayProfileProvider` from that
public entry point. The esbuild metafile must show no emitted renderer, session,
agent, React, MCP, SQLite or WASM dependency and no retained external import.
Finally it removes the packed package and runs the two array examples using
only that standalone bundle. Optional peer declarations in the broad data
barrel may be visited by the bundler but must contribute no emitted runtime
code. This verifies computational separation; it does not validate a future UI
integration or benchmark a large source.

`browser.test.ts` additionally executes the same standalone public-API bundle in
Node.js and in a real Chromium module Worker. Both quantile methods must give
the same selected population, coverage, statistics, frequencies and operation
events (apart from elapsed time). The Worker has no `document` or `window`.
This verifies the small-data execution path in both hosts; it does not transfer
large captures into a browser or provide a production Worker job service.
