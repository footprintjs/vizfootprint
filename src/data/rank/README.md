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

## Progressive result context

`summarizeRankResult` projects a trusted `RankResult` through the same public
`vizfootprint/data` door. It reads no source rows and performs no new ranking.
The host retains the original result under its authorized `resultRef` and serves
successive pages from that same immutable receipt.

```js
import { summarizeRankResult, summarizeDataResult, listDataOperations } from 'vizfootprint/data';
const first = summarizeRankResult(result, { rowLimit: 3, maxCharacters: 16_000 });
if (first.rowPage.nextOffset !== null) {
  const next = summarizeDataResult(result, {
    rowOffset: first.rowPage.nextOffset, rowLimit: 3, maxCharacters: 16_000,
  });
}
// Shared discovery names profile, group-profile and rank; the old profile-only list stays unchanged.
const operations = listDataOperations();
```

The summary preserves the source version/table, operation/result references,
selection reference and actual predicate, input/output grain, full population
counts and rank conventions. `fieldDefinitions` declares each complete key, the
measure, and any additional predicate field once, with its meaning and unit.
Every returned row retains its exact ordinal position, value and complete
`sourceRef`; names and key components are never abbreviated. Other source
columns and raw source rows are not included. Ranking an existing percentile
still ranks those reported values; the summary performs no aggregation,
percentile calculation, unit conversion, or causal interpretation.

Two levels of omission are separate:

- `ranking.total` is the known selected population; `ranking.shown` is the saved
  top-N result size. `ranking.omitted = total - shown`. `ranking.complete` means
  every known selected value was saved, regardless of the summary page.
- `rowPage.total` is that saved result size. `returned` counts this page, and
  `omitted = total - returned` includes both earlier and later saved rows.
  `nextOffset` addresses the next row in this result, never a source-scan offset.
  An offset beyond the saved rows returns an empty page with `nextOffset: null`.

`rowOffset` defaults to 0 and must be a nonnegative safe integer; `rowLimit`
defaults to 3 and accepts 1–16. `maxCharacters` defaults to 16,000 and accepts
1–64,000. The exact budget is `JSON.stringify(summary).length` (UTF-16 code
units), not bytes, model tokens, or the size of an enclosing tool response.
Overflow throws `ProfileError` with `PROFILE_LIMIT`; request fewer rows instead
of clipping identities or dropping scope and limitations. A too-small budget
for required metadata also refuses. Malformed controls and result structures
refuse, including nonfinite values, inconsistent counts, and broken references
on rows outside the requested page. Source/version mismatches retain the
existing `SOURCE_MISMATCH` error. Results are detached and deeply frozen;
the caller's receipt is untouched.

This is structural validation of a trusted computed receipt, not independent
verification of source facts or authentication of references. The host still
owns source availability, result lookup, authorization and persistence.
`summarizeDataResult` adds dispatch over profile/group/rank and rejects options
for the wrong result family; existing `summarizeProfileResult` remains unchanged.
There is no new model SDK, tool executor, source store or package subpath.

The public example `examples/profile-semantics.mjs` includes two rank pages.
The packed-package check runs it with only the unpacked package and again as a
standalone dependency-free bundle. The existing real browser Worker test checks
that its rank metadata and pages equal the Node output.
