/**
 * LAYOUT BENCH — THE TABLE. `layout-results.json` in, one markdown report out.
 *
 * Its own module for one reason: a renderer that only ever runs at the end of a
 * long bench is a renderer nobody exercises. This one can be handed a results
 * object and checked in a second.
 *
 * The order is the order a reader needs: the CONTROLS first, because a table
 * whose instruments were dead is not a table of small numbers, it is a table of
 * no numbers; then the phases, then what the cap costs, then whether the
 * iterations bought anything, then the graph itself, then the whole analysis.
 */

export function tableOf(json) {
  const n = (x) => (x === null || x === undefined ? '—' : x.toLocaleString('en-US'));
  // WHY MiB and not MB: the divisor is 2^20, and a header one row above hands
  // the reader the byte formula (`n × n × 2`) to check. A number labelled MB
  // that is 1024-based disagrees with its own arithmetic by 5%.
  const mb = (bytes) => (bytes === null || bytes === undefined ? '—' : `${(bytes / 1_048_576).toFixed(1)} MiB`);
  // An arm that could not be measured is a result about the cap, not a hole.
  const measured = json.sizes.filter((s) => s.measured !== false);
  const failed = json.sizes.filter((s) => s.measured === false);
  const out = [];

  out.push(`node ${json.node} · ${json.platform} · ${json.generatedAt}`);
  out.push('');
  out.push(`**Units.** time = ${json.units.time} · memory = ${json.units.memory} · stress = ${json.units.stress}`);
  out.push(`Seed ${json.seed} · stress sampled from ${json.stressSources} BFS sources · ${json.warmupDiscarded} warm-up call discarded per phase.`);
  out.push('');

  out.push('### 0 · controls — are the instruments alive?');
  out.push('');
  out.push(`| instrument | asked | read | live |`);
  out.push('|---|---:|---:|---|');
  out.push(`| clock (a deliberate block) | ${json.controls.clock.askedMs} ms | ${json.controls.clock.readMs} ms | ${json.controls.clock.live ? 'YES' : 'NO'} |`);
  out.push(
    `| stress metric — ${json.controls.metric.graph} | scrambled ≫ truth | ${json.controls.metric.scrambledMeanStress} vs ${json.controls.metric.truthMeanStress} = ${json.controls.metric.ratio}× | ${json.controls.metric.live ? 'YES' : 'NO'} |`,
  );
  out.push('');
  out.push(json.controls.live ? '> Both controls fired. The numbers below are readable.' : `> **CONTROL FAILED — every number below is void.** ${json.controls.note}`);
  out.push('');

  out.push('### 1 · the phases');
  out.push('');
  out.push('| nodes | edges | reps × iterations | adjacency | all-pairs (bench) | all-pairs (`distancesOf`) | place | place / iteration |');
  out.push('|---:|---:|---|---:|---:|---:|---:|---:|');
  for (const s of measured) {
    const real = s.allPairs.real.measured ? `${n(s.allPairs.real.medianMs)} ms` : s.allPairs.real.refused === undefined ? 'CRASHED' : 'REFUSED';
    out.push(
      `| ${n(s.nodes)} | ${n(s.graph.edgeRows)} | ${s.reps} × ${s.iterations} | ${n(s.adjacency.medianMs)} ms | ${n(s.allPairs.benchMedianMs)} ms | ${real} | ${n(s.place.medianMs)} ms | ${n(s.place.msPerIteration)} ms |`,
    );
  }
  out.push('');
  out.push(
    'Medians; p95 is in `layout-results.json`. `distancesOf` REFUSED means the size is above the implementation’s cap — the bench’s own cap-free all-pairs is what makes that row measurable at all. CRASHED is not a refusal: it is a defect.',
  );
  for (const s of measured) {
    if (!s.allPairs.real.measured) out.push(`- ${n(s.nodes)} nodes: ${s.allPairs.real.refused ?? s.allPairs.real.crashed}`);
    else if (s.allPairs.real.agreesWithBench === false) out.push(`- ${n(s.nodes)} nodes: **the two all-pairs matrices disagree** — ${s.allPairs.real.firstDisagreement}`);
  }
  for (const s of failed) out.push(`- ${n(s.nodes)} nodes: **NOT MEASURED** — ${s.failed}`);
  out.push('');

  out.push('### 2 · what the cap costs — the memory the matrix needs');
  out.push('');
  out.push('| nodes | distance matrix (`n × n × 2` bytes) | max sampled RSS | max sampled array buffers | max sampled heap | graph diameter (longest finite hop distance) | disconnected pairs (ordered cells) |');
  out.push('|---:|---:|---:|---:|---:|---:|---:|');
  for (const s of measured) {
    out.push(
      `| ${n(s.nodes)} | ${mb(s.allPairs.matrixBytes)} | ${mb(s.memory.maxSampledRss)} | ${mb(s.memory.maxSampledArrayBuffers)} | ${mb(s.memory.maxSampledHeapUsed)} | ${n(s.allPairs.maxFinite)} | ${n(s.allPairs.disconnectedPairs)} |`,
    );
  }
  out.push('');
  out.push(
    `Declared cap in \`src/analysis/layout.ts\`: **${n(json.declaredCap)} nodes**. The **distance matrix** and **max sampled RSS** columns are the evidence it has to answer to; the array-buffer column is where the matrix actually lives. Max sampled heap EXCLUDES typed-array backing stores, so the matrix does not appear in it, and every sampled column is the largest of four readings taken BETWEEN phases — not a peak over the run.`,
  );
  out.push('');

  out.push('### 3 · quality — did the iterations do anything?');
  out.push('');
  out.push('| nodes | placed mean stress | scrambled mean stress | ratio | pairs counted | pairs skipped (no finite distance or position) |');
  out.push('|---:|---:|---:|---:|---:|---:|');
  for (const s of measured) {
    out.push(
      `| ${n(s.nodes)} | ${s.stress.placedMeanStress} | ${s.stress.scrambledMeanStress} | ${s.stress.ratio === null ? '—' : `${s.stress.ratio}×`} | ${n(s.stress.counted)} | ${n(s.stress.skipped)} |`,
    );
  }
  out.push('');
  out.push('Scored by `bench/layout/measure.ts`, which shares no code with the layout. A ratio at or below 1 means the iterations bought nothing.');
  out.push('');

  out.push('### 4 · the graph the layout was handed, and what it made of it');
  out.push('');
  out.push('| nodes | edge rows | giant component | used | rows dropped (unknown endpoint or self-loop) | bench agrees |');
  out.push('|---:|---:|---:|---:|---:|---|');
  for (const s of measured) {
    out.push(
      `| ${n(s.nodes)} | ${n(s.graph.edgeRows)} | ${n(s.graph.giantCount)} | ${n(s.adjacency.used)} | ${n(s.adjacency.dropped)} | ${s.adjacency.agreesWithBench ? 'yes' : 'NO — the two adjacencies disagree'} |`,
    );
  }
  out.push('');

  out.push('### 5 · one whole analysis run');
  out.push('');
  out.push(
    json.analysis.measured
      ? `${n(json.analysis.ms)} ms at ${n(json.analysis.nodes)} nodes over ${n(json.analysis.edgeRows)} edge rows — one cold call (no warm-up): the flowchart, the commit and the column write, on top of the phases above.`
      : `NOT MEASURED at ${n(json.analysis.nodes)} nodes: ${json.analysis.refused ?? json.analysis.reason}`,
  );
  out.push('');

  return out.join('\n');
}
