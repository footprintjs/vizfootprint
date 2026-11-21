/** Copy at the observer boundary; project must return an owned plain value. */
export function captureDelivery<T>(result: unknown, project: (value: unknown) => T): T | Promise<T> {
  const then = (result as { then?: unknown } | null | undefined)?.then;
  if (typeof then !== 'function') return project(result);
  // Copy before resolving our promise: the platform never assimilates the
  // foreign value or reads its then/getters a second time.
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const accept = (value: unknown) => {
      if (settled) return;
      settled = true;
      try { resolve(project(value)); } catch (error) { reject(error); }
    };
    const refuse = (reason: unknown) => {
      if (settled) return;
      settled = true; reject(reason);
    };
    try { Reflect.apply(then, result, [accept, refuse]); } catch (error) { refuse(error); }
  });
}
