/*
 * Builds dist/ from the TypeScript source — two bundles, the stylesheet, and
 * the .d.ts types (atui's pattern; §"Build/test discipline"):
 *   dist/vizfootprint-ui.js       ESM, React + `vizfootprint` externalized  → bundler users
 *   dist/vizfootprint-ui.umd.js   IIFE on window.VizfootprintUI, React from window, library INLINED  → <script>
 *   dist/vizfootprint-ui.css      the stylesheet
 *   types/**.d.ts                 declarations, flat and ours only (tsc -p tsconfig.build.json)
 * Run:  npm run build
 */
import esbuild from 'esbuild';
import { mkdirSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

mkdirSync('dist', { recursive: true });
copyFileSync('src/styles.css', 'dist/vizfootprint-ui.css');

// The library is authored with the AUTOMATIC JSX runtime, so the UMD bundle must
// resolve `react` AND `react/jsx-runtime` from the page globals. React 18's UMD
// build exposes window.React but NOT a jsx-runtime, so we shim jsx/jsxs/Fragment
// over window.React.createElement.
const reactGlobals = {
  name: 'react-globals',
  setup(b) {
    b.onResolve({ filter: /^react-dom(\/client)?$/ }, (a) => ({ path: a.path, namespace: 'rg-dom' }));
    b.onLoad({ filter: /.*/, namespace: 'rg-dom' }, () => ({ contents: 'module.exports = window.ReactDOM;' }));
    b.onResolve({ filter: /^react$/ }, (a) => ({ path: a.path, namespace: 'rg-react' }));
    b.onLoad({ filter: /.*/, namespace: 'rg-react' }, () => ({ contents: 'module.exports = window.React;' }));
    b.onResolve({ filter: /^react\/jsx-(dev-)?runtime$/ }, (a) => ({ path: a.path, namespace: 'rg-jsx' }));
    b.onLoad({ filter: /.*/, namespace: 'rg-jsx' }, () => ({
      contents: `
        var React = window.React;
        export var Fragment = React.Fragment;
        function split(props, key) {
          var rest = {};
          for (var k in props) if (k !== 'children') rest[k] = props[k];
          if (key !== undefined) rest.key = key;
          return rest;
        }
        export function jsx(type, props, key) {
          return React.createElement(type, split(props, key), props ? props.children : undefined);
        }
        // jsxs = STATIC children (an array, keys not required) — spread them as
        // separate createElement args so React skips its missing-key warning.
        export function jsxs(type, props, key) {
          var children = props && Array.isArray(props.children) ? props.children : [props && props.children];
          return React.createElement.apply(React, [type, split(props, key)].concat(children));
        }
        export var jsxDEV = jsx;
      `,
    }));
  },
};

// The LIBRARY is a dependency now, not a folder up the tree (../../PACKAGING.md).
// Before it had an exports map, `../../../src/*` was the only way in and esbuild
// INLINED it — so dist/ shipped a private copy of vizfootprint's internals under
// this package's name, and two copies of the commit-id counter could meet in one
// app. The ESM bundles externalize it: the app resolves one library, once.
const LIBRARY = ['vizfootprint', 'vizfootprint/*'];
const REACT = ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'];

const base = { bundle: true, jsx: 'automatic', jsxDev: false, minify: true, sourcemap: true, logLevel: 'info' };

await esbuild.build({
  ...base,
  entryPoints: ['src/index.ts'],
  format: 'esm',
  outfile: 'dist/vizfootprint-ui.js',
  external: [...REACT, ...LIBRARY],
});

// the link matrix as its own entry point — an app that never edits links never bundles it
await esbuild.build({
  ...base,
  entryPoints: ['src/links/index.ts'],
  format: 'esm',
  outfile: 'dist/links.js',
  external: [...REACT, ...LIBRARY],
});

// the editor (a side drawer + one chart's editable fields) as its own entry point — an app that never edits a dashboard never bundles it
await esbuild.build({
  ...base,
  entryPoints: ['src/editor/index.ts'],
  format: 'esm',
  outfile: 'dist/editor.js',
  external: [...REACT, ...LIBRARY],
});

// the story bridge (a session's bookmarks as a storydeck post) as its own entry point — pure data, no React; an app that never tells a story never bundles it
await esbuild.build({
  ...base,
  entryPoints: ['src/story/index.ts'],
  format: 'esm',
  outfile: 'dist/story.js',
  external: [...REACT, ...LIBRARY],
});

// The STAGE — the scroll lens over a live session — is its own entry and not part of
// `./story` on purpose: `./story` is pure data, and the stage is React plus storydeck.
// Folding it in would make every host that exports a post pay for both. storydeck is an
// OPTIONAL peer, so it is external here for the same reason the library is: the app
// resolves one copy, and a host that never mounts the stage never installs it.
await esbuild.build({
  ...base,
  entryPoints: ['src/story/stage/index.ts'],
  format: 'esm',
  outfile: 'dist/story-stage.js',
  external: [...REACT, ...LIBRARY, 'storydeck'],
});

// The PAGE — the whole dashboard, its story and its data as one HTML file — is its
// own entry for the same reason again: it carries a boot sequence and a payload
// codec that a host mounting the stage inside a running cockpit never needs.
await esbuild.build({
  ...base,
  entryPoints: ['src/story/page/index.ts'],
  format: 'esm',
  outfile: 'dist/story-page.js',
  external: [...REACT, ...LIBRARY, 'storydeck'],
});

// The PAYLOAD CODEC on its own — the door a BUILD walks through. It is split off
// the page for the reason `source/file` is split off the library's source barrel:
// the page entry above pulls React and storydeck, and a Vite config runs in plain
// Node, where storydeck's bundler-only ESM does not resolve at all. A build tool
// must be able to write what the page reads without loading a renderer.
await esbuild.build({
  ...base,
  entryPoints: ['src/story/page/payload.ts'],
  format: 'esm',
  outfile: 'dist/story-payload.js',
  external: [...REACT, ...LIBRARY],
});

// The UMD build is the ONE that still inlines the library, and deliberately: a
// <script> tag has no module resolver, so a self-contained file is the whole
// point of this artifact. It takes React from window and everything else from
// inside itself. Anything that resolves imports — a bundler, the demo, Node —
// gets the ESM entries above and one shared library.
await esbuild.build({
  ...base,
  entryPoints: ['src/index.ts'],
  format: 'iife',
  globalName: 'VizfootprintUI',
  outfile: 'dist/vizfootprint-ui.umd.js',
  plugins: [reactGlobals],
});

// .d.ts (emit-only; own tsconfig so the repo-root tsc is unaffected). This used
// to need four hand-written shim files: the program spanned ../../src for the
// library's types, so tsc's rootDir became the common ancestor and the tree came
// out nested under types/ui/src/ — WITH the library's whole src/ tree beside it,
// published under this package's name. Now that those types arrive as a
// dependency's .d.ts, rootDir is src/ and the emit is flat and ours alone.
execFileSync('tsc', ['-p', 'tsconfig.build.json'], { stdio: 'inherit', shell: process.platform === 'win32' });

console.log('✓ built dist/ + types/');
