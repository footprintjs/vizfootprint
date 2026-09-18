/**
 * purity.test.ts — PURITY IS WHY THIS LAYER IS PORTABLE, so it is asserted and
 * not asked for.
 *
 * A fold touches no DOM, no `fetch`, no timer, no environment — and the way to
 * keep that true a year from now is to READ THE IMPORTS, the way the selection
 * layer asserts its own boundary against a peer (`../../selection/index.test.ts`).
 *
 * WHY IT MATTERS, and the evidence is already in this repo: the progressive
 * read's own tests run under `node:http` with a real gzip frame, and Node 22
 * gives `Response.body` a `getReader()` — the same API a browser gives. So this
 * core already executes on both sides of the wire, and a pure fold is what
 * keeps moving a computation between them from changing what a number means.
 *
 * What this CANNOT assert is a host's own fold: the library cannot stop an
 * author reading a clock inside `take`. That claim is declared and falsified
 * like the monotone one (`./conformance.ts` — a fold that is not a function of
 * the bytes fails the framing check), and it is stated in ./README.md.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const sources = readdirSync(here).filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'));
const read = (file: string): string => readFileSync(path.join(here, file), 'utf8');

/** Every `from '…'` in a file, however it was spelled. */
const importsOf = (code: string): readonly string[] => [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);

/**
 * The environment a pure fold may not reach, as the names it would have to
 * write. `fetch`, a timer and a clock are the three this layer would actually
 * be tempted by; `document`/`window` are the ones that would end the "same fold
 * on a server" claim outright.
 */
const ENVIRONMENT = ['fetch(', 'document', 'window', 'globalThis', 'setTimeout', 'setInterval', 'Date.now', 'new Date', 'performance.now', 'Math.random', 'process.'] as const;

describe('the fold layer is pure, and the imports say so', () => {
  it('there is something to check', () => {
    expect(sources.length).toBeGreaterThan(3);
  });

  for (const file of sources) {
    it(`${file} imports nothing from outside this folder`, () => {
      for (const specifier of importsOf(read(file))) {
        // a relative path that climbs out, or a bare package name — either would make the
        // layer's portability depend on something the layer does not own
        expect(specifier.startsWith('./'), `${file} imports ${specifier}`).toBe(true);
        expect(specifier.includes('..'), `${file} imports ${specifier}`).toBe(false);
      }
    });

    it(`${file} touches no environment`, () => {
      const code = read(file);
      for (const name of ENVIRONMENT) expect(code.includes(name), `${file} mentions ${name}`).toBe(false);
    });
  }

  it('…and the carrier is the one that reaches ACROSS the boundary, never the other way', () => {
    // the direction that keeps the core portable: `http.ts` imports the fold layer, and
    // nothing in the fold layer knows a carrier exists
    expect(readFileSync(path.join(here, '..', 'http.ts'), 'utf8')).toContain("from './fold/declare.js'");
  });
});
