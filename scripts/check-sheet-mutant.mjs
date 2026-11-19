// One hosted negative control for the capped-Sheet browser property. Never ship
// the mutation: restore the exact source bytes/mode before any pack is created.
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.GITHUB_REPOSITORY, 'footprintjs/vizfootprint');
assert(process.env.RUNNER_TEMP, 'hosted proof directory required');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const relative = 'ui/src/sheet/Sheet.tsx', source = join(root, relative);
const original = readFileSync(source), mode = statSync(source).mode & 0o777;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const before = hash(original), anchor = 'const shown = Math.min(rows.length, room);';
const text = original.toString('utf8');
assert.equal(text.split(anchor).length, 2, 'one whole-row rendering endpoint required');
const mutant = text.replace(anchor, 'const shown = Math.min(rows.length, room) - 1;');
const out = join(process.env.RUNNER_TEMP, 'viz-sheet-mutation');
mkdirSync(out);
const logPath = join(out, 'mutant.log'), fd = openSync(logPath, 'wx');
const command = [join(root, 'node_modules/vitest/vitest.mjs'), 'run',
  'ui/gallery/sheet.smoke.test.ts', '-t',
  'caps the canvas and still reaches the LAST row at the bottom of the scroll'];
const result = { kind: 'capped-sheet-last-row-negative-control/1',
  source: relative, originalSha256: before, mutation: 'omit the final shown row',
  command: [process.execPath, ...command], status: 'unknown' };
let problem;
try {
  writeFileSync(source, mutant);
  const run = spawnSync(process.execPath, command, { cwd: root, stdio: ['ignore', fd, fd] });
  result.exitCode = run.status; result.signal = run.signal;
  const raw = readFileSync(logPath), log = raw.toString('utf8').replace(/\x1b\[[0-9;]*m/g, '');
  result.logSha256 = hash(raw);
  // Only the actual absent last-row assertion kills this mutant. An installation,
  // transport, compilation or unrelated assertion error cannot count as proof.
  assert(!run.error && run.signal === null && run.status !== null && run.status !== 0);
  assert(log.includes('FAIL') && log.includes('ui/gallery/sheet.smoke.test.ts')
    && log.includes(command.at(-1)), 'the selected product case must fail');
  assert(log.includes('AssertionError: the last row must be rendered at the completed bottom window')
    && /expected \+?0 to be 1/.test(log),
  'the actual last row must be missing, not an unrelated command failure');
  result.status = 'killed';
} catch (error) {
  problem = error;
  result.error = String(error);
} finally {
  try { closeSync(fd); }
  catch (error) { result.logCloseError = String(error); problem ??= error; }
  try {
    writeFileSync(source, original); chmodSync(source, mode);
    assert.equal(hash(readFileSync(source)), before, 'original source restoration failed');
    assert.equal(statSync(source).mode & 0o777, mode, 'original mode restoration failed');
    execFileSync('git', ['diff', '--exit-code', '--', relative], { cwd: root });
    result.restored = true;
  } catch (error) {
    result.restored = false; result.restorationError = String(error);
    problem ??= error;
  }
  writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
}
if (problem) throw problem;
console.log(JSON.stringify(result));
