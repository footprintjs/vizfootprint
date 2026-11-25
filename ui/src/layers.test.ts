/**
 * THE FOUR LAYERS, CHECKED.
 *
 * theme → components ← door ← data logic. A component renders; it does not
 * derive data and it does not choose a colour or a size. This file reads the
 * source and fails when a file crosses a layer:
 *
 *  1. DATA LOGIC (`model.ts`) imports no React, no component and no stylesheet.
 *  2. A COMPONENT (`*.tsx`) imports no data rule: nothing but types from the
 *     adapter, and no value from the library's own doors (`vizfootprint/*`).
 *     It gets data from its feature's door.
 *  3. A COMPONENT writes no literal colour, and no literal size or duration in
 *     an inline style. Those are the theme's.
 *
 * Features are converted one at a time, so each rule has a list of the files
 * that do not obey it yet. A list only shrinks: a listed file that now obeys
 * fails the test until it is taken off, and a file that is not listed can
 * never start breaking a rule.
 *
 * What this cannot see: derivation written INSIDE a component with no import
 * to betray it. That is a reviewer's job; rule 2 catches the usual way in.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SRC = path.dirname(fileURLToPath(import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sources(full);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [full] : [];
  });
}

const rel = (file: string): string => path.relative(SRC, file).split(path.sep).join('/');
const FILES = sources(SRC).map((file) => ({ name: rel(file), text: readFileSync(file, 'utf8') }));
const COMPONENTS = FILES.filter((f) => f.name.endsWith('.tsx'));

interface Import {
  readonly from: string;
  /** False for `import type …` and for a clause whose every name is marked `type`. */
  readonly bringsValue: boolean;
}

/** Every static import of a file. */
function importsOf(text: string): Import[] {
  return [...text.matchAll(/^import\s+(type\s+)?([\s\S]*?)\s+from\s+'([^']+)';/gm)].map((m) => {
    const names = m[2]!.replace(/[{}]/g, ' ').split(',').map((n) => n.trim()).filter((n) => n !== '');
    return { from: m[3]!, bringsValue: m[1] === undefined && names.some((n) => !n.startsWith('type ')) };
  });
}

/** Files that break a rule, by name, sorted. */
const breakers = (files: readonly { name: string; text: string }[], breaks: (text: string) => boolean): string[] => files.filter((f) => breaks(f.text)).map((f) => f.name).sort();

describe('rule 1 — data logic stands alone', () => {
  it('a model imports no React, no component and no stylesheet', () => {
    const models = FILES.filter((f) => /(^|\/)model\.ts$/.test(f.name));
    expect(models.length).toBeGreaterThan(0);
    const crossing = models.flatMap((f) => importsOf(f.text).filter((i) => /^react(-dom)?(\/|$)/.test(i.from) || /\.(tsx|css)(\.js)?$/.test(i.from) || /\.css$/.test(i.from)).map((i) => `${f.name} imports ${i.from}`));
    expect(crossing).toEqual([]);
  });
});

describe('rule 2 — a component imports no data rule', () => {
  /** A value from the adapter's rule files (its `types` are fine), or from one of the library's own doors. */
  const importsADataRule = (text: string): boolean => importsOf(text).some((i) => i.bringsValue && (/(^|\/)adapter\/(?!types\.js$)/.test(i.from) || /^vizfootprint(\/|$)/.test(i.from)));

  // not converted yet — each leaves this list when its feature gets a model and a door
  const NOT_YET = [
    'contract/renderers.tsx',
    'editor/ChartEditor.tsx',
    'notes/NoteCell.tsx',
    'panels/SelectionChips.tsx',
    'sheet/AddAggregate.tsx',
    'sheet/ExportRows.tsx',
    'sheet/Sheet.tsx',
    'time/BranchMap.tsx',
  ];

  it('only the listed files still do, and every listed file still does', () => {
    expect(breakers(COMPONENTS, importsADataRule)).toEqual(NOT_YET);
  });

  it('the converted time-travel bar is not on the list', () => {
    expect(NOT_YET).not.toContain('time/TimeTravelBar.tsx');
  });
});

describe('rule 3 — a component chooses no colour, size or duration', () => {
  const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(rgb|hsl)a?\(/;
  /** Code only: comments may quote a colour while explaining one. */
  const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('no source file writes a colour literal', () => {
    // the theme's own presets and its colour maths are where colours are written
    const outsideTheme = FILES.filter((f) => !f.name.startsWith('theme/'));
    expect(breakers(outsideTheme, (text) => COLOUR.test(code(text)))).toEqual([]);
  });

  /** An inline style object holding a number: a length, a duration, a ratio. A measured value (a variable) and a token (`var(--vzf-…)`) are not literals. */
  const writesALiteralSize = (text: string): boolean => [...code(text).matchAll(/style=\{\{([^}]*)\}\}/g)].some((m) => /\d/.test(m[1]!.replace(/\$\{[^}]*\}/g, '').replace(/var\(--[a-z0-9-]+\)/g, '')));

  // not converted yet — each leaves this list when its sizes become tokens or classes
  const NOT_YET = ['charts/VizFrame.tsx', 'layout/VizCockpit.tsx', 'layout/VizPanel.tsx', 'panels/CommitLog.tsx', 'panels/GapsPanel.tsx', 'panels/ReadinessPanel.tsx', 'time/BranchMap.tsx', 'time/TimeTravelBar.tsx'];

  it('only the listed files still write a literal size inline, and every listed file still does', () => {
    expect(breakers(COMPONENTS, writesALiteralSize)).toEqual(NOT_YET);
  });
});

describe('the checks themselves', () => {
  it('tell a type import from a value import', () => {
    const found = importsOf(["import type { A } from './a.js';", "import { type B, type C } from './b.js';", "import { type D, e } from './c.js';", "import F from './d.js';", "import {\n  g,\n  type H,\n} from './e.js';"].join('\n'));
    expect(found).toEqual([
      { from: './a.js', bringsValue: false },
      { from: './b.js', bringsValue: false },
      { from: './c.js', bringsValue: true },
      { from: './d.js', bringsValue: true },
      { from: './e.js', bringsValue: true },
    ]);
  });
});
