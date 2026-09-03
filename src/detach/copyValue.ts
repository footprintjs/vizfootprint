/**
 * The COPY half of the detach law (see ./README.md and ./deepFreeze.ts).
 *
 * `deepFreeze` detaches by making a finished thing unwritable. This detaches by
 * handing over different bytes — which is what you need when the value is not
 * yours to freeze. The commit log needs exactly that: a caller passes the value
 * it selected, the log keeps that value in history forever and freezes it, and
 * the caller must be able to go on using its own array afterwards.
 *
 * JSON-shaped through every door, which is what `CommitRecord.value` promises.
 * A value that will not clone (a hand-built one carrying a function or a
 * symbol) is kept as it is rather than thrown on — a log must never refuse a
 * commit because of how a caller spelled its payload.
 */
export function copyValue<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    /* v8 ignore next -- unreachable through the JSON-shaped doors: only a hand-built value with a function or symbol refuses to clone */
    return value;
  }
}
