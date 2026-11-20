import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// An observation of real installers, not a merge gate or a replacement manifest.
const root = process.cwd();
const out = join(process.env.RUNNER_TEMP, 'viz-agent-peer');
mkdirSync(out, { recursive: true });
const env = { ...process.env, npm_config_fetch_retries: '0', NPM_CONFIG_FETCH_RETRIES: '0' };
const results = [];
function run(command, args, cwd, label) {
  const r = spawnSync(command, args, { cwd, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  writeFileSync(join(out, `${label}.stdout.log`), r.stdout ?? '');
  writeFileSync(join(out, `${label}.stderr.log`), r.stderr ?? '');
  if (r.error) throw r.error; // A failed transport is not an installer verdict.
  return r;
}
const pack = run('npm', ['pack', '--ignore-scripts', '--json', '--workspaces=false', '--pack-destination', out], root, 'pack');
if (pack.status !== 0) throw Error('Actual package could not be packed; see pack logs');
const [report] = JSON.parse(pack.stdout);
const archive = join(out, report.filename);
const manifest = readFileSync(join(root, 'package.json'));
const source = {
  head: process.env.SOURCE_HEAD,
  run: process.env.GITHUB_RUN_ID,
  attempt: process.env.GITHUB_RUN_ATTEMPT,
  node: process.version,
  agentfootprint: '16.0.0',
  engine: '14.0.0',
  peer: JSON.parse(manifest).peerDependencies.agentfootprint,
  manifestSha256: createHash('sha256').update(manifest).digest('hex'),
  packSha256: createHash('sha256').update(readFileSync(archive)).digest('hex'),
  results,
};
const cases = [
  ['npm-default', 'npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund']],
  ['npm-strict', 'npm', ['install', '--strict-peer-deps', '--ignore-scripts', '--no-audit', '--no-fund']],
  ['pnpm-default', resolve(process.env.PNPM_BINARY), ['install', '--ignore-scripts']],
];
for (const [label, command, args] of cases) {
  const cwd = join(out, label);
  mkdirSync(cwd);
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: `viz-${label}`, version: '0.0.0', private: true,
    dependencies: { vizfootprint: `file:${archive}`, agentfootprint: source.agentfootprint, footprintjs: source.engine } }, null, 2) + '\n');
  // The same empty user config and public registry for every fresh consumer.
  writeFileSync(join(cwd, '.npmrc'), 'registry=https://registry.npmjs.org/\nfetch-retries=0\n');
  const version = run(command, ['--version'], cwd, `${label}-version`);
  if (version.status !== 0) throw Error(`${label} executable unavailable`);
  const r = run(command, args, cwd, label);
  results.push({ label, version: version.stdout.trim(), args, exit: r.status, signal: r.signal,
    stdout: `${label}.stdout.log`, stderr: `${label}.stderr.log` });
  writeFileSync(join(out, 'results.json'), JSON.stringify(source, null, 2) + '\n');
  console.log(`${label}: exit ${r.status}\n${r.stdout}\n${r.stderr}`);
}
