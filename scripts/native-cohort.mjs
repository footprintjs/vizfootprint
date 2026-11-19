// Fixed facade only. Missing accepted tuples refuse before transport or installation.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchInputs, prepare, verify,requireWorkflow } from './native-cohort/setup.mjs';
import { appendFileSync } from 'node:fs';
import { inspectPublished } from './native-cohort/published.mjs';
import { checkpointPublished, verifyPublishedCheckpoint } from './native-cohort/published-guard.mjs';

try {
  requireWorkflow(process.env);
  const command = process.argv[2];
  if (process.argv.length !== 3 || !['fetch','prepare','verify','identity','checkpoint','verify-published'].includes(command)) throw new Error('unknown command');
  if (['prepare','checkpoint'].includes(command) && !process.env.GITHUB_OUTPUT) throw new Error('step output missing');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  if (['identity','checkpoint','verify-published'].includes(command)) {
    if (process.env.GH_TOKEN) throw new Error('identity needs no API token');
    if (command !== 'identity' && !process.env.RUNNER_TEMP) throw new Error('CI paths missing');
    const args = { root, out: resolve(process.env.RUNNER_TEMP || '.', 'viz-published-cohort'),
      expectedCheckpoint: process.env.EXPECTED_PUBLISHED_CHECKPOINT };
    const result = command === 'identity' ? inspectPublished(root)
      : command === 'checkpoint' ? checkpointPublished(args) : verifyPublishedCheckpoint(args);
    if (command === 'checkpoint') appendFileSync(process.env.GITHUB_OUTPUT, `checkpoint_sha256=${result.checkpointSha256}\n`);
    console.log(JSON.stringify(result));
  } else {
  const inputs = JSON.parse(readFileSync(new URL('./native-cohort/inputs.json', import.meta.url)));
  if (!process.env.RUNNER_TEMP || !process.env.GITHUB_WORKSPACE) throw new Error('CI paths missing');
  const args = { root, out: resolve(process.env.RUNNER_TEMP, 'viz-native-cohort'),
    inspectorRoot: resolve(process.env.GITHUB_WORKSPACE, '.ci-tools'), inputs,
    expectedCheckpoint:process.env.EXPECTED_NATIVE_CHECKPOINT };
  const result=command==='fetch'?fetchInputs(args):command==='prepare'?prepare(args):verify(args);
  if (command==='prepare') {
    appendFileSync(process.env.GITHUB_OUTPUT,`checkpoint_sha256=${result.checkpointSha256}\n`);
  }
  console.log(JSON.stringify(result));
  }
} catch(error) {
  const reason=['producer-read-403','producer-read-404','producer-read-failed'].includes(error?.message)
    ? error.message : 'native-source-inputs-not-admitted';
  console.error(JSON.stringify({status:'REFUSED',reason}));
  process.exitCode = 2;
}
