import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, chmodSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixture, put } from './published-fixture.mjs';
import { checkpointPublished, verifyPublishedCheckpoint } from './published-guard.mjs';

const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'footprintjs/vizfootprint' };
function guarded() {
  const root = fixture(), outside = realpathSync(mkdtempSync(join(tmpdir(), 'viz-checkpoint-fixture-')));
  put(root, 'node_modules/typescript/package.json', { name: 'typescript', version: '5.9.3', main: 'index.js', bin: { tsc: 'bin/tsc' } });
  put(root, 'node_modules/typescript/index.js', 'throw Error("inert compiler")');
  put(root, 'node_modules/typescript/bin/tsc', 'throw Error("inert compiler must never execute")');
  mkdirSync(join(root, 'node_modules/.bin')); symlinkSync('../typescript/bin/tsc', join(root, 'node_modules/.bin/tsc'));
  for (const path of ['package-lock.json', 'node_modules/.package-lock.json']) {
    const lock = JSON.parse(readFileSync(join(root, path)));
    lock.packages['node_modules/typescript'] = { version: '5.9.3' }; put(root, path, lock);
  }
  put(root, '.gitignore', 'node_modules/\n');
  put(root, 'src/runtime.ts', 'export const inertFixture = true;');
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
  git('init'); git('add', '.');
  git('-c', 'user.name=Inert fixture', '-c', 'user.email=fixture@invalid', 'commit', '-m', 'inert metadata');
  const args = { root, out: join(outside, 'checkpoint'), env };
  return { ...args, clean: () => { rmSync(root, { recursive: true }); rmSync(outside, { recursive: true }); } };
}

test('normal checkpoint preserves Git sources, compiler and installed bytes without executing packages', () => {
  const args = guarded();
  try {
    const before = checkpointPublished(args);
    assert.equal(verifyPublishedCheckpoint({ ...args, expectedCheckpoint: before.checkpointSha256 }).status, 'PUBLISHED_INPUTS_UNCHANGED');
    assert.throws(() => checkpointPublished(args));
  } finally { args.clean(); }
});

test('changed runtime/compiler bytes and authored bytes or modes refuse after checkpoint', () => {
  for (const [path, change] of [
    ['node_modules/footprintjs/index.js', file => writeFileSync(file, 'changed runtime')],
    ['node_modules/typescript/bin/tsc', file => writeFileSync(file, 'changed compiler')],
    ['package.json', file => writeFileSync(file, '{}')],
    ['package.json', file => chmodSync(file, 0o600)],
  ]) {
    const args = guarded();
    try {
      const before = checkpointPublished(args); change(join(args.root, path));
      assert.throws(() => verifyPublishedCheckpoint({ ...args, expectedCheckpoint: before.checkpointSha256 }));
    } finally { args.clean(); }
  }
});

test('a rewritten nearby checkpoint never substitutes for the prior step digest', () => {
  const args = guarded();
  try {
    const before = checkpointPublished(args);
    const path = join(args.out, 'checkpoint.json');
    writeFileSync(path, readFileSync(path, 'utf8') + '\n'); // Same JSON value; changed authenticated bytes.
    assert.throws(() => verifyPublishedCheckpoint({ ...args, expectedCheckpoint: before.checkpointSha256 }));
  } finally { args.clean(); }
});

test('foreign or token-bearing checkpoint invocations refuse before output creation', () => {
  const args = guarded();
  try {
    for (const bad of [{ ...env, GITHUB_REPOSITORY: 'other/repo' }, { ...env, GH_TOKEN: 'inert' }]) {
      assert.throws(() => checkpointPublished({ ...args, env: bad }));
    }
    assert.throws(() => readFileSync(join(args.out, 'checkpoint.json')));
  } finally { args.clean(); }
});

test('tracked runtime edits and staged edits cannot be presented as the original source head', () => {
  for (const staged of [false, true]) {
    const args = guarded();
    try {
      const before = checkpointPublished(args);
      put(args.root, 'src/runtime.ts', 'export const changed = true;');
      if (staged) execFileSync('git', ['-C', args.root, 'add', 'src/runtime.ts']);
      assert.throws(() => verifyPublishedCheckpoint({ ...args, expectedCheckpoint: before.checkpointSha256 }));
    } finally { args.clean(); }
  }
});
