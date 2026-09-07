/**
 * The layer address — join, split, hold — and the pin that keeps `~` spelled
 * in ONE file: no source file under src/ or ui/src may carry the literal
 * outside `layerAddress.ts` (the `@uwdata` pin's precedent in src/selection).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAYER_MARKER, holdsLayerMarker, layerAddress, splitLayerAddress } from './layerAddress.js';

describe('layerAddress — the one owner of the marker', () => {
  it('joins a viewId and a layerId with the marker', () => {
    expect(LAYER_MARKER).toBe('~');
    expect(layerAddress('v', 'edges')).toBe('v~edges');
  });

  it('splits an address at the first marker and leaves a plain viewId whole', () => {
    expect(splitLayerAddress('v~edges')).toEqual({ viewId: 'v', layerId: 'edges' });
    expect(splitLayerAddress('v')).toEqual({ viewId: 'v' });
    expect(splitLayerAddress('v')).not.toHaveProperty('layerId');
    // a second marker stays on the layer side — the layer lookup refuses it, never another view
    expect(splitLayerAddress('v~a~b')).toEqual({ viewId: 'v', layerId: 'a~b' });
    expect(splitLayerAddress(layerAddress('view', 'nodes'))).toEqual({ viewId: 'view', layerId: 'nodes' });
  });

  it('holdsLayerMarker says whether an id wears it', () => {
    expect(holdsLayerMarker('v~l')).toBe(true);
    expect(holdsLayerMarker('~')).toBe(true);
    expect(holdsLayerMarker('plain')).toBe(false);
    expect(holdsLayerMarker('')).toBe(false);
  });

  it('no source file under src/ or ui/src spells the marker outside layerAddress.ts', () => {
    const here = fileURLToPath(new URL('.', import.meta.url));
    const root = path.resolve(here, '..', '..');
    const roots = [path.join(root, 'src'), path.join(root, 'ui', 'src')];
    const isSource = (f: string): boolean => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith('.d.ts');
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (name === 'node_modules' || name === 'dist') return [];
      return statSync(full).isDirectory() ? walk(full) : isSource(name) ? [full] : [];
    });
    const files = roots.flatMap(walk).filter((f) => f !== path.join(here, 'layerAddress.ts'));
    expect(files.length).toBeGreaterThan(0);
    // the literal in any quote or beside a template hole — a comment may say "the marker", code may not spell it
    const spelled = /(['"`])~\1|~\$\{|\}~/;
    for (const file of files) expect(spelled.test(readFileSync(file, 'utf8')), path.relative(root, file)).toBe(false);
  });
});
