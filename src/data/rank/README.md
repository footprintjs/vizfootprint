# Ranking existing numeric observations

`rankData`, exported from `vizfootprint/data`, ranks one declared numeric measure
without aggregating it. It uses the existing profile schema, snapshot provider,
expression validator and selection scanner, then the existing memory provider's
numeric sort. This is bounded retained-data execution, not SQL pushdown or a
constant-memory top-k algorithm.

```js
import { createArrayProfileProvider, rankData } from 'vizfootprint/data';
const result = await rankData(createArrayProfileProvider(schema, rows), {
  kind: 'rank', version: 1, ops: 1,
  source: schema.source, selectionRef: 'selection:owned-current',
  keys: ['cluster', 'node'], metric: 'p95_latency_us',
  direction: 'desc', limit: 5, missing: 'exclude', ties: 'keys-ascending',
}, { operationId: 'operation:rank-1', resultRef: 'result:rank-1', signal });
```

The `ProfileSchema` must supply the source snapshot identity, table, row grain,
column types/roles/meanings and any units. The metric must be a numeric measure;
keys must be one to four declared identifier/dimension columns. Complete key
tuples must be unique across the supplied snapshot, including excluded rows,
so a returned supporting reference cannot name two records. Missing or empty
keys refuse. Only null/undefined measurements are missing; zero is known and
nonfinite or incorrectly typed selected values refuse. No strings are coerced.

The optional `where` uses existing `Expr` operations and selects only `true`.
The receipt separates scanned, selected, excluded and predicate-unknown rows,
then known/missing selected measurements. The entire selected population is
validated before ordering and top-N projection. Equal measurements use the
complete keys in ascending order. `position` is ordinal, not dense or competition
rank; the top-N boundary may split equal measurements, which the receipt says.
`complete` means every known selected measurement was returned, not complete
estate coverage. Ranking an existing p95 ranks those reported p95 values; it
does not recompute an operation percentile or infer weighting.

Results preserve the actual plan/schema, source, selection/result/operation
references, counts and exact key references for each ranked value. The host owns
reference persistence, access control and immutable source identity. A version
label cannot stabilize a live source. Source provenance and estate coverage
remain adapter responsibilities; the receipt describes the provider's snapshot.

Default limits: 100,000 scanned rows, 100,000 retained identity rows, 1,000,000
retained string characters and 128 KiB result JSON (UTF-8). Maximum overrides
are respectively 1,000,000, 100,000, 8,000,000 and 1 MiB; limit is 1–100 results.
Keys from excluded rows count toward retention. Exceeding any bound refuses,
never ranks an incomplete prefix. The shared scanner provides cancellation,
iterator cleanup and synchronous progress observation; completion follows the
sort and result-size check. Provider buffers and native preloading are not
bounded by these analytical retention limits.

## Native session integration

`rankAnalysis` is exported through `vizfootprint/analysis`. The same factory can
be declared as data using `RankDecl` from `vizfootprint/def`:

```js
const result = await session.dispatch({
  verb: 'analyze', analysisId: 'rank-1', table: schema.table,
  def: { builtin: 'rank', schema, plan,
    operationId: 'operation:rank-1', resultRef: 'result:rank-1' },
  cause: { requestedBy: 'agent', computedBy: 'agent', intent: 'highest latency' },
});
// Check result.ok and result.analysis.result.ok.
// result.analysis.result.output.ranking is the complete ranking receipt.
// result.analysis.commit is the actual native cause-tagged analysis commit.
```

The native session reads its current selection. Its receipt explicitly says
`conventions.population: 'analysis-input'`: scanned counts describe that input,
not another scan of the original estate. Existing native provenance records
which selection commits supplied it. Hosts must mint current selection/result
references per operation and retain the native commit beside the result.
The source schema describes the immutable loaded basis; later source queries
must use a new schema/basis rather than reuse a stale version label.

Rank opts into `AnalysisDef.requiresCompleteInput`. A provider-capped native
read refuses before computation/commit, and explicit substituted `input` is
refused. Direct factory calls rank the array actually passed by their trusted
caller. Empty and all-missing tables return empty results using declared schema;
observed values still undergo strict validation.

This uses the existing `analyze` verb and table output channel. The output also
contains flat key/metric rows, but no new native table is materialized. Render
an ordered existing source view or retain a separate result projection; do not
claim it is a newly registered Viz layer. Native replay keeps the declaration
and reruns against the available source, following the existing session policy.
Rank neither creates cohorts nor groups source rows; use existing `profileGroups`
or aggregate declarations when those are the intended operations.
