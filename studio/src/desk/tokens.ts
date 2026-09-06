/**
 * THE DESK'S TOKENS — the demo's inline values, promoted to a default.
 *
 * Every colour and size the desk draws with used to be a literal inside a
 * `style={{ … }}` in one 1,100-line file. That is not a design system and this
 * is not one either: it is the smallest set of names that makes today's look a
 * DEFAULT rather than a hard-code, so a second application can restyle the desk
 * without forking it.
 *
 * **Where the defaults live, and why not in a stylesheet.** They are written as
 * inline CSS custom properties on the desk's own root element, from the one map
 * below. A `studio/styles.css` would have been the other option and was
 * rejected: a host that forgot the import would get a desk with no colours at
 * all, and the failure would look like a bug in the desk. Inline defaults
 * cannot be forgotten. The cost is stated plainly — an inline property beats a
 * stylesheet, so a host restyles through the `tokens` prop (or by setting the
 * variable on an element INSIDE the desk), not by writing `.vzfs { … }` in its
 * own CSS.
 *
 * **What is NOT here.** The charts, the cockpit shell, the modals, the time
 * strip, the branch map, the sheet — all of that is `vizfootprint-ui`'s look and
 * wears `--vzf-*` from its own stylesheet. These tokens govern only what the
 * DESK itself draws: a view's words, the dashboard summary and its drafts, the
 * aside's tabs, the jump box, the notice line, and the two report panels the
 * desk owns the words of.
 */
import type { CSSProperties } from 'react';

/** One name the desk draws with. The CSS variable is `--vzfs-<name in kebab>`. */
export type DeskTokenName =
  /** A prose slot whose basis moved — stale, said in colour and never hidden. */
  | 'stale'
  /** A proposal on the table: the ground and the hairline of its chip. */
  | 'draftBg'
  | 'draftLine'
  /** A hairline: a tab, a small button, a rule between things. */
  | 'rule'
  /** The selected tab's ground. */
  | 'tabOn'
  /** A control's own ground. */
  | 'paper'
  /** An answer that landed, or a proposal admitted. */
  | 'ok'
  /** A refusal, in the colour a refusal is said in. */
  | 'danger'
  /** The smallest type: a slot name, a readout, a hint. */
  | 'textXs'
  /** Small type: the jump box, a chip. */
  | 'textSm'
  /** The desk's own prose size. */
  | 'textMd'
  /** A panel's body. */
  | 'textLg'
  /** The line height prose is set at. */
  | 'lineHeight'
  /** The face a column name, a commit id or a slot label is set in. */
  | 'mono'
  /** The gap between things in a strip. */
  | 'gap'
  | 'gapSm'
  /** The padding inside a small box. */
  | 'pad'
  /** The corner a chip or a tab wears. */
  | 'radius';

/** kebab-case of a token name — `draftBg` → `draft-bg`. */
const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** The CSS custom property a token is read through. */
export const deskTokenVar = (name: DeskTokenName): string => `--vzfs-${kebab(name)}`;

/**
 * The defaults — byte for byte the values the NNDSS cockpit was written with,
 * so moving that demo onto this desk changed no pixel.
 */
export const DESK_TOKENS: Readonly<Record<DeskTokenName, string>> = {
  stale: '#a8661a',
  draftBg: '#fff7e6',
  draftLine: '#f0d9a8',
  rule: '#d8dee4',
  tabOn: '#dcefec',
  paper: '#ffffff',
  ok: '#2f7d5b',
  danger: '#a83a3a',
  textXs: '11px',
  textSm: '12px',
  textMd: '12.5px',
  textLg: '13px',
  lineHeight: '1.5',
  mono: 'ui-monospace, Menlo, monospace',
  gap: '8px',
  gapSm: '6px',
  pad: '10px',
  radius: '6px',
};

/** A host's overrides — any subset; the rest keep {@link DESK_TOKENS}. */
export type DeskTokens = Partial<Record<DeskTokenName, string>>;

/**
 * The token map as a React `style` object to spread onto the desk root.
 *
 * Every token is written, not only the overridden ones: a variable that is
 * merely inherited is a variable a surrounding page can change by accident, and
 * a desk whose colours depend on where it was mounted is not a default.
 */
export function deskTokenStyle(tokens: DeskTokens = {}): CSSProperties {
  const style: Record<string, string> = {};
  for (const name of Object.keys(DESK_TOKENS) as DeskTokenName[]) {
    style[deskTokenVar(name)] = tokens[name] ?? DESK_TOKENS[name];
  }
  return style as CSSProperties;
}

/**
 * The reader — how the desk's own components spell a token.
 *
 * `var(--vzfs-x)` with no fallback on purpose: the root always writes every
 * one, so a fallback here would be a second copy of the default and the two
 * would drift. If you see an unstyled desk, the root did not mount.
 */
export const T: Readonly<Record<DeskTokenName, string>> = Object.fromEntries(
  (Object.keys(DESK_TOKENS) as DeskTokenName[]).map((name) => [name, `var(${deskTokenVar(name)})`]),
) as Readonly<Record<DeskTokenName, string>>;
