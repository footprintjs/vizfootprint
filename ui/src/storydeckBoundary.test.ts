/**
 * THE BOUNDARY — the component library imports nothing from StoryDeck.
 *
 * StoryDeck (the scroll lens) and vizfootprint meet only in the app layer
 * (`studio/src/story/`), through StoryDeck's framework-neutral `StoryFigure`.
 * A library that imported the lens would make every user of the charts install
 * a story renderer they may never mount — and it did, once: a second record
 * library came in with it, and the tests needed a transform for its source JSX.
 *
 * This reads every file under `ui/` a build or a bundler could follow — code,
 * stylesheets, the manifest — and fails on any import of `storydeck` or
 * `footprint-storydeck` (or a subpath of either). Prose may name StoryDeck; only
 * an import is a dependency.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);
/** Built output and installed packages are not the library's own source. */
const SKIP = new Set(['node_modules', 'dist', 'types', 'coverage']);
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|css)$/;

/** `from '…'`, `import '…'`, `import('…')`, `require('…')`, `@import '…'` / `url(…)` — naming StoryDeck by either name. */
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|@import\s+(?:url\(\s*)?)['"](?:footprint-)?storydeck(?:\/[^'"]*)?['"]/;

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIP.has(entry.name) ? [] : filesUnder(full);
    return CODE.test(entry.name) && full !== SELF ? [full] : [];
  });
}

describe('ui/ imports nothing from StoryDeck', () => {
  it('the check sees every way a module names a package (so a pass means something)', () => {
    for (const line of [
      "import { ScrollyView } from 'storydeck';",
      'import type { Section } from "footprint-storydeck";',
      "export * from 'storydeck/focus';",
      "import 'footprint-storydeck/storydeck.css';",
      "const m = await import('storydeck');",
      "const m = require('footprint-storydeck');",
      "@import 'storydeck/storydeck.css';",
      '@import url("footprint-storydeck/storydeck.css");',
    ]) {
      expect(IMPORT.test(line), line).toBe(true);
    }
    expect(IMPORT.test('// a storydeck post, told in prose')).toBe(false);
    expect(IMPORT.test("import { x } from 'storydeck-like';")).toBe(false);
  });

  it('no source file, build script or stylesheet under ui/ imports it', () => {
    const files = filesUnder(UI);
    expect(files.length).toBeGreaterThan(50); // the walk reached the library, not an empty folder
    const offenders = files.filter((file) => IMPORT.test(readFileSync(file, 'utf8'))).map((file) => path.relative(UI, file));
    expect(offenders).toEqual([]);
  });

  it('the manifest neither depends on it nor exports a door that needs it', () => {
    const pkg = JSON.parse(readFileSync(path.join(UI, 'package.json'), 'utf8')) as Record<string, unknown>;
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'peerDependenciesMeta']) {
      const names = Object.keys((pkg[field] as Record<string, unknown> | undefined) ?? {});
      expect(names.filter((name) => /^(footprint-)?storydeck$/.test(name)), field).toEqual([]);
    }
    const manifest = readFileSync(path.join(UI, 'package.json'), 'utf8');
    expect(manifest).not.toMatch(/footprint-storydeck|"storydeck"/);
  });
});
