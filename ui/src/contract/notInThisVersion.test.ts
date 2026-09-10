// @vitest-environment node
/**
 * notInThisVersion.test.ts — WHAT THE CONTRACT SAYS IT HAS NOT BUILT MUST STILL
 * BE UNBUILT.
 *
 * `README.md`'s layers law has now outlived two of its own outstanding items.
 * It once ended with "… and any first-party layered chart — the network view is
 * the next packet"; the network view shipped as packet 4 (`networkRenderer`, the
 * first `canLayer` renderer). It then said the RENDERER that draws several 2D
 * layers on one folded frame was the next packet; that shipped as
 * `layeredRenderer` (R6) with `<VizFrame>` behind it. A "not in this version"
 * that outlives the work sends a host to build what the library already hands
 * them, so this pins the sentence against the CODE that falsifies it.
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

/** The contract really carries the layers' shared scales: `RenderState.frame`, folded by the host (protocol 1.5). */
const holdsFrame = (): boolean => /readonly frame\?:/.test(read('types.ts'));

/** The GENERIC frame renderer really ships: `layeredRenderer` draws the def's stack of 2D marks (R6). */
const holdsFrameRenderer = (): boolean => /export function layeredRenderer\(/.test(read('renderers.tsx'));

/** The contract really speaks the LOGARITHMIC AXIS minor (protocol 1.6) — the version the prose claims. */
const holdsLogMinor = (): boolean => /RENDERER_PROTOCOL_VERSION = '1\.6'/.test(read('types.ts'));

/** The chart side really owns "which scale builder for this channel" — the function the prose's example calls. */
const holdsScaleFor = (): boolean => /export function scaleFor\(/.test(read('../primitives/scales.ts'));

/** …and the words for what a transform could not place, which `src/encoding/frame.ts` cites by name. */
const holdsExcludedNote = (): boolean => /export function excludedNote\(/.test(read('../primitives/scales.ts'));

/** The logarithmic-axis claim: from its "Not in this version" to the end of that sentence. */
const notInThisLogVersion = (): string => {
  const readme = read('README.md');
  const from = readme.indexOf('Not in this version: a symlog');
  expect(from).toBeGreaterThan(-1);
  const rest = readme.slice(from);
  return rest.slice(0, rest.indexOf('.') + 1);
};

/** The claim itself: from "Not in this version" to the end of that sentence. */
const notInThisVersion = (): string => {
  const from = read('README.md').indexOf('Not in this version');
  expect(from).toBeGreaterThan(-1);
  const rest = read('README.md').slice(from);
  return rest.slice(0, rest.indexOf('.') + 1);
};

describe('the logarithmic-axis law says only what is true (protocol 1.6)', () => {
  it('the version the prose claims is the version the code speaks', () => {
    expect(holdsLogMinor()).toBe(true);
  });

  it('the two functions the prose\'s example calls really ship, under those names', () => {
    // `src/encoding/frame.ts` cites `excludedNote` in this package BY NAME as the words for what a
    // transform could not place — this is the check that keeps that citation true.
    expect(holdsScaleFor()).toBe(true);
    expect(holdsExcludedNote()).toBe(true);
  });

  it('and the outstanding list names what is really missing, not what shipped', () => {
    const claim = notInThisLogVersion();
    // shipped, so the list may not count them among what is missing
    expect(claim).not.toContain('a logarithmic axis');
    expect(claim).not.toContain('decade ticks');
    // still missing — a list emptied to pass a test is drift of its own
    expect(claim).toContain('symlog');
    expect(claim).toContain('per-layer transform');
    expect(claim).toContain('colour ramp');
  });
});

describe('the layers law says only what is true', () => {
  it('a first-party renderer really does declare canLayer', () => {
    expect(holdsLayeredRenderer()).toBe(true);
  });

  it('the contract really carries the frame — the layers\' shared scales, folded by the host (1.5)', () => {
    expect(holdsFrame()).toBe(true);
  });

  it('the GENERIC frame renderer really does ship', () => {
    expect(holdsFrameRenderer()).toBe(true);
  });

  it('so the outstanding list no longer counts a layered chart, shared scales, or the frame RENDERER among what is missing', () => {
    const claim = notInThisVersion();
    expect(claim).not.toContain('layered chart');
    expect(claim).not.toContain('network view');
    // `RenderState.frame` shipped, so the list may no longer count shared scales as unbuilt
    expect(claim).not.toContain('shared scales');
    // …and `layeredRenderer` shipped, so neither may it count the renderer that draws them
    expect(claim).not.toContain('one folded frame');
    expect(claim).not.toContain('the frame RENDERER is the next packet');
    // and it still names what IS missing — a list emptied to pass a test is drift of its own
    expect(claim).toContain('annotation layers');
    expect(claim).toContain('a map frame with an inset');
    expect(claim).toContain('a line on a band');
  });

  it('no sentence still says no first-party chart declares the capability', () => {
    expect(read('README.md')).not.toContain('none of which declares `canLayer`');
    // the README says where it landed instead
    expect(read('README.md')).toContain('networkRenderer');
  });
});
