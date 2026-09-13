import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { chromium, type Browser } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ProfilePlan, ProfileResult, ProfileSchema } from './types.js';
import type { GroupProfilePlan, GroupProfileResult } from './groups.types.js';
import type { ProfileOperationDescriptor, ProfileOperationSummary } from './operations.types.js';
import type { ProfileResultSummary } from './summary.js';

// Like demo/smoke.test.ts and bench/x4/runner.mjs: an explicit local Chrome
// override, otherwise Playwright's matching installed headless shell. No download.
const executablePath = process.env['VZF_CHROME'];
const root = fileURLToPath(new URL('../../../', import.meta.url));
const entry = `
import { profileData, profileGroups, createArrayProfileProvider, listProfileOperations, describeProfileOperation, summarizeProfileResult } from 'vizfootprint/data';
export async function executeProfile({ schema, rows, plan }) {
  const events = [];
  const provider = createArrayProfileProvider(schema, rows);
  const result = await (plan.kind === 'group-profile' ? profileGroups : profileData)(provider, plan, {
    operationId: 'parity:profile', resultRef: 'parity:result', progressEvery: 2,
    onEvent: ({ elapsedMs, ...event }) => events.push(event),
  });
  const { elapsedMs, ...execution } = result.execution;
  const drilldowns = [];
  for (const group of result.groups ?? []) {
    const scoped = await profileData(provider, {
      kind: 'profile', version: 1, ops: plan.ops, source: plan.source,
      selectionRef: 'parity:group-' + group.ref.index, where: group.where,
      fields: plan.fields, quantileMethod: plan.quantileMethod,
    }, { operationId: 'parity:reconstruct-' + group.ref.index, resultRef: 'parity:scoped-' + group.ref.index });
    drilldowns.push({ ref: group.ref, rowCount: scoped.population.selected, fields: scoped.fields });
  }
  return {
    result: { ...result, execution }, events, drilldowns,
    semantics: { catalog: listProfileOperations(), descriptor: describeProfileOperation(schema, plan.kind, schema.columns.map(column => column.name)), summary: summarizeProfileResult(result) },
    runtime: {
      worker: typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope,
      document: typeof document, window: typeof window,
    },
  };
}
if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
  self.onmessage = async ({ data }) => {
    try { self.postMessage({ value: await executeProfile(data) }); }
    catch (error) { self.postMessage({ error: String(error?.message ?? error) }); }
  };
}
`;
const schema: ProfileSchema = {
  source: { id: 'synthetic:requests', version: 'fixture-1' }, table: 'requests', grain: 'one saved request',
  columns: [
    { name: 'client', type: 'string', role: 'identifier', meaning: 'Client identity within this source' },
    { name: 'operation', type: 'string', role: 'dimension', meaning: 'Recorded operation' },
    { name: 'duration', type: 'number', role: 'measure', meaning: 'Known completed duration', unit: 'ms' },
    { name: 'successful', type: 'boolean', role: 'dimension', meaning: 'Observed success, when known' },
  ],
};
const rows = [
  { client: 'client-a', operation: 'read', duration: 0, successful: true },
  { client: 'client-a', operation: 'read', duration: 10, successful: true },
  { client: 'client-b', operation: 'read', duration: null, successful: false },
  { client: null, operation: 'read', successful: null },
  { client: 'client-b', operation: 'write', duration: 100, successful: true },
  { operation: null, duration: 8, successful: true },
];
type Answer = {
  result: (Omit<ProfileResult, 'execution'> | Omit<GroupProfileResult, 'execution'>) & { execution: Omit<ProfileResult['execution'], 'elapsedMs'> };
  events: { status: string; scanned: number; selected: number; resultRef?: string }[];
  drilldowns: { ref: { resultRef: string; index: number }; rowCount: number; fields: ProfileResult['fields'] }[];
  semantics: { catalog: readonly ProfileOperationSummary[]; descriptor: ProfileOperationDescriptor; summary: ProfileResultSummary };
  runtime: { worker: boolean; document: string; window: string };
};

