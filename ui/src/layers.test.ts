/**
 * THE FOUR LAYERS, CHECKED.
 *
 * theme → components ← door ← data logic. This file parses the source with the
 * TypeScript compiler and fails when a file crosses a layer in a way it can see:
 *
 *  1. DATA LOGIC (a file named `model.ts`) reaches no React, no component and
 *     no stylesheet — directly, or through any file it imports.
 *  2. A COMPONENT (`*.tsx`) imports no value from the adapter (`adapter/**`),
 *     from the library's own doors (`vizfootprint/*`) or from the package's
 *     root barrel. Types are fine. It gets data from its feature's door.
 *  3. No source file outside `theme/` writes a colour literal in code, and no
 *     component writes a number in an inline `style`.
 *
 * Features are converted one at a time, so rules 2 and 3 each list the files
 * that do not obey yet. A list only shrinks: a listed file that now obeys
 * fails the test until it is taken off, and an unlisted file that starts
 * breaking a rule fails it too.
 *
 * WHAT THIS DOES NOT CHECK — each is a reviewer's job:
 *  - data logic in a file not named `model.ts`, and a component that imports a
 *    rule from such a file (`scales.ts`, `arrangement.ts`, `rail.ts` …);
 *  - derivation written inside a component, or inside a hook file beside it;
 *  - colours in the stylesheet (`theme/theme.test.tsx` holds the token rules),
 *    named colours (`'crimson'`) and colours assembled at run time;
 *  - sizes written as SVG attributes (`r={4}`), as module constants, or in a
 *    style object built outside the `style` attribute.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const SRC = path.dirname(fileURLToPath(import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sources(full);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [full] : [];
  });
}

interface Source {
  /** Path under `src`, with forward slashes on every platform. */
  readonly name: string;
  readonly tree: ts.SourceFile;
}

const parse = (name: string, text: string): Source => ({ name, tree: ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS) });
const FILES: readonly Source[] = sources(SRC).map((file) => parse(path.relative(SRC, file).split(path.sep).join('/'), readFileSync(file, 'utf8')));
const COMPONENTS = FILES.filter((f) => f.name.endsWith('.tsx'));

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

interface Import {
  readonly from: string;
  /** False only when nothing but types crosses: `import type`, `export type … from`, or a clause whose every name is marked `type`. */
  readonly bringsValue: boolean;
}

/** Every way a file names another module: `import`, `export … from`, `import()` and `require()`. */
function importsOf(file: Source): Import[] {
  const found: Import[] = [];
  walk(file.tree, (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const named = clause?.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : undefined;
      const typesOnly = clause !== undefined && (clause.isTypeOnly || (clause.name === undefined && named !== undefined && named.length > 0 && named.every((n) => n.isTypeOnly)));
      found.push({ from: node.moduleSpecifier.text, bringsValue: !typesOnly });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push({ from: node.moduleSpecifier.text, bringsValue: !node.isTypeOnly });
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const arg = node.arguments[0];
      if (arg !== undefined && ts.isStringLiteralLike(arg)) found.push({ from: arg.text, bringsValue: true });
    }
  });
  return found;
}

/** The source file a relative specifier names, or undefined for a package or a file that is not source. */
function resolve(from: Source, specifier: string, files: readonly Source[]): Source | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const base = path.posix.join(path.posix.dirname(from.name), specifier.replace(/\.js$/, ''));
  return files.find((f) => f.name === `${base}.ts` || f.name === `${base}.tsx` || f.name === `${base}/index.ts`);
}

/** One finding: the file and the piece of source that breaks the rule. */
type Finding = readonly [file: string, what: string];

/**
 * Compare what breaks a rule with the list of files allowed to, and say what
 * to do about each difference.
 */
function verdict(found: readonly Finding[], notYet: readonly string[]): { newViolations: string[]; noLongerViolating: string[] } {
  const breaking = new Map<string, string>();
  for (const [file, what] of found) if (!breaking.has(file)) breaking.set(file, what);
  return {
    // fix the file (use the feature's door, a token or a class) — do not add it to the list
    newViolations: [...breaking].filter(([file]) => !notYet.includes(file)).map(([file, what]) => `${file}: ${what}`).sort(),
    // the file was converted — take it off the list
    noLongerViolating: notYet.filter((file) => !breaking.has(file)).sort(),
  };
}
const CLEAN = { newViolations: [], noLongerViolating: [] };

// ── rule 1 ─────────────────────────────────────────────────────────────────────

/** Why a model reaches outside data logic, following every import it makes; undefined when it does not. */
function reachesOutsideDataLogic(model: Source, files: readonly Source[]): string | undefined {
  const seen = new Set<string>([model.name]);
  const queue: [Source, string][] = [[model, model.name]];
  for (let at = 0; at < queue.length; at += 1) {
    const [file, trail] = queue[at]!;
    for (const { from } of importsOf(file)) {
      if (/^react(-dom)?(\/|$)/.test(from)) return `${trail} → ${from}`;
      if (/\.css$/.test(from)) return `${trail} → ${from}`;
      const target = resolve(file, from, files);
      if (target === undefined) continue;
      if (target.name.endsWith('.tsx')) return `${trail} → ${target.name}`;
      if (!seen.has(target.name)) {
        seen.add(target.name);
        queue.push([target, `${trail} → ${target.name}`]);
      }
    }
  }
  return undefined;
}

