/**
 * DETACH — the one law this module enforces: *a reader never holds the object
 * the system is still using*.
 *
 * There are two honest ways to keep that law, and they cost different things:
 *
 *  - **FREEZE** the thing on the way out. No allocation, no copy — but it is a
 *    one-way door: whatever is frozen can never be written again, by anyone.
 *    Use it where the value is genuinely finished (a validated def, the
 *    materialized link graph, a landed commit) — the TRACE and the MAP.
 *  - **COPY** the thing on the way out. Costs an allocation per read, but the
 *    system keeps a writable original. Use it where the system still writes
 *    (a store's own list, a ledger that grows).
 *
 * `deepFreeze` is the first; the copy is a plain spread/clone at the call site.
 *
 * WHAT IT WALKS. Plain objects and arrays only — the shape declarative data
 * actually has. A class instance or a function is left exactly as it was:
 * neither frozen nor recursed into. That is deliberate, not an oversight. A
 * def carries author-supplied functions and (for a built-in analysis) live
 * module objects; freezing those would break code that legitimately writes to
 * its own instance fields, and this module must never be the reason a
 * dashboard stops working. The consequence is stated plainly so nobody has to
 * guess: fields hanging off a class instance inside a frozen graph are NOT
 * protected. Every field of every plain object is.
 *
 * THE FROZEN ⇒ DEEPLY-FROZEN ASSUMPTION. `deepFreeze` stops at an already
 * frozen object, which makes re-freezing a mostly-frozen graph cheap (the link
 * graph is re-derived on nearly every read). The short-circuit is only sound
 * where a plain object with plain children has not been frozen SHALLOWLY
 * somewhere else first — such an object would be walked no further, and its
 * children would silently stay writable.
 *
 * Two shallow `Object.freeze` calls in this repo do have plain children, and
 * neither is reachable from anything this function walks:
 *
 *  - `def.data` and each table declaration under it (buildDashboard's
 *    `freezeDefinition`). That one is DELIBERATE and load-bearing: the stop is
 *    exactly what keeps an author's bulk `rows` writable. Everything else under
 *    a table declaration is deep-frozen by hand first, so nothing is missed.
 *  - `CHART_REQUIREMENTS` (src/encoding/requirements.ts), a module-level
 *    validation table. Nothing copies a reference to it into a fold result, so
 *    it is never on a path this function takes; and being a module constant
 *    nobody writes to it anyway.
 *
 * Every other shallow freeze in the repo is on a flat record — a gap row, a
 * ref event, a bookmark view, a channel→field map — where shallow and deep are
 * the same thing. If you add a shallow `Object.freeze` to a nested plain
 * object, add it to this list or use `deepFreeze` instead.
 */

/** True for the two shapes we recurse into: plain objects (or null-prototype ones) and arrays. */
function isPlainContainer(value: unknown): value is Record<PropertyKey, unknown> {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return true;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

/**
 * Freeze `value` and every plain object/array reachable from it, and return it.
 * Idempotent, cycle-safe (a frozen node is never re-entered), and a no-op on
 * primitives, functions and class instances.
 */
export function deepFreeze<T>(value: T): T {
  if (!isPlainContainer(value)) return value;
  if (Object.isFrozen(value)) return value; // already done — and, by this module's law, done deeply
  Object.freeze(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key]);
  return value;
}
