/**
 * THE TOKEN TABLE — every design token the library reads, declared once.
 *
 * A token has two spellings: a field on the typed {@link ThemeTokens} object
 * (`colors.brand`) and a CSS custom property (`--vzf-brand`). `TOKEN_VARS` is
 * the one table that joins them. The stylesheet and the components read only
 * the CSS property, so a consumer may set either spelling and get the same
 * result. `theme.test.ts` fails when the stylesheet reads a property this
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

/** A theme, whole or in part. Every group and every field is optional; an omitted one keeps the value already in force. */
export type ThemeTokens = {
  readonly [G in TokenGroup]?: { readonly [F in keyof (typeof TOKEN_VARS)[G]]?: string };
};

/** A theme that names every token — what a preset is, and what replaces the default as a whole. */
export type CompleteThemeTokens = {
  readonly [G in TokenGroup]: { readonly [F in keyof (typeof TOKEN_VARS)[G]]: string };
};

/** The CSS custom properties a theme declares, ready to spread into a React `style`. */
export type ThemeVars = Readonly<Record<string, string>>;

const own = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

/**
 * A token value is one CSS value. `;`, `{` and `}` end a declaration or a rule,
 * so a value holding one could declare something the theme never named when a
 * server prints the style attribute as text.
 */
const ENDS_A_DECLARATION = /[;{}]/;

/**
 * Turn a theme into the CSS custom properties it declares.
 *
 * Only what the theme names is emitted, so a partial theme overrides exactly
 * those tokens and the rest keep inheriting. An `undefined` group or field is
 * an omission. Anything else that is not a usable value is refused with a
 * `TypeError` naming the token: a misspelt field would otherwise be dropped
 * and the consumer would see the default with no reason given.
 */
export function tokensToCSSVars(tokens: ThemeTokens = {}): ThemeVars {
  const vars: Record<string, string> = {};
  const table: Readonly<Record<string, Readonly<Record<string, string>>>> = TOKEN_VARS;
  for (const [group, fields] of Object.entries(tokens as Readonly<Record<string, unknown>>)) {
    if (fields === undefined) continue;
    if (!own(table, group)) throw new TypeError(`vizfootprint-ui theme: unknown token group "${group}"`);
    if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) {
      throw new TypeError(`vizfootprint-ui theme: token group "${group}" must be an object of token values`);
    }
    const names = table[group]!;
    for (const [field, value] of Object.entries(fields as Readonly<Record<string, unknown>>)) {
      if (value === undefined) continue;
      if (!own(names, field)) throw new TypeError(`vizfootprint-ui theme: unknown token "${group}.${field}"`);
      if (typeof value !== 'string' || value.trim() === '' || ENDS_A_DECLARATION.test(value)) {
        throw new TypeError(`vizfootprint-ui theme: token "${group}.${field}" must be one non-empty CSS value`);
      }
      vars[names[field]!] = value;
    }
  }
  return vars;
}

/**
 * Lay `over` on `base`, field by field. An `undefined` field in `over` keeps
 * the base value. Use it to derive a variant from a preset.
 */
export function mergeTokens<T extends ThemeTokens>(base: T, over: ThemeTokens): T {
  const merged: Record<string, Record<string, string>> = {};
  const groups = new Set([...Object.keys(base), ...Object.keys(over)]);
  const bag = (t: ThemeTokens, group: string): Readonly<Record<string, string | undefined>> =>
    (t as Readonly<Record<string, Readonly<Record<string, string | undefined>> | undefined>>)[group] ?? {};
  for (const group of groups) {
    const fields: Record<string, string> = {};
    for (const [field, value] of [...Object.entries(bag(base, group)), ...Object.entries(bag(over, group))]) {
      if (value !== undefined) fields[field] = value;
    }
    merged[group] = fields;
  }
  return merged as unknown as T;
}
