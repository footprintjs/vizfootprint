/**
 * THE TOKEN TABLE — every design token the library reads, declared once.
 *
 * A token has two spellings: a field on the typed {@link ThemeTokens} object
 * (`colors.brand`) and a CSS custom property (`--vzf-brand`). `TOKEN_VARS` is
 * the one table that joins them. The stylesheet and the components read only
 * the CSS property, so a consumer may set either spelling and get the same
 * result. `theme.test.tsx` fails when the stylesheet reads a property this
 * table does not name, or when a preset stops covering one.
 */

export const TOKEN_VARS = {
  colors: {
    // neutrals: the ground, the surfaces above it, the ink and the lines
    paper: '--vzf-paper',
    surface: '--vzf-surface',
    surfaceRaised: '--vzf-surface-2',
    surfaceSunken: '--vzf-surface-3',
    ink: '--vzf-ink',
    inkSoft: '--vzf-ink-soft',
    inkFaint: '--vzf-ink-faint',
    line: '--vzf-line',
    lineSoft: '--vzf-line-soft',
    zero: '--vzf-zero',
    // accents: base, a deeper shade, a tint for fills, and the ink drawn over the base
    brand: '--vzf-brand',
    brandDeep: '--vzf-brand-deep',
    brandTint: '--vzf-brand-tint',
    onBrand: '--vzf-on-brand',
    user: '--vzf-user',
    userDeep: '--vzf-user-deep',
    userTint: '--vzf-user-tint',
    onUser: '--vzf-on-user',
    agent: '--vzf-agent',
    agentDeep: '--vzf-agent-deep',
    agentTint: '--vzf-agent-tint',
    onAgent: '--vzf-on-agent',
    ok: '--vzf-ok',
    okDeep: '--vzf-ok-deep',
    okTint: '--vzf-ok-tint',
    onOk: '--vzf-on-ok',
    danger: '--vzf-danger',
    dangerDeep: '--vzf-danger-deep',
    dangerTint: '--vzf-danger-tint',
    onDanger: '--vzf-on-danger',
    clay: '--vzf-clay',
    clayTint: '--vzf-clay-tint',
    // data ink: the magnitude ramp, the "no data" fill, the two y-scale hues
    rampLowest: '--vzf-seq-1',
    rampLow: '--vzf-seq-2',
    rampMiddle: '--vzf-seq-3',
    rampHigh: '--vzf-seq-4',
    rampHighest: '--vzf-seq-5',
    mapEmpty: '--vzf-map-empty',
    scaleLeft: '--vzf-scale-left',
    scaleRight: '--vzf-scale-right',
    // the modal's glass
    scrim: '--vzf-scrim',
    glass: '--vzf-glass',
    glassLine: '--vzf-glass-line',
  },
  fontFamily: {
    display: '--vzf-font-display',
    body: '--vzf-font-body',
    mono: '--vzf-font-mono',
  },
  typography: {
    scale: '--vzf-text-scale',
  },
  spacing: {
    xxs: '--vzf-space-1',
    xs: '--vzf-space-2',
    sm: '--vzf-space-3',
    md: '--vzf-space-4',
    lg: '--vzf-space-5',
    xl: '--vzf-space-6',
    xxl: '--vzf-space-7',
  },
  radii: {
    sm: '--vzf-r-sm',
    md: '--vzf-r-md',
    lg: '--vzf-r-lg',
    pill: '--vzf-r-pill',
  },
  elevation: {
    sm: '--vzf-shadow-sm',
    md: '--vzf-shadow-md',
    lg: '--vzf-shadow-lg',
    focus: '--vzf-focus',
  },
} as const;

/** A token group: `colors`, `fontFamily`, `typography`, `spacing`, `radii`, `elevation`. */
export type TokenGroup = keyof typeof TOKEN_VARS;

/**
 * TOKENS THAT FOLLOW ANOTHER. Each has no value of its own by default: the
 * stylesheet reads it as `var(--vzf-zero, var(--vzf-ink-faint))`, so it tracks
 * its source wherever the source changes — a nested theme, a forced mode. A
 * theme that names one pins it. (A custom property declared as `var(--other)`
 * is resolved once, on the element that declares it, and its descendants
 * inherit that result; declared on the root it would not follow anything.)
 */
export const FOLLOWING_TOKENS = {
  '--vzf-zero': '--vzf-ink-faint',
  '--vzf-map-empty': '--vzf-surface-2',
} as const;

type Following = 'zero' | 'mapEmpty';
type Fields<G extends TokenGroup> = keyof (typeof TOKEN_VARS)[G];

/** A theme, whole or in part. Every group and every field is optional; an omitted one keeps the value already in force. */
export type ThemeTokens = {
  readonly [G in TokenGroup]?: { readonly [F in Fields<G>]?: string };
};

/**
 * A theme that names every token with a value of its own — what a preset is,
 * and what replaces the default as a whole. The tokens that follow another
 * ({@link FOLLOWING_TOKENS}) stay optional.
 */
