import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync, symlinkSync, readFileSync, chmodSync, lstatSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { hash } from './admission.mjs';
import { physicalCensus, requireFamilyCensus, requireMembers, inspectInstalled } from './installed.mjs';
import { fetchInputs,prepare, verify,restoreDocuments,requireOutside,readCheckpoint,requireOriginalDocuments } from './setup.mjs';
import { manifestPaths, workspacePaths } from './manifests.mjs';
import { installedFixture } from './installed-fixture.mjs';

function fixture() { return realpathSync(mkdtempSync(join(tmpdir(), 'viz-native-data-'))); }
function put(root, path, bytes) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), bytes); }
const parse = bytes => JSON.parse(bytes);

for (const [phase, action] of [['FETCH',fetchInputs],['PREPARE',prepare],['VERIFY',verify]]) {
  test(`workflow guards ${phase}: desktop and foreign repository refuse before filesystem/API/npm`,()=>{
    const root=fixture();
    try {
      const inputs=JSON.parse(readFileSync(new URL('./inputs.json',import.meta.url)));
      inputs.storydeck.status='NATIVE_SOURCE_READY'; // Accepted-shape fixture only; no producer effects.
      for (const [env,reason] of [
        [{GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'footprintjs/other'},/intended repository required/],
        [{GITHUB_ACTIONS:'false',GITHUB_REPOSITORY:'footprintjs/vizfootprint'},/Actions workflow required/],
      ]) {
        assert.throws(()=>action({root:'/filesystem-boundary-must-not-be-reached',
          out:join(root,'must-not-exist'),inputs,env}),reason);
        assert.throws(()=>readFileSync(join(root,'must-not-exist')),/ENOENT/);
      }
    } finally {rmSync(root,{recursive:true});}
  });
}

test('complete installed fixture binds native/hidden locks, vendor image, all owners and actual compiler bytes', () => {
  const root = fixture();
  try {
    const require = createRequire(import.meta.url), base = resolve(process.env.NATIVE_ARCHIVE_PORT);
    const port = { ...require(base + '/inspector.cjs'), ...require(base + '/strict-json.cjs') };
    const args = { ...installedFixture(root), port };
    const before = inspectInstalled(args);
    assert.equal(before.packages.length, 6);
    assert.equal(before.ownerRoots.length, 10);
    assert.equal(before.vendorImage.members, 2);
    assert.equal(before.sourceMembers.agentfootprint.dependencyRoots.length, 1);
    assert.equal(before.compiler.version, '5.9.3');
    put(root, 'node_modules/typescript/bin/tsc', 'changed compiler');
    assert.notDeepEqual(inspectInstalled(args).compiler, before.compiler);
    const wrong = JSON.parse(args.nativeLock); wrong.packages['node_modules/typescript'].version = '6.0.0';
    assert.throws(() => inspectInstalled({ ...args, nativeLock: Buffer.from(JSON.stringify(wrong)) }), /compiler lock changed/);
    const hidden = JSON.parse(args.nativeLock); hidden.packages['node_modules/foottrace'].version = '1.0.0';
    put(root, 'node_modules/.package-lock.json', JSON.stringify(hidden));
    assert.throws(() => inspectInstalled(args));
  } finally { rmSync(root, { recursive: true }); }
});

function packages(root) {
  for (const path of manifestPaths) put(root,path,JSON.stringify({private:true,
    ...(path==='package.json'?{workspaces:workspacePaths}:{})}));
  const rows = [['footprintjs', 'footprintjs', '13.0.0'], ['foottrace', 'foottrace', '2.0.0'],
    ['agentfootprint', 'agentfootprint', '15.0.0-rc.0'], ['storydeck', 'footprint-storydeck', '0.13.3'],
    ['contextfootprint', 'contextfootprint', '0.1.0'],
    ['agentfootprint/node_modules/contextfootprint', 'contextfootprint', '0.1.1']];
  for (const [path, name, version] of rows) put(root, `node_modules/${path}/package.json`, JSON.stringify({ name, version }));
  return rows;
}

test('census includes both context owners, alias identity, hidden duplicates and actual links', () => {
  const root = fixture();
  try {
    packages(root);
    const census = physicalCensus(root, parse);
    const byName = requireFamilyCensus(census);
    assert.equal(byName('footprint-storydeck')[0].root, join(root, 'node_modules/storydeck'));
    assert.equal(byName('contextfootprint').length, 2);
    put(root, 'node_modules/.hidden/alias/package.json', '{"name":"foottrace","version":"2.0.0"}');
    assert.throws(() => requireFamilyCensus(physicalCensus(root, parse)), /one physical foottrace/);
    rmSync(join(root, 'node_modules/.hidden'), { recursive: true });
    symlinkSync(join(root, 'node_modules/foottrace'), join(root, 'node_modules/trace-alias'));
    assert.throws(() => physicalCensus(root, parse), /unexpected linked/);
  } finally { rmSync(root, { recursive: true }); }
});

