// Fixed public GitHub GETs with the workflow token only. One attempt, no credential fallback.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { constants, mkdirSync, openSync, closeSync, fstatSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSPECTOR_HEAD, verifyProvider, admitArchive, hash } from './admission.mjs';

export function dataPort(inspectorRoot) {
  const git = (...args) => execFileSync('git', ['-C', inspectorRoot, ...args], { timeout: 10000 }).toString().trim();
  assert.equal(git('rev-parse', 'HEAD'), INSPECTOR_HEAD);
  git('diff', '--exit-code', '--'); git('diff', '--cached', '--exit-code', '--');
  const require = createRequire(import.meta.url), base = resolve(inspectorRoot, 'src/release-route/archive');
  return { ...require(join(base, 'inspector.cjs')), ...require(join(base, 'strict-json.cjs')) };
}

export function regular(file, limit = 64 * 1024 * 1024) {
  assert.equal(realpathSync(file), resolve(file));
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    assert(stat.isFile() && stat.nlink === 1 && stat.size <= limit);
    const bytes = readFileSync(fd), after = fstatSync(fd);
    assert(bytes.length <= limit && bytes.length === stat.size && after.size === stat.size
      && after.mtimeMs === stat.mtimeMs && after.ctimeMs === stat.ctimeMs);
    return bytes;
  } finally { closeSync(fd); }
}

function client(directory, token, port) {
  assert(typeof token === 'string' && token.length > 0, 'workflow token missing');
  const config = join(directory, 'empty-gh-config'); mkdirSync(config, { mode: 0o700 });
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, GH_TOKEN: token,
    GH_CONFIG_DIR: config, GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1', GH_PAGER: 'cat' };
  function get(path, output) {
    try {
      return execFileSync('gh', ['api', path], { env, timeout: 60000,
        maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', output ?? 'pipe', 'pipe'] });
    } catch (error) {
      const status = /(?:HTTP |status code: )(403|404)/.exec(error.stderr?.toString() ?? '')?.[1];
      throw new Error(status ? `producer-read-${status}` : 'producer-read-failed');
    }
  }
  return { json: path => port.parseStrictJson(get(path), { maxBytes: 8 * 1024 * 1024 }),
    zip(path, file) {
      const fd = openSync(file, 'wx', 0o600);
      try { get(path, fd); } finally { closeSync(fd); }
    } };
}

export function fetchInput(role, input, directory, port, token) {
  mkdirSync(directory, { mode: 0o700 });
  const api = client(directory, token, port), base = `repos/${input.repository}`;
  const jobsPath = `${base}/actions/runs/${input.run.id}/attempts/${input.run.run_attempt}/jobs?per_page=100`;
  const jobs = api.json(jobsPath);
  const provider = {
    run: api.json(`${base}/actions/runs/${input.run.id}`),
    job: jobs.jobs.find(job => job.id === input.sourceJob.id), jobs, jobsPath,
    artifact: api.json(`${base}/actions/artifacts/${input.sourceArtifact.id}`),
    sourceCommit: api.json(`${base}/git/commits/${input.source.head}`),
    testedCommit: api.json(`${base}/git/commits/${input.tested.head}`),
  };
  verifyProvider(input, provider); // Metadata mismatch refuses before ZIP retrieval.
  const commits = [provider.sourceCommit, provider.testedCommit].map(({ sha, tree, parents }) => ({ sha, tree: { sha: tree.sha }, parents: parents.map(p => ({ sha:p.sha })) }));
  const safeProvider = { ...provider, sourceCommit: commits[0], testedCommit: commits[1],
    run: { ...input.run, head_sha: provider.run.head_sha, head_commit: { id:provider.run.head_commit.id, tree_id:provider.run.head_commit.tree_id }, repository: { id:provider.run.repository.id, full_name:provider.run.repository.full_name } } };
  writeFileSync(join(directory, 'provider.json'), JSON.stringify(safeProvider), { flag: 'wx', mode: 0o600 });
  writeFileSync(join(directory,'provider-summary.json'),JSON.stringify({repository:input.repository,source:input.source,tested:input.tested,
    testedParents:provider.testedCommit.parents.map(p=>p.sha),run:input.run,sourceJob:input.sourceJob,artifact:input.sourceArtifact,
    qualifyingJobs:provider.jobs.jobs.map(({id,name,status,conclusion})=>({id,name,status,conclusion})),
    qualification:'Exact attempt/source/provider facts; not registry publication or downstream acceptance'},null,2)+'\n',{flag:'wx',mode:0o600});
  const zip = join(directory, 'ORIGINAL.zip'), out = join(directory, 'original');
  api.zip(`${base}/actions/artifacts/${input.sourceArtifact.id}/zip`, zip);
  const expected = join(directory, 'zip-expected.json');
  writeFileSync(expected, JSON.stringify({ ...input.sourceArtifact, filename: input.archive.filename }), { flag: 'wx', mode: 0o600 });
  execFileSync('python3', [fileURLToPath(new URL('./zip_input.py', import.meta.url)), zip, expected, out],
    { timeout: 60000, maxBuffer: 4096, stdio: ['ignore', 'pipe', 'pipe'] });
  const files = Object.fromEntries([input.archive.filename, 'candidate.json', 'source-package.json', 'source-package-lock.json']
    .map(name => [name, regular(join(out, name), name.endsWith('.tgz') ? 32 * 1024 * 1024 : 8 * 1024 * 1024)]));
  const admitted = admitArchive(role, input, files, port);
  const archive = join(out, input.archive.filename);
  writeFileSync(join(directory, 'admission.json'), JSON.stringify({ role, source: input.source, tested: input.tested,
    artifact: input.sourceArtifact, archive: Object.fromEntries(['filename','package','version','sha256','shasum','integrity','bytes'].map(key=>[key,admitted[key]])),
    memberCount:admitted.files.length,memberCensusSha256:hash(JSON.stringify(admitted.files)),
    qualification: 'Native source input only; not registry or downstream acceptance' }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { archive, admitted };
}

export function savedInput(role, input, directory, port) {
  verifyProvider(input, port.parseStrictJson(regular(join(directory, 'provider.json')), { maxBytes:8*1024*1024 }));
  const zip = regular(join(directory, 'ORIGINAL.zip'));
  assert.equal(zip.length, input.sourceArtifact.size_in_bytes);
  assert.equal('sha256:' + hash(zip), input.sourceArtifact.digest);
  const out = join(directory, 'original');
  const expectedPath = join(directory, 'zip-expected.json');
  assert.deepEqual(port.parseStrictJson(regular(expectedPath)), { ...input.sourceArtifact, filename:input.archive.filename });
  execFileSync('python3', ['-B', fileURLToPath(new URL('./zip_input.py', import.meta.url)),
    join(directory,'ORIGINAL.zip'), expectedPath, out, '--verify'],
    { timeout:60000, maxBuffer:4096, stdio:['ignore','pipe','pipe'] });
  const files = Object.fromEntries([input.archive.filename, 'candidate.json', 'source-package.json', 'source-package-lock.json']
    .map(name => [name, regular(join(out, name), name.endsWith('.tgz') ? 32*1024*1024 : 8*1024*1024)]));
  return { archive:join(out,input.archive.filename), admitted:admitArchive(role,input,files,port) };
}
