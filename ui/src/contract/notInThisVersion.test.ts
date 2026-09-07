// @vitest-environment node
/**
 * notInThisVersion.test.ts — WHAT THE CONTRACT SAYS IT HAS NOT BUILT MUST STILL
 * BE UNBUILT.
 *
 * `README.md`'s layers law ended with "Not in this version: … and any
 * first-party layered chart — the network view is the next packet". The network
 * view shipped as packet 4: `networkRenderer` is the ninth reference renderer
 * and the first to declare `canLayer`. A "not in this version" that outlives the
 * work sends a host to build a renderer the library already hands them, so this
 * pins the sentence against the CODE that falsifies it.
 *
 * It reads files rather than importing: the claim is about the prose, and the
 * proof is one declaration in `renderers.tsx` — no DOM, no React, no render.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(path.join(here, file), 'utf8');

/** A first-party renderer that declares the layer capability — the fact the prose has to agree with. */
const holdsLayeredRenderer = (): boolean => /canLayer:\s*true/.test(read('renderers.tsx'));

/** The claim itself: from "Not in this version" to the end of that sentence. */
const notInThisVersion = (): string => {
  const from = read('README.md').indexOf('Not in this version');
  expect(from).toBeGreaterThan(-1);
  const rest = read('README.md').slice(from);
  return rest.slice(0, rest.indexOf('.') + 1);
};

describe('the layers law says only what is true', () => {
  it('a first-party renderer really does declare canLayer', () => {
    expect(holdsLayeredRenderer()).toBe(true);
  });

  it('so the outstanding list no longer counts a first-party layered chart among what is missing', () => {
    const claim = notInThisVersion();
    expect(claim).not.toContain('layered chart');
    expect(claim).not.toContain('network view');
    // and it still names what IS missing — a list emptied to pass a test is drift of its own
    expect(claim).toContain('shared scales');
  });

  it('no sentence still says no first-party chart declares the capability', () => {
    expect(read('README.md')).not.toContain('none of which declares `canLayer`');
    // the README says where it landed instead
    expect(read('README.md')).toContain('networkRenderer');
  });
});
