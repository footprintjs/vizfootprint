// Fixed normal identity facade. Observations never execute installed package code.
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectPublished } from './native-cohort/published.mjs';

function requireWorkflow(env) {
  assert.equal(env.GITHUB_ACTIONS,'true','Actions workflow required');
  assert.equal(env.GITHUB_REPOSITORY,'footprintjs/vizfootprint','intended repository required');
}

try {
  requireWorkflow(process.env);
  if (process.argv.length !== 3 || process.argv[2] !== 'identity') throw new Error('unknown command');
  if (process.env.GH_TOKEN) throw new Error('identity needs no API token');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  console.log(JSON.stringify(inspectPublished(root)));
} catch {
  console.error(JSON.stringify({ status: 'REFUSED', reason: 'published-identity-not-admitted' }));
  process.exitCode = 2;
}
