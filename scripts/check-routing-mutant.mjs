// Each control removes one boundary, runs its existing assertion once, restores.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = join(process.env.RUNNER_TEMP, 'viz-routing-mutation');
mkdirSync(out, { recursive: true });
const vitest = join(process.cwd(), 'node_modules/vitest/vitest.mjs');
const controls = [
  { name: 'numeric-validation', file: 'src/links/route/scores.ts', from: "typeof score !== 'number' || ", to: '',
    args: [vitest, 'run', 'src/links/route.boundary.test.ts', '-t', 'refuses non-number scores before any decision is called'],
    assertion: 'refuses non-number scores before any decision is called' },
  { name: 'policy-custody', file: 'src/links/route.ts', from: '{ ...captured.policy }', to: 'captured.policy',
    args: [vitest, 'run', 'src/links/route/decision.test.ts', '-t', 'contains decision exceptions and input mutation without altering owned evidence'],
    assertion: 'contains decision exceptions and input mutation without altering owned evidence' },
  { name: 'async-decision-observation', file: 'src/links/route/decision.ts', from: "typeof then !== 'function'", to: 'true',
    args: [vitest, 'run', 'src/links/route/delivery.test.ts', '-t', 'contains rejected decisions without an unhandled rejection in a strict process'],
    assertion: 'contains rejected decisions without an unhandled rejection in a strict process' },
  { name: 'optional-runtime-boundary', file: 'scripts/routing-package/check.mjs', from: "'optionalDependencies', ", to: '',
    args: ['--test', 'scripts/routing-package/check.node-test.mjs'], assertion: 'the packed manifest refuses the host in optionalDependencies' },
  { name: 'packed-host-boundary', file: 'scripts/routing-package/check.mjs', from: 'assert(!/agentfootprint/i.test(text),', to: 'assert(true,',
    args: ['--test', 'scripts/routing-package/check.node-test.mjs'], assertion: 'host reference' },
];
const results = [];
for (const control of controls) {
  const original = readFileSync(control.file);
  const text = original.toString('utf8');
  assert.equal(text.split(control.from).length, 2, `${control.name}: expected one mutation site`);
  try {
    writeFileSync(control.file, text.replace(control.from, control.to));
    const result = spawnSync(process.execPath, control.args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const log = (result.stdout ?? '') + (result.stderr ?? '');
    writeFileSync(join(out, control.name + '.log'), log);
    if (result.error) throw result.error;
    const plain = log.replace(/\x1b\[[0-9;]*m/g, '');
    assert.equal(result.signal, null, `${control.name}: process did not finish normally`);
    assert.equal(result.status, 1, `${control.name}: mutation was not killed`);
    assert(plain.includes(control.assertion), `${control.name}: expected assertion did not run`);
    assert(/AssertionError|ERR_ASSERTION/.test(plain), `${control.name}: failure was not an assertion`);
    assert(!/SyntaxError|Cannot find module|Failed to load/.test(plain), `${control.name}: unrelated loader failure`);
    results.push({ name: control.name, source: control.file, status: 'killed', exit: result.status,
      originalSha256: createHash('sha256').update(original).digest('hex'), log: control.name + '.log' });
  } finally {
    writeFileSync(control.file, original);
    assert(readFileSync(control.file).equals(original), `${control.name}: original source was not restored`);
  }
}
const result = { kind: 'routing-boundary-negative-controls/1', head: process.env.SOURCE_HEAD, results, restored: true };
writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
