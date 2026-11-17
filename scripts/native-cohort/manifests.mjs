import assert from 'node:assert/strict';
import { isAbsolute } from 'node:path';

export const manifestPaths = Object.freeze([
  'package.json', 'ui/package.json', 'studio/package.json', 'bridges/vega-lite/package.json',
]);

/** Only two setup slots change. Callers retain and restore the original bytes. */
export function projectManifests(originals, archives) {
  assert.deepEqual(Object.keys(originals).sort(), [...manifestPaths].sort());
  assert.deepEqual(Object.keys(archives).sort(), ['agentfootprint', 'storydeck']);
  for (const path of Object.values(archives)) assert.equal(typeof path, 'string');
  for (const path of Object.values(archives)) assert(isAbsolute(path) && path.endsWith('.tgz'));
  const parsed = Object.fromEntries(manifestPaths.map(path => [path, JSON.parse(originals[path])]));
  for (const value of Object.values(parsed)) assert.equal(value.private, true);
  const root = parsed['package.json'];
  assert.equal(root.dependencies.footprintjs, '^13.0.0');
  assert.equal(root.dependencies.foottrace, '^2.0.0');
  assert.equal(root.devDependencies.agentfootprint, '15.0.0-rc.0');
  const studio = parsed['studio/package.json'];
  assert.equal(studio.devDependencies.storydeck, 'npm:footprint-storydeck@^0.13.1');
  root.devDependencies.agentfootprint = 'file:' + archives.agentfootprint;
  studio.devDependencies.storydeck = 'file:' + archives.storydeck;
  return Object.fromEntries(manifestPaths.map(path => [path,
    path === 'package.json' || path === 'studio/package.json'
      ? Buffer.from(JSON.stringify(parsed[path], null, 2) + '\n') : Buffer.from(originals[path]),
  ]));
}
