// Inert normal-install specimens; entry text must never execute.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { manifestPaths, workspacePaths } from './manifests.mjs';

export function put(root, path, value) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value));
}
export function fixture() {
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
