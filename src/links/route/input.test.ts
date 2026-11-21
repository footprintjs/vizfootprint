import { describe, expect, it } from 'vitest';
import { routeIntent } from '../route.js';
import type { RoutePort, RoutePolicy } from './types.js';
import { decision, invoke, nodes, port, scores, unmatched } from './route.fixture.js';

describe('routing input boundary', () => {
  it.each([undefined, null])('requires the port (%s), including an empty graph', async value => {
    await expect(invoke(value, [])).rejects.toThrow(/routing port/);
  });
  it.each([undefined, null])('requires a scorer (%s)', async scorer => {
    await expect(invoke({ ...port(), scorer })).rejects.toThrow(/scorer/);
  });
  it.each([{ name: 1, score: scores }, { name: 'x', score: null }])('requires scorer metadata and its method', async scorer => {
    await expect(invoke({ ...port(), scorer })).rejects.toThrow(/scorer/);
  });
  it('requires the decision function', async () => {
    await expect(invoke({ ...port(), decide: undefined })).rejects.toThrow(/decide/);
  });
  it.each([undefined, null])('requires a declared policy (%s)', async policy => {
    await expect(invoke({ ...port(), policy })).rejects.toThrow(/policy/);
  });
  it.each([{ nearTieMargin: 'x', menuSize: 3 }, { nearTieMargin: 0.15, menuSize: 'x' }, { nearTieMargin: 0.15, menuSize: 3, floor: 'x' }])('refuses malformed declared policy', async policy => {
    await expect(invoke({ ...port(), policy })).rejects.toThrow(/policy/);
  });
  it('records declared policy and explicit overrides without supplying defaults', async () => {
    const p = port();
    const plain = await routeIntent('alpha', nodes(), p);
    expect(plain.policy).toEqual(p.policy);
    const overridden = await routeIntent('alpha', nodes(), p, { policy: { floor: 0, nearTieMargin: 0.6, menuSize: 8 } });
    expect(overridden.policy).toEqual({ floor: 0, nearTieMargin: 0.6, menuSize: 8 });
    const cleared = await routeIntent('alpha', nodes(), { ...p, policy: { ...p.policy, floor: 1 } }, { policy: { floor: undefined } });
    expect(cleared.policy).toEqual({ nearTieMargin: 0.15, menuSize: 3, floor: undefined });
  });
  it('does not read ignored input fields', async () => {
    const p = port();
    Object.defineProperty(p.policy, 'hidden', { enumerable: true, get() { throw Error('hidden policy'); } });
    const input = nodes();
    Object.defineProperty(input[0], 'hidden', { enumerable: true, get() { throw Error('hidden node'); } });
    const answer = await routeIntent('alpha', input, p);
    expect(answer.verdict.kind).toBe('move');
    expect(answer.policy).toEqual({ nearTieMargin: 0.15, menuSize: 3 });
    expect(answer.nodes[0]).not.toHaveProperty('hidden');
  });
  it('captures getters once and preserves callback receivers', async () => {
    const calls = { scorer: 0, name: 0, score: 0, decide: 0, policy: 0, margin: 0, size: 0, floor: 0 };
    const scorer = { token: 'receiver', get name() { calls.name++; return 'captured'; }, get score() {
      calls.score++;
      return function (this: { token: string }) { expect(this.token).toBe('receiver'); return scores(); };
    } };
    const policy: RoutePolicy = { get nearTieMargin() { calls.margin++; return 0.15; }, get menuSize() { calls.size++; return 3; }, get floor() { calls.floor++; return 0; } };
    const p: RoutePort & { token: string } = { token: 'decision-receiver', get scorer() { calls.scorer++; return scorer; }, get policy() { calls.policy++; return policy; }, get decide() {
      calls.decide++;
      return function (this: { token: string }) { expect(this.token).toBe('decision-receiver'); return decision(); };
    } };
    const answer = await routeIntent('alpha', nodes(), p);
    expect(answer.scorer).toBe('captured');
    expect(calls).toEqual({ scorer: 1, name: 1, score: 1, decide: 1, policy: 1, margin: 1, size: 1, floor: 1 });
  });
  it('empty nodes call neither callback', async () => {
    const p = port();
    p.scorer.score = () => { throw Error('score called'); };
    p.decide = () => { throw Error('decision called'); };
    expect((await routeIntent('alpha', [], p)).verdict).toEqual(unmatched);
  });
  it('does not hide a configuration getter failure or retry it', async () => {
    const error = Error('configuration getter'); let reads = 0;
    const p = port(); Object.defineProperty(p, 'scorer', { get() { reads++; throw error; } });
    await expect(routeIntent('alpha', nodes(), p)).rejects.toBe(error);
    expect(reads).toBe(1);
  });
  it('preserves a captured inherited floor and an explicit override that clears it', async () => {
    const policy = Object.assign(Object.create({ floor: 1 }) as { floor: number; nearTieMargin: number; menuSize: number }, { nearTieMargin: 0.2, menuSize: 4 });
    const p = port(); Reflect.set(p, 'policy', policy);
    expect((await routeIntent('alpha', nodes(), p)).policy).toEqual({ nearTieMargin: 0.2, menuSize: 4, floor: 1 });
    expect((await routeIntent('alpha', nodes(), p, { policy: { floor: undefined } })).policy).toEqual({ nearTieMargin: 0.2, menuSize: 4, floor: undefined });
  });
  it('calls the captured functions without reading their extra bind properties', async () => {
    const p = port();
    p.scorer.score = () => scores(); p.decide = rows => decision(rows);
    Object.defineProperty(p.scorer.score, 'bind', { get() { throw Error('foreign bind'); } });
    Object.defineProperty(p.decide, 'bind', { get() { throw Error('foreign bind'); } });
    const input = nodes(); Reflect.set(input[0]!, 'examples', undefined);
    const answer = await routeIntent('alpha', input, p);
    expect(answer.verdict.kind).toBe('move');
    expect(answer.nodes[0]).toHaveProperty('examples', undefined);
  });
});
