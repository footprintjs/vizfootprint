// Installed-byte and physical-owner observations. No imports of package runtime code.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { lstatSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { hash } from './admission.mjs';
import { regular } from './transport.mjs';
import { manifestPaths, requireWorkspaceDeclarations } from './manifests.mjs';

const family = new Set(['agentfootprint', 'footprintjs', 'foottrace', 'footprint-storydeck', 'contextfootprint']);
const childPath = (root, path) => path === root || path.startsWith(root + '/');

export function inventory(root, { dependencies = false } = {}) {
  const files = [], dependencyRoots = [];
  let visits = 0, bytes = 0;
  function walk(path, depth) {
    assert(depth <= 64);
    for (const name of readdirSync(path).sort()) {
      assert(++visits <= 200000);
      const file = join(path, name), stat = lstatSync(file), rel = relative(root, file).split('\\').join('/');
      assert(!stat.isSymbolicLink(), 'linked package member');
      if (stat.isDirectory()) {
        if (dependencies && rel === 'node_modules') dependencyRoots.push(file);
        else walk(file, depth + 1);
      } else {
        const data = regular(file); bytes += data.length;
        assert(bytes <= 128 * 1024 * 1024);
        files.push({ path: 'package/' + rel, size: data.length, sha256: hash(data) });
      }
    }
  }
  walk(root, 0);
  return { files: files.sort((a, b) => a.path.localeCompare(b.path)), dependencyRoots };
}

export function requireMembers(root, admitted) {
  const actual = inventory(root, { dependencies: true });
  assert.deepEqual(actual.files, [...admitted.files].sort((a, b) => a.path.localeCompare(b.path)),
    'installed source package differs from original archive');
  return { members: actual.files.length, censusSha256: hash(JSON.stringify(actual.files)),
    dependencyRoots: actual.dependencyRoots }; // Separately scanned install namespaces, never shipped members.
}

