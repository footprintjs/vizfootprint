// Fixed ordinary-install checkpoint; no producer or registry effects.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { lstatSync, realpathSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { hash } from './admission.mjs';
import { regular } from './transport.mjs';
import { manifestPaths } from './manifests.mjs';
import { inventory, owner, physicalCensus } from './installed.mjs';
import { inspectPublished } from './published.mjs';
import { requireWorkflow, requireOutside, requireOriginalDocuments, readCheckpoint, clean } from './setup.mjs';

const documents = [...manifestPaths, 'package-lock.json'];
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');

function admission(root, out, env) {
  requireWorkflow(env);
  assert(!Object.hasOwn(env, 'GH_TOKEN') && !Object.hasOwn(env, 'GITHUB_TOKEN'), 'published guard needs no API token');
  root = realpathSync(root);
  requireOutside(root, out);
  assert.equal(realpathSync(dirname(out)), dirname(out), 'canonical checkpoint parent required');
  return root;
}

function observe(root) {
  clean(root); // Both tracked worktree and index must still name the actual source commit.
  const parse = bytes => JSON.parse(bytes);
  const originals = Object.fromEntries(documents.map(path => [path, regular(join(root, path), 8 * 1024 * 1024)]));
  const modes = Object.fromEntries(documents.map(path => [path, lstatSync(join(root, path)).mode & 0o7777]));
  requireOriginalDocuments(root, originals, modes);
  const physical = inspectPublished(root), census = physicalCensus(root, parse);
  const lock = parse(originals['package-lock.json']);
  const compilerRoot = owner(createRequire(join(root, 'package.json')).resolve('typescript'), 'typescript', parse);
  const compilerManifest = parse(regular(join(compilerRoot, 'package.json')));
  assert.equal(compilerManifest.version, lock.packages[relative(root, compilerRoot)].version, 'compiler differs from actual lock');
  const compilerEntry = resolve(compilerRoot, compilerManifest.bin.tsc);
  assert(compilerEntry.startsWith(compilerRoot + '/'), 'compiler entry outside its owner');
  assert.equal(realpathSync(join(root, 'node_modules/.bin/tsc')), compilerEntry, 'compiler bin resolves another owner');
  return {
    consumer: { head: git(root, 'rev-parse', 'HEAD'), tree: git(root, 'rev-parse', 'HEAD^{tree}') },
    source: Object.fromEntries(documents.map(path => [path, { sha256: hash(originals[path]), mode: modes[path] }])),
    physical,
    hiddenLocks: census.hiddenLocks.map(({ path, sha256 }) => ({ path, sha256 })),
    familyImages: census.packages.map(pkg => ({ name: pkg.name, root: pkg.root,
      censusSha256: hash(JSON.stringify(inventory(pkg.root, { dependencies: true }).files)) })),
    compiler: { root: compilerRoot, version: compilerManifest.version,
      manifestSha256: hash(regular(join(compilerRoot, 'package.json'))), entry: compilerEntry,
      entrySha256: hash(regular(compilerEntry)), filesSha256: hash(JSON.stringify(inventory(compilerRoot).files)) },
  };
}

export function checkpointPublished({ root, out, env = process.env }) {
  root = admission(root, out, env);
  mkdirSync(out, { mode: 0o700 });
  const state = { protocol: 'viz-published-checkpoint/1', initial: observe(root) };
  const bytes = jsonBytes(state);
  writeFileSync(join(out, 'checkpoint.json'), bytes, { flag: 'wx', mode: 0o600 });
  return { status: 'PUBLISHED_INPUTS_RECORDED', checkpointSha256: hash(bytes) };
}

export function verifyPublishedCheckpoint({ root, out, expectedCheckpoint, env = process.env }) {
  root = admission(root, out, env);
  const state = JSON.parse(readCheckpoint(join(out, 'checkpoint.json'), expectedCheckpoint));
  assert.deepEqual(Object.keys(state).sort(), ['initial', 'protocol']);
  assert.equal(state.protocol, 'viz-published-checkpoint/1');
  assert.deepEqual(observe(root), state.initial, 'installed inputs/compiler/locks changed during source gates');
  return { status: 'PUBLISHED_INPUTS_UNCHANGED', consumer: state.initial.consumer,
    qualification: 'Git source/lock/owner/compiler/installed-byte guard; product outcomes remain separate' };
}
