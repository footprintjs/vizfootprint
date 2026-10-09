import { expect, it } from 'vitest';
import { analysisOutcomeText } from './analysisOutcome.js';

it('distinguishes an invocation refusal, a read refusal and a computed degenerate fit', () => {
  const describe = (n: number) => `no fit over ${n} rows`;
  expect(analysisOutcomeText({ ok: false, reason: 'guard-failed', detail: 'agentCall is malformed' }, describe)).toBe('not run — agentCall is malformed');
  expect(analysisOutcomeText({ ok: false, reason: 'degenerate-fit', fitDegenerate: true, n: 1 }, describe)).toBe('no fit over 1 rows');
  expect(analysisOutcomeText({ ok: false, reason: 'unavailable', rejection: { ok: false, engine: 'memory', operation: 'evaluate', reason: 'unknown-table', detail: 'the table is absent' } }, describe)).toBe('unavailable — the engine refused the read: the table is absent');
  expect(analysisOutcomeText({ ok: false, reason: 'unavailable', rejection: { ok: false, engine: 'memory', operation: 'evaluate', reason: 'unknown-table' } }, describe)).toBe('unavailable — the engine refused the read: unknown-table');
});