describe('rule 1 — data logic stands alone', () => {
  it('a model reaches no React, no component and no stylesheet, through any file it imports', () => {
    const models = FILES.filter((f) => /(^|\/)model\.ts$/.test(f.name));
    expect(models.length).toBeGreaterThan(0);
    expect(models.map((m) => reachesOutsideDataLogic(m, FILES)).filter((why) => why !== undefined)).toEqual([]);
  });
});

// ── rule 2 ─────────────────────────────────────────────────────────────────────

/** Value imports a component must not make: the adapter, a library door, or the package's own root barrel (which re-exports the adapter). */
function dataRuleImports(file: Source, files: readonly Source[]): Finding[] {
  return importsOf(file)
    .filter((i) => i.bringsValue)
    .filter((i) => /^vizfootprint(\/|$)/.test(i.from) || /^(adapter\/|index\.ts$)/.test(resolve(file, i.from, files)?.name ?? ''))
    .map((i) => [file.name, `imports a value from '${i.from}'`]);
}

describe('rule 2 — a component imports no value from the adapter or a library door', () => {
  // not converted yet — each leaves this list when its feature gets a model and a door
  const NOT_YET = [
    'branches/DiscardModal.tsx',
    'branches/PathsModal.tsx',
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
    expect(verdict(COMPONENTS.flatMap((f) => dataRuleImports(f, FILES)), NOT_YET)).toEqual(CLEAN);
  });

  it('the converted time-travel bar is not on the list', () => {
    expect(NOT_YET).not.toContain('time/TimeTravelBar.tsx');
  });
});

// ── rule 3 ─────────────────────────────────────────────────────────────────────

const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(rgb|hsl|hwb|lab|lch|oklab|oklch|color)a?\(/;

/** The text of every string, template piece and JSX text in a file — code only, so a comment may quote a colour. */
function literalTexts(root: ts.Node): string[] {
  const texts: string[] = [];
  walk(root, (node) => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) texts.push(node.text);
  });
  return texts;
}

function colourLiterals(file: Source): Finding[] {
  return literalTexts(file.tree).filter((text) => COLOUR.test(text)).map((text) => [file.name, `writes the colour ${JSON.stringify(text.trim().slice(0, 40))}`]);
}

/**
 * Numbers written inside an inline `style`: a number literal, or a string or
 * template piece holding a digit. A variable is not a literal, whatever its
 * name, and neither is a token (`var(--vzf-space-3)`). ANY number counts —
 * `flex: 1` and `margin: 0` are choices the stylesheet should own too.
 */
function inlineStyleNumbers(file: Source): Finding[] {
  const found: Finding[] = [];
  walk(file.tree, (node) => {
    if (!ts.isJsxAttribute(node) || node.name.getText() !== 'style' || node.initializer === undefined) return;
    walk(node.initializer, (inner) => {
      const number = ts.isNumericLiteral(inner);
      const texty = ts.isStringLiteralLike(inner) || ts.isTemplateHead(inner) || ts.isTemplateMiddle(inner) || ts.isTemplateTail(inner);
      if (number || (texty && /\d/.test(inner.text.replace(/var\(--[a-z0-9-]+\)/g, '')))) found.push([file.name, `writes ${inner.getText().slice(0, 40)} in an inline style`]);
    });
  });
  return found;
}

describe('rule 3 — a component chooses no colour, and no number in an inline style', () => {
  it('no source file outside the theme writes a colour literal', () => {
    // the theme's own presets and its colour maths are where colours are written
    expect(FILES.filter((f) => !f.name.startsWith('theme/')).flatMap(colourLiterals)).toEqual([]);
  });

  // not converted yet — each leaves this list when its numbers become tokens or classes
  const NOT_YET = ['charts/VizFrame.tsx', 'layout/VizCockpit.tsx', 'layout/VizPanel.tsx', 'panels/CommitLog.tsx', 'panels/GapsPanel.tsx', 'panels/ReadinessPanel.tsx', 'time/BranchMap.tsx', 'time/TimeTravelBar.tsx'];

  it('only the listed files still write a number in an inline style, and every listed file still does', () => {
    expect(verdict(COMPONENTS.flatMap(inlineStyleNumbers), NOT_YET)).toEqual(CLEAN);
  });
});

// ── the checks themselves ──────────────────────────────────────────────────────

