# Progressive semantic context over real SkillGraph runs

This opt-in developer harness compares two ways to present the same analytical
metadata to Haiku. It calls the existing `vizfootprint/data` profiling APIs;
it adds no runtime dependency, new grammar or dashboard integration.

- **All at once:** the operation catalog, both operation descriptors and
  interpretation guidance stay in the base system context throughout the run.
- **Progressive:** the existing AgentFootprint SkillGraph serves the catalog
  when choosing an operation, the selected descriptor when supplying its
  parameters, and interpretation guidance when reading the result. Previous
  skill bodies retire when the graph advances.

Both arms use the same graph, available tools per stage, task, source schema,
semantic facts, result summaries, model settings and independent grading rubric.
Both keep raw synthetic rows in the host. The model chooses an operation,
executes its own plan through the public API (or explicitly refuses), then
submits a structured interpretation. The final stage answers `Done`; arbitrary
explanatory prose and automatic skill discovery are outside this experiment.
Prompt lengths differ by design. This is neither a token-matched experiment
nor a comparison against an unrestricted agent.

## Run

Build Viz first with `npm run build`. Supply an existing directory from which
published AgentFootprint public APIs resolve, such as the Neo checkout.
The harness verifies required exports and records the resolved package version.
It does not install or modify that host's dependencies.

Run the evaluator's focused checks before model evaluation:

```sh
AGENTFOOTPRINT_ROOT=/absolute/path/to/neo-agentfootprint \
  node --test scripts/profile-semantics-eval/*.node-test.mjs
```

Without that optional host, graph-audit tests report a counted skip; this is not
sufficient verification for a live run.

```sh
node scripts/evaluate-profile-semantics.mjs --dry-run \
  --agent-root /absolute/path/to/neo-agentfootprint \
  --output /absolute/path/outside/vizfootprint/dry-run

node scripts/evaluate-profile-semantics.mjs --live \
  --agent-root /absolute/path/to/neo-agentfootprint \
  --env-file /authorized/path/.env \
  --output /absolute/path/outside/vizfootprint/live-run
```

`AGENTFOOTPRINT_ROOT` can replace `--agent-root`. Output directories must be new
and outside the library checkout; earlier experiments are never overwritten.

Dry runs exercise all eight frozen cases in both arms using scripted vendor
responses through the real graph, execution and recording path. They make no
network calls and read no API key. Passing dry checks demonstrates harness
behavior, **not model accuracy**; their zero usage and local latency are not
model measurements.

Live runs measure four preselected cases: selected known-value denominator,
grouping with unknown keys excluded, refusal of arithmetic on a numeric
identifier, and refusal to recover individual-request p95 from aggregate rows.
Each case runs once per arm, alternating which arm runs first. The other four
cases have no live result. The exact snapshot is `claude-haiku-4-5-20251001`,
temperature zero and at most 500 output tokens per call. Limits are four calls
per run and 32 total live calls, sequentially, with a 60-second request timeout
and no retries. Dry checks permit at most 64 scripted calls.

Live mode requires an explicit flag and reads only `ANTHROPIC_API_KEY` from the
selected dotenv file, or the existing process environment. No environment dump
or authorization value is saved. Progress records report stages and usage;
request IDs are the only response-header values retained. No customer data is
used. Network/API failures remain separate from semantic failures.
Token totals preserve unreported usage as unavailable; they never replace a
missing counter with zero. Raw per-call usage retains any cache counters.

## What a pass means

The frozen expected answers in `fixtures.mjs` are not sent to the live model.
Before execution, the harness checks their numerical claims against the public
APIs and verifies grader controls that intentionally contain incorrect answers.
A valid JSON plan alone is insufficient: the operation, field, method,
predicate, source and selection must match the requested scope. Interpretation
checks distinguish selected rows, result groups, known denominators, missing
values, empty results and aggregate populations. A model refusal is correct
only when the specific refusal is required.

`populationBasis` names the population of a computed result, not merely the
source schema. It is `unavailable` on refusal; the refusal reason still must
identify the actual problem. A valid statistic computed over saved aggregate
rows uses `aggregate-row`. The source's original grain remains in its schema.

Manifest version 4 is a separately recorded follow-up to the first version 2
live run and an aborted version 3 run. It adds shared executable predicate
examples and group-key versus measure guidance, defines interpretation fields
explicitly, and checks unrequested frequency outputs. It fixes the ambiguous
version 2 rubric that expected `aggregate-row` even on refusal. Model-visible
references are opaque; descriptive testcase names remain only in host reports.
Version 2 and partial version 3 reference names leaked expected decision labels,
so those runs cannot establish unbiased model accuracy. Preserve their reports
as recorded; do not silently regrade them or attribute differences between these
experiments to progressive context alone.

For every model call, the harness compares the framework's rebuilt served view
and ledger receipt with the captured provider request, then checks the actual
serialized Anthropic request. Tool-call IDs, messages, system text, schemas,
model settings, receipt hashes and the graph's current operational tool menu
are checked. Progressive checks also assert that old skill bodies retire and
full operation descriptors do not remain in tool-result history. These checks
observe the real request; they do not patch it after recording.

Saved artifacts include the manifest, independent rubric, exact plans,
execution results, grades, graph events, snapshots, served views, receipts,
sanitized provider/vendor requests, responses, token usage and latency.
`REPORT.md` summarizes both denominators and every case result. A run with a
failed case exits nonzero; a missing tool call is not a successful refusal.

## Limits of the conclusion

Four live cases, one run per arm and synthetic data cannot establish general
model sufficiency, statistical reliability or accuracy on customer incidents.
The grain refusal is a semantic requirement: the executor can validly compute
p95 over aggregate rows without that answering a question about individual
requests. The result summary is a bounded context projection, not independent
authentication of a claim. This evaluation does not test multi-gigabyte data,
free-text answer grounding, production authorization or the dashboard.

Provider references checked when the harness was prepared (13 September 2026):
[Anthropic models](https://platform.claude.com/docs/en/models/overview) and
[API/authentication](https://platform.claude.com/docs/en/api/overview).
