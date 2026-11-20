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
for (const section of ['dependencies', 'peerDependencies', 'peerDependenciesMeta']) {
  test(`the packed manifest refuses the host in ${section}`, async () => fixture(async (root, put, files) => {
    await put('package.json', JSON.stringify({ [section]: { agentfootprint: '^16.0.0' } }));
    await assert.rejects(checkRoutingPackage(root, files), /must not require/);
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