describe('profile public API in Node and a real browser Worker', () => {
  let browser: Browser | undefined;
  let directory: string | undefined;
  let bundle: string;
  let bundleFile: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'viz-profile-worker-'));
    const built = await build({
      absWorkingDir: root,
      stdin: { contents: entry, resolveDir: root, sourcefile: 'profile-worker-entry.mjs', loader: 'js' },
      bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2022', treeShaking: true,
      // The broad public data barrel declares optional peers; the profile
      // bundle must tree-shake them away. A retained import fails in the Worker.
      external: ['node:*', '@duckdb/*', '@modelcontextprotocol/*', '@uwdata/*', 'footprintjs', 'agentfootprint', 'react', 'react-dom'],
    });
    bundle = built.outputFiles[0]!.text;
    bundleFile = join(directory, 'profile-worker.mjs');
    await writeFile(bundleFile, bundle);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  });
  afterAll(async () => {
    try { await browser?.close(); }
    finally { if (directory) await rm(directory, { recursive: true, force: true }); }
  });

  it('has matching selected coverage, values and events in both hosts', async () => {
    for (const testcase of [
      { quantileMethod: 'nearest-rank' }, { quantileMethod: 'linear' },
      { quantileMethod: 'nearest-rank', unknownKeys: 'include' },
      { quantileMethod: 'nearest-rank', unknownKeys: 'exclude' },
    ] as const) {
      const { quantileMethod } = testcase;
      const unknownKeys = 'unknownKeys' in testcase ? testcase.unknownKeys : undefined;
      const basePlan: ProfilePlan = {
        kind: 'profile', version: 1, ops: 1, source: schema.source, selectionRef: 'synthetic:reads',
        where: { op: 'eq', args: [{ col: 'operation' }, { lit: 'read' }] },
        fields: [
          { field: 'duration', statistics: ['sum', 'min', 'max', 'mean', 'median', 'p95'] },
          { field: 'operation', frequencies: true },
          { field: 'successful', frequencies: true },
        ], quantileMethod,
      };
      const plan: ProfilePlan | GroupProfilePlan = unknownKeys
        ? { ...basePlan, kind: 'group-profile', groupBy: ['client', 'operation'], unknownKeys }
        : basePlan;
      const packet = { schema, rows, plan };
      const nodeCode = `import { executeProfile } from ${JSON.stringify(pathToFileURL(bundleFile).href)};
        let input = ''; for await (const chunk of process.stdin) input += chunk;
        console.log(JSON.stringify(await executeProfile(JSON.parse(input))));`;
      const node: Answer = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', nodeCode], {
        cwd: directory, encoding: 'utf8', input: JSON.stringify(packet), timeout: 10_000,
      }));
      const page = await browser!.newPage();
      try {
        // An intercepted empty document gives the module Worker a stable origin.
        // Nothing reaches the network: no HTTP server, app, UI or source download.
        await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Profile worker fixture</title>' }));
        await page.goto('https://profile-fixture.test/');
        const worker: Answer = await page.evaluate(async ({ source, packet }) => {
          const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
          const worker = new Worker(url, { type: 'module' });
          try {
            return await new Promise<Answer>((resolve, reject) => {
              worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data.value);
              worker.onerror = (error) => reject(new Error(error.message));
              worker.postMessage(packet);
            });
          } finally { worker.terminate(); URL.revokeObjectURL(url); }
        }, { source: bundle, packet });
        expect(node.runtime).toEqual({ worker: false, document: 'undefined', window: 'undefined' });
        expect(worker.runtime).toEqual({ worker: true, document: 'undefined', window: 'undefined' });
        expect(worker.result).toEqual(node.result);
        expect(worker.events).toEqual(node.events);
        expect(worker.drilldowns).toEqual(node.drilldowns);
        expect(worker.semantics).toEqual(node.semantics);
        expect(worker.semantics.descriptor.ui.inputGrain).toBe(schema.grain);
        expect(worker.semantics.summary.fieldDefinitions[0]).toMatchObject({ name: 'duration', unit: 'ms' });
        expect(worker.semantics.summary.resultRef).toBe('parity:result');
        if (worker.result.kind === 'profile') {
          expect(worker.result.population).toEqual({ scanned: 6, selected: 4, excluded: 2, predicateUnknown: 1 });
          expect(worker.result.fields[0]).toMatchObject({
            field: 'duration', unit: 'ms', known: 2, unknown: 2,
            statistics: { sum: 10, min: 0, max: 10, mean: 5, median: quantileMethod === 'linear' ? 5 : 0, p95: quantileMethod === 'linear' ? 9.5 : 10 },
          });
          expect(worker.result.fields[2]).toMatchObject({ known: 3, unknown: 1, frequencies: [{ value: false, count: 1 }, { value: true, count: 2 }] });
        } else {
          expect(worker.result.population).toEqual({
            scanned: 6, selected: 4, excluded: 2, predicateUnknown: 1,
            grouped: unknownKeys === 'include' ? 4 : 3, withUnknownKeys: 1, excludedUnknownKeys: unknownKeys === 'include' ? 0 : 1,
          });
          expect(worker.result.groupOrder).toBe('first-seen');
          expect(worker.result.grain).toEqual({ kind: 'group', groupBy: ['client', 'operation'], sourceGrain: schema.grain });
          expect(worker.result.groups.map(group => group.keys)).toEqual([
            { client: 'client-a', operation: 'read' }, { client: 'client-b', operation: 'read' },
            ...(unknownKeys === 'include' ? [{ client: null, operation: 'read' }] : []),
          ]);
          expect(worker.result.groups[0]!.fields[0]).toMatchObject({ known: 2, unknown: 0, statistics: { mean: 5, p95: 10 } });
          expect(worker.result.groups[1]!.fields[0]).toMatchObject({ known: 0, unknown: 1, statistics: { mean: null, p95: null } });
          for (const [index, group] of worker.result.groups.entries()) {
            expect(group.ref).toEqual({ resultRef: 'parity:result', index });
            expect(worker.drilldowns[index]).toEqual({ ref: group.ref, rowCount: group.rowCount, fields: group.fields });
          }
        }
        expect(worker.events.map(event => event.status)).toEqual(['started', 'progress', 'progress', 'progress', 'completed']);
        expect(worker.events.at(-1)).toMatchObject({ scanned: 6, selected: 4, resultRef: 'parity:result' });
      } finally { await page.close(); }
    }
  });
});
