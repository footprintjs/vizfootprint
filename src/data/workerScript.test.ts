/**
 * THE WORKER SCRIPT HOLDS AN ADDRESS, AND ONLY AN ADDRESS.
 *
 * The browser arm starts DuckDB's worker from one line of script. The worker
 * address used to be pasted between two quote marks, so an address holding a
 * quote mark ended the string and the rest ran as script inside the worker.
 *
 * | the address                                   | the script                                   |
 * |-----------------------------------------------|----------------------------------------------|
 * | an absolute https URL                         | importScripts of exactly that address        |
 * | one holding a quote mark and script           | one string literal; nothing else is a statement |
 * | one holding a line break or a backslash       | one string literal                           |
 * | a relative address                            | refused: it never worked from a blob         |
 * | nothing, or not a string                      | refused                                      |
 */
import { describe, expect, it } from 'vitest';
import { workerScriptFor } from './duckdbConnection.js';

/** Run the script with a recording `importScripts` and say what it loaded and whether anything else ran. */
function run(script: string): { loaded: unknown[]; hijacked: boolean } {
  const loaded: unknown[] = [];
  const scope = { hijacked: false };
  // the script is one this test built from the function under test; the names it may reach are the two handed in
  new Function('importScripts', 'scope', script)((...addresses: unknown[]) => loaded.push(...addresses), scope);
  return { loaded, hijacked: scope.hijacked };
}

describe('workerScriptFor', () => {
  it('an absolute URL is imported as it is', () => {
    const at = 'https://cdn.example/duckdb/duckdb-browser-eh.worker.js';
    expect(workerScriptFor(at)).toBe(`importScripts("${at}");`);
    expect(run(workerScriptFor(at))).toEqual({ loaded: [at], hijacked: false });
  });

  it.each([
    ['a quote mark and script', 'https://cdn.example/w.js");scope.hijacked=true;("'],
    ['a quote mark in the path', 'https://cdn.example/a"b.js'],
    ['a backslash and a quote mark', 'https://cdn.example/w.js\\");scope.hijacked=true;//'],
    ['a line break and script', 'https://cdn.example/w.js?\n");scope.hijacked=true;//'],
    ['a line separator', 'https://cdn.example/w.js? ");scope.hijacked=true;//'],
    ['a closing script tag', 'https://cdn.example/</script><script>scope.hijacked=true</script>'],
    ['a blob address', 'blob:https://app.example/0b0e7a7e-8f0b-4c55-9a55-000000000000'],
  ])('%s: the script is one import of one address, and nothing else runs', (_what, at) => {
    const ran = run(workerScriptFor(at));
    expect(ran.hijacked).toBe(false);
    expect(ran.loaded).toEqual([new URL(at).href]);
  });

  it('what the old pasting did with the same address', () => {
    const at = 'https://cdn.example/w.js");scope.hijacked=true;("';
    expect(run(`importScripts("${at}");`).hijacked).toBe(true);
  });

  it.each([
    ['a relative address', './duckdb-browser-eh.worker.js'],
    ['a bare file name', 'worker.js'],
    ['a protocol-relative address', '//cdn.example/w.js'],
  ])('%s is refused', (_what, at) => {
    expect(() => workerScriptFor(at)).toThrow(/must be an absolute URL/);
  });

  it.each([[undefined], [null], [''], [42], [{ toString: () => 'https://cdn.example/w.js' }]])('%j is refused: the bundle names no worker script', (at) => {
    expect(() => workerScriptFor(at)).toThrow(/names no worker script/);
  });
});
