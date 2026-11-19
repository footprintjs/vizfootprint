import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { manifestPaths, workspacePaths } from './manifests.mjs';
import { inspectPublished } from './published.mjs';

function put(root, path, value) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value));
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'viz-published-fixture-'));
  for (const path of manifestPaths) put(root, path, { private: true,
    ...(path === 'package.json' ? { workspaces: workspacePaths, peerDependencies: { footprintjs: '^14.0.0' },
      devDependencies: { footprintjs: '14.0.0' }, dependencies: { foottrace: '^2.1.0' } } : {}) });
  const packages = {};
  for (const [name, version] of [['footprintjs', '14.0.0'], ['foottrace', '2.1.0']]) {
    put(root, `node_modules/${name}/package.json`, { name, version, main: 'index.js' });
    put(root, `node_modules/${name}/index.js`, 'throw Error("inert fixture must never execute")');
    packages['node_modules/' + name] = { version, resolved: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`, integrity: 'sha512-inert' };
  }
  put(root, 'package-lock.json', { packages }); put(root, 'node_modules/.package-lock.json', { packages });
  return root;
}

test('current authored contract admits only the stable engine peer and reader line', () => {
  const root = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url)));
  assert.equal(root.peerDependencies.footprintjs, '^14.0.0');
  assert.equal(root.dependencies.footprintjs, undefined);
  assert.equal(root.dependencies.foottrace, '^2.1.0');
  assert.equal(root.devDependencies.footprintjs, '14.0.0');
  assert.equal(root.devDependencies.contextfootprint, '0.1.1');
});

test('normal lock and every workspace resolve one real engine and reader without executing packages', () => {
  const root = fixture();
  try {
    assert.deepEqual(inspectPublished(root).versions, { footprintjs: '14.0.0', foottrace: '2.1.0' });
    assert.equal(inspectPublished(root).workspaces, 4);
  } finally { rmSync(root, { recursive: true }); }
});

test('hidden copies in every dependency namespace and alias packages refuse', () => {
  for (const scope of ['', 'ui/', 'studio/', 'bridges/vega-lite/']) {
    const root = fixture();
    try {
      put(root, scope + 'node_modules/.hidden/alias/package.json', { name: 'foottrace', version: '1.0.0' });
      assert.throws(() => inspectPublished(root), /one physical/);
    } finally { rmSync(root, { recursive: true }); }
  }
});

test('changed selected bytes metadata, missing locks and package aliases refuse', () => {
  for (const change of [
    root => put(root, 'node_modules/footprintjs/package.json', { name: 'footprintjs', version: '13.0.0', main: 'index.js' }),
    root => put(root, 'node_modules/.package-lock.json', { packages: {} }),
    root => symlinkSync(join(root, 'node_modules/foottrace'), join(root, 'node_modules/trace-alias')),
  ]) {
    const root = fixture();
    try { change(root); assert.throws(() => inspectPublished(root)); }
    finally { rmSync(root, { recursive: true }); }
  }
});

test('the engine is a required host peer, not an optional or hidden second owner', () => {
  for (const change of [pkg => { pkg.peerDependenciesMeta = { footprintjs: { optional: true } }; },
    pkg => { pkg.dependencies.footprintjs = '^14.0.0'; }]) {
    const root = fixture();
    try {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'))); change(pkg);
      put(root, 'package.json', pkg);
      assert.throws(() => inspectPublished(root));
    } finally { rmSync(root, { recursive: true }); }
  }
});

test('coherent stale core metadata refuses, while a newer compatible reader remains supported', () => {
  for (const [name, version, accepted] of [['footprintjs', '13.0.0', false],
    ['foottrace', '1.11.1', false], ['foottrace', '2.0.0', false], ['foottrace', '2.2.0', true]]) {
    const root = fixture();
    try {
      put(root, `node_modules/${name}/package.json`, { name, version, main: 'index.js' });
      for (const path of ['package-lock.json', 'node_modules/.package-lock.json']) {
        const lock = JSON.parse(readFileSync(join(root, path)));
        Object.assign(lock.packages['node_modules/' + name], { version,
          resolved: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz` });
        put(root, path, lock);
      }
      if (accepted) assert.equal(inspectPublished(root).versions.foottrace, version);
      else assert.throws(() => inspectPublished(root), /authored|reader|development/);
    } finally { rmSync(root, { recursive: true }); }
  }
});