export type CompleteThemeTokens = {
  readonly [G in TokenGroup]: { readonly [F in Exclude<Fields<G>, Following>]: string } & { readonly [F in Extract<Fields<G>, Following>]?: string };
};

/** The CSS custom properties a theme declares, ready to spread into a React `style`. */
export type ThemeVars = Readonly<Record<string, string>>;

const own = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

/** A plain object: `{}` or `Object.create(null)`. A Map, a Date, an array or a class instance holds no token fields. */
function isPlain(value: unknown): value is Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object') return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Is `value` ONE CSS value? It must be a non-empty string that ends where it
 * began, so that nothing after it is swallowed when a server prints the style
 * attribute as text. The rule is strict on purpose — a reader can check it by
 * eye, and no token needs what it refuses:
 *  - no `;`, `{`, `}`, backslash, comment mark or control character anywhere,
 *    quoted or not (a backslash escape can spell any of the others, so the
 *    rest of the rule could not be trusted with one present);
 *  - every quote closed, every `(` and `[` closed by its own partner, in order;
 *  - `url(` is followed by a quote (CSS reads an unquoted `url(` by other rules
 *    than the ones above, so its contents cannot be judged here).
 */
const NEVER_IN_A_VALUE = /[;{}\\\u0000-\u001f\u007f]|\/\*|\*\/|url\(\s*[^"'\s]/i;
const CLOSES: Readonly<Record<string, string>> = { ')': '(', ']': '[' };

function isOneCSSValue(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '' || NEVER_IN_A_VALUE.test(value)) return false;
  let quote = '';
  const open: string[] = [];
  for (const c of value) {
    if (quote !== '') {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') open.push(c);
    else if (c === ')' || c === ']') {
      if (open.pop() !== CLOSES[c]) return false;
    }
  }
  return quote === '' && open.length === 0;
}

const refuse = (what: string): never => {
  throw new TypeError(`vizfootprint-ui theme: ${what}`);
};

/**
 * THE ONE READER of a theme: every named token as `[group, field, value]`, or
 * a `TypeError` naming what is wrong. The emitter and the merge both walk it,
 * so neither can accept what the other refuses. `undefined` and `null` are
 * omissions at every level.
 */
function namedTokens(tokens: ThemeTokens | null | undefined): [group: TokenGroup, field: string, value: string][] {
  if (tokens === undefined || tokens === null) return [];
  if (!isPlain(tokens)) return refuse('a theme must be a plain object of token groups');
  const table: Readonly<Record<string, Readonly<Record<string, string>>>> = TOKEN_VARS;
  const named: [TokenGroup, string, string][] = [];
  for (const [group, fields] of Object.entries(tokens)) {
    if (fields === undefined || fields === null) continue;
    if (!own(table, group)) return refuse(`unknown token group "${group}"`);
    if (!isPlain(fields)) return refuse(`token group "${group}" must be a plain object of token values`);
    for (const [field, value] of Object.entries(fields)) {
      if (value === undefined || value === null) continue;
      if (!own(table[group]!, field)) return refuse(`unknown token "${group}.${field}"`);
      if (!isOneCSSValue(value)) return refuse(`token "${group}.${field}" must be one non-empty CSS value`);
      named.push([group as TokenGroup, field, value]);
    }
  }
  return named;
}

/**
 * Turn a theme into the CSS custom properties it declares.
 *
 * Only what the theme names is emitted, so a partial theme overrides exactly
 * those tokens and the rest keep inheriting. Anything that is not a usable
 * theme is refused with a `TypeError` naming the token: a misspelt field would
 * otherwise be dropped and the consumer would see the default with no reason
 * given. The error is thrown where the theme is used, so a component given a
 * wrong theme fails to render — check a theme that comes from outside your own
 * code before handing it over.
 */
export function tokensToCSSVars(tokens?: ThemeTokens | null): ThemeVars {
  const table: Readonly<Record<string, Readonly<Record<string, string>>>> = TOKEN_VARS;
  const vars: Record<string, string> = {};
  for (const [group, field, value] of namedTokens(tokens)) vars[table[group]![field]!] = value;
  return vars;
}

/**
 * Lay `over` on `base`, field by field, into a new theme. An omitted field in
 * `over` keeps the base value. Both inputs are read by the same rule as
 * {@link tokensToCSSVars}, so a wrong token is refused here too.
 */
export function mergeTokens(base: CompleteThemeTokens, over: ThemeTokens): CompleteThemeTokens;
export function mergeTokens(base: ThemeTokens, over: ThemeTokens): ThemeTokens;
export function mergeTokens(base: ThemeTokens, over: ThemeTokens): ThemeTokens {
  const merged: Partial<Record<TokenGroup, Record<string, string>>> = {};
  for (const [group, field, value] of [...namedTokens(base), ...namedTokens(over)]) {
    (merged[group] ??= {})[field] = value;
  }
  return merged;
}
