// Normal published installations share the existing physical census, without producer effects.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { realpathSync as canonical } from 'node:fs';
import { regular } from './files.mjs';
import { owner, physicalCensus } from './installed.mjs';

export function inspectPublished(root) {
  root = canonical(root);
  const parse = bytes => JSON.parse(bytes);
  const manifest = parse(regular(join(root, 'package.json')));
  const lock = parse(regular(join(root, 'package-lock.json'), 8 * 1024 * 1024));
  assert.equal(manifest.dependencies.footprintjs, undefined, 'the host owns the engine peer');
  assert.equal(typeof manifest.peerDependencies.footprintjs, 'string', 'required engine peer missing');
  assert.notEqual(manifest.peerDependenciesMeta?.footprintjs?.optional, true, 'engine peer must be required');
  const census = physicalCensus(root, parse), versions = {}, roots = {};
  for (const name of ['footprintjs', 'foottrace']) {
    const actual = census.packages.filter(pkg => pkg.name === name);
    assert.equal(actual.length, 1, `one physical ${name} required`);
    const entries = Object.entries(lock.packages).filter(([path, item]) =>
      path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`) || item.name === name);
    assert.equal(entries.length, 1, `one locked ${name} required`);
    assert.equal(entries[0][0], `node_modules/${name}`, 'core package must be hoisted');
    const selected = entries[0][1];
    assert.match(selected.version, /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/, 'published stable core required');
    assert.equal(actual[0].version, selected.version, 'installed version differs from the genuine lock');
    assert.equal(selected.resolved, `https://registry.npmjs.org/${name}/-/${name}-${selected.version}.tgz`);
    roots[name] = actual[0].root; versions[name] = selected.version;
    const key = relative(root, roots[name]).split('\\').join('/');
    assert(census.hiddenLocks.some(hidden => (!hidden.base || key.startsWith(hidden.base + '/'))
      && Object.hasOwn(hidden.packages, hidden.base ? key.slice(hidden.base.length + 1) : key)),
      'selected core missing from actual hidden lock');
  }
  // This source contract is deliberately closed: an exact development engine
  // and a positive-major stable reader caret. npm remains the general resolver.
  assert.equal(versions.footprintjs, manifest.devDependencies.footprintjs, 'authored development engine differs');
  assert.equal(manifest.peerDependencies.footprintjs, '^' + manifest.devDependencies.footprintjs,
    'authored engine peer differs from its development floor');
  const floor = /^\^([1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(manifest.dependencies.foottrace);
  assert(floor, 'authored stable reader caret required');
  const minimum = floor.slice(1).map(Number), reader = versions.foottrace.split('.').map(Number);
  assert([...minimum, ...reader].every(Number.isSafeInteger), 'bounded reader version required');
  assert(reader[0] === minimum[0] && (reader[1] > minimum[1]
    || reader[1] === minimum[1] && reader[2] >= minimum[2]), 'installed reader excludes authored range');
  for (const hidden of census.hiddenLocks) for (const [path, item] of Object.entries(hidden.packages)) {
    const expected = lock.packages[hidden.base ? hidden.base + '/' + path : path];
    assert(expected, 'hidden lock contains an unrecorded package');
    for (const key of ['version', 'resolved', 'integrity', 'link']) assert.deepEqual(item[key], expected[key]);
  }
  for (const path of [...census.workspaceRoots, ...census.packages.map(pkg => pkg.root)]) {
    const here = createRequire(join(path, 'package.json'));
    for (const name of ['footprintjs', 'foottrace']) {
      assert.equal(owner(here.resolve(name), name, parse), roots[name], 'owner resolves another physical core');
    }
  }
  return { kind: 'published-installed-cohort', versions, workspaces: census.workspaceRoots.length,
    roots, dependencyNamespaces: census.dependencyNamespaces, hiddenLocks: census.hiddenLocks.length };
}
