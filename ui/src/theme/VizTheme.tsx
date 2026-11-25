/**
 * `<VizTheme>` — the theme a subtree wears.
 *
 * It declares the theme's CSS custom properties on one wrapper element, and
 * everything beneath reads them by inheritance. The wrapper takes no box of its
 * own (`display: contents`, from the stylesheet), so it never changes the
 * host's layout. Themes nest: an inner `<VizTheme>` declares only what it
 * names and keeps the rest from the outer one.
 *
 * IT IS ALSO A ROOT. Every component rule in the stylesheet is written under
 * `.vzf`, so the wrapper carries that class too: a chart, a panel or a sheet
 * placed inside `<VizTheme>` and nothing else is styled and laid out. It used
 * to carry only `vzf-theme`, which declared the tokens and matched none of the
 * component rules — a chart inside it was drawn unstyled (no axis lines, the
 * browser's default ticks, no frame layout) unless the host also wrote
 * `className="vzf"` somewhere above it. Being a root also
 * means what it wraps inherits the theme's ink and type, as under any `.vzf`.
 */
import type { ReactNode } from 'react';
import type { ThemeMode } from './accent.js';
import { tokensToCSSVars, type ThemeTokens } from './tokens.js';

export interface VizThemeProps {
  /** A whole theme (a preset, or your own complete set) or the part you override. */
  readonly tokens?: ThemeTokens;
  /** Force the shipped light or dark values. Omitted, the operating system's preference decides. */
  readonly mode?: ThemeMode;
  readonly className?: string;
  readonly children?: ReactNode;
}

export function VizTheme(props: VizThemeProps): JSX.Element {
  const { tokens, mode, className, children } = props;
  return (
    <div className={className === undefined ? 'vzf vzf-theme' : `vzf vzf-theme ${className}`} style={tokensToCSSVars(tokens)} data-theme={mode} data-vzf="theme">
      {children}
    </div>
  );
}
