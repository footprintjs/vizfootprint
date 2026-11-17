import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { installedFixture } from './installed-fixture.mjs';
import { inspectInstalled, physicalCensus, requireFamilyCensus } from './installed.mjs';

const require = createRequire(import.meta.url), base = resolve(process.env.NATIVE_ARCHIVE_PORT);
const port = { ...require(base + '/inspector.cjs'), ...require(base + '/strict-json.cjs') };
const roots = ['', 'ui', 'studio', 'bridges/vega-lite'];

for (const workspace of roots) {
  test(`workspace census: ${workspace || 'root'} hidden Foottrace alias refuses`, () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'viz-workspace-census-')));
    try {
      const args = { ...installedFixture(root), port };
      inspectInstalled(args); // Positive baseline, with both legitimate context owners.
      const hidden = join(root, workspace, 'node_modules/.hidden/second-trace');
      mkdirSync(hidden, { recursive: true });
      writeFileSync(join(hidden, 'package.json'), JSON.stringify({ name: 'foottrace', version: '1.0.0', main: 'index.js' }));
      writeFileSync(join(hidden, 'index.js'), 'throw new Error("inert, must not execute")');
      assert.throws(() => inspectInstalled(args), /one physical foottrace required/);
    } finally { rmSync(root, { recursive: true }); }
  });

  test(`workspace census: ${workspace || 'root'} hidden lock must join the native lock`, () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'viz-workspace-lock-')));
    try {
      const args = { ...installedFixture(root), port };
      inspectInstalled(args);
      const modules = join(root, workspace, 'node_modules');
      mkdirSync(modules, { recursive: true });
      writeFileSync(join(modules, '.package-lock.json'), JSON.stringify({ lockfileVersion: 3,
        packages: { 'node_modules/unrecorded-input': { version: '1.0.0' } } }));
      assert.throws(() => inspectInstalled(args), /unrecorded/);
    } finally { rmSync(root, { recursive: true }); }
  });
}

test('workspace census: workspace aliases do not duplicate scans and local declared bin links remain valid',()=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'viz-workspace-links-')));
  try {
    installedFixture(root);
    const tool=join(root,'ui/node_modules/local-tool');mkdirSync(join(tool,'bin'),{recursive:true});
    writeFileSync(join(tool,'package.json'),JSON.stringify({name:'local-tool',version:'1.0.0',bin:{tool:'bin/tool.js'}}));
    writeFileSync(join(tool,'bin/tool.js'),'throw new Error("inert, must not execute")');
    const bin=join(root,'ui/node_modules/.bin');mkdirSync(bin);symlinkSync('../local-tool/bin/tool.js',join(bin,'tool'));
    writeFileSync(join(root,'ui/node_modules/.package-lock.json'),'{}');
    symlinkSync(join(root,'ui'),join(root,'node_modules/workspace-a'));
    symlinkSync(join(root,'ui'),join(root,'node_modules/workspace-b'));
    const census=physicalCensus(root,port.parseStrictJson);requireFamilyCensus(census);
    assert.deepEqual(census.dependencyNamespaces,['node_modules','ui/node_modules','studio/node_modules','bridges/vega-lite/node_modules']);
    assert.equal(new Set(census.dependencyNamespaces).size,4);
    assert.equal(census.hiddenLocks.filter(row=>row.path==='ui/node_modules/.package-lock.json').length,1);
    assert.equal(census.links.filter(row=>row.path==='ui/node_modules/.bin/tool').length,1);
  } finally {rmSync(root,{recursive:true});}
});

test('workspace census: unknown declarations and aliased dependency namespaces refuse explicitly',()=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'viz-workspace-scope-')));
  try {
    installedFixture(root);const file=join(root,'package.json'),bytes=readFileSync(file),manifest=JSON.parse(bytes);
    manifest.workspaces.push('unadmitted');writeFileSync(file,JSON.stringify(manifest));
    assert.throws(()=>physicalCensus(root,port.parseStrictJson),/unsupported workspace declarations/);
    writeFileSync(file,bytes);mkdirSync(join(root,'outside-namespace'));
    symlinkSync(join(root,'outside-namespace'),join(root,'studio/node_modules'));
    assert.throws(()=>physicalCensus(root,port.parseStrictJson),/dependency namespace/);
  } finally {rmSync(root,{recursive:true});}
});
