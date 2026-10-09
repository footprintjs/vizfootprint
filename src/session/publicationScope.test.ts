import { expect, it, vi } from 'vitest';
import { CauseSelectionSession } from '../log/index.js';
import { PublicationScope } from './publicationScope.js';

const cause = { requestedBy: 'user', computedBy: 'user' } as const;
const input = { id: 's1', parent: null, viewId: 'bar', actorMeta: { actor: 'user' as const }, kind: 'point' as const, field: 'category', value: 'Formal', cause };

it('keeps sync doors synchronous, closes once, and cannot land after closure', () => {
  const log = new CauseSelectionSession();
  const publication = new PublicationScope(log);
  const seen: unknown[] = [];
  log.port.listen(() => seen.push(log.records.at(-1)!.id));
  const answer = publication.run(() => { publication.commit(input); return 42; }, [], vi.fn());
  expect(answer).toBe(42);
  expect(seen).toEqual(['s1']);
  publication.release();
  expect(seen).toEqual(['s1']);
  expect(() => publication.commit({ ...input, id: 's2' })).toThrow('closed publication scope');
});

it('an empty invocation never asks the log to publish', () => {
  const log = new CauseSelectionSession();
  const publish = vi.spyOn(log, 'publish');
  expect(new PublicationScope(log).run(() => 42, [], vi.fn())).toBe(42);
  expect(publish).not.toHaveBeenCalled();
});

it.each([undefined, null, 0, 'failure', new Error('failure')])('preserves primary thrown value %j even if every cleanup channel fails', (primary) => {
  const log = new CauseSelectionSession();
  const publication = new PublicationScope(log);
  let attempted = 0;
  const cleanup = new Error('cleanup');
  log.port.listen(() => { attempted++; throw cleanup; });
  let caught = false;
  let error: unknown;
  try {
    publication.run(() => { publication.commit(input); throw primary; }, [() => { attempted++; throw cleanup; }, () => { attempted++; }], () => { throw new Error('broken reporter'); });
  } catch (failure) { caught = true; error = failure; }
  expect(caught).toBe(true);
  expect(error).toBe(primary);
  expect(attempted).toBe(3);
});

it('without a primary error, finalization attempts everything and throws its first error', () => {
  const log = new CauseSelectionSession();
  const publication = new PublicationScope(log);
  const first = new Error('first');
  const second = new Error('second');
  let attempted = 0;
  log.port.listen(() => { attempted++; throw second; });
  expect(() => publication.run(() => { publication.commit(input); }, [() => { attempted++; throw first; }, () => { attempted++; throw second; }], vi.fn())).toThrow(first);
  expect(attempted).toBe(3);
});

it('the async finally preserves the original rejection and releases only its own pending records', async () => {
  const log = new CauseSelectionSession();
  const pending = new PublicationScope(log);
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  const seen: unknown[] = [];
  log.port.listen(() => seen.push(log.port.clauses()[0]!.value));
  const primary = new Error('original');
  const result = pending.run(async () => { pending.commit(input); await gate; throw primary; }, [() => { throw new Error('restore failed'); }], vi.fn());
  const rejection = result.catch((error: unknown) => error);
  const other = new PublicationScope(log);
  other.run(() => other.commit({ ...input, id: 's2', parent: 's1', value: 'Party' }), [], vi.fn());
  expect(seen).toEqual(['Party']);
  finish();
  expect(await rejection).toBe(primary);
  expect(seen).toEqual(['Party', 'Formal']);
});

it('async success is finalized before its answer resolves', async () => {
  const log = new CauseSelectionSession();
  const publication = new PublicationScope(log);
  let notifications = 0;
  log.port.listen(() => { notifications++; });
  expect(await publication.run(async () => { publication.commit(input); return 42; }, [], vi.fn())).toBe(42);
  expect(notifications).toBe(1);
});

it('a post-land Promise classification or then-registration error cannot bypass finalization', () => {
  for (const result of [
    new Proxy({}, { getPrototypeOf() { throw new Error('classification'); } }),
    new Proxy(Promise.resolve(42), { get(target, key, receiver) { if (key === 'then') throw new Error('registration'); return Reflect.get(target, key, receiver); } }),
  ]) {
    const log = new CauseSelectionSession();
    const publication = new PublicationScope(log);
    let notifications = 0;
    log.port.listen(() => { notifications++; });
    expect(() => publication.run(() => { publication.commit(input); return result; }, [], vi.fn())).toThrow();
    expect(notifications).toBe(1);
  }
});

it('queued reentrant effects own their error drain and never swallow a delayed mounted error', () => {
  const log = new CauseSelectionSession();
  const parent = new PublicationScope(log);
  const child = new PublicationScope(log);
  const first = new Error('mounted first');
  const second = new Error('mounted second');
  const seen: string[] = [];
  let entered = false;
  log.port.listen(() => {
    if (entered) return;
    entered = true;
    child.run(() => {
      child.commit({ ...input, id: 's2', parent: 's1', value: 'Party' }, () => { seen.push('first'); throw first; });
      child.commit({ ...input, id: 's3', parent: 's2', value: 'Casual' }, () => { seen.push('second'); throw second; });
    }, [], vi.fn());
  });
  expect(() => parent.run(() => parent.commit(input), [], vi.fn())).toThrow(first);
  expect(seen).toEqual(['first', 'second']);
  child.release();
  expect(seen).toEqual(['first', 'second']);
});
