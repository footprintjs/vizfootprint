/*
 * Builds dist/ from the TypeScript source — one bundle per DOOR, plus the
 * .d.ts types (the `ui/build.mjs` pattern, one step smaller):
 *   dist/desk.js       ESM, React + `vizfootprint` + `vizfootprint-ui` externalized  → bundler users
 *   dist/make.js       the wizard, the same way — its own door because a host
 *                      that only mounts a desk should not bundle an authoring flow
 *   dist/cards.js      the demo card and its filter — a gallery's program, and
 *                      neither a desk nor an authoring flow
 *   types/**.d.ts      declarations, flat and OURS ONLY (tsc -p tsconfig.build.json)
 * Run:  npm run build
 *
 * No UMD build here, and that is a decision rather than an omission. The ui
 * package ships one because a <script> tag has no module resolver and a chart
 * library is a thing people drop on a page. A DESK is not: it needs a session
 * to project, which means a server or a bundled definition either way — so the
 * one artifact worth shipping is the one a bundler resolves.
 *
 * No stylesheet either. The desk wears `vizfootprint-ui/styles.css` (the host
 * already imports it for the charts) and writes its own tokens as inline CSS
 * custom properties on its root — see `src/desk/tokens.ts` for why the defaults
 * live in TypeScript rather than in a second stylesheet a host could forget.
 */
import esbuild from 'esbuild';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

mkdirSync('dist', { recursive: true });

// Both are DEPENDENCIES, never folders up the tree. Externalizing them is what
// keeps one library and one component library in the app — the same reason
// `ui/build.mjs` externalizes `vizfootprint` (two copies of the commit-id
// counter, meeting in one page, is the failure that rule exists to prevent).
const LIBRARY = ['vizfootprint', 'vizfootprint/*', 'vizfootprint-ui', 'vizfootprint-ui/*'];
const REACT = ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'];
// storydeck is an OPTIONAL peer and reaches us only through
// `vizfootprint-ui/story/stage`; external here for the same reason as the rest.
const OPTIONAL = ['storydeck'];

const base = { bundle: true, jsx: 'automatic', jsxDev: false, minify: true, sourcemap: true, logLevel: 'info' };

for (const door of ['desk', 'make', 'cards']) {
  await esbuild.build({
    ...base,
    entryPoints: [`src/${door}/index.ts`],
    format: 'esm',
    outfile: `dist/${door}.js`,
    external: [...REACT, ...LIBRARY, ...OPTIONAL],
  });
}

// .d.ts (emit-only; its own tsconfig so the workspace's `tsc --noEmit` is
// unaffected). `rootDir` resolves to src/ because every non-relative import is
// a dependency's — so the emit is flat and carries only this package's tree,
// never a copy of the library's types under this package's name.
execFileSync('tsc', ['-p', 'tsconfig.build.json'], { stdio: 'inherit', shell: process.platform === 'win32' });

console.log('✓ built dist/ + types/');
