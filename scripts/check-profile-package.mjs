// Verify the real packed public surface and the emitted dependency boundary.
// This is a local check: no registry install, network, live database, or browser.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = await mkdtemp(join(tmpdir(), 'viz-profile-package-'));
const env = { ...process.env, NODE_PATH: '', npm_config_cache: join(scratch, 'npm-cache'), npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false' };
function run(command, args, cwd = root) {
  try { return execFileSync(command, args, { cwd, env, encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }); }
  catch (error) {
    throw new Error(`${command} ${args.join(' ')} failed\n${error.stdout ?? ''}${error.stderr ?? ''}`, { cause: error });
  }
}
try {
  run('npm', ['run', 'build']);
  const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--workspaces=false', '--pack-destination', scratch]));
  assert.equal(packed.length, 1);
  assert(!packed[0].files.some(file => file.path.startsWith('node_modules/')),
    'The packed library bundles no dependency: ContextFootprint is a host\'s install, never ours');
  const consumer = join(scratch, 'consumer');
  const packageDir = join(consumer, 'node_modules', 'vizfootprint');
  await mkdir(packageDir, { recursive: true });
  run('tar', ['-xzf', join(scratch, packed[0].filename), '--strip-components=1', '-C', packageDir]);
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  assert.deepEqual(await readdir(join(consumer, 'node_modules')), ['vizfootprint']);
  const example = await readFile(join(packageDir, 'examples/profile-data.mjs'), 'utf8');
  await writeFile(join(consumer, 'example.mjs'), example);
  const direct = JSON.parse(run(process.execPath, ['example.mjs', '--sqlite'], consumer));
  assert.equal(direct.examples.length, 3);
  const groupedExample = await readFile(join(packageDir, 'examples/group-profile-data.mjs'), 'utf8');
  await writeFile(join(consumer, 'group-example.mjs'), groupedExample);
  const groupedDirect = JSON.parse(run(process.execPath, ['group-example.mjs', '--sqlite'], consumer));
  assert.equal(groupedDirect.examples.length, 4);
  console.log('PASS packed public import: vizfootprint/data; no separately installed optional engines; seven synthetic profile/group fixtures');

  const semanticExample = await readFile(join(packageDir, 'examples/profile-semantics.mjs'), 'utf8');
  await writeFile(join(consumer, 'semantics.mjs'), semanticExample);
  const semanticDirect = JSON.parse(run(process.execPath, ['semantics.mjs'], consumer));
  assert.equal(semanticDirect.pages.length, 2);
  assert.equal(semanticDirect.rankPages.length, 2);
  assert.equal(semanticDirect.rankPages[0].rowPage.total, 2);
  assert.equal(semanticDirect.rankPages[0].ranking.total, 3);
  const namespaceExample = await readFile(join(packageDir, 'examples/field-namespace.mjs'), 'utf8');
  await writeFile(join(consumer, 'namespace.mjs'), namespaceExample);
  const namespaceDirect = JSON.parse(run(process.execPath, ['namespace.mjs'], consumer));
  assert.equal(namespaceDirect.bindings.length, 2);
  assert.notEqual(namespaceDirect.bindings[0].nativeField, namespaceDirect.distinctTableAddress);
  // The comparison example needs ContextFootprint, which the LIBRARY does not depend on (its assertion
  // is the library's own shape, `src/data/profile/assertion.types.ts`): install it as a host would —
  // the reviewed archive under vendor/, offline, beside the packed library.
  const vendorDir = join(root, 'vendor', 'contextfootprint');
  const archive = (await readdir(vendorDir)).find(name => name.endsWith('.tgz'));
  assert(archive, 'vendor/contextfootprint holds the reviewed archive');
  const comparatorDir = join(consumer, 'node_modules', 'contextfootprint');
  await mkdir(comparatorDir, { recursive: true });
  run('tar', ['-xzf', join(vendorDir, archive), '--strip-components=1', '-C', comparatorDir]);
  const assertionExample = join(packageDir, 'examples/profile-assertion.mjs');
  const assertionDirect = JSON.parse(run(process.execPath, [assertionExample], consumer));
  assert.equal(assertionDirect.observedValue, 10);
  assert.equal(assertionDirect.mismatchConflicts, 1);
  assert.equal(assertionDirect.unknownParticipates, false);
  const assertionBundle = await build({
    absWorkingDir: consumer, entryPoints: [assertionExample], outfile: join(consumer, 'assertion-only.mjs'),
    bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', treeShaking: true, metafile: true,
    external: ['node:*', '@duckdb/*', '@modelcontextprotocol/*', '@uwdata/*', 'footprintjs', 'agentfootprint', 'react', 'react-dom'],
    logLevel: 'silent',
  });
  const assertionInputs = new Set();
  for (const output of Object.values(assertionBundle.metafile.outputs)) {
    assert.deepEqual(output.imports, [], 'An external dependency escaped the assertion bundle');
    for (const [path, contribution] of Object.entries(output.inputs)) if (contribution.bytesInOutput > 0) assertionInputs.add(path.replaceAll('\\', '/'));
  }
  assert([...assertionInputs].some(path => path.endsWith('/contextfootprint/dist/esm/conflicts.js')),
    'The example must use the shared comparator');
  assert([...assertionInputs].some(path => path.endsWith('/data/profile/assertion.js')),
    'The example must use the Viz observation adapter');
  const entry = join(consumer, 'profile-entry.mjs');
  await writeFile(entry, "export { profileData, profileGroups, createArrayProfileProvider, listProfileOperations, describeProfileOperation, summarizeProfileResult, rankData, summarizeRankResult, summarizeDataResult, listDataOperations, createFieldNamespace, FIELD_NAMESPACE_PREFIX } from 'vizfootprint/data';\n");
  const bundled = await build({
    absWorkingDir: consumer, entryPoints: [entry], outfile: join(consumer, 'profile-only.mjs'),
    bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', treeShaking: true, metafile: true,
    // The broad data barrel declares optional engines. Permit resolution to skip their packages,
    // but REFUSE any retained external import below: none may reach the profile consumer.
    external: ['node:*', '@duckdb/*', '@modelcontextprotocol/*', '@uwdata/*', 'footprintjs', 'agentfootprint', 'react', 'react-dom'],
    logLevel: 'silent',
  });
  const outputs = Object.values(bundled.metafile.outputs);
  assert(outputs.length > 0);
  const retained = new Set();
  for (const output of outputs) {
    assert.deepEqual(output.imports, [], 'A runtime import escaped into the standalone profile bundle');
    for (const [path, contribution] of Object.entries(output.inputs)) if (contribution.bytesInOutput > 0) retained.add(path.replaceAll('\\', '/'));
  }
  const forbidden = /(?:^|\/)(?:ui|renderer|session|agent|mcp|mosaic)\/|(?:react|sqlite|duckdb|wasmProvider|serverProvider|footprintjs)/i;
  for (const path of retained) assert(!forbidden.test(path), `Profile bundle retained a forbidden dependency: ${path}`);
  for (const path of assertionInputs) assert(!forbidden.test(path), `Assertion bundle retained a forbidden dependency: ${path}`);
  assert(![...retained].some(path => path.includes('/contextfootprint/')),
    'Using ordinary profile operations must not retain the shared comparator');
  assert([...retained].some((path) => path.endsWith('/data/profile/run.js')));
  assert([...retained].some((path) => path.endsWith('/data/profile/groups.js')));
  assert([...retained].some((path) => path.endsWith('/data/rank/summary.js')));
  assert([...retained].some((path) => path.endsWith('/data/fieldNamespace.js')));
  await writeFile(join(consumer, 'bundle-example.mjs'), example.replace("from 'vizfootprint/data'", "from './profile-only.mjs'"));
  await writeFile(join(consumer, 'bundle-group-example.mjs'), groupedExample.replace("from 'vizfootprint/data'", "from './profile-only.mjs'"));
  await writeFile(join(consumer, 'bundle-semantics.mjs'), semanticExample.replace("from 'vizfootprint/data'", "from './profile-only.mjs'"));
  await writeFile(join(consumer, 'bundle-namespace.mjs'), namespaceExample.replace("from 'vizfootprint/data'", "from './profile-only.mjs'"));
  // Remove even the packed package: this execution has no node_modules directory at all.
  await rm(join(consumer, 'node_modules'), { recursive: true });
  const standalone = JSON.parse(run(process.execPath, ['bundle-example.mjs'], consumer));
  assert.equal(standalone.examples.length, 2);
  assert.deepEqual(standalone.examples, direct.examples.slice(0, 2));
  const groupedStandalone = JSON.parse(run(process.execPath, ['bundle-group-example.mjs'], consumer));
  assert.equal(groupedStandalone.examples.length, 3);
  assert.deepEqual(groupedStandalone.examples, groupedDirect.examples.slice(0, 3));
  const semanticStandalone = JSON.parse(run(process.execPath, ['bundle-semantics.mjs'], consumer));
  assert.deepEqual(semanticStandalone, semanticDirect);
  const assertionStandalone = JSON.parse(run(process.execPath, ['assertion-only.mjs'], consumer));
  assert.deepEqual(assertionStandalone, assertionDirect);
  const namespaceStandalone = JSON.parse(run(process.execPath, ['bundle-namespace.mjs'], consumer));
  assert.deepEqual(namespaceStandalone, namespaceDirect);
  console.log('PASS standalone profile bundle: no renderer, session, agent, React, MCP, SQLite, WASM, or external runtime imports');
  console.log(JSON.stringify({
    packedFiles: packed[0].files.length,
    bundleBytes: outputs.reduce((sum, output) => sum + output.bytes, 0),
    retainedModules: [...retained].map((path) => path.replace(/^node_modules\/vizfootprint\//, '')).sort(),
    checks: ['packed-public-import', 'synthetic-requests', 'synthetic-inventory', 'sqlite-iterator-parity',
      'packed-group-example', 'grouped-requests-include-exclude', 'grouped-inventory', 'group-scope-reconstruction',
      'grouped-sqlite-iterator-parity', 'semantic-discovery-ui-tool-parity', 'bounded-result-context', 'rank-paged-context', 'shared-data-discovery', 'qualified-field-namespace', 'shared-profile-assertion', 'standalone-assertion-comparison', 'bundle-dependency-boundary', 'dependency-free-bundle-execution'],
  }, null, 2));
} finally {
  await rm(scratch, { recursive: true, force: true });
}
