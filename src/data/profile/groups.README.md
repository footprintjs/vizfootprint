# Grouped profiles of organized data

`profileGroups` partitions a selected population by declared column values and
profiles each partition. This is **grouped data profiling** in the Data Analysis
layer, over rows that already have a
schema, source identity and grain. It does not organize flat records into
relationships or graphs, create views, or change interaction state. Its provider,
field statistics and `where` expressions are shared with [`profileData`](README.md).

The public API is exported through the existing `vizfootprint/data` entry point.
It runs in Node.js or a browser Worker without a renderer, session or agent.

## Public use

```js
import { profileGroups, createArrayProfileProvider } from 'vizfootprint/data';

const schema = {
  source: { id: 'example:requests', version: 'snapshot-1' },
  table: 'requests', grain: 'one saved request',
  columns: [
    { name: 'client', type: 'string', role: 'identifier', meaning: 'Source client identity' },
    { name: 'operation', type: 'string', role: 'dimension', meaning: 'Recorded operation' },
    { name: 'durationMs', type: 'number', role: 'measure', unit: 'ms', meaning: 'Known completed duration' },
  ],
};
const provider = createArrayProfileProvider(schema, [
  { client: 'client-a', operation: 'read', durationMs: 0 },
  { client: 'client-a', operation: 'read', durationMs: 10 },
  { client: null, operation: 'read', durationMs: null },
]);
const result = await profileGroups(provider, {
  kind: 'group-profile', version: 1, ops: 1,
  source: schema.source, selectionRef: 'example:all-requests',
  groupBy: ['client', 'operation'], unknownKeys: 'include',
  fields: [{ field: 'durationMs', statistics: ['mean', 'p95'] }],
  quantileMethod: 'nearest-rank',
}, { operationId: 'example:group-1', resultRef: 'example:groups-1' });
// Two groups: client-a/read has two rows, mean 5 ms and p95 10 ms.
// null/read has one row, one unknown duration, and null requested statistics.
```

`GroupProfilePlan` requires one to four distinct `groupBy` column names and an
explicit `unknownKeys` policy. Grouping supports declared number, string and
Boolean columns. Numeric statistics still require a number column with the
`measure` role; a grouping identifier does not thereby become a measure.
`fields`, the optional `where` predicate, `ops`, source version and quantile
methods have the same meanings as in the ordinary profile operation. See
[`groups.types.ts`](groups.types.ts) and [`types.ts`](types.ts).

## Population, keys and group references

The predicate first selects source rows. Grouping then partitions those selected
rows; it never infers a distinct-entity count from a key. Each group's `rowCount`
counts its selected source rows. Its field coverage and statistics describe
known selected values **within that group**, with unknown values reported
separately for each field. Zero and `false` are known values.

Null and missing (`undefined`) keys share the canonical `null` key. With
`unknownKeys: 'include'`, their full key tuples form explicit groups. With
`'exclude'`, a selected row with any unknown key is excluded from grouping:

| Population field | Meaning |
| --- | --- |
| `scanned`, `selected`, `excluded`, `predicateUnknown` | The original predicate's population, as in `profileData` |
| `grouped` | Selected rows assigned to a group |
| `withUnknownKeys` | Selected rows with at least one unknown grouping key |
| `excludedUnknownKeys` | Such rows excluded by the explicit grouping policy |

Thus `selected = grouped + excludedUnknownKeys`. Excluding an unknown key does
not erase that row from the selected population. A selection with no grouped
rows returns an empty `groups` array; it does not invent an empty group.

Groups use typed tuples, preserving key positions and distinguishing, for
example, the string `"null"` from an unknown key. The result declares
`groupOrder: 'first-seen'` and `grain: { kind: 'group', groupBy, sourceGrain }`.
There is no sort, rank or top-N interpretation. If a provider changes iteration
order, group indices can change even when aggregate values are equal.

Each group includes `{ ref: { resultRef, index }, keys, where, rowCount, fields }`.
Its reference names a position in this result; it is not a stable source entity
ID or a cross-result join key. The caller owns persistence and authorization for
these references. The function does not save an artifact or create history.

`group.where` composes the original predicate with exact key tests using the
existing `Expr` vocabulary; unknown keys use `isAbsent`. Run `profileData` with
that predicate, the same field requests, quantile method and **same source
snapshot** to reconstruct the group's row count and field results. Replayability
is validated against expression and plan limits; a group that cannot provide a
valid predicate is refused. A version label alone cannot stabilize a changing
database: the provider remains responsible for a truthful read snapshot.

## One scan, bounded retained state

The shared scanner reads the required projection once, applies the predicate,
and feeds per-group field accumulators. Grouping retains keys and accumulated
analytical state, not the source rows. It is not a sort or a SQL aggregate
pushdown adapter. Exact quantiles retain values, so one pass does not imply
constant memory.

All [profile retention limits](README.md#streaming-providers-and-limits) apply,
with the following additional limits:

| Limit | Default | Maximum override |
| --- | ---: | ---: |
| `maxGroups` | 128 | 4,096 |
| `maxGroupFields`: total group/field accumulator pairs | 4,096 | 16,384 |

`maxGroupFields` includes fields requesting coverage only. Per-field exact-value
and frequency limits apply to each group/field accumulator; combined retained
value and character budgets span all groups. Each component of each retained
group key consumes a value slot, including unknown keys. String key characters
also count toward the combined character budget. Retaining the same value as a
key and for a statistic or frequency table incurs each applicable charge.
These are analytical retention limits, not a bound on total process memory or
provider-owned buffers. [`groups.validate.ts`](groups.validate.ts) exports
`GROUP_PROFILE_DEFAULT_LIMITS` through the public data entry point.

Exceeding a limit fails the operation; it never silently truncates groups or
returns partial statistics as a complete answer. There is no approximate
fallback. `execution.exact` means the population is unsampled and the named
quantile method is exact; arithmetic still uses IEEE 754 numbers.

Observation and cancellation follow the [profile contract](README.md#receipts-and-observation).
Events identify `operation: 'group-profile'`; progress counts scanned and selected
rows. `onEvent` is synchronous, and returned thenables count as observer failures
without being awaited. Hosts must supply any remote progress transport or job
service. Cancellation stops waiting for pending provider work and requests
iterator cleanup; a provider that ignores the signal may retain its resource
until its own I/O completes.

## Examples and host checks

After building the package, run `node examples/group-profile-data.mjs` for
synthetic request groups by client and operation, both unknown-key policies,
and disk inventory groups by VM and disk kind. Every group is reconstructed
through `profileData` and its returned predicate. Adding `--sqlite` checks an
iterator over Node's built-in in-memory SQLite database against the array
provider, including unknown-key coverage. This fixture has no live service or
customer data; its fixed snapshot is not a production database adapter.

The checkout's `scripts/check-profile-package.mjs` reads both examples from the
actual packed archive and runs them in a fresh consumer with no installed
runtime or optional dependencies. It then bundles the public profile functions,
checks that no renderer, session, agent, React, MCP, SQLite or WASM code or
external runtime import is retained, removes the packed package, and reruns the
array examples using only that bundle.

`browser.test.ts` runs the same public-API bundle in Node and a real Chromium
module Worker. The grouped cases compare coverage, results, events and predicate
reconstruction for both unknown-key policies. The Worker has no `document` or
`window`. These checks establish small-fixture API parity and dependency
separation, not multi-gigabyte performance, a UI workflow or a Worker job service.
