/**
 * notYet.test.ts — A "NOT YET" LIST IS A PROMISE, AND A STALE ONE LIES.
 *
 * `README.md`'s last section says what this folder has not built. Three of its
 * four entries had shipped and the list still named them, which tells a reader
 * to go build what is already under their hand. This test pins the list against
 * the CODE: for each thing, a live proof that it landed, and then the claim that
 * it is outstanding must be gone from the outstanding paragraph — while the
 * section as a whole must still say where it landed, so the record is not simply
 * deleted.
 *
 * The one thing genuinely outstanding is the streaming carrier, and the test
 * requires the paragraph to still name it: a list emptied to pass is drift too.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { deltaByKey } from './index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...parts: string[]): string => readFileSync(path.join(here, ...parts), 'utf8');

/** The section's two halves: what is outstanding (first paragraph), and the whole section around it. */
function notYetSection(): { readonly outstanding: string; readonly whole: string } {
  const whole = read('README.md').split('\n## Not yet\n')[1]!;
  return { outstanding: whole.split('\n\n').filter((p) => p.trim().length > 0)[0]!, whole };
}

/** What shipped, what proves it, and the words the stale list used to claim it with. */
const SHIPPED = [
  { what: 'the exact delta a row key buys', proof: () => typeof deltaByKey === 'function', claimed: ['row key', 'snapshot plus delta'], lands: 'deltaByKey' },
  { what: 'the version stamp on every commit', proof: () => read('..', 'log', 'log.ts').includes('stampData?:'), claimed: ['version stamp'], lands: 'stampData' },
  { what: "the package's exports map", proof: () => Object.keys(JSON.parse(read('..', '..', 'package.json')).exports).includes('./source/file'), claimed: ['exports'], lands: 'exports' },
] as const;

describe('the "Not yet" list is what is not yet', () => {
  it('names the streaming carrier, which is the one thing still outstanding', () => {
    expect(notYetSection().outstanding).toContain('streaming carrier');
  });

  for (const { what, proof, claimed, lands } of SHIPPED) {
    it(`no longer claims ${what} is outstanding — the code says it landed`, () => {
      expect(proof(), `${what} was expected to have shipped`).toBe(true);
      const { outstanding, whole } = notYetSection();
      for (const words of claimed) expect(outstanding, what).not.toContain(words);
      // …and the section still says WHERE it landed: a promise is kept in words, not by deleting the words
      expect(whole, what).toContain(lands);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────

describe('the http carrier is reachable — the door Law 3 says it should always have had', () => {
  it('the barrel carries it, so a consumer never writes its own copy of a port we ship', async () => {
    const barrel = await import('./index.js');
    expect(typeof barrel.httpSource).toBe('function');
    // the shape a caller gets: an adapter, exactly as the file carrier gives one
    const adapter = barrel.httpSource();
    expect(typeof adapter.open).toBe('function');
  });

  it('importing it opens no socket: the global fetch is read at CALL time, never at import', async () => {
    const original = globalThis.fetch;
    // WHY this is the test that matters: it is the whole reason the carrier may
    // sit on the barrel at all (PACKAGING.md Law 3 — the test is COST). If the
    // module read `fetch` while loading, a barrel import would fail here.
    Reflect.deleteProperty(globalThis as { fetch?: unknown }, 'fetch');
    try {
      // WHY resetModules and not a query-string specifier: vitest caches the
      // module, so a plain re-import would prove nothing; a `?probe` suffix
      // defeats the cache but is not a specifier TypeScript can resolve under
      // NodeNext, and the typecheck is a gate. Resetting the registry gives a
      // genuinely fresh load through the one path the compiler also sees.
      vi.resetModules();
      const fresh = await import('./http.js');
      expect(typeof fresh.httpSource).toBe('function');
    } finally {
      Object.defineProperty(globalThis, 'fetch', { value: original, configurable: true, writable: true });
    }
  });
});
