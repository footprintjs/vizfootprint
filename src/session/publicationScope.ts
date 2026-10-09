import type { CauseSelectionSession, CommitInput, CommitRecord } from '../log/index.js';
import type { CauseClause } from '../selection/index.js';

type Landed = { readonly record: CommitRecord; readonly clause: CauseClause };
export interface PublicationFailure { readonly error: unknown }

/** Each drain owns its error state, even when the drain itself was queued. */
function attemptAll(effects: readonly (() => void)[]): void {
  let failed = false;
  let firstError: unknown;
  for (const effect of effects) {
    try { effect(); } catch (error) { if (!failed) { failed = true; firstError = error; } }
  }
  if (failed) throw firstError;
}

/**
 * One semantic invocation owns exactly the records its writer lands. No global
 * slice or ambient scope can absorb another invocation's work across an await.
 * Lower writers receive this explicit capability; the semantic owner runs it.
 */
export class PublicationScope {
  readonly #records: CommitRecord[] = [];
  readonly #effects: (() => void)[] = [];
  #closed = false;

  constructor(private readonly log: CauseSelectionSession) {}

  get hasRecords(): boolean { return this.#records.length > 0; }
  get lastRecord(): CommitRecord | undefined { return this.#records.at(-1); }

  commit(input: CommitInput, afterPublication?: (landed: Landed) => void): Landed {
    if (this.#closed) throw new Error('vizfootprint: a closed publication scope cannot land another record');
    const landed = this.log.commit(input, { deferPublication: true });
    // Ownership precedes every caller's landed/ref/fold callback.
    this.#records.push(landed.record);
    if (afterPublication !== undefined) this.#effects.push(() => afterPublication(landed));
    return landed;
  }

  /** Attempt every finalization task, then publish once, preserving first failure. */
  release(finalizers: readonly (() => void)[] = []): void {
    if (this.#closed) return;
    this.#closed = true; // a throwing callback cannot make this invocation retry
    attemptAll([
      ...finalizers,
      ...(this.hasRecords ? [() => this.log.publish(this.#records, this.#effects.length === 0 ? undefined : () => attemptAll(this.#effects))] : []),
    ]);
  }

  /**
   * Sync doors stay sync; async doors release in their promise's finally path.
   * A primary error may be any thrown value, including undefined or zero.
   */
  run<T>(operation: () => T, finalizers: readonly ((failure: PublicationFailure | undefined) => void)[], reportCleanupFailure: (error: unknown) => void): T {
    const finish = (failure?: PublicationFailure): void => {
      try {
        this.release(finalizers.map((finalizer) => () => finalizer(failure)));
      } catch (cleanupError) {
        if (failure === undefined) throw cleanupError;
        // Reporting cannot replace the exact primary exception either.
        try { reportCleanupFailure(cleanupError); } catch { /* the failure channel itself is broken; retain the primary error */ }
      }
    };
    let result: T;
    try {
      result = operation();
      if (result instanceof Promise) {
        return result.then(
          (value) => { finish(); return value; },
          (error: unknown) => { finish({ error }); throw error; },
        ) as T;
      }
    } catch (error) { finish({ error }); throw error; }
    finish();
    return result;
  }
}
