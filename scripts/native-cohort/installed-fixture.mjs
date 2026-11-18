// Real temporary files and inert entry text. No npm, compiler or package execution.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { archive } from './byte-fixture.mjs';
import { hash } from './admission.mjs';
import { manifestPaths, workspacePaths } from './manifests.mjs';

export function installedFixture(root) {
  const put = (path, bytes) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), bytes); };
  const json = data => Buffer.from(JSON.stringify(data));
  const originals = Object.fromEntries(manifestPaths.map(path => [path, json({ name: 'viz-fixture', private: true, type: 'module',
    ...(path === 'package.json' ? { workspaces: workspacePaths } : {}) })]));
  for (const [path, bytes] of Object.entries(originals)) put(path, bytes);
  const packages = {}, images = {};
  const rows = [['footprintjs', 'footprintjs', '14.0.0-rc.0'], ['foottrace', 'foottrace', '2.1.0'],
    ['agentfootprint', 'agentfootprint', '15.0.0-rc.0'], ['storydeck', 'footprint-storydeck', '0.13.3'],
    ['contextfootprint', 'contextfootprint', '0.1.0'],
    ['agentfootprint/node_modules/contextfootprint', 'contextfootprint', '0.1.1'], ['typescript', 'typescript', '5.9.3']];
  for (const [path, name, version] of rows) {
    const manifest = { name, version, main: 'index.js', ...(name === 'typescript' ? { bin: { tsc: 'bin/tsc' } } : {}) };
    const files = { 'package/package.json': json(manifest), 'package/index.js': Buffer.from('throw new Error("must not execute")') };
    if (name === 'typescript') files['package/bin/tsc'] = Buffer.from('throw new Error("must not compile")');
    for (const [member, bytes] of Object.entries(files)) put('node_modules/' + path + '/' + member.slice(8), bytes);
    images[path] = files;
    packages['node_modules/' + path] = { version, resolved: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`, integrity: 'sha512-synthetic-unit-fixture' };
  }
  const vendorBytes = archive(Object.entries(images.contextfootprint));
  put('vendor/contextfootprint/original.tgz', vendorBytes);
  packages['node_modules/contextfootprint'] = { version: '0.1.0', resolved: 'file:vendor/contextfootprint/original.tgz',
    integrity: 'sha512-' + createHash('sha512').update(vendorBytes).digest('base64') };
  const archives = { agentfootprint: join(root, 'af-original.tgz'), storydeck: join(root, 'storydeck-original.tgz') };
  const admitted = {};
  for (const role of Object.keys(archives)) {
    const files = images[role];
    admitted[role] = { integrity: 'sha512-' + role + '-synthetic-unit-fixture',
      files: Object.entries(files).map(([path, bytes]) => ({ path, size: bytes.length, sha256: hash(bytes) })) };
    packages['node_modules/' + role].resolved = 'file:' + archives[role];
    packages['node_modules/' + role].integrity = admitted[role].integrity;
  }
  const nativeLock = json({ lockfileVersion: 3, packages });
  originals['package-lock.json'] = json({ lockfileVersion: 3, packages: structuredClone(packages) });
  put('package-lock.json', originals['package-lock.json']);
  put('node_modules/.package-lock.json', nativeLock);
  return { root, originals, nativeLock, admitted, archives };
}
