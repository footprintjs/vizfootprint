/**
 * X4 CLI — `node bench/x4/run.mjs [reps]`
 * Prints the main-thread-budget table (see runner.mjs for the bench itself).
 */
import { runX4 } from './runner.mjs';

const reps = Number(process.argv[2] ?? 3);
const config = { reps, rows: 100_000, frames: 180, seed: 42 };

console.log(
  `X4 (R15) main-thread budget — 3s/60Hz brush, ${config.frames} transient updates,` +
    ` ${config.rows.toLocaleString()} rows predicate work per update, seed=${config.seed}, reps=${reps} interleaved\n`,
);

const { runs, summary } = await runX4(config);

console.log(
  `detector positive control: ${summary.detectorControl.longTasks} long task(s), max ${summary.detectorControl.maxDurationMs.toFixed(0)}ms` +
    ` (80ms deliberate block ${summary.detectorControl.longTasks >= 1 ? 'DETECTED — instrument live' : 'NOT DETECTED — instrument dead, numbers below are void'})\n`,
);

for (const r of runs) {
  console.log(
    `run rep=${r.rep} mode=${r.mode.padEnd(5)} frames=${r.frames} longTasks=${r.longTaskCount}` +
      ` tbtMs=${r.tbtMs.toFixed(2)} commits=${r.commits} clauses=${r.selectionClauseCount}` +
      ` checksum=${r.checksum} wallMs=${r.gestureWallMs.toFixed(0)}` +
      ` frameWork(p50/p95/max)=${r.frameWorkMs.p50.toFixed(2)}/${r.frameWorkMs.p95.toFixed(2)}/${r.frameWorkMs.max.toFixed(2)}ms` +
      (r.mode === 'log' ? ` commitMs=${r.commitMs.toFixed(3)}` : '') +
      (r.stalled ? ' [STALLED]' : ''),
  );
}

console.log('\n' + summary.table + '\n');

const longTaskDelta = Math.abs(summary.log.longTasksMean - summary.nolog.longTasksMean);
const tbtDelta = Math.abs(summary.log.tbtMsMean - summary.nolog.tbtMsMean);
const oneCommitEverywhere = runs
  .filter((r) => r.mode === 'log')
  .every((r) => r.commits === 1);

console.log(`R13 exactly-one-commit per gesture: ${oneCommitEverywhere ? 'PASS' : 'FAIL'}`);
console.log(
  `long-task delta (a−b): ${(summary.log.longTasksMean - summary.nolog.longTasksMean).toFixed(2)}` +
    ` | TBT delta: ${(summary.log.tbtMsMean - summary.nolog.tbtMsMean).toFixed(2)}ms` +
    ` | acceptance (|Δlt|<=1, |Δtbt|<=16ms): ${longTaskDelta <= 1 && tbtDelta <= 16 ? 'PASS' : 'FAIL'}`,
);

if (!oneCommitEverywhere || longTaskDelta > 1 || tbtDelta > 16) process.exitCode = 1;
