# Renderer protocol — the revised "bring any chart" design

Status: **PROPOSED / canonical design record.** This document supersedes the original "bring any chart" pitch
(three co-shipped bridges + a public certification badge). It is the output of a five-lens adversarial panel
(practitioner, academic, skeptic, economist, historian) run against the original seven points, followed by a
contradiction-map synthesis. Where the panel disagreed with the original proposal, the panel wins; where the
panel converged, that convergence is the strongest evidence in this document and is called out as such.

## Why revise at all

The original pitch's central risk is that it was evaluated as an engineering design, not as an adoption bet.
Run against real precedent, the adoption thesis does not survive: **FINOS Perspective** — same analyst audience,
same JPMorgan-scale resourcing, same first-party + BYO two-tier split — shipped Highcharts and Hypergrid bridges
and then *deleted both* to consolidate on a single first-party renderer (`finos/perspective` CHANGELOG, PR
#1174). That is the single most on-topic data point available: the best-resourced real trial of "bridge packages
per chart ecosystem" ended in deliberate retreat to first-party-only. Apache Superset's third-party plugin
directory (10 plugins, explicit no-maintenance disclaimer, untouched since Feb 2024) and the now-unmaintained
`react-chartjs-2` (1,477 dependent projects, maintainers unresponsive — `chartjs/Chart.js#11848`) point the same
direction. The revised design below is built to survive that precedent rather than repeat it.

## The moat is not the bridges

Every hostile lens on the panel converged on this independently, from different evidence: the skeptic and
economist explicitly, the academic from the other direction (scoring the two-slot causal commit log with
hypothesis gating as "a genuine extension beyond either [Vega-Lite or Mosaic's] grammar" — the only piece of the
whole proposal it rated as novel). The append-only log + two-slot cause + branching + LORD++ ledger stack is what
neither Mosaic nor Databricks is building. Renderer bridges are the most *copyable*, most *expensive-to-maintain*
part of the surface area — exactly backwards from where a small team's engineering time should go. Everything
below is designed to spend the minimum viable effort on bridges and protect the actual moat.

---

## 1. The Renderer Contract — MODIFY

The contract survives as a concept but not in its original shape. The historian lens supplied the deciding
distinction: contracts that outlive their creators (LSP, ODBC/JDBC, TCK-gated JSRs) are **versioned,
capability-negotiated message protocols**; contracts that die (jQuery-UI/Backbone-era widget bridges, and — a
first-hand data point — the repo owner's own 2016 "Adapter" project, see `docs/research/weave-study.md` §6) are
**imperative object-surface wrappers** tied to a specific library's live API shape, which drift silently on every
upstream major. As originally written (vanilla mount/update/destroy, no protocol version, no handshake), the
Renderer Contract was on the graveyard side of that line. Three concrete changes move it to the surviving side:

**(a) Protocol version + capability handshake at mount, LSP-style.** A renderer declares "I speak protocol
vX.Y" and its supported capability buckets at mount time, the way LSP's `initialize` handshake lets client and
server independently evolve without breaking the wire contract (`microsoft/language-server-protocol` "Protocol
History"). This is what makes "partial or evolving compliance" a normal, non-breaking state instead of a silent
drift nobody catches until a user does.

**(b) Clause-addressable selection, not a flattened predicate.** The original spec passed renderers one
already-flattened "keep-predicate over interned keys." The academic lens's strongest evidence: Mosaic formalizes
a `Selection` as a managed *set of clauses* — one per contributing client/interactor — combined via named resolve
strategies (`single`/`union`/`intersect`), specifically so a view can exclude its own brush while honoring
everyone else's (Heer & Moritz, "Mosaic: An Architecture for Scalable & Interoperable Data Views," IEEE TVCG
2024; "Mosaic Selections," arXiv:2507.19690). A flat predicate cannot express "dim everyone's brush but my own"
without an out-of-band side channel per bridge — which is exactly the kind of bespoke per-renderer special-casing
the contract exists to eliminate one layer up. Revised shape:

```
selection: {
  clauses: Map<sourceId, predicate>,
  resolve: 'union' | 'intersect',
  selfClauseId?: sourceId,
}
```

This is not a hypothetical gap — Adapter's own 2016 attempt hit a narrower version of the same wall (one global
`defaultSelectionKeySet`, no way to run two independent linked-brushing groups; see weave-study.md §6). Clause
addressing is the fix for both problems at once.

**(c) A fourth outbound verb for view-state.** Two independent lenses derived the same missing verb from
different methodologies: the practitioner from production event APIs (`plotly_relayout`, ECharts `dataZoom` have
no equivalent in the three-callback vocabulary), the academic from Yi et al.'s interaction taxonomy (Select and
Encode are covered; **Explore** — pan/zoom/navigate — and **Reconfigure** — rearrange/sort — have no verb at all;
Yi, Kang, Stasko & Jacko, IEEE TVCG 13(6), 2007). Two hostile methodologies landing on the identical hole is the
single most trustworthy technical defect surfaced by the whole panel. Add `navigate`/view-state as a fourth typed
outbound callback (or, at minimum, a first-class gap-ledger category) alongside `emit`/`hover`/`reencodeRequest`,
and extend the capability buckets with `canPanZoom` / `canRearrange`.

