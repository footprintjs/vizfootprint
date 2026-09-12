// @vitest-environment node
/**
 * notInThisVersion.test.ts — WHAT THE CONTRACT SAYS IT HAS NOT BUILT MUST STILL
 * BE UNBUILT.
 *
 * `README.md`'s layers law has now outlived three of its own outstanding items.
 * It once ended with "… and any first-party layered chart — the network view is
 * the next packet"; the network view shipped as packet 4 (`networkRenderer`, the
 * first `canLayer` renderer). It then said the RENDERER that draws several 2D
 * layers on one folded frame was the next packet; that shipped as
 * `layeredRenderer` (R6) with `<VizFrame>` behind it. It then counted "a
 * selection folded per layer" among what was missing; that shipped as
 * `RenderLayer.selection` (protocol 1.8). A "not in this version"
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

/**
 * The contract really speaks a version AT OR PAST the logarithmic-axis minor
 * (protocol 1.6) — the version the prose claims. 1.7 added `narrowed` on the
 * clause view, so the pin is "1.6 or later within the major", not "exactly
 * 1.6": the log-axis law stays true across the minors that follow it.
 */
const holdsLogMinor = (): boolean => {
  const m = /RENDERER_PROTOCOL_VERSION = '1\.(\d+)'/.exec(read('types.ts'));
  return m !== null && Number(m[1]) >= 6;
};

/** The minor the contract speaks, as a number — `null` when the constant is not the `'1.<n>'` this file reads. */
const minorSpoken = (): number | null => {
  const m = /RENDERER_PROTOCOL_VERSION = '1\.(\d+)'/.exec(read('types.ts'));
  return m === null ? null : Number(m[1]);
};

/**
 * The contract really speaks a version AT OR PAST the narrowed-clause minor
 * (protocol 1.7), and the field is on the clause view. 1.8 added the fold per
 * layer, so — the `holdsLogMinor` precedent — the pin is "1.7 or later within
 * the major", not "exactly 1.7": the narrowed-clause law stays true across the
 * minors that follow it.
 */
const holdsNarrowedMinor = (): boolean => (minorSpoken() ?? 0) >= 7 && /readonly narrowed\?: \{ readonly column: string; readonly reason: string \};/.test(read('types.ts'));

/**
 * The contract really speaks a version AT OR PAST the fold-per-layer minor
 * (protocol 1.8), and the fold is on the layer. 1.9 added `via` on the clause
 * view, so — the `holdsLogMinor` precedent again — the pin is "1.8 or later
 * within the major", not "exactly 1.8".
 */
const holdsPerLayerMinor = (): boolean => (minorSpoken() ?? 0) >= 8 && /readonly selection\?: RenderSelection;/.test(read('types.ts'));

