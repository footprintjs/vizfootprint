import assert from 'node:assert/strict';
import test from 'node:test';
import { manifestPaths, workspacePaths, projectManifests } from './manifests.mjs';

const archives = { agentfootprint: '/tmp/inputs/agentfootprint-15.0.0-rc.0.tgz',
  storydeck: '/tmp/inputs/footprint-storydeck-0.13.3.tgz' };
function specimen() {
  return Object.fromEntries(manifestPaths.map(path => [path, Buffer.from(JSON.stringify({
    private: true, name: path, dependencies: { footprintjs: '^14.0.0-rc.0', foottrace: '^2.1.0' },
    devDependencies: { agentfootprint: '15.0.0-rc.0', storydeck: 'npm:footprint-storydeck@^0.13.1' },
    scripts: { prepare: 'the-original-prepare' }, unknownField: ['preserve', { nested: true }],
    ...(path === 'package.json' ? { workspaces: workspacePaths } : {}),
  }) + '\n')]));
}
test('native setup fixes the exact registry cohort and two source archives, preserving originals', () => {
  const original = specimen();
  const before = structuredClone(original);
  const setup = projectManifests(original, archives);
  for (const path of manifestPaths) {
    assert.deepEqual(original[path], Buffer.from(before[path]));
    const expected = JSON.parse(original[path]);
    if (path === 'package.json') {
      expected.dependencies.footprintjs = '14.0.0-rc.0';
      expected.dependencies.foottrace = '2.1.0';
      expected.devDependencies.agentfootprint = 'file:' + archives.agentfootprint;
    }
    if (path === 'studio/package.json') expected.devDependencies.storydeck = 'file:' + archives.storydeck;
    assert.deepEqual(JSON.parse(setup[path]), expected);
    if (path !== 'package.json' && path !== 'studio/package.json') assert.deepEqual(setup[path], original[path]);
  }
});
test('stale authored graph, changed alias, public workspace and unknown setup selectors refuse', () => {
  const mutations = [
    ['package.json', value => { value.dependencies.footprintjs = '^13.0.0'; }],
    ['package.json', value => { value.dependencies.foottrace = '^2.0.0'; }],
    ['package.json', value => { value.dependencies.footprintjs = '^12.0.0'; }],
    ['package.json', value => { value.dependencies.foottrace = '^1.0.0'; }],
    ['package.json', value => { value.devDependencies.agentfootprint = '14.4.0'; }],
    ['studio/package.json', value => { value.devDependencies.storydeck = 'footprint-storydeck'; }],
    ['ui/package.json', value => { value.private = false; }],
    ['package.json', value => { value.workspaces = [...workspacePaths, 'unadmitted']; }],
  ];
  for (const [path, mutate] of mutations) {
    const original = specimen(), value = JSON.parse(original[path]);
    mutate(value); original[path] = Buffer.from(JSON.stringify(value));
    assert.throws(() => projectManifests(original, archives));
  }
  assert.throws(() => projectManifests(specimen(), { ...archives, arbitrary: '/tmp/other.tgz' }));
  assert.throws(() => projectManifests(specimen(), { ...archives, storydeck: '../other.tgz' }));
  assert.throws(() => projectManifests({ ...specimen(), 'extra/package.json': Buffer.from('{}') }, archives));
});