**(d) Transform-ownership rule — the panel's collective blind spot.** No single lens caught this; it only
surfaces from the intersection of the practitioner's event analysis and the academic's selection analysis. Point
6 (below) puts scale machinery — crossfilter, decimation, aggregation — in the host. But Vega-Lite specs (and
ECharts/Plotly configs) can carry their own `bin`/`aggregate`/`transform` clauses. An LLM-proposed VL spec with
an internal aggregation breaks `emit()`'s raw-interned-key semantics outright (a brushed bar is an aggregate, not
a set of raw keys) and silently double-transforms data the host already decimated. **Rule:** the host owns all
binning/aggregation/decimation; a renderer must reject, or land a typed gap-ledger entry for, any spec carrying
internal transform clauses. This needs to be written down *before* the first bridge ships — it is a breaking
contract change if it arrives later.

---

## 2. Bridge packages — CUT to one

The original plan (three co-shipped bridges) does not survive. The skeptic and economist independently land on
shipping exactly one; the historian's counter-argument (curated breadth — "WeaveJS survived by wrapping only 3
frameworks and stopping there") is real but is evidence *for* a hard cap, not for launching with three
simultaneously — and the historian's own cited number includes a maps library and D3 wrapped out of necessity,
not a validated go-to-market strategy. Decisive additional data: this is the repo owner's own lived history.
WeaveJS survived by *shrinking* scope (never ported ~37 of Weave's 40 Flex tools); the 2016 "Adapter" project
attempted the more general "wrap anything" version of this exact idea and was abandoned. Inside this author's own
track record, "more bridges" is the thing that died and "fewer, curated, protocol-narrow" is the thing that
shipped.

**Decision:** ship `@vizfootprint/vega-lite` as the sole first-party bridge. Do not announce `/echarts` or
`/plotly`. When either exists, it is labeled community-contributed / "unmaintained if unowned" — first-class only
once a named external co-maintainer commits to it. This mirrors LangChain's own retreat from a monolithic
`langchain-community` package (integrations of "widely varying levels of usage, maintenance, and maturity," "high
maintenance burden") into partner packages with explicit named owners.

**Why Vega-Lite specifically, and not a coin flip among the three:** every operational lens on the panel — not
just the two that argued for cutting to one — independently lands on VL as the first bridge: the practitioner
(load-bearing risk analysis), the skeptic (ship only it), the economist (points 2 and 5 converge there — it's
simultaneously a rendering target *and* the agent-authoring surface), the historian (inside any cap, VL is the
obvious first pick). Four hostile methodologies agreeing on the same answer is the strongest kind of signal this
panel produced.

**The one wrinkle that must be engineered around, not argued around:** the practitioner's strongest finding is
that Vega-Lite is simultaneously the *privileged* agent-authoring surface (point 5) and the *weakest* of the
three bridges for the exact behavior point 5 depends on. Vega-Lite's own maintainers document that its interval
selection has no built-in "selection complete" signal (`vega/vega-lite#5341`, open) — "listening to the brush
signal alone does not suffice because there is no indication of completion" — which is inverted from what a
commit-log architecture needs (gesture → trustworthy emit). This does not change the choice of VL; it changes
what the VL bridge has to do: **synthesize a completion signal at the bridge layer** (pointer-up detection or a
debounce window over the raw brush signal), and make that synthesis a conformance-kit test case, not folklore.
The skeptic adds a second reason the bridge needs its own version-pinning discipline regardless: VL v5 already
broke its own selection semantics (`selections` → `parameters`), so even the chosen bridge needs the pinning
machinery from point 3.

---

## 3. Conformance kit — internal CI only, no public badge (yet)

The kit itself survives — historian and practitioner both want it, independently, from different precedents (JSR
Technology Compatibility Kits; ECharts' own v5/v6 upgrade guides as evidence that "certified once" silently
rots). What does not survive is the *public* badge as originally scoped:

- A "certified renderer" badge is a point-in-time claim over a moving pair (contract version × framework major
  version). Vega-Lite already broke its own selection semantics in v5 — any bridge "certified" against v4 decays
  silently under v5, which is precisely the class of untyped silent gap the capability ledger exists to forbid,
  now institutionalized one layer up, at distribution, where no gap ledger is watching.
- Certification programs historically **formalize an already-competitive market**; they don't create one. CNCF's
  Kubernetes conformance program launched with 32 already-existing conformant distributions and grew to 90+ —
  the badge gave an existing vendor field a way to differentiate to buyers. Minting a "certified renderer" badge
  before a single third-party bridge maintainer exists independent of the core team means the same team is sole
  author, judge, and cost-bearer of its own certification apparatus — unpaid governance theater performed on
  itself, not market-building.

**Decision:** keep the conformance kit as internal CI machinery, pinned to exact framework versions and re-run on
every upstream bump — "certified" means "certified at commit X of the framework," not a one-time claim. No public
badge until a second, non-author-controlled implementer actually wants one. When badges do exist, they are
version-stamped (`contract vX × renderer vY`) and **auto-expire into a typed gap-ledger entry**
(`certification-lapsed`) rather than lingering as unretracted marketing.

---

## 4. Capability declarations — SURVIVES INTACT

The one point every lens on the panel endorsed without qualification. Extend the bucket list with `canPanZoom` /
`canRearrange` (closing the Explore/Reconfigure gap from point 1c) and add `certification-lapsed` as a gap type
so an expired badge becomes visible machine state, not silent staleness.

---

## 5. Vega-Lite agent authoring — MODIFY (gate it)

The mechanism itself is not novel — Databricks already ships agents generating governed Vega-Lite specs bound to
Unity Catalog permissions, independent of any vizfootprint contract ("Bringing Visualizations to Life in
Multi-Agent Systems With Vega-Lite," databricks.com/blog). Treating it as a differentiator as originally framed
undersells the actual defensible position and ignores a real liability: LLM-generated VL is unreliable in
practice (GPT-3.5-Turbo emits valid VL only 19.1% of the time — DracoGPT, arXiv:2408.06845; a 2025 eval put
GPT-4o at 70% and Gemini at 24% chart-completion, arXiv:2507.22890) and an ungated LLM-proposed chart is an
unaudited visual hypothesis presented as evidence — a structural contradiction with an architecture that
otherwise gates every inferential claim through the LORD++ ledger.

**Decision:** an agent-proposed VL spec is a claim, not a decoration. Pipeline: schema validation → capability
check (including the transform-ownership rule from point 1d) → registered as a hypothesis in the LORD++ ledger →
only then rendered. The VL bridge must also synthesize the missing selection-completion signal from point 2
before any brush-driven emit from an agent-authored chart is trustworthy.

**Reframed positioning:** the defensible differentiator is not "agents can write Vega-Lite" (Databricks already
ships that) — it is *provenance-gated* agent-proposed charts, wired into the same hypothesis ledger and honesty
apparatus that governs every other claim in the system. That is the piece nobody else is building.

---

## 6. Host-owned scale machinery — SURVIVES, plus the transform-ownership rule

Keeping crossfilter/decimation/aggregation in the host rather than the renderer survives unchanged — Perspective's
own retreat to first-party (`d3fc`) is *supporting* evidence for keeping the host-owned tier strong, and Mosaic
already owns adjacent territory here with real distribution (integrated into Observable Framework). The one
required addition is point 1d's transform-ownership rule: bridges must reject or gap-ledger any renderer-side
spec carrying its own binning/aggregation/transform clauses, full stop.

---

## 7. First-party charts as reference implementation — SURVIVES INTACT

Perspective's retreat to first-party-only is direct supporting evidence, not just an absence of counter-evidence:
when a well-resourced, same-audience project under real maintenance pressure had to choose one tier to keep, it
kept the first-party one. Nothing in the panel argues against strengthening this tier; several lenses argue for
strengthening it further (redirect the budget saved by cutting bridges 2 and 3 here and into the provenance
substrate).

---

## The verdict table

| # | Point | Verdict |
|---|-------|---------|
| 1 | Renderer Contract | **Modify** — protocol version + capability handshake at mount; clause-addressable selection (`{clauses, resolve, selfClauseId}`); 4th outbound verb for view-state (pan/zoom/navigate); transform-ownership rule. |
| 2 | Three bridge packages | **Cut to one.** Ship `@vizfootprint/vega-lite` only. `/echarts`, `/plotly` stay unannounced until a named external co-maintainer exists. |
| 3 | Conformance kit | **Modify** — internal CI, pinned to exact framework versions, re-run on every upstream bump. No public badge until a second non-author implementer wants one; badges version-stamped and auto-expiring into `certification-lapsed`. |
| 4 | Capability declarations | **Survives intact** — extend buckets with `canPanZoom`/`canRearrange` + `certification-lapsed`. |
| 5 | Vega-Lite agent authoring | **Modify (gate it)** — schema-valid → capability-checked → LORD++ hypothesis → render; bridge synthesizes the missing selection-completion signal. |
| 6 | Host-owned scale machinery | **Survives**, plus the transform-ownership rule (host owns bin/aggregate/decimate; renderer-side transforms are rejected or gap-ledgered). |
| 7 | First-party charts as reference implementation | **Survives intact** — strengthen further with the budget freed by cutting bridges 2–3. |

## The revised adoption thesis

"Meet teams at their chart library" was run, at scale, by the closest precedent available (FINOS Perspective) and
reversed. The more plausible adoption blocker is the provenance model's own learning curve — VisTrails, the
canonical provenance-for-visual-analysis system, saw maintenance stop in 2016 despite roughly a decade of polish,
and no lens on the panel found bridges addressing that blocker at all.

**Revised thesis:** meet *agents* at Vega-Lite (they already speak it, and Databricks already proves the demand
exists for governed agent-VL — the differentiator is provenance-gating it). Meet *analysts* with a 10-minute
provenance on-ramp (progressive disclosure: commits → branches → the FDR ledger), not with chart-library
familiarity. The bridge is an internal architecture win that keeps first-party code honest about its own
contract; it is not the growth engine.

## Go/no-go experiment (gate before bridge #2, ever)

The T1/T3 dispute in the panel — cap-at-three (historian) vs. exactly-one (skeptic/economist) — resolves to one
measurable question rather than a standing argument:

> **Can one team keep a single pinned bridge conformant across two consecutive upstream majors of its framework
> for under X hours/quarter?**

Run that experiment on the Vega-Lite bridge across its next major version before green-lighting a second bridge
of any kind. This converts a values disagreement (how much breadth is worth the maintenance tax) into a measured
maintenance number specific to this team, this bridge, this framework — the actual decision-relevant quantity,
which no amount of precedent-matching substitutes for.

## Key citations

- FINOS Perspective bridge removal: `finos/perspective` CHANGELOG.md, PR #1174 (Highcharts + Hypergrid deleted,
  consolidated on first-party d3fc).
- Vega-Lite selection-completion gap: `vega/vega-lite#5341` (open); VL v5 `selections`→`parameters` breaking
  change, VL 5.0.0 release notes.
- LLM Vega-Lite reliability: DracoGPT, arXiv:2408.06845 (GPT-3.5-Turbo 19.1% valid-VL rate); "Evaluating LLMs for
  Visualization Generation and Understanding," arXiv:2507.22890 (2025 eval, GPT-4o 70% / Gemini 24% completion).
- Databricks governed agent-VL: "Bringing Visualizations to Life in Multi-Agent Systems With Vega-Lite,"
  databricks.com/blog.
- Mosaic clause-addressable selections: Heer & Moritz, "Mosaic: An Architecture for Scalable & Interoperable
  Data Views," IEEE TVCG 2024; "Mosaic Selections," arXiv:2507.19690.
- Interaction-taxonomy gap (Explore/Reconfigure unaddressed): Yi, Kang, Stasko & Jacko, "Toward a Deeper
  Understanding of the Role of Interaction in Information Visualization," IEEE TVCG 13(6), 2007.
- Trrack (closest peer-reviewed provenance precedent, ~20k downloads, 60+ citations, research/demo-context
  adoption): Cutler, Gadhave & Lex, IEEE VIS 2020 short paper; `github.com/visdesignlab/trrack`.
- LSP/TCK precedents for enduring protocols: `microsoft/language-server-protocol` "Protocol History"; Java
  Community Process TCK Reference Guide; JSR 315 Servlet 3.0 Specification.
- VisTrails maintenance death despite a decade of polish: "Sustaining CyberWater-VisTrails," Information
  16(11):988, MDPI; AOSA Vol. 1 VisTrails chapter.
- LangChain community-package retreat: LangChain blog, "Towards LangChain 0.1: LangChain-Core and
  LangChain-Community"; `langchain-ai/langchain-community#674`.
- Superset third-party plugin non-maintenance + concentrated contributor base: Apache Superset wiki,
  "Third-Party Plugins Directory"; LFX Insights Apache Superset contributor analysis.
- CNCF conformance formalizing an existing market: PR Newswire, "CNCF Launches Certified Kubernetes Program with
  32 Conformant Distributions"; CNCF "Certified Kubernetes Software Conformance."
- Own-history counter-evidence (curated breadth vs. general bridging): WeaveJS wraps exactly 3 frameworks
  (`WeaveTeam/WeaveJS`); the repo owner's 2016 "Adapter" project (framework-agnostic bring-any-chart bridge,
  abandoned) — full study in `docs/research/weave-study.md` §6.

## Relationship to the Weave study

`docs/research/weave-study.md` is the source of the historian's own-history evidence (§6, Adapter) and several of
the design primitives referenced above (Mosaic-style clause selections were cross-checked against Weave's older
`KeyFilter`/`KeySet` composition pattern in weave-study.md §2, which independently arrives at boolean-algebra
subset filters over materialized key lists for the same scaling reason). The two documents are complementary: this
one is the adoption/protocol design; the study is the scale-engineering research base for what the protocol's
future bridges will eventually need to be fast.
