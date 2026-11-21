import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { routeIntent } from '../route.js';
import { decision, nodes, port, scores, unmatched } from './route.fixture.js';

type Boundary = 'score' | 'decision';
const install = (p: ReturnType<typeof port>, boundary: Boundary, value: unknown) => {
  if (boundary === 'score') p.scorer.score = () => value as ReturnType<typeof p.scorer.score>;
  else p.decide = () => value as ReturnType<typeof p.decide>;
};
const payload = (boundary: Boundary) => boundary === 'score' ? scores() : decision();

describe.each(['score', 'decision'] as const)('%s callback delivery boundary', boundary => {
  it('captures one receiver-bound delivery and ignores later settlements and retained mutations', async () => {
    const p = port(); const raw = payload(boundary);
    const rows = Array.isArray(raw) ? raw : raw.ranked;
    let reads = 0; let thenReads = 0; let value = 1;
    Object.defineProperty(rows[0], 'score', { get() { reads++; return value; } });
    Object.defineProperty(rows, Symbol.iterator, { get() { throw Error('foreign iterator'); } });
    Object.defineProperty(rows, 'map', { get() { throw Error('foreign map'); } });
    Object.defineProperty(raw, 'then', { get() { throw Error('delivered then'); } });
    const foreign = { get then() {
      thenReads++;
      const method = function (this: unknown, accept: (value: unknown) => void, reject: (reason: unknown) => void) {
        expect(this).toBe(foreign); accept(raw); value = 99;
        accept(null); reject(Error('late rejection')); throw Error('late throw');
      };
      Object.defineProperty(method, 'bind', { get() { throw Error('foreign bind'); } });
      return method;
    } };
    install(p, boundary, foreign);
    const answer = await routeIntent('alpha', nodes(), p);
    expect(answer.verdict).toEqual(decision());
    value = 77;
    expect(answer.verdict).toEqual(decision());
    expect(reads).toBe(1); expect(thenReads).toBe(1);
  });
  it.each(['reject', 'throw'] as const)('ignores later delivered evidence after first %s', async failure => {
    const p = port(); const raw = payload(boundary); let reads = 0;
    if (Array.isArray(raw)) Object.defineProperty(raw[0], 'id', { get() { reads++; throw Error('late row'); } });
    else Object.defineProperty(raw, 'kind', { get() { reads++; throw Error('late verdict'); } });
    let release!: () => void;
    install(p, boundary, { then(accept: (value: unknown) => void, reject: (reason: unknown) => void) {
      release = () => accept(raw);
      if (failure === 'throw') throw Error('first throw');
      reject(Error('first rejection'));
    } });
    expect((await routeIntent('alpha', nodes(), p)).verdict).toEqual(unmatched);
    release();
    expect(reads).toBe(0);
  });
  it.each(['getter', 'method', 'rejected', 'malformed'] as const)('contains a %s failure without taking a second answer', async failure => {
    const p = port(); let reads = 0;
    const raw = failure === 'rejected' ? Promise.reject(Error('callback rejection')) : { get then() {
      reads++;
      if (failure === 'getter') throw Error('then getter');
      return (accept: (value: unknown) => void) => {
        if (failure === 'method') throw Error('then method');
        accept(null); accept(payload(boundary));
      };
    } };
    install(p, boundary, raw);
    expect((await routeIntent('alpha', nodes(), p)).verdict).toEqual(unmatched);
    expect(reads).toBe(failure === 'rejected' ? 0 : 1);
  });
  it('settles a controlled cancellation once and never invents earlier completion', async () => {
    const p = port(); const controller = new AbortController(); let settled = false; let calls = 0;
    let reject!: (reason: unknown) => void;
    const pendingValue = new Promise((_resolve, fail) => { reject = fail; });
    if (boundary === 'score') p.scorer.score = () => { calls++; return pendingValue as ReturnType<typeof p.scorer.score>; };
    else p.decide = () => { calls++; return pendingValue as ReturnType<typeof p.decide>; };
    const pending = routeIntent('alpha', nodes(), p, { signal: controller.signal }).then(answer => { settled = true; return answer; });
    expect(settled).toBe(false);
    controller.abort(); reject(controller.signal.reason);
    expect((await pending).verdict).toEqual(unmatched);
    expect(calls).toBe(1);
  });
  it.each([NaN, Infinity, -Infinity, -0])('retains raw numeric evidence %s across asynchronous delivery', async value => {
    const p = port(); const rows = [{ id: 'a', score: value }, { id: 'b', score: 0 }];
    p.scorer.score = () => rows;
    install(p, boundary, Promise.resolve(boundary === 'score' ? rows : decision(rows)));
    const answer = await routeIntent('alpha', nodes(), p);
    expect(answer.verdict.kind).toBe('move');
    expect(Object.is(answer.verdict.ranked[0]!.score, value)).toBe(true);
  });
});

it('contains rejected score delivery without an unhandled rejection in a strict process', () => {
  const built = buildSync({ entryPoints: [fileURLToPath(new URL('../route.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false });
  const program = built.outputFiles[0]!.text + `
    import assert from 'node:assert/strict';
    const answer = await routeIntent('alpha', [{id:'a',viewId:'a',does:'alpha',kinds:['point']}], {
      scorer:{name:'isolated',score:()=>Promise.reject(Error('foreign scorer rejection'))},
      policy:{nearTieMargin:0.1,menuSize:1}, decide:()=>{throw Error('decision must not run')}
    });
    assert.deepEqual(answer.verdict,{kind:'unmatched',ranked:[],decisive:false});
    console.log('score rejection observed');
  `;
  const run = spawnSync(process.execPath, ['--unhandled-rejections=strict', '--input-type=module'], { input: program, encoding: 'utf8' });
  expect(run.error).toBeUndefined(); expect(run.signal).toBeNull();
  expect(run.status, run.stderr).toBe(0);
  expect(run.stdout).toContain('score rejection observed');
});
