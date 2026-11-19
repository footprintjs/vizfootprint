// Physical-owner observations only. No imports of package runtime code.
import assert from 'node:assert/strict';
import { lstatSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { hash, regular } from './files.mjs';
import { manifestPaths, requireWorkspaceDeclarations } from './manifests.mjs';

const family = new Set(['agentfootprint', 'footprintjs', 'foottrace', 'footprint-storydeck', 'contextfootprint']);
const childPath = (root, path) => path === root || path.startsWith(root + '/');

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
