/**
 * TWO RESOLUTIONS, ONE LIST — the drift PACKAGING.md names and nothing enforced.
 *
 * The `exports` map in `package.json` points every door at `dist/`, because
 * that is what a consumer outside this checkout resolves. `vitest.alias.mjs`
 * points the same doors back at `src/`, because coverage is enforced over
 * `src/**` and because `dist/` is a second copy of every module. Both reasons
 * are load-bearing and neither is going away — so the list is written twice,
 * and the failure if the two copies drift is the quiet one: the suite passes
 * against source while a consumer cannot resolve the import at all, or the
 * reverse. `import.meta.resolve` in the demo would catch it eventually, from
 * another repo, after a build.
 *
 * This file catches it here. It is not a type check and not a build check: it
 * reads both lists and asserts they name the same doors, and the same module
 * behind each door.
 *
 * It lives beside the two files it compares, in the same module language they
 * are written in — `package.json` is JSON and `vitest.alias.mjs` is ESM, so
 * there is no TypeScript in the comparison and none is imported to make it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DOORS } from './vitest.alias.mjs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/**
 * `./package.json` is deliberately not a door in this sense: it resolves the
 * manifest itself (the convention every package follows), not a module of the
 * library, so there is nothing for an alias to point at. PACKAGING.md's Law 1
 * table lists it for the same reason it lists everything else — a reader
 * should find the whole surface in one place — and it is the one row this
 * comparison skips.
 */
const MANIFEST = './package.json';

/** `vizfootprint/x` as the exports map spells it (`'.'` stays `'.'`). */
const asExportKey = (door) => (door === '.' ? '.' : `./${door}`);
/** …and back, so a failure names the door the way a person types it. */
const asDoor = (key) => (key === '.' ? '.' : key.slice('./'.length));

describe('the exports map and vitest.alias.mjs are one list written twice', () => {
  it('they name the SAME doors — a door added to one and not the other fails here', () => {
    const exported = Object.keys(pkg.exports).filter((k) => k !== MANIFEST).map(asDoor).sort();
    const aliased = Object.keys(DOORS).sort();

    const missingFromAlias = exported.filter((d) => !aliased.includes(d));
    const missingFromExports = aliased.filter((d) => !exported.includes(d));

    expect(
      missingFromAlias,
      `these doors are in package.json's "exports" but NOT in vitest.alias.mjs's DOORS: ${missingFromAlias.join(', ')} — a test run would resolve them to dist/ (or not at all), so add each one to DOORS`,
    ).toEqual([]);
    expect(
      missingFromExports,
      `these doors are in vitest.alias.mjs's DOORS but NOT in package.json's "exports": ${missingFromExports.join(', ')} — a consumer outside this checkout cannot resolve them, so add each one to the exports map (and to PACKAGING.md's Law 1 table)`,
    ).toEqual([]);
  });

  it('and the SAME module behind each door — the alias’s src file is what the exports map’s dist file is built from', () => {
    const disagreements = [];
    for (const [door, sourceFile] of Object.entries(DOORS)) {
      const entry = pkg.exports[asExportKey(door)];
      if (entry === undefined) continue; // named by the test above, not twice
      const built = sourceFile.replace(/\.ts$/, '');
      const expected = { types: `./dist/${built}.d.ts`, default: `./dist/${built}.js` };
      if (entry.types !== expected.types || entry.default !== expected.default) {
        disagreements.push(
          `vizfootprint${door === '.' ? '' : `/${door}`}: the alias resolves src/${sourceFile}, so the exports map should say ${expected.default} (+ ${expected.types}) — it says ${entry.default} (+ ${entry.types})`,
        );
      }
    }
    expect(disagreements, disagreements.join('\n')).toEqual([]);
  });

  it('every door the exports map declares is a real built module path', () => {
    // `files` ships dist/; a door pointing outside it would resolve nowhere.
    const outside = Object.entries(pkg.exports)
      .filter(([key]) => key !== MANIFEST)
      .filter(([, entry]) => !entry.default.startsWith('./dist/') || !entry.types.startsWith('./dist/'));
    expect(outside.map(([key]) => key), 'a door must resolve into dist/ — see PACKAGING.md, "The build"').toEqual([]);
  });
});
