// Fixed CI setup transaction. No commands or source selectors are supplied by callers.
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { constants, existsSync, mkdirSync, writeFileSync, openSync, closeSync, realpathSync, lstatSync, fstatSync, ftruncateSync, fchmodSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { hash, requireNativeInputs } from './admission.mjs';
import { projectManifests, manifestPaths } from './manifests.mjs';
import { dataPort, fetchInput, savedInput, regular } from './transport.mjs';
import { inspectInstalled } from './installed.mjs';

const documents = [...manifestPaths, 'package-lock.json'];
const git = (root, args) => execFileSync('git', ['-C', root, ...args],
  { timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const snapshot = root => Object.fromEntries(documents.map(path => [path, regular(join(root, path), 8 * 1024 * 1024)]));

function replaceDocument(file, bytes, mode) {
  assert.equal(realpathSync(file), resolve(file));
  const fd = openSync(file, constants.O_WRONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd); assert(stat.isFile() && stat.nlink === 1);
    ftruncateSync(fd, 0); writeFileSync(fd, bytes); fchmodSync(fd, mode);
  } finally { closeSync(fd); }
}

function clean(root) {
  git(root, ['diff', '--exit-code', '--']);
  git(root, ['diff', '--cached', '--exit-code', '--']);
}

export function requireWorkflow(env) {
  assert.equal(env.GITHUB_ACTIONS,'true','Actions workflow required');
  assert.equal(env.GITHUB_REPOSITORY,'footprintjs/vizfootprint','intended repository required');
}

export function requireOriginalDocuments(root,originals,modes) {
  for (const path of documents) {
    const bytes=execFileSync('git',['-C',root,'show',`HEAD:${path}`]);
    assert.deepEqual(originals[path],bytes,'original source bytes differ from Git');
    const mode=parseInt(git(root,['ls-tree','HEAD','--',path]).split(' ')[0],8) & 0o7777;
    assert.equal(modes[path],mode,'original mode differs from Git');
    assert.deepEqual(regular(join(root,path)),bytes,'authored document changed');
    assert.equal(lstatSync(join(root,path)).mode & 0o7777,mode,'authored mode changed');
  }
}

export function npmEnvironment(out, env) {
  const user = join(out, 'empty-user-npmrc'), global = join(out, 'empty-global-npmrc');
  for (const config of [user,global]) writeFileSync(config, '', { flag: 'wx', mode: 0o600 });
  return { ...Object.fromEntries(['PATH','HOME','TMPDIR','LANG'].filter(k=>typeof env[k]==='string').map(k=>[k,env[k]])),
    NPM_CONFIG_USERCONFIG: user, NPM_CONFIG_GLOBALCONFIG: global,
    NPM_CONFIG_CACHE: join(out, 'npm-cache'), NPM_CONFIG_UPDATE_NOTIFIER: 'false' };
}

function npm(root, out, env, step, args, timeout) {
  const fd = openSync(join(out, `${step}.log`), 'wx', 0o600);
  let result;
  try { result = spawnSync('npm', args, { cwd: root, env, timeout, stdio: ['ignore', fd, fd] }); }
  finally { closeSync(fd); }
  writeFileSync(join(out, `${step}.json`), jsonBytes({ step, args, exitCode: result.status,
    signal: result.signal, toolError: Boolean(result.error) }), { flag: 'wx', mode: 0o600 });
  assert(!result.error && !result.signal && result.status === 0, `${step} failed`);
}

export function restoreDocuments(root, originals, modes) {
  assert.deepEqual(Object.keys(originals).sort(), [...documents].sort());
  assert.deepEqual(Object.keys(modes).sort(), [...documents].sort());
  const failures = [];
  for (const [path, bytes] of Object.entries(originals)) {
    try {
      assert(documents.includes(path));
      replaceDocument(join(root, path), bytes, modes[path]);
      assert.deepEqual(regular(join(root, path)), bytes);
      assert.equal(lstatSync(join(root,path)).mode & 0o7777, modes[path]);
    } catch { failures.push(path); }
  }
  assert.equal(failures.length, 0, 'original document restoration failed');
}

export function requireOutside(root, out) {
  assert(isAbsolute(out) && resolve(out) === out, 'output must be absolute');
  const path = relative(root, out);
  assert(path === '..' || path.startsWith('..' + sep) || isAbsolute(path), 'output must be outside source');
}

export function fetchInputs({ root, out, inspectorRoot, inputs, env = process.env }) {
  requireWorkflow(env);
  requireNativeInputs(inputs); root = realpathSync(root); clean(root);
  requireOutside(root,out); assert.equal(realpathSync(dirname(out)),dirname(out));
  mkdirSync(out,{mode:0o700});
  const port = dataPort(inspectorRoot);
  for (const role of ['agentfootprint','storydeck']) fetchInput(role,inputs[role],join(out,role),port,env.GH_TOKEN);
  return { status:'SOURCE_DATA_FETCHED',inputsSha256:hash(JSON.stringify(inputs)),qualification:'Data stage only; no installation or consumer execution' };
}

function readInputs(inputs,out,port) {
  const admitted={},archives={};
  for (const role of ['agentfootprint','storydeck']) {
    const result=savedInput(role,inputs[role],join(out,role),port);
    admitted[role]=result.admitted; archives[role]=result.archive;
  }
  return {admitted,archives};
}

function installProjected({root,out,env,originals,originalModes,port,projected,admitted,archives}) {
    for (const path of manifestPaths) replaceDocument(join(root, path), projected[path],originalModes[path]);
    const childEnv = npmEnvironment(out, env);
    const strict = ['--strict-peer-deps', '--legacy-peer-deps=false', '--force=false', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org'];
    npm(root, out, childEnv, 'lock-update', ['update', '--package-lock-only', '--ignore-scripts', '--workspaces', '--include-workspace-root', ...strict,
      'agentfootprint', 'storydeck', 'footprintjs', 'foottrace'], 90000);
    const nativeLock = regular(join(root, 'package-lock.json'), 8 * 1024 * 1024);
    const baseline = port.parseStrictJson(originals['package-lock.json']);
    const updated = port.parseStrictJson(nativeLock);
    for (const path of ['node_modules/contextfootprint', 'node_modules/typescript']) {
      assert.deepEqual(updated.packages[path], baseline.packages[path], 'baseline vendor/compiler changed');
    }
    writeFileSync(join(out, 'native-package-lock.json'), nativeLock, { flag: 'wx', mode: 0o600 });
    npm(root, out, childEnv, 'strict-ci', ['ci', '--ignore-scripts=false', ...strict], 300000); // Original prepare hook runs.
    for (const path of manifestPaths) assert.deepEqual(regular(join(root, path)), projected[path], 'setup manifest changed');
    assert.deepEqual(regular(join(root, 'package-lock.json')), nativeLock, 'strict install rewrote native lock');
    const initial = inspectInstalled({ root, originals, nativeLock, admitted, archives, port });
    return {nativeLock,initial};
}

export function prepare({ root, out, inspectorRoot, inputs, env = process.env }) {
  requireWorkflow(env);
  requireNativeInputs(inputs); // Missing producer refuses before any filesystem/network/install effect.
  assert(!Object.hasOwn(env,'GH_TOKEN') && !Object.hasOwn(env,'GITHUB_TOKEN'), 'prepare must have no API token');
  assert.equal(env.GITHUB_ACTIONS, 'true', 'CI setup only');
  root = realpathSync(root); clean(root);
  requireOutside(root,out);
  assert.equal(realpathSync(dirname(out)), dirname(out));
  for (const path of manifestPaths) assert(!existsSync(join(dirname(join(root, path)), 'node_modules')), 'fresh CI dependency tree required');
  const originals = snapshot(root), port = dataPort(inspectorRoot);
  assert(lstatSync(out).isDirectory() && realpathSync(out)===out);
  const attempt=openSync(join(out,'prepare-attempt'),'wx',0o600); closeSync(attempt);
  const consumer = { head: git(root, ['rev-parse', 'HEAD']), tree: git(root, ['rev-parse', 'HEAD^{tree}']) };
  const {admitted,archives}=readInputs(inputs,out,port);
  const originalModes=Object.fromEntries(documents.map(path=>[path,lstatSync(join(root,path)).mode & 0o7777]));
  requireOriginalDocuments(root,originals,originalModes);
  const projected = projectManifests(Object.fromEntries(manifestPaths.map(path => [path, originals[path]])), archives);
  writeFileSync(join(out, 'originals.json'), jsonBytes(Object.fromEntries(documents.map(path => [path, originals[path].toString('base64')]))), { flag: 'wx', mode: 0o600 });
  writeFileSync(join(out,'setup-manifests.json'),jsonBytes(Object.fromEntries(manifestPaths.map(path=>[path,projected[path].toString('base64')]))),{flag:'wx',mode:0o600});
  let nativeLock, initial, setupFailure, restorationFailure;
  try {
    ({nativeLock,initial}=installProjected({root,out,env,originals,originalModes,port,projected,admitted,archives}));
  } catch (error) { setupFailure = error; }
  finally {
    try { restoreDocuments(root, originals,originalModes); clean(root); }
    catch (error) { restorationFailure = error; }
    writeFileSync(join(out, 'restoration.json'), jsonBytes({ setupFailed: Boolean(setupFailure),
      restorationFailed: Boolean(restorationFailure), restored: documents.map(path => {
        let actualSha256 = null;
        try { actualSha256 = hash(regular(join(root, path))); } catch { /* Preserve the original failures. */ }
        let mode=null; try { mode=lstatSync(join(root,path)).mode & 0o7777; } catch {}
        return { path, expectedSha256: hash(originals[path]), actualSha256,expectedMode:originalModes[path],actualMode:mode };
      }) }), { flag: 'wx', mode: 0o600 });
  }
  if (setupFailure || restorationFailure) throw new AggregateError([setupFailure, restorationFailure].filter(Boolean), 'native setup refused');
  const state = { consumer, inputsSha256: hash(JSON.stringify(inputs)), archives, admitted, initial,originalModes,
    originalHashes: Object.fromEntries(documents.map(path => [path, hash(originals[path])])),
    projectedHashes: Object.fromEntries(manifestPaths.map(path => [path, hash(projected[path])])),
    nativeLockSha256: hash(nativeLock), qualification: 'Source input setup only; existing consumer gates still required' };
  writeFileSync(join(out, 'native-state.json'), jsonBytes(state), { flag: 'wx', mode: 0o600 });
  writeFileSync(join(out,'setup-receipt.json'),jsonBytes({consumer,sourceHeads:Object.fromEntries(Object.entries(inputs).map(([role,input])=>[role,input.source.head])),
    originalHashes:state.originalHashes,originalModes,projectedHashes:state.projectedHashes,
    checkpointSha256:hash(jsonBytes(state)),nativeLockSha256:state.nativeLockSha256,
    observed:{packages:initial.packages,ownerRoots:initial.ownerRoots,dependencyNamespaces:initial.dependencyNamespaces,sourceMembers:initial.sourceMembers,
      compiler:initial.compiler,hiddenLocks:initial.hiddenLocks,linkCount:initial.links.length,linksSha256:hash(JSON.stringify(initial.links))},
    qualification:'Setup and installed-byte observations only; original consumer gates still required'}),{flag:'wx',mode:0o600});
  return { status: 'SOURCE_SETUP_COMPLETE', consumer, checkpointSha256:hash(jsonBytes(state)),nativeLockSha256: state.nativeLockSha256,
    sourceHeads: Object.fromEntries(Object.entries(inputs).map(([role, input]) => [role, input.source.head])) };
}

export function readCheckpoint(file,expectedSha256) {
  assert.match(expectedSha256,/^[a-f0-9]{64}$/,'prior-step checkpoint digest required');
  const bytes=regular(file,8*1024*1024); assert.equal(hash(bytes),expectedSha256,'native checkpoint changed'); return bytes;
}

export function verify({ root, out, inspectorRoot, inputs, expectedCheckpoint, env=process.env }) {
  requireWorkflow(env);
  requireNativeInputs(inputs);
  assert(!Object.hasOwn(env,'GH_TOKEN') && !Object.hasOwn(env,'GITHUB_TOKEN'), 'verify must have no API token');
  root = realpathSync(root); clean(root);
  requireOutside(root,out);
  const port = dataPort(inspectorRoot), state = port.parseStrictJson(readCheckpoint(join(out,'native-state.json'),expectedCheckpoint), { maxBytes: 8 * 1024 * 1024 });
  const fresh=readInputs(inputs,out,port); assert.deepEqual(state.admitted,fresh.admitted); assert.deepEqual(state.archives,fresh.archives);
  assert.equal(state.inputsSha256, hash(JSON.stringify(inputs)));
  assert.deepEqual(state.consumer, { head: git(root, ['rev-parse', 'HEAD']), tree: git(root, ['rev-parse', 'HEAD^{tree}']) });
  const encoded = port.parseStrictJson(regular(join(out, 'originals.json')), { maxBytes: 8 * 1024 * 1024 });
  const originals = Object.fromEntries(documents.map(path => [path, Buffer.from(encoded[path], 'base64')]));
  for (const path of documents) {
    assert.equal(hash(originals[path]), state.originalHashes[path]);
    assert.equal(hash(regular(join(root, path))), state.originalHashes[path], 'authored public document changed');
  }
  requireOriginalDocuments(root,originals,state.originalModes);
  const nativeLock = regular(join(out, 'native-package-lock.json'), 8 * 1024 * 1024);
  assert.equal(hash(nativeLock), state.nativeLockSha256);
  const current = inspectInstalled({ root, originals, nativeLock, admitted: state.admitted, archives: state.archives, port });
  assert.deepEqual(current, state.initial, 'installed inputs/compiler/locks changed during consumer gates');
  return { status: 'SOURCE_INPUTS_UNCHANGED', consumer: state.consumer,
    nativeLockSha256: state.nativeLockSha256, qualification: 'Byte/owner guard only; consumer check outcomes remain separate' };
}
