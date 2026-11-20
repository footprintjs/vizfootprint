import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { routeIntent } from '../route.js';
import type { RouteDecision } from './types.js';
import { decision, nodes, port, unmatched } from './route.fixture.js';

describe('routing decision delivery', () => {
  it.each(['sync', 'fulfilled', 'deferred'] as const)('captures owned evidence on %s delivery', async delivery => {
    const p = port(); const input = nodes(); const raw = decision();
    let kindReads = 0;
    Object.defineProperty(raw, 'kind', { get() { kindReads++; return 'move'; } });
    let release!: (value: RouteDecision) => void;
    p.decide = () => {
      if (delivery === 'sync') {
        queueMicrotask(() => { Reflect.set(raw.ranked[0]!, 'score', 99); });
        return raw;
      }
      return delivery === 'fulfilled' ? Promise.resolve(raw) : new Promise(resolve => { release = resolve; });
    };
    const pending = routeIntent('alpha', input, p);
    Reflect.set(input[0]!, 'does', 'foreign');
    Reflect.set(p, 'policy', { nearTieMargin: 9, menuSize: 99 });
    Reflect.set(p.scorer, 'name', 'changed');
    p.decide = () => { throw Error('replaced callback'); };
    if (delivery === 'deferred') release(raw);
    const answer = await pending;
    Reflect.set(raw.ranked[0]!, 'score', 77);
    expect(answer.verdict).toEqual(decision());
    expect(answer.nodes[0]!.does).toBe('alpha');
    expect(answer.policy).toEqual({ nearTieMargin: 0.15, menuSize: 3 });
    expect(answer.scorer).toBe('fixture');
    expect(kindReads).toBe(1);
  });
  it('captures a then method once, preserves its receiver and admits only its first settlement', async () => {
    let thenReads = 0; let kindReads = 0;
    const first = decision();
    Object.defineProperty(first, 'kind', { get() { kindReads++; return 'move'; } });
    Object.defineProperty(first, 'then', { get() { throw Error('delivered then must not be read'); } });
    const foreign = { get then() {
      thenReads++;
      return function (this: unknown, resolve: (value: RouteDecision) => void, reject: (reason: Error) => void) {
        expect(this).toBe(foreign);
        resolve(first);
        Reflect.set(first.ranked[0]!, 'score', 88);
        resolve({ ...decision(), kind: 'unmatched' }); reject(Error('late rejection'));
        throw Error('late throw');
      };
    } };
    const p = port(); p.decide = () => foreign as unknown as PromiseLike<RouteDecision>;
    const answer = await routeIntent('alpha', nodes(), p);
    expect(answer.verdict).toEqual(decision());
    Reflect.set(first.ranked[0]!, 'score', 99);
    expect(answer.verdict).toEqual(decision());
    expect(thenReads).toBe(1); expect(kindReads).toBe(1);
  });
  it('never reads a delivered value after an earlier rejection or throw', async () => {
    const p = port(); let deliveries = 0;
    const value = { get kind() { deliveries++; throw Error('late value'); } };
    for (const fail of ['reject', 'throw'] as const) {
      let release!: () => void;
      p.decide = () => ({ then(_resolve: unknown, reject: (reason: Error) => void) {
        release = () => Reflect.apply(_resolve as (...args: unknown[]) => unknown, undefined, [value]);
        if (fail === 'throw') throw Error('first throw');
        reject(Error('first rejection'));
      } }) as unknown as PromiseLike<RouteDecision>;
      expect((await routeIntent('alpha', nodes(), p)).verdict).toEqual(unmatched);
      release();
    }
    expect(deliveries).toBe(0);
  });
  it.each(['rejected', 'throwing-then', 'throwing-getter', 'malformed'] as const)('contains %s delivery', async failure => {
    const p = port();
    p.decide = () => {
      if (failure === 'rejected') return Promise.reject(Error('decision rejection'));
      if (failure === 'malformed') return Promise.resolve(null as unknown as RouteDecision);
      return { get then() {
        if (failure === 'throwing-getter') throw Error('then getter');
        return () => { throw Error('then call'); };
      } } as unknown as PromiseLike<RouteDecision>;
    };
    expect((await routeIntent('alpha', nodes(), p)).verdict).toEqual(unmatched);
  });
  it('treats a non-callable then as ordinary data and never accepts a getter second answer', async () => {
    const p = port(); p.decide = () => ({ ...decision(), then: 7 });
    expect((await routeIntent('alpha', nodes(), p)).verdict).toEqual(decision());
    let reads = 0;
    const raw = { ...decision(), get kind() { reads++; return reads === 1 ? 'invented' : 'move'; } };
    p.decide = () => raw as RouteDecision;
    expect((await routeIntent('alpha', nodes(), p)).verdict).toEqual(unmatched);
    expect(reads).toBe(1);
  });
  it('observes a promise even when it carries synchronous-looking decision fields', async () => {
    const p = port();
    p.decide = () => Object.assign(Promise.reject(Error('hybrid rejection')), decision());
    expect((await routeIntent('alpha', nodes(), p)).verdict).toEqual(unmatched);
    const fulfilled = Promise.resolve(decision());
    Object.defineProperty(fulfilled, 'kind', { get() { throw Error('promise is not the delivered decision'); } });
    p.decide = () => fulfilled;
    expect((await routeIntent('alpha', nodes(), p)).verdict).toEqual(decision());
  });
  it('observes cancellation delivered by a pending decision once', async () => {
    const p = port(); const controller = new AbortController(); let calls = 0;
    let reject!: (reason: unknown) => void;
    p.decide = () => { calls++; return new Promise((_resolve, fail) => { reject = fail; }); };
    const pending = routeIntent('alpha', nodes(), p, { signal: controller.signal });
    controller.abort(); reject(controller.signal.reason);
    expect((await pending).verdict).toEqual(unmatched);
    expect(calls).toBe(1);
  });
  it('contains rejected decisions without an unhandled rejection in a strict process', () => {
    const built = buildSync({ entryPoints: [fileURLToPath(new URL('../route.ts', import.meta.url))],
      bundle: true, platform: 'node', format: 'esm', write: false });
    const program = built.outputFiles[0]!.text + `
      import assert from 'node:assert/strict';
      const rows = [{id:'a',score:1}];
      const answer = await routeIntent('alpha', [{id:'a',viewId:'a',does:'alpha',kinds:['point']}], {
        scorer:{name:'isolated',score:()=>rows}, policy:{nearTieMargin:0.1,menuSize:1},
        decide:()=>Promise.reject(Error('foreign decision rejection'))
      });
      assert.equal(answer.verdict.kind,'unmatched');
      console.log('rejection observed');
    `;
    const run = spawnSync(process.execPath, ['--unhandled-rejections=strict', '--input-type=module'], { input: program, encoding: 'utf8' });
    expect(run.error).toBeUndefined();
    expect(run.signal).toBeNull();
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('rejection observed');
  });
});