describe('the checks see what they claim to see', () => {
  it('imports: type-only against value, in every form a file can name a module', () => {
    const file = parse(
      'x/a.tsx',
      [
        "import type { A } from './a.js';",
        "import { type B, type C } from './b.js';",
        'import { type D, e } from "./c.js"',
        "import F from './d.js';",
        "import * as G from './e.js';",
        "  import './f.css';",
        "export { h } from './g.js';",
        "export type { I } from './h.js';",
        "const j = await import('./i.js'); const k = require('./j.js');",
        "import L, { type M } from './k.js';",
      ].join('\n'),
    );
    expect(importsOf(file).map((i) => `${i.from}:${i.bringsValue ? 'value' : 'type'}`)).toEqual([
      './a.js:type',
      './b.js:type',
      './c.js:value',
      './d.js:value',
      './e.js:value',
      './f.css:value',
      './g.js:value',
      './h.js:type',
      './i.js:value',
      './j.js:value',
      './k.js:value',
    ]);
  });

  it('rule 1: a component named by its .js specifier, React behind another file, and a stylesheet', () => {
    const files = [
      parse('f/model.ts', "import { rule } from './rule.js';"),
      parse('f/rule.ts', "import { useState } from 'react';"),
      parse('g/model.ts', "import { Bar } from './Bar.js';"),
      parse('g/Bar.tsx', 'export const Bar = 1;'),
      parse('h/model.ts', "import './look.css'; import type { T } from './types.js';"),
      parse('i/model.ts', "import { a } from './pure.js';"),
      parse('i/pure.ts', "import { b } from './model.js'; export const a = 1;"),
    ];
    const reach = (name: string): string | undefined => reachesOutsideDataLogic(files.find((f) => f.name === name)!, files);
    expect(reach('f/model.ts')).toBe('f/model.ts → f/rule.ts → react');
    expect(reach('g/model.ts')).toBe('g/model.ts → g/Bar.tsx');
    expect(reach('h/model.ts')).toBe('h/model.ts → ./look.css');
    // a cycle between pure files ends, and reaches nothing
    expect(reach('i/model.ts')).toBeUndefined();
  });

  it('rule 2: values from the adapter by any route; types never', () => {
    const files = [parse('index.ts', "export * from './adapter/index.js';"), parse('adapter/index.ts', ''), parse('adapter/types.ts', ''), parse('adapter/stepNav.ts', ''), parse('time/rail.ts', '')];
    const breaks = (text: string): string[] => dataRuleImports(parse('time/Bar.tsx', text), files).map(([, what]) => what);
    expect(breaks("import * as nav from '../adapter/stepNav.js';")).toHaveLength(1);
    expect(breaks("import { emptyState } from '../adapter/types.js';")).toHaveLength(1);
    expect(breaks("import { createSessionView } from '../adapter/index.js';")).toHaveLength(1);
    expect(breaks("import { createSessionView } from '../index.js';")).toHaveLength(1);
    expect(breaks("import { cellString } from 'vizfootprint/data';")).toEqual(["imports a value from 'vizfootprint/data'"]);
    expect(breaks("export { pathToRoot } from '../adapter/stepNav.js';")).toHaveLength(1);
    expect(breaks("import type { CommitView } from '../adapter/types.js'; import { type A } from 'vizfootprint/def';")).toEqual([]);
    // stated limit: a rule file outside the adapter is not seen
    expect(breaks("import { railScope } from './rail.js';")).toEqual([]);
  });

  it('rule 3: a colour in code is seen, a colour in a comment is not', () => {
    const seen = (text: string): number => colourLiterals(parse('x/A.tsx', text)).length;
    expect(seen("const a = '#fff';")).toBe(1);
    expect(seen('const a = <rect fill="#1b2430" />;')).toBe(1);
    expect(seen("const a = `1px solid ${'rgba(0, 0, 0, 0.2)'}`;")).toBe(1);
    expect(seen("const a = 'oklch(60% 0.1 200)';")).toBe(1);
    expect(seen("const u = 'http://x'; const a = '#abc';")).toBe(1);
    expect(seen("// the old default was #7c5cff\n/* rgb(1, 2, 3) */ const a = 'var(--vzf-brand)';")).toBe(0);
    expect(seen("const id = `#${commit}`; const label = '# of rows';")).toBe(0);
  });

  it('rule 3: a number anywhere inside an inline style is seen; a variable and a token are not', () => {
    const seen = (style: string): number => inlineStyleNumbers(parse('x/A.tsx', `const a = <div style={${style}} />;`)).length;
    expect(seen('{ margin: 0 }')).toBe(1);
    expect(seen("{ fontSize: '0.8em' }")).toBe(1);
    expect(seen('{ width: `${w ?? 380}px` }')).toBe(1);
    expect(seen('{ transform: `translateX(${x}px)`, width: 12 }')).toBe(1);
    expect(seen('{ width: px({ n: 12 }) }')).toBe(1);
    expect(seen('on ? { width: 12 } : undefined')).toBe(1);
    expect(seen('{ height: h2, width, top: scrollTop }')).toBe(0);
    expect(seen("{ gap: 'var(--vzf-space-2)', ['--vzf-tick' as string]: `${tick}px` }")).toBe(0);
    expect(seen('given')).toBe(0);
  });

  it('a difference from a list says which way it goes', () => {
    expect(verdict([['a.tsx', 'x'], ['a.tsx', 'y'], ['b.tsx', 'z']], ['b.tsx', 'c.tsx'])).toEqual({ newViolations: ['a.tsx: x'], noLongerViolating: ['c.tsx'] });
  });
});
