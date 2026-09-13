import { ProfileError } from './error.js';

/** Stop waiting for an uncooperative provider. Consume its eventual resolution/rejection;
 * the provider remains responsible for cancelling its underlying I/O and releasing resources. */
export function profileAwait<T>(value: T | PromiseLike<T>, signal?: AbortSignal): Promise<T> {
  const work = Promise.resolve(value);
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', cancel);
    const cancel = () => { cleanup(); reject(new ProfileError('CANCELLED', 'Profile was cancelled')); };
    signal.addEventListener('abort', cancel, { once: true });
    work.then(result => { cleanup(); resolve(result); }, error => { cleanup(); reject(error); });
    if (signal.aborted) cancel();
  });
}
