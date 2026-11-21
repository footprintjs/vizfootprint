import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { checkRoutingPackage } from './check.mjs';

async function fixture(body) {
  const root = await mkdtemp(join(tmpdir(), 'viz-routing-package-test-'));
  const put = async (path, value) => { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), value); };
  try {
    await put('package.json', JSON.stringify({ devDependencies: { agentfootprint: '^15.0.0' } }));
    await put('dist/route.js', 'export const route = 1;');
    await put('src/route.ts', 'export const route = 1;');
    await put('README.md', "import { keywordScorer } from 'agentfootprint/skill-graph';");
    await body(root, put, [{ path: 'dist/route.js' }, { path: 'src/route.ts' }, { path: 'README.md' }]);
  } finally { await rm(root, { recursive: true }); }
}

test('the packed package admits a dev-only host and its README adapter', async () => fixture(async (root, _put, files) => {
  await checkRoutingPackage(root, files);
}));
for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta']) {
  test(`the packed manifest refuses the host in ${section}`, async () => fixture(async (root, put, files) => {
    await put('package.json', JSON.stringify({ [section]: { agentfootprint: '^16.0.0' } }));
    await assert.rejects(checkRoutingPackage(root, files), /must not require/);
  }));
}
for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
  for (const spec of ['npm:agentfootprint', 'npm:agentfootprint@^16.0.0', ' npm:AgentFootprint@16 ']) {
    test(`the packed manifest refuses ${section} host alias ${spec}`, async () => fixture(async (root, put, files) => {
      await put('package.json', JSON.stringify({ [section]: { 'routing-host': spec } }));
      await assert.rejects(checkRoutingPackage(root, files), /must not require/);
    }));
  }
}
for (const field of ['bundleDependencies', 'bundledDependencies']) {
  test(`the packed manifest refuses direct ${field}`, async () => fixture(async (root, put, files) => {
    await put('package.json', JSON.stringify({ [field]: ['agentfootprint'] }));
    await assert.rejects(checkRoutingPackage(root, files), /must not bundle/);
  }));
  test(`the packed manifest refuses aliased ${field}`, async () => fixture(async (root, put, files) => {
    await put('package.json', JSON.stringify({ dependencies: { host: 'npm:agentfootprint@16' }, [field]: ['host'] }));
    await assert.rejects(checkRoutingPackage(root, files), /must not require/);
  }));
  test(`the packed manifest refuses a dev alias made runtime by ${field}`, async () => fixture(async (root, put, files) => {
    await put('package.json', JSON.stringify({ devDependencies: { host: 'npm:agentfootprint@16' }, [field]: ['host'] }));
    await assert.rejects(checkRoutingPackage(root, files), /must not bundle/);
  }));
  test(`the packed manifest admits unrelated boolean ${field} and dev-only aliases`, async () => fixture(async (root, put, files) => {
    await put('package.json', JSON.stringify({ dependencies: { helper: 'npm:other-package@1' }, devDependencies: { host: 'npm:agentfootprint@16' }, [field]: true }));
    await checkRoutingPackage(root, files);
  }));
}
for (const name of ['agentfootprint', 'another-package']) {
  test(`the packed archive inspects bundled alias package identity ${name}`, async () => fixture(async (root, put, files) => {
    const path = 'node_modules/routing-host/package.json';
    await put(path, JSON.stringify({ name }));
    const inspected = checkRoutingPackage(root, [...files, { path }]);
    if (name === 'agentfootprint') await assert.rejects(inspected, /must not bundle/);
    else await inspected;
  }));
}
for (const path of ['dist/route.js', 'dist/route.d.ts', 'dist/route.js.map']) {
  test(`the packed ${path} refuses a host reference`, async () => fixture(async (root, put, files) => {
    await put(path, '// AgentFootprint must not leak into built files');
    await assert.rejects(checkRoutingPackage(root, [...files, { path }]), /host agent name/);
  }));
}
for (const statement of ["import type { X } from 'agentfootprint';", "export { X } from 'agentfootprint/skill-graph';", "await import( /* host */ 'agentfootprint' );", "require('agentfootprint/skill-graph');", "import 'agentfootprint';", "import 'agentfootprint/skill-graph';", "type Host = import('agentfootprint').Agent;", "import host = require('agentfootprint');"]) {
  test(`packed source refuses ${statement}`, async () => fixture(async (root, put, files) => {
    await put('src/route.ts', statement);
    await assert.rejects(checkRoutingPackage(root, files), /imports the host/);
  }));
}
test('source comments and data mentioning a host are not imports', async () => fixture(async (root, put, files) => {
  await put('src/route.ts', "// import 'agentfootprint';\nconst text = \"require('agentfootprint')\";");
  await checkRoutingPackage(root, files);
}));
