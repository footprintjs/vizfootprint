# Progressive analytical context: first controlled Haiku result

The corrected experiment passed all four selected cases in both context modes.
Progressive delivery used 71.6% fewer reported input tokens. This supports the
next small integration test; it does not establish general model sufficiency or
a correctness advantage over providing all metadata upfront.

## What changed

The shared profiling definitions now explain the existing expression-node
structure and provide executable examples with typed placeholder values. Group
guidance separates `groupBy` keys from the field summaries requested in `fields`.
Tools and UI explanations receive the same definitions. Runtime validators,
operation vocabulary, execution behavior and public API remain unchanged.

The optional [evaluation harness](../scripts/profile-semantics-eval/README.md)
uses the published AgentFootprint 9.97.0 package from an external host. Its real
SkillGraph advances through operation choice, parameters, interpretation and
completion. It records served views, receipts, provider requests and sanitized
vendor payloads without modifying requests after the framework records them.
No dependency was added to the portable data core.

## Corrected live experiment: manifest version 4

Model: `claude-haiku-4-5-20251001`, temperature 0, maximum 500 output tokens per
call. Four cases ran once in each arm, alternating arm order. There were 28
requests in total, no retries and no transport errors. All data was synthetic;
source rows remained in the host. Both modes used the same graph and stage tool
gates. Only the timing of metadata delivery differed.

| Context mode | Cases passed | Requests | Reported input tokens | Reported output tokens | Summed request latency |
| --- | ---: | ---: | ---: | ---: | ---: |
| All metadata upfront | 4/4 | 14 | 141,918 | 2,656 | 28.623 s |
| Progressive metadata | 4/4 | 14 | 40,292 | 2,536 | 26.074 s |

Cache creation and cache read counters were zero on every observed response.
The latency column is one run's summed request time, not a throughput benchmark.
Input reduction is `(141918 - 40292) / 141918`.

Both modes passed selected-row versus known-value denominators, grouping with
unknown keys excluded, refusal of arithmetic on numeric identifiers, and
refusal to recover individual-request p95 from saved aggregate rows. A pass
requires correct scope, actual public execution or the specific justified
refusal, correct structured interpretation and matching context witnesses.
All 28 provider/vendor pairs passed their served-view and receipt checks.

The result-population label is explicit: a refusal has no computed population
(`unavailable`), while a supported statistic over saved aggregates uses
`aggregate-row`. Source grain remains separately declared in the schema.

Fixture SHA-256:
`c6b50320283cbc7f449a8798b92a6be58a6494e43969f9e8448e88f316132824`.
The local audit bundle is named `PROFILE_SEMANTICS_GRAPH_LIVE_OPAQUE_997`.
Raw request journals are kept outside the repository.

## Earlier runs and corrections

The first version 2 run recorded 2/4 passes with all metadata and 1/4 with
progressive delivery. It exposed malformed filter nodes and unnecessary grouped
field summaries. Both models correctly refused the aggregate-grain question,
but an ambiguous population label made the original strict rubric reject that
interpretation. Those original scores remain recorded, not silently regraded.

Review then found that descriptive testcase names were present in source,
selection and result references. Names containing `refusal` revealed expected
decisions. Version 2 and the partial version 3 run therefore cannot establish
unbiased decision accuracy. Version 3 was stopped; 16 responses and 17 request
records had been saved. Its unfinished request has no measured usage claim.

Version 4 uses opaque references throughout, tests actual requests for label
leakage, rejects unrequested frequency outputs and clarifies interpretation
fields. Multiple things changed between versions. Do not attribute the revised
pass rate to progressive delivery alone or describe it as a controlled
before/after accuracy improvement.

## Verification and next step

- Library gate: 5,836 tests passed, one skipped; 100% statements, branches,
  functions and lines coverage. Typecheck and build passed.
- Packed public imports and standalone profiling/semantic examples passed,
  including the check that no UI or agent dependency enters the profile bundle.
- Evaluator: 15 focused checks passed; eight independently checked numerical
  fixtures and eight grader negative controls; all 16 scripted case/arm pairs
  passed through 60 scripted requests. Scripted results are not model accuracy.
- Independent review checked the 28 live vendor requests and served receipts.

Next, connect one profiling/grouping flow to the evidence dashboard using the
same operation metadata, data references and recorded operation events. Check
that the visible selection and calculation agree with what the model used.
Keep large data in the backend and return bounded findings plus references.

Code generation remains a possible later path for custom analysis not expressed
by supported operations. It should use restricted execution, authorized data
references and the same result validation/provenance. This experiment did not
test or add that path. It also does not cover discovery/routing, production
authorization, free-text answer grounding, multi-gigabyte scale or dashboard UI.
