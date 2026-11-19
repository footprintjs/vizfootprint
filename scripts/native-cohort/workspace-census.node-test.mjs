import assert from 'node:assert/strict';
import { realpathSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fixture } from './published-fixture.mjs';
import { physicalCensus } from './installed.mjs';
import { inspectPublished } from './published.mjs';

const parse = bytes => JSON.parse(bytes);
const roots = ['', 'ui', 'studio', 'bridges/vega-lite'];

for (const workspace of roots) {
  test(`workspace census: ${workspace || 'root'} hidden Foottrace alias refuses`, () => {
    const root = realpathSync(fixture());
    try {
      inspectPublished(root); // Positive baseline: the host engine and owned reader are shared.
      const hidden = join(root, workspace, 'node_modules/.hidden/second-trace');
      mkdirSync(hidden, { recursive: true });
      writeFileSync(join(hidden, 'package.json'), JSON.stringify({ name: 'foottrace', version: '1.0.0', main: 'index.js' }));
      writeFileSync(join(hidden, 'index.js'), 'throw new Error("inert, must not execute")');
      assert.throws(() => inspectPublished(root), /one physical foottrace required/);
    } finally { rmSync(root, { recursive: true }); }
  });

  test(`workspace census: ${workspace || 'root'} hidden lock must join the committed lock`, () => {
    const root = realpathSync(fixture());
    try {
      inspectPublished(root);
      const modules = join(root, workspace, 'node_modules');
      mkdirSync(modules, { recursive: true });
      const hidden = join(modules, '.package-lock.json');
      const lock = workspace ? { lockfileVersion: 3, packages: {} } : parse(readFileSync(hidden));
      lock.packages['node_modules/unrecorded-input'] = { version: '1.0.0' };
      writeFileSync(hidden, JSON.stringify(lock));
      assert.throws(() => inspectPublished(root), /unrecorded/);
    } finally { rmSync(root, { recursive: true }); }
  });
}

test('workspace census: workspace aliases do not duplicate scans and local declared bin links remain valid',()=>{
  const root=realpathSync(fixture());
  try {
    inspectPublished(root);
    const tool=join(root,'ui/node_modules/local-tool');mkdirSync(join(tool,'bin'),{recursive:true});
    writeFileSync(join(tool,'package.json'),JSON.stringify({name:'local-tool',version:'1.0.0',bin:{tool:'bin/tool.js'}}));
    writeFileSync(join(tool,'bin/tool.js'),'throw new Error("inert, must not execute")');
    const bin=join(root,'ui/node_modules/.bin');mkdirSync(bin);symlinkSync('../local-tool/bin/tool.js',join(bin,'tool'));
    writeFileSync(join(root,'ui/node_modules/.package-lock.json'),'{"packages":{}}');
    symlinkSync(join(root,'ui'),join(root,'node_modules/workspace-a'));
    symlinkSync(join(root,'ui'),join(root,'node_modules/workspace-b'));
    const census=physicalCensus(root,parse);
    assert.deepEqual(census.dependencyNamespaces,['node_modules','ui/node_modules','studio/node_modules','bridges/vega-lite/node_modules']);
    assert.equal(new Set(census.dependencyNamespaces).size,4);
    assert.equal(census.hiddenLocks.filter(row=>row.path==='ui/node_modules/.package-lock.json').length,1);
    assert.equal(census.links.filter(row=>row.path==='ui/node_modules/.bin/tool').length,1);
  } finally {rmSync(root,{recursive:true});}
});

test('workspace census: unknown declarations and aliased dependency namespaces refuse explicitly',()=>{
  const root=realpathSync(fixture());
  try {
    inspectPublished(root);const file=join(root,'package.json'),bytes=readFileSync(file),manifest=JSON.parse(bytes);
    manifest.workspaces.push('unadmitted');writeFileSync(file,JSON.stringify(manifest));
    assert.throws(()=>physicalCensus(root,parse),/unsupported workspace declarations/);
    writeFileSync(file,bytes);mkdirSync(join(root,'outside-namespace'));
    symlinkSync(join(root,'outside-namespace'),join(root,'studio/node_modules'));
    assert.throws(()=>physicalCensus(root,parse),/dependency namespace/);
  } finally {rmSync(root,{recursive:true});}
});
