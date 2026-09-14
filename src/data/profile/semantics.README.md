# Semantic discovery and progressive result context

These public functions from `vizfootprint/data` expose the existing profiling
operations to software, UI explanations and model tools using shared definitions:

- `listProfileOperations()` returns the two small operation summaries.
- `describeProfileOperation(schema, kind, fields)` describes one operation for
  1–16 named fields, including source meaning, a tool input schema and UI text.
- `summarizeProfileResult(result, options)` projects a computed result into a
  bounded, detached context with explicit field/group/frequency omissions.

The additive `listDataOperations()` catalog includes these two operations plus
rank. `summarizeDataResult(result, options)` dispatches profile/group receipts to
the existing summary and rank receipts to `summarizeRankResult`, rejecting
options for the wrong result family. The original profile-only APIs retain
their contracts. See [rank result context](../rank/README.md#progressive-result-context)
for row paging, complete supporting keys, and the distinction between a summary
page and the saved top-N result. Rank discovery shares the same operation
meaning used in its summary; no rank plan-descriptor grammar is added here.

The analytical vocabulary remains `ProfilePlan`, `GroupProfilePlan` and `Expr`.
The generated JSON Schema describes existing plans; the runtime validators and
expression judge still decide whether a plan is valid. Descriptions do not
replace semantic validation or authenticate a source, result or user.

## Progressive disclosure

Start with the operation list and the host's authorized source catalog. Describe
only the operation and fields needed for the current question. Execute through
`profileData` or `profileGroups`; keep the full result in the host's result store.
Pass its bounded summary to the current decision, and retrieve more fields or
groups by the same result reference when needed. Focused metadata is a context
selection, not a data-access authorization boundary.

The AgentFootprint host owns SkillGraph state, scoped tools, the context ledger
and the recorded served view. It should use those existing mechanisms to serve
this metadata at the applicable skill and iteration. Viz does not create an
alternative agent-state engine or import a model SDK. Human-driven applications
can consume the same metadata directly without an agent.

`descriptor.ui` and `descriptor.tool` derive from one operation definition.
The UI can render the explanation and parameters; it must still use the actual
result's field meanings, units, row grain and scope when showing measurements.
The summaries count source rows and known values, not inferred distinct entities.
They describe computed observations; interpreting causation belongs to the
investigation with additional evidence.

## Writing a predicate and grouped field requests

The descriptor's `where.examples` demonstrates the existing `Expr` shape with
focused column names and correctly typed placeholder literals. The same examples
appear in the shared tool description and UI notes. A node is exactly one of
`{col}`, `{lit}` or `{op,args}`: comparison operands belong in `args`, not beside
`op`. Multiple conditions use an `and` operation over predicate nodes. These
examples add no expression vocabulary or validation rules. Their sample values
are neither source observations nor default filters; use the user's criteria,
and omit `where` when selecting all source rows.

For a grouped profile, `groupBy` chooses the keys that partition rows. Those
values are already returned in each group's `keys`. The separate `fields` list
asks for coverage, statistics or frequencies. Include a grouping column in that
list only when its separate summary is requested; the engine still permits that
valid use. A request for the mean of one measure by one category therefore needs
the category in `groupBy` and only the measure in `fields`.

The operation metadata tests execute the advertised equality and conjunction
examples through `profileData` and `profileGroups`, exercise numeric, string and
boolean literals, and verify that grouping keys need no redundant field summary.

## Result projection

The input must be an engine-produced receipt belonging to the host's authorized
investigation. The function does not recompute source facts or authenticate refs.
It retains source version, selection predicate/ref, input/output grain,
known/unknown coverage, chosen method and group policy. Zero/false remain known;
null estimates remain null. Field definitions are included once per response,
not copied into every group value. Group-key definitions are retained separately
even when those keys are not requested measurement fields.

Options:

| Option | Default | Maximum |
| --- | ---: | ---: |
| `fields` | First 8 requested fields | 16 explicit fields |
| `groupOffset` | 0 | Nonnegative safe integer |
| `groupLimit` | 3 | 16 |
| `frequencyLimit` | 5 | 16 |
| `maxCharacters` | 16,000 | 64,000 |

`fieldCoverage` reports omitted fields; `groupPage` reports total groups and a
`nextOffset`. Frequency previews report total distinct values and omissions,
and preserve value-ascending order; they are not a top-frequency ranking.
The group indices identify positions in this saved result and are first-seen.
A partial presentation never changes the complete result's population totals.

The character budget is measured on JSON text in UTF-16 characters, not model
tokens. Overflow refuses the projection; request fewer fields or groups instead
of clipping names or removing limitations silently. Results are detached and
frozen, while the original receipt is left untouched.

Progress still comes from the existing operation `onEvent` lifecycle. Hosts
transport events to their screens or agents and retain the operation/result IDs.
The library supplies neither a screen nor a remote job-status service.

## Verification and examples

After building, `node examples/profile-semantics.mjs` demonstrates discovery,
shared tool/UI explanations, progress and two pages of synthetic group results.
The packed-package check also executes this example after removing the installed
package and using only a standalone bundle. The browser test compares generated
metadata and result summaries in Node and a real Chromium Worker.

The opt-in Haiku evaluation is host-side development tooling. It uses synthetic
fixtures and stores the actual context and model outputs for inspection. Model
selection/interpretation success, token use and context scope need measured
comparison; metadata is not a guarantee of model correctness. Live credentials
are read only by the evaluation host and never included in generated metadata.
