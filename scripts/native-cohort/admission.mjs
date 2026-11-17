// Fixed producer evidence and shared archive DATA port. No network, installs or execution.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const INSPECTOR_HEAD = '1ca5d7de9bde68c205b5d140c94dc475ae3b2520';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const archiveProfiles = Object.freeze({
  // Exact existing ba51 archivePolicy roots/prefixes, not a broadened family profile.
  agentfootprint: ['dist/', 'bin/', 'ai-instructions/', 'AGENTS.md', 'CAPABILITIES.md', 'canonical-notes.json'],
  storydeck: ['dist/', 'plugin/', 'site/public/deck-stage.js', '*.d.ts', '*.css', 'CHANGELOG.md'],
});

export function requireNativeInputs(inputs) {
  assert.deepEqual(Object.keys(inputs).sort(), ['agentfootprint', 'storydeck']);
  for (const [role, input] of Object.entries(inputs)) {
    assert.equal(input?.status, 'NATIVE_SOURCE_READY', `${role} accepted source tuple missing`);
    assert.equal(input.repository, role === 'agentfootprint' ? 'footprintjs/agentfootprint' : 'footprintjs/storydeck');
    assert.equal(input.archive.package, role === 'agentfootprint' ? 'agentfootprint' : 'footprint-storydeck');
    assert.equal(input.archive.version, role === 'agentfootprint' ? '15.0.0-rc.0' : '0.13.3');
  }
  return inputs;
}

export function verifyProvider(input, provider) {
  const { run, job, artifact, sourceCommit, testedCommit } = provider;
  for (const key of ['id', 'run_attempt', 'workflow_id', 'name', 'event', 'head_branch', 'status', 'conclusion']) {
    assert.deepEqual(run[key], input.run[key], `producer run ${key} differs`);
  }
  assert.equal(run.head_sha, input.source.head);
  assert.equal(run.head_commit.id, input.source.head); assert.equal(run.head_commit.tree_id, input.source.tree);
  assert.equal(run.repository.id, input.repositoryId);
  assert.equal(run.repository.full_name, input.repository);
  for (const key of ['id', 'name', 'status', 'conclusion']) assert.equal(job[key], input.sourceJob[key]);
  assert.equal(job.run_id, run.id);
  if (Object.hasOwn(job, 'run_attempt')) assert.equal(job.run_attempt, run.run_attempt);
  assert.equal(job.head_sha, input.source.head);
  for (const key of ['id', 'name', 'size_in_bytes', 'digest', 'expired']) {
    assert.equal(artifact[key], input.sourceArtifact[key], `producer artifact ${key} differs`);
  }
  assert.equal(artifact.expired, false);
  assert.equal(artifact.workflow_run.id, run.id);
  assert.equal(artifact.workflow_run.head_sha, input.source.head);
  for (const [commit, expected] of [[sourceCommit, input.source], [testedCommit, input.tested]]) {
    assert.equal(commit.sha, expected.head); assert.equal(commit.tree.sha, expected.tree);
  }
  assert.equal(input.source.tree, input.tested.tree);
  assert.deepEqual(testedCommit.parents.map(parent => parent.sha), input.expectedTestedParents);
  assert.equal(input.expectedTestedParents.at(-1), input.source.head);
  assert.equal(provider.jobsPath, `repos/${input.repository}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
  assert(input.qualifyingJobs.length > 0 && input.qualifyingJobs.length <= 100);
  const jobs = provider.jobs.jobs;
  assert.equal(provider.jobs.total_count, input.qualifyingJobs.length); assert.equal(jobs.length, input.qualifyingJobs.length);
  assert.deepEqual(jobs.map(({ id, name, status, conclusion }) => ({ id, name, status, conclusion })).sort((a,b)=>a.id-b.id),
    [...input.qualifyingJobs].sort((a,b)=>a.id-b.id));
  for (const expected of input.qualifyingJobs) {
    assert.equal(expected.status, 'completed');
    if (expected.conclusion !== 'success') {
      assert.equal(input.repository, 'footprintjs/agentfootprint');
      assert.deepEqual({ id: expected.id, name: expected.name, conclusion: expected.conclusion }, input.allowedDocsFailure);
      assert.equal(expected.name, 'docs'); assert.equal(expected.conclusion, 'failure');
    }
  }
  for (const observed of jobs) {
    assert.equal(observed.run_id,run.id); assert.equal(observed.head_sha,input.source.head);
    if (Object.hasOwn(observed,'run_attempt')) assert.equal(observed.run_attempt,run.run_attempt);
  }
}

export function admitArchive(role, input, files, port) {
  const filename = input.archive.filename;
  assert.deepEqual(Object.keys(files).sort(), [filename, 'candidate.json', 'source-package-lock.json', 'source-package.json'].sort());
  const record = port.parseStrictJson(files['candidate.json'], { maxBytes: 8 * 1024 * 1024 });
  assert.equal(record.protocol, input.sourceProtocol);
  assert.deepEqual(record.source, input.source); assert.deepEqual(record.tested, input.tested);
  const manifestBytes = files['source-package.json'], lockBytes = files['source-package-lock.json'];
  assert.equal(hash(manifestBytes), input.source.manifestSha256);
  assert.equal(hash(lockBytes), input.source.lockSha256);
  const manifest = port.parseManifest(manifestBytes);
  const admitted = port.inspectArchive(files[filename], { sourceManifest: manifest,
    version: input.archive.version, archive: archiveProfiles[role],
    ...(role === 'agentfootprint' ? { maxArchiveBytes: 32 * 1024 * 1024,
      maxExpandedBytes: 128 * 1024 * 1024, maxFiles: 20000 } : {}),
  });
  assert.deepEqual(record.archive, { filename, ...admitted });
  for (const key of ['package', 'version', 'sha256', 'shasum', 'integrity', 'bytes']) {
    assert.equal(admitted[key], input.archive[key]);
  }
  assert.equal(admitted.files.length, input.archive.memberCount);
  assert.equal(hash(JSON.stringify(admitted.files)), input.archive.memberCensusSha256);
  return { ...admitted, filename, source: record.source, tested: record.tested, manifest, memberBindings: record.memberBindings ?? null };
}