export function owner(entry, name, parse) {
  let path = dirname(realpathSync(entry));
  for (;;) {
    try {
      const manifest = parse(regular(join(path, 'package.json'), 1024 * 1024));
      if (manifest.name === name) return path;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = dirname(path); assert.notEqual(parent, path, 'package owner missing'); path = parent;
  }
}

export function physicalCensus(root, parse) {
  root = realpathSync(root);
  requireWorkspaceDeclarations(parse(regular(join(root, 'package.json'), 1024 * 1024)));
  const workspaceRoots = manifestPaths.map(path => dirname(join(root, path)));
  for (const workspace of workspaceRoots) assert.equal(realpathSync(workspace), workspace, 'aliased workspace root');
  const dependencyRoots = workspaceRoots.map(path => join(path, 'node_modules'));
  const allowedWorkspace = new Set(workspaceRoots), packages = [], links = [], hiddenLocks = [];
  const seenDirectories = new Set();
  let visits = 0;
  function walk(path, depth) {
    assert(depth <= 80);
    const canonical = realpathSync(path);
    assert.equal(canonical, resolve(path), 'aliased dependency directory');
    if (seenDirectories.has(canonical)) return;
    seenDirectories.add(canonical);
    for (const name of readdirSync(path).sort()) {
      assert(++visits <= 250000, 'installed census bound exceeded');
      const file = join(path, name), stat = lstatSync(file);
      if (stat.isSymbolicLink()) {
        const target = realpathSync(file), targetStat = lstatSync(target);
        if (targetStat.isDirectory()) assert(allowedWorkspace.has(target), 'unexpected linked package or directory');
        else {
          assert(targetStat.isFile() && dependencyRoots.some(path => childPath(path, target)), 'unexpected file link');
          assert.equal(dirname(file).split('/').at(-1), '.bin', 'linked non-bin package file');
          const packageRoot = ownerManifest(target);
          const manifest = parse(regular(join(packageRoot, 'package.json')));
          const bins = typeof manifest.bin === 'string' ? { [manifest.name.split('/').at(-1)]: manifest.bin } : manifest.bin;
          assert(bins && Object.hasOwn(bins, name) && resolve(packageRoot, bins[name]) === target, 'undeclared bin link');
        }
        links.push({ path: relative(root, file), request: readlinkSync(file), target });
      } else if (stat.isDirectory()) walk(file, depth + 1);
      else if (name === '.package-lock.json') {
        assert.equal(dirname(file).split('/').at(-1), 'node_modules', 'unexpected hidden lock location');
        const bytes = regular(file, 8 * 1024 * 1024), data = parse(bytes);
        hiddenLocks.push({ path: relative(root, file), sha256: hash(bytes), packages: data.packages,
          base: relative(root, dirname(dirname(file))) });
      } else if (name === 'package.json') {
        const manifest = parse(regular(file, 1024 * 1024));
        if (family.has(manifest.name)) packages.push({ name: manifest.name, version: manifest.version, root: dirname(file), manifestSha256: hash(regular(file)) });
      }
    }
  }
  for (const path of dependencyRoots) {
    let stat;
    try { stat = lstatSync(path); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    assert(stat.isDirectory() && !stat.isSymbolicLink(), 'linked or non-directory dependency namespace');
    walk(path, 0); // Hidden aliases and locks in EVERY declared dependency namespace, once.
  }
  return { packages, links, workspaceRoots, hiddenLocks,
    dependencyNamespaces: dependencyRoots.map(path => relative(root, path)) };
}

function ownerManifest(file) {
  let path = dirname(file);
  for (;;) {
    try { regular(join(path, 'package.json')); return path; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = dirname(path); assert.notEqual(parent, path); path = parent;
  }
}

export function requireFamilyCensus(census) {
  const byName = name => census.packages.filter(p => p.name === name);
  for (const [name, version] of Object.entries({ footprintjs: '14.0.0-rc.0', foottrace: '2.1.0',
    agentfootprint: '15.0.0-rc.0', 'footprint-storydeck': '0.13.3' })) {
    assert.equal(byName(name).length, 1, `one physical ${name} required`);
    assert.equal(byName(name)[0].version, version);
  }
  assert.deepEqual(byName('contextfootprint').map(p => p.version).sort(), ['0.1.0', '0.1.1']);
  return byName;
}

export function inspectInstalled({ root, originals, nativeLock, admitted, archives, port }) {
  root = realpathSync(root);
  const parse = bytes => port.parseStrictJson(bytes, { maxBytes: 8 * 1024 * 1024 });
  const lock = parse(nativeLock), baseline = parse(originals['package-lock.json']);
  assert.deepEqual(lock.packages['node_modules/contextfootprint'], baseline.packages['node_modules/contextfootprint'], 'vendored context input changed');
  const compilerLock = baseline.packages['node_modules/typescript'];
  assert.deepEqual(lock.packages['node_modules/typescript'], compilerLock, 'compiler lock changed');
  const hiddenBytes = regular(join(root, 'node_modules/.package-lock.json'), 8 * 1024 * 1024), hidden = parse(hiddenBytes);
  for (const [path, record] of Object.entries(hidden.packages)) {
    assert(lock.packages[path], 'hidden lock has an unrecorded package');
    for (const key of ['version', 'resolved', 'integrity', 'link']) assert.deepEqual(record[key], lock.packages[path][key]);
  }
  const census = physicalCensus(root, parse), byName = requireFamilyCensus(census);
  const selected = { footprintjs: '14.0.0-rc.0', foottrace: '2.1.0', agentfootprint: '15.0.0-rc.0', 'footprint-storydeck': '0.13.3' };
  for (const [name, version] of Object.entries(selected)) {
    const key = relative(root, byName(name)[0].root).split('\\').join('/'), record = lock.packages[key];
    assert(record && record.version === version && hidden.packages[key], 'selected package missing from normal/hidden lock');
    if (name === 'agentfootprint' || name === 'footprint-storydeck') {
      const role = name === 'agentfootprint' ? name : 'storydeck';
      assert.equal(record.integrity, admitted[role].integrity);
      assert(record.resolved.startsWith('file:') && resolve(root, record.resolved.slice(5)) === archives[role]);
    } else assert(record.resolved === `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`);
  }
  const vendor = regular(resolve(root, baseline.packages['node_modules/contextfootprint'].resolved.slice(5)));
  assert.equal('sha512-' + createHash('sha512').update(vendor).digest('base64'), baseline.packages['node_modules/contextfootprint'].integrity);
  const vendorMembers = port.readArchiveMembers(vendor).map(row => ({ path: row.path, size: row.size, sha256: hash(row.data) }));
  const vendorImage = requireMembers(byName('contextfootprint').find(p => p.version === '0.1.0').root, { files: vendorMembers });
  for (const hidden of census.hiddenLocks) for (const [path, record] of Object.entries(hidden.packages)) {
    const expected = lock.packages[hidden.base ? hidden.base + '/' + path : path];
    assert(expected, 'unrecorded nested hidden-lock input');
    for (const key of ['version', 'resolved', 'integrity', 'link']) assert.deepEqual(record[key], expected[key]);
  }
  const owners = [...census.workspaceRoots, ...census.packages.map(p => p.root)];
  const engine = byName('footprintjs')[0].root, trace = byName('foottrace')[0].root;
  for (const path of owners) {
    const here = createRequire(join(path, 'package.json'));
    assert.equal(owner(here.resolve('footprintjs'), 'footprintjs', parse), engine, 'owner engine differs');
    assert.equal(owner(here.resolve('foottrace'), 'foottrace', parse), trace, 'owner Foottrace differs');
  }
  const sourceMembers = {
    agentfootprint: requireMembers(byName('agentfootprint')[0].root, admitted.agentfootprint),
    storydeck: requireMembers(byName('footprint-storydeck')[0].root, admitted.storydeck),
  };
  const compilerRoot = owner(createRequire(join(root, 'package.json')).resolve('typescript'), 'typescript', parse);
  const compilerManifest = port.parseManifest(regular(join(compilerRoot, 'package.json')));
  assert.equal(compilerManifest.version, compilerLock.version);
  const compilerEntry = resolve(compilerRoot, compilerManifest.bin.tsc);
  assert(childPath(compilerRoot, compilerEntry));
  return { packages: census.packages, links: census.links, ownerRoots: owners, sourceMembers, vendorImage,
    dependencyNamespaces: census.dependencyNamespaces,
    familyImages: census.packages.map(p => ({ root: p.root, name: p.name,
      censusSha256: hash(JSON.stringify(inventory(p.root, { dependencies: true }).files)) })),
    hiddenLocks: census.hiddenLocks.map(({ path, sha256 }) => ({ path, sha256 })),
    nativeLockSha256: hash(nativeLock), hiddenLockSha256: hash(hiddenBytes),
    compiler: { root: compilerRoot, version: compilerManifest.version,
      manifestSha256: hash(regular(join(compilerRoot, 'package.json'))), entry: compilerEntry,
      entrySha256: hash(regular(compilerEntry)), filesSha256: hash(JSON.stringify(inventory(compilerRoot).files)) } };
}
