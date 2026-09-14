import { compile } from '../../derive/walk.js';
import type { Row } from '../types.js';
import type { Cell } from '../../derive/types.js';
import { profileCell } from './cell.js';
import { ProfileError } from './error.js';
import { profileAwait } from './abort.js';
import { normalizeSchema, positiveLimit, sameSource, textId, validateSelection } from './validate.js';
import type { ProfileEvent, ProfilePlan, ProfileProvider } from './types.js';
import type { ProfileOperation, ProfileReserve, ProfileScanResult, ScanEvent, ScanSetup } from './scan.types.js';

/** Execute one bounded profile over a provider snapshot. No DOM, model, or result store. */
export async function profileScan<T, O extends ProfileOperation>(provider: ProfileProvider, setup: ScanSetup<T, O>): Promise<ProfileScanResult<T>> {
  // The public operation normalizes its plan before any provider or observer is called.
  const { plan, options, operation } = setup;
  // Read caller-owned options once: accessors must not split one operation's references.
  const { operationId, resultRef, signal, onEvent, progressEvery: requestedProgressEvery } = options ?? {};
  textId(operationId, 'operationId'); textId(resultRef, 'resultRef');
  const progressEvery = requestedProgressEvery ?? 10_000;
  positiveLimit(progressEvery, 'progressEvery', 100_000);
  if (onEvent !== undefined && typeof onEvent !== 'function') throw new ProfileError('INVALID_PROFILE', 'onEvent must be a function');
  if (!provider || typeof provider.describe !== 'function' || typeof provider.scan !== 'function') throw new ProfileError('INVALID_PROFILE', 'A profile provider is required');
  const started = performance.now();
  let scanned = 0, selected = 0, predicateUnknown = 0, observerFailures = 0;
  const elapsed = () => Math.max(0, performance.now() - started);
  const emit = (status: ProfileEvent['status'], error?: ProfileEvent['error']) => {
    const event: ScanEvent<O> = Object.freeze({ operationId, operation, source: plan.source,
      selectionRef: plan.selectionRef, status, scanned, selected, elapsedMs: elapsed(),
      ...(status === 'completed' ? { resultRef } : {}), ...(error ? { error: Object.freeze(error) } : {}),
    });
    try {
      const returned: unknown = onEvent?.(event);
      if (returned !== null && (typeof returned === 'object' || typeof returned === 'function')
        && typeof (returned as PromiseLike<unknown>).then === 'function') {
        observerFailures++;
        void Promise.resolve(returned).catch(() => undefined);
      }
    } catch { observerFailures++; }
  };
  const abort = () => {
    if (signal?.aborted) throw new ProfileError('CANCELLED', 'Profile was cancelled');
  };
  emit('started');
  try {
    abort();
    const schema = normalizeSchema(await profileAwait(provider.describe(plan.source, signal), signal));
    abort(); sameSource(schema.source, plan.source);
    const predicateReads = validateSelection(plan, schema);
    const columns = new Map(schema.columns.map(column => [column.name, column]));
    const test = plan.where ? compile(plan.where) : undefined;
    const limits = plan.limits as Required<NonNullable<ProfilePlan['limits']>>;
    let retainedValues = 0, retainedCharacters = 0;
    const reserve: ProfileReserve = (_kind, value) => {
      retainedValues++;
      if (typeof value === 'string') retainedCharacters += value.length;
      if (retainedValues > limits.maxRetainedValues || retainedCharacters > limits.maxRetainedCharacters) {
        throw new ProfileError('PROFILE_LIMIT', 'Profile exceeds the combined retention budget; no complete result is available');
      }
    };
    const consumer = setup.create(schema, reserve, resultRef);
    const projection = Object.freeze([...new Set([...predicateReads, ...plan.fields.map(field => field.field), ...consumer.reads])]);
    const stream = provider.scan(plan.source, projection, signal) as Partial<Iterable<Row> & AsyncIterable<Row>>;
    const iterator = stream?.[Symbol.asyncIterator]?.() ?? stream?.[Symbol.iterator]?.();
    if (!iterator || typeof iterator.next !== 'function') throw new ProfileError('PROVIDER_FAILURE', 'Provider scan must return an iterable');
    let exhausted = false;
    try {
      while (true) {
        const step = await profileAwait(iterator.next(), signal);
        if (step.done) { exhausted = true; break; }
        const row = step.value;
        abort();
        if (scanned === limits.maxScannedRows) throw new ProfileError('PROFILE_LIMIT', 'Profile exceeds maxScannedRows; no complete result is available');
        scanned++;
        if (row === null || typeof row !== 'object' || Array.isArray(row)) throw new ProfileError('INVALID_VALUE', 'Provider must yield row objects');
        const cells = new Map<string, Cell>();
        const read = (field: string): Cell => {
          if (cells.has(field)) return cells.get(field)!;
          const descriptor = Object.getOwnPropertyDescriptor(row, field);
          if (descriptor && !('value' in descriptor)) throw new ProfileError('INVALID_VALUE', `Row accessors are unsupported: ${field}`);
          const cell = profileCell(descriptor?.value, columns.get(field)!);
          cells.set(field, cell);
          return cell;
        };
        // Validate declared dependencies even if an expression takes a lazy branch.
        for (const field of predicateReads) read(field);
        const passes = test ? test(read) : true;
        consumer.visit?.(read);
        if (passes === null) predicateUnknown++;
        if (passes === true) {
          consumer.push(read);
          selected++;
        }
        if (scanned % progressEvery === 0) {
          emit('progress');
          // Let abort timers and other host work run for synchronous row iterators too.
          await new Promise<void>(resolve => setTimeout(resolve, 0));
          abort();
        }
      }
    } finally {
      if (!exhausted && iterator.return) {
        // Preserve the primary failure. A provider ignoring abort may finish cleanup later;
        // waiting for that pending I/O must not prevent the job from reporting cancellation.
        try { await profileAwait(iterator.return(), signal); } catch { /* Primary failure is reported below. */ }
      }
    }
    abort();
    const value = await profileAwait(consumer.finish(), signal);
    abort();
    const result: ProfileScanResult<T> = {
      resultRef, operationId, schema,
      population: { scanned, selected, excluded: scanned - selected, predicateUnknown }, value,
      execution: { strategy: 'stream', passes: 1, exact: true, retainedValues, retainedCharacters, observerFailures, elapsedMs: elapsed() },
      conventions: { missing: 'null-or-undefined', invalid: 'refuse', predicate: 'only-true', statisticsPopulation: 'known-selected-values' },
    };
    setup.validateResult?.(result);
    emit('completed');
    return { ...result, execution: { ...result.execution, observerFailures } };
  } catch (cause) {
    const error = signal?.aborted ? new ProfileError('CANCELLED', 'Profile was cancelled')
      : cause instanceof ProfileError ? cause : new ProfileError('PROVIDER_FAILURE', 'Profile provider failed; no complete result is available');
    emit(error.code === 'CANCELLED' ? 'cancelled' : 'failed', { code: error.code, message: error.message });
    throw error;
  }
}