test('archive member guard rejects extra/changed own files and observes dependency namespaces separately', () => {
  const root = fixture();
  try {
    const bytes = Buffer.from('inert code never imported'); put(root, 'index.js', bytes);
    put(root, 'node_modules/contextfootprint/package.json', '{}');
    const admitted = { files: [{ path: 'package/index.js', size: bytes.length, sha256: hash(bytes) }] };
    assert.equal(requireMembers(root, admitted).dependencyRoots.length, 1);
    put(root, '.hidden.js', 'extra'); assert.throws(() => requireMembers(root, admitted), /differs from original/);
    rmSync(join(root, '.hidden.js')); put(root, 'index.js', 'changed');
    assert.throws(() => requireMembers(root, admitted), /differs from original/);
  } finally { rmSync(root, { recursive: true }); }
});

test('pending tuples refuse before any setup effect, including root lookup', () => {
  const root = fixture();
  try {
    assert.throws(() => prepare({ root: '/does-not-exist', out: join(root, 'never-created'),
      inputs: { agentfootprint: null, storydeck: { status: 'PENDING_SOURCE_ARTIFACT' } },
      env:{GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'footprintjs/vizfootprint'} }), /accepted source tuple missing/);
    assert.throws(() => readFileSync(join(root, 'never-created')), /ENOENT/);
    const inputs=JSON.parse(readFileSync(new URL('./inputs.json',import.meta.url)));
    inputs.storydeck.status='NATIVE_SOURCE_READY'; // Inert accepted-shape fixture only; no source config change.
    for(const action of [prepare,verify]) assert.throws(()=>action({root:'/does-not-exist',inputs,
      env:{GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'footprintjs/vizfootprint',GH_TOKEN:'inert-not-a-credential'}}),/must have no API token/);
  } finally { rmSync(root, { recursive: true }); }
});

test('restoration retains original bytes and refuses a changed symlink target without touching it', () => {
  const root = fixture(), paths = [...manifestPaths, 'package-lock.json'];
  try {
    const originals = Object.fromEntries(paths.map(path => [path, Buffer.from(JSON.stringify({ original: path }))]));
    const modes=Object.fromEntries(paths.map(path=>[path,0o640]));
    for (const path of paths) { put(root, path, Buffer.from('changed'));chmodSync(join(root,path),0o600); }
    restoreDocuments(root, originals,modes);
    for (const path of paths) {assert.deepEqual(readFileSync(join(root, path)), originals[path]);assert.equal(lstatSync(join(root,path)).mode & 0o7777,0o640);}
    put(root, 'outside.json', 'untouched'); rmSync(join(root, 'package.json'));
    symlinkSync(join(root, 'outside.json'), join(root, 'package.json'));
    assert.throws(() => restoreDocuments(root, originals,modes), /restoration failed/);
    assert.equal(readFileSync(join(root, 'outside.json')).toString(), 'untouched');
  } finally { rmSync(root, { recursive: true }); }
});

test('segment containment refuses ..evil inside source and checkpoint tampering cannot self-authorize',()=>{
  const root=fixture();
  try {
    assert.throws(()=>requireOutside(root,join(root,'..evil')),/outside source/);
    assert.throws(()=>readFileSync(join(root,'..evil')),/ENOENT/);
    const file=join(root,'state.json'),before=Buffer.from('{"admitted":{},"initial":{}}');writeFileSync(file,before);
    assert.deepEqual(readCheckpoint(file,hash(before)),before);
    writeFileSync(file,'{"admitted":{"changed":true},"initial":{"changed":true}}');
    assert.throws(()=>readCheckpoint(file,hash(before)),/checkpoint changed/);
    assert.throws(()=>readCheckpoint(file,undefined));
  } finally {rmSync(root,{recursive:true});}
});

test('restored document bytes and modes are bound to immutable Git, not mutable backup/checkpoint agreement',()=>{
  const root=fixture(),paths=[...manifestPaths,'package-lock.json'];
  try {
    const originals=Object.fromEntries(paths.map(path=>[path,Buffer.from(JSON.stringify({original:path}))]));
    const modes=Object.fromEntries(paths.map(path=>[path,0o644]));
    for(const path of paths){put(root,path,originals[path]);chmodSync(join(root,path),0o644);}
    const env={PATH:process.env.PATH,HOME:process.env.HOME,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'};
    const git=(...args)=>execFileSync('git',['-c','core.hooksPath='+join(root,'empty-hooks'),'-c','commit.gpgsign=false','-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args],{cwd:root,env,stdio:['ignore','pipe','pipe']});
    mkdirSync(join(root,'empty-hooks'));git('init','-q');git('add',...paths);git('commit','-qm','inert original documents');
    requireOriginalDocuments(root,originals,modes);
    originals['package.json']=Buffer.from('{"changedTogether":true}');put(root,'package.json',originals['package.json']);
    assert.throws(()=>requireOriginalDocuments(root,originals,modes),/source bytes differ from Git/);
    originals['package.json']=git('show','HEAD:package.json');put(root,'package.json',originals['package.json']);
    chmodSync(join(root,'package.json'),0o600);modes['package.json']=0o600;
    assert.throws(()=>requireOriginalDocuments(root,originals,modes),/mode differs from Git/);
  } finally {rmSync(root,{recursive:true});}
});
