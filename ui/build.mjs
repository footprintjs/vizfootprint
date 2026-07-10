/*
 * Builds dist/ from the TypeScript source — two bundles, the stylesheet, and
 * the .d.ts types (atui's pattern; §"Build/test discipline"):
 *   dist/vizfootprint-ui.js       ESM, React (+jsx-runtime) externalized  → bundler users
 *   dist/vizfootprint-ui.umd.js   IIFE on window.VizfootprintUI, React from window  → <script>
 *   dist/vizfootprint-ui.css      the stylesheet
 *   types/**.d.ts                 declarations (tsc -p tsconfig.build.json)
 * Run:  npm run build
 */
import esbuild from 'esbuild';
import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
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

const base = { bundle: true, jsx: 'automatic', jsxDev: false, minify: true, sourcemap: true, logLevel: 'info' };

await esbuild.build({
  ...base,
  entryPoints: ['src/index.ts'],
  format: 'esm',
  outfile: 'dist/vizfootprint-ui.js',
  external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
});

await esbuild.build({
  ...base,
  entryPoints: ['src/index.ts'],
  format: 'iife',
  globalName: 'VizfootprintUI',
  outfile: 'dist/vizfootprint-ui.umd.js',
  plugins: [reactGlobals],
});

// .d.ts (emit-only; own tsconfig so the repo-root tsc is unaffected). The
// program spans ../src for imported types, so tsc nests the tree under
// types/ui/src/ — a flat entry shim keeps package.json's `types` field stable.
execFileSync('tsc', ['-p', 'tsconfig.build.json'], { stdio: 'inherit', shell: process.platform === 'win32' });
writeFileSync('types/index.d.ts', "export * from './ui/src/index.js';\n");

console.log('✓ built dist/ + types/');
