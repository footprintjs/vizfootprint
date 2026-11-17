import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { mkdtempSync,writeFileSync,mkdirSync,realpathSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { savedInput } from './transport.mjs';
import { hash, archiveProfiles, admitArchive, verifyProvider, requireNativeInputs } from './admission.mjs';
import { SOURCE, TESTED, fixtureFiles, archive } from './byte-fixture.mjs';

assert(process.env.NATIVE_ARCHIVE_PORT, 'supply the pinned shared ci archive directory');
const require = createRequire(import.meta.url), base = resolve(process.env.NATIVE_ARCHIVE_PORT);
const port = { ...require(base + '/inspector.cjs'), ...require(base + '/strict-json.cjs') };

function specimen() {
  const contents = fixtureFiles(), manifestBytes = contents['package/package.json'];
  const lockBytes = Buffer.from('{"lockfileVersion":3}'), filename = 'footprint-storydeck-0.13.3.tgz';
  const bytes = archive(Object.entries(contents));
  const admitted = port.inspectArchive(bytes, { version: '0.13.3', sourceManifest: JSON.parse(manifestBytes), archive: archiveProfiles.storydeck });
  const source = { ...SOURCE, manifestSha256: hash(manifestBytes), lockSha256: hash(lockBytes) };
  const input = { status: 'NATIVE_SOURCE_READY', repository: 'footprintjs/storydeck', repositoryId: 100,
    source, tested: TESTED, expectedTestedParents:['5'.repeat(40),source.head],sourceProtocol: 'storydeck.source-candidate.v1',
    run: { id: 200, run_attempt: 1, workflow_id: 300, name: 'CI', event: 'pull_request',
      head_branch: 'candidate', status: 'completed', conclusion: 'success' },
    sourceJob: { id: 400, name: 'test', status: 'completed', conclusion: 'success' },
    sourceArtifact: { id: 500, name: 'source-' + SOURCE.head, size_in_bytes: 1234, digest: 'sha256:' + '4'.repeat(64), expired: false },
    archive: { filename, ...admitted, files: undefined, memberCount: admitted.files.length,
      memberCensusSha256: hash(JSON.stringify(admitted.files)) } };
  const record = { protocol: input.sourceProtocol, source, tested: TESTED, archive: { filename, ...admitted } };
  const files = { [filename]: bytes, 'source-package.json': manifestBytes, 'source-package-lock.json': lockBytes,
    'candidate.json': Buffer.from(JSON.stringify(record)) };
  input.qualifyingJobs=[{...input.sourceJob}];
  const provider = { run: { ...input.run, head_sha: source.head, head_commit:{id:source.head,tree_id:source.tree},repository: { id: 100, full_name: input.repository } },
    job: { ...input.sourceJob, run_id: 200, run_attempt: 1, head_sha: source.head },
    artifact: { ...input.sourceArtifact, workflow_run: { id: 200, head_sha: source.head } },
    sourceCommit: { sha: source.head, tree: { sha: source.tree } },
    testedCommit: { sha: TESTED.head, tree: { sha: TESTED.tree },parents:input.expectedTestedParents.map(sha=>({sha})) } };
  provider.jobs={total_count:1,jobs:[{...provider.job}]};
  provider.jobsPath=`repos/${input.repository}/actions/runs/200/attempts/1/jobs?per_page=100`;
  return { input, files, provider };
}

test('actual shared parser admits an inert original package and complete source/tested binding', () => {
  const { input, files, provider } = specimen();
  verifyProvider(input, provider);
  const admitted = admitArchive('storydeck', input, files, port);
  assert.equal(admitted.version, '0.13.3'); assert.equal(admitted.files.length, 9);
  assert.equal(globalThis.__storydeckPackageExecuted, undefined);
});

test('wrong provider source/run/attempt/job/artifact/digest and tested tree refuse', () => {
  for (const [path, value] of [
    [['run', 'head_sha'], 'f'.repeat(40)], [['run', 'id'], 201], [['run', 'run_attempt'], 2],
    [['job', 'id'], 401], [['artifact', 'id'], 501], [['artifact', 'digest'], 'sha256:' + '0'.repeat(64)],
    [['testedCommit', 'tree', 'sha'], 'e'.repeat(40)],
    [['run','head_commit','id'],'f'.repeat(40)], [['testedCommit','parents'],[{sha:'9'.repeat(40)}]],
    [['jobs','total_count'],2], [['jobsPath'],'repos/wrong/attempt/2'],
  ]) {
    const { input, provider } = specimen(); let target = provider;
    for (const key of path.slice(0, -1)) target = target[key]; target[path.at(-1)] = value;
    assert.throws(() => verifyProvider(input, provider));
  }
});

test('changed archive/source/census and duplicate JSON keys refuse without relabeling', () => {
  const { input, files } = specimen();
  assert.throws(() => admitArchive('storydeck', input, { ...files, 'source-package.json': Buffer.from('{}') }, port));
  assert.throws(() => admitArchive('storydeck', { ...input, archive: { ...input.archive, memberCount: 8 } }, files, port));
  const duplicate = Buffer.from('{"protocol":"one","protocol":"two"}');
  assert.throws(() => admitArchive('storydeck', input, { ...files, 'candidate.json': duplicate }, port), /manifest-json/);
  const changed = Buffer.from(files[input.archive.filename]); changed[changed.length - 1] ^= 1;
  assert.throws(() => admitArchive('storydeck', input, { ...files, [input.archive.filename]: changed }, port));
});

test('both accepted roles are mandatory; arbitrary or pending selectors cannot activate', () => {
  const { input } = specimen();
  assert.throws(() => requireNativeInputs({ agentfootprint: input, storydeck: input }));
  assert.throws(() => requireNativeInputs({ agentfootprint: null, storydeck: input }));
  assert.throws(() => requireNativeInputs({ agentfootprint: null, storydeck: input, arbitrary: input }));
});

test('saved data is re-admitted against fixed ZIP/archive pins; changed tar bytes refuse across stages',()=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'viz-source-intake-')));
  try {
    const {input,files,provider}=specimen();mkdirSync(join(root,'original'));
    for (const [name,bytes] of Object.entries(files)) writeFileSync(join(root,'original',name),bytes);
    const code="import sys,json,base64,zipfile;d=json.load(sys.stdin);z=zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED);[z.writestr(k,base64.b64decode(v)) for k,v in d.items()];z.close()";
    execFileSync('python3',['-B','-c',code,join(root,'ORIGINAL.zip')],{input:JSON.stringify(Object.fromEntries(Object.entries(files).map(([k,v])=>[k,v.toString('base64')]))) });
    const zip=execFileSync('python3',['-B','-c','import sys;sys.stdout.buffer.write(open(sys.argv[1],"rb").read())',join(root,'ORIGINAL.zip')]);
    input.sourceArtifact.size_in_bytes=zip.length;input.sourceArtifact.digest='sha256:'+hash(zip);
    Object.assign(provider.artifact,input.sourceArtifact);
    writeFileSync(join(root,'provider.json'),JSON.stringify(provider));
    writeFileSync(join(root,'zip-expected.json'),JSON.stringify({...input.sourceArtifact,filename:input.archive.filename}));
    assert.equal(savedInput('storydeck',input,root,port).admitted.files.length,9);
    writeFileSync(join(root,'original',input.archive.filename),'changed archive');
    assert.throws(()=>savedInput('storydeck',input,root,port));
    writeFileSync(join(root,'original',input.archive.filename),files[input.archive.filename]);
    writeFileSync(join(root,'ORIGINAL.zip'),Buffer.concat([zip,Buffer.from('changed ZIP')]));
    assert.throws(()=>savedInput('storydeck',input,root,port));
  } finally {rmSync(root,{recursive:true});}
});