/** The contract really speaks the CLAUSE-TRAVELS-A-RELATION minor (protocol 1.9): the version, and `via` on the clause view. */
const holdsTravelledMinor = (): boolean => minorSpoken() === 9 && /readonly via\?: \{/.test(read('types.ts'));

/** The law that makes `via` true at the fold really ships: ONE picker of the consumer's travelled clause, beside `narrowedAt`. */
const holdsTravelledAt = (): boolean => /function travelledAt\(/.test(read('selection.ts')) && /function narrowedAt\(/.test(read('selection.ts'));

/** The law that makes `narrowed` true at the fold really ships: ONE owner of the missing-column guard, in the compiler. */
const holdsJudgeable = (): boolean => /function judgeable\(/.test(read('selection.ts'));

/** The chart side really owns "which scale builder for this channel" — the function the prose's example calls. */
const holdsScaleFor = (): boolean => /export function scaleFor\(/.test(read('../primitives/scales.ts'));

/** …and the words for what a transform could not place, which `src/encoding/frame.ts` cites by name. */
const holdsExcludedNote = (): boolean => /export function excludedNote\(/.test(read('../primitives/scales.ts'));

/**
 * A LINE ON A BAND really ships: the line's point has a band arm, the frame
 * classifies a layer by its x COLUMN (`bandX`) rather than by a list of marks,
 * and the two marks place a slot through the one geometry.
 */
const holdsBandLine = (): boolean =>
  /export interface BandLinePoint/.test(read('../charts/VizLine.tsx')) && /function bandX\(/.test(read('renderers.tsx')) && !/BAND_X_KINDS/.test(read('renderers.tsx')) && /export function bandCentre\(/.test(read('../primitives/scales.ts'));

/**
 * THE SECOND AXIS really ships: a side on the two charts that may stand one on
 * the right, the ONE sentence for two scales exported beside the frame's other
 * words, and the frame's per-layer path that hands the sides out.
 */
const holdsSecondAxis = (): boolean =>
  /readonly axisSide\?: AxisSide;/.test(read('../charts/VizLine.tsx')) &&
  /readonly axisSide\?: AxisSide;/.test(read('../charts/VizScatter.tsx')) &&
  /export function twoScalesSentence\(/.test(read('renderers.tsx')) &&
  /readonly ownY\?: boolean;/.test(read('../charts/VizFrame.tsx'));

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

describe('the fold-per-layer law says only what is true (protocol 1.8)', () => {
  it('the version the prose claims is the version the code speaks, and the fold is on the layer', () => {
    expect(holdsPerLayerMinor()).toBe(true);
  });

  it('the frame renderer reads each layer\'s own fold and falls back to the frame\'s — and the old one-fold sentence is gone', () => {
    const renderers = read('renderers.tsx');
    expect(renderers).toContain('f.layer.selection ?? state.selection');
    expect(renderers).toContain('THE FRAME FOLDS PER LAYER (protocol 1.8)');
    // the sentence that named this packet ("a fold per layer is a protocol change, not a renderer one") is gone — its promise was kept
    expect(renderers).not.toContain("Every layer reads the frame's ONE `selection`");
    expect(renderers).not.toContain('a fold per layer is a protocol change, not a renderer one');
  });

  it('so the outstanding list no longer counts a selection folded per layer — and the README states the law by the field\'s name', () => {
    const claim = notInThisVersion();
    expect(claim).not.toContain('a selection folded per layer');
    expect(claim).not.toContain('chooses whose clause is "self"');
    const readme = read('README.md').replace(/\s+/g, ' ');
    expect(readme).toContain('`RenderLayer.selection`');
    expect(readme).toContain('protocol 1.8');
    // the law, by its own sentence
    expect(readme).toContain('A layer reads the clauses that reached ITS address, folded with ITS clause as self');
    // the old host rule is now the fallback's WHY, not the rule
    expect(readme).not.toContain('must be folded for the LAYER whose marks it draws');
  });
});

describe('the clause-travels-a-relation law says only what is true (protocol 1.9)', () => {
  it('the version the prose claims is the version the code speaks, and the field is on the clause view', () => {
    expect(holdsTravelledMinor()).toBe(true);
  });

  it('the picker the prose names really is ONE function in the fold, beside the narrowed one — and the README states the law by that name', () => {
    expect(holdsTravelledAt()).toBe(true);
    const readme = read('README.md').replace(/\s+/g, ' ');
    expect(readme).toContain('`travelledAt`');
    expect(readme).toContain('protocol 1.9');
    expect(readme).toContain('`SelectionClauseView.via`');
    // the law, by its own sentence: the tier folds what the session travelled, and never joins
    expect(readme).toContain('The fold takes the session\'s travelled clause and never joins');
  });
});

describe('the narrowed-clause law says only what is true (protocol 1.7)', () => {
  it('the version the prose claims is the version the code speaks, and the field is on the clause view', () => {
    expect(holdsNarrowedMinor()).toBe(true);
  });

  it('the guard the prose names really is ONE function in the compiler — and the README states the law by that name', () => {
    expect(holdsJudgeable()).toBe(true);
    const readme = read('README.md');
    expect(readme).toContain('`judgeable`');
    expect(readme).toContain('protocol 1.7');
    // the distinction that carries the whole law is stated where a host will read it
    expect(readme).toContain('`field in row`');
  });
});

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
    // what the band-line packet left: a point on a band, and the brush on a band line
    expect(claim).toContain('a point on a band');
    expect(claim).toContain('a brush on a band line');
  });

  it('a line on a band really ships, so the outstanding list no longer counts it — and the README states the law by the column, not the mark', () => {
    expect(holdsBandLine()).toBe(true);
    const claim = notInThisVersion();
    expect(claim).not.toContain('a line on a band');
    const readme = read('README.md').replace(/\s+/g, ' '); // the prose wraps; the claim does not
    expect(readme).toContain('band versus run is a property of the x COLUMN, not of the mark');
    // the narrowed refusal's exact sentence, as the code says it
    expect(readme).toContain('a line over bands must bind a category to x, or take a frame of its own');
    expect(read('renderers.tsx')).toContain('over bands must bind a category to x, or take a frame of its own');
    // the old, half-true sentence is gone from both
    expect(readme).not.toContain('whatever the column says');
    expect(read('renderers.tsx')).not.toContain('one frame cannot be both');
  });

  it('the second axis on the right really ships, so the outstanding list no longer counts it — and the README carries the three laws, the sentence and the two refused remedies', () => {
    expect(holdsSecondAxis()).toBe(true);
    const claim = notInThisVersion();
    expect(claim).not.toContain('a second axis');
    expect(claim).not.toContain('refused in words instead');
    const readme = read('README.md').replace(/\s+/g, ' ');
    // the law, by its own sentence
    expect(readme).toContain('Two scales on one frame are two claims, and the frame must say so');
    // the words, exactly as the code says them
    expect(readme).toContain('two scales — left is temperature, right is rainfall; heights are not comparable across them');
    expect(read('renderers.tsx')).toContain('heights are not comparable across them');
    // the two refusals of law 1, as the code says them
    for (const sentence of ['one frame has one x, drawn once by the frame', 'a frame has two sides, left and right, and no third']) {
      expect(readme).toContain(sentence);
      expect(read('renderers.tsx')).toContain(sentence);
    }
    // the two refused remedies, by name
    expect(readme).toContain("`derive: 'align-extent'`");
    expect(readme).toContain('a merged guide is a DECLARATION');
    // and the old overprint sentence is gone from both
    expect(readme).not.toContain('overprint');
    expect(read('renderers.tsx')).not.toContain('per-layer guides overprint');
  });

  it('no sentence still says no first-party chart declares the capability', () => {
    expect(read('README.md')).not.toContain('none of which declares `canLayer`');
    // the README says where it landed instead
    expect(read('README.md')).toContain('networkRenderer');
  });
});
