# theme — the look, as data a consumer can replace

The components draw with CSS custom properties and nothing else. This folder is
the one place those properties are named, given default values, and handed to a
consumer to change.

## Why it is built this way

- **One table.** `TOKEN_VARS` joins each token's two spellings: a typed field
  (`colors.brand`) and a CSS property (`--vzf-brand`). The stylesheet reads only
  the property, so a theme written as an object and a theme written in plain CSS
  are the same theme.
- **Tokens live on the outermost theme root.** The stylesheet declares the
  defaults on the outermost `.vzf` or `.vzf-theme` element, and everything
  beneath inherits. A themed ancestor therefore reaches every component inside
  it. Before this layer a nested component re-declared the defaults on itself,
  so a themed cockpit did not theme a sheet placed inside it.
- **The stylesheet and the presets cannot drift.** `theme.test.tsx` reads the
  stylesheet and fails when its default block differs from `slateLight`, when a
  dark block differs from what `slateDark` changes, when a file names a property
  no token covers, or when a preset stops naming a token.
- **A wrong theme is refused, not ignored.** `tokensToCSSVars` throws a
  `TypeError` naming the token for an unknown group, an unknown field, or a
  value that is not one CSS value. A misspelt field that was silently dropped
  would show the default with no reason given.

## Replace the whole theme

A preset names every token, so it replaces the theme whatever the operating
system prefers.

```tsx
import { VizTheme, slateDark } from 'vizfootprint-ui';
import 'vizfootprint-ui/styles.css';

<VizTheme tokens={slateDark}>
  <Dashboard />
</VizTheme>
```

Your own complete theme has the type `CompleteThemeTokens`; the compiler tells
you which token is missing.

## Override part of it

Only the tokens you name are declared. The rest keep the value already in force.

```tsx
<VizTheme tokens={{ colors: { brand: '#0a7d5a' }, radii: { sm: '2px', md: '4px', lg: '6px' } }}>
  <Dashboard />
</VizTheme>
```

Themes nest. An inner `<VizTheme>` changes what it names and inherits the rest
from the outer one.

## Force light or dark

Without a mode the operating system's preference decides. `mode` forces the
shipped values either way.

```tsx
<VizTheme mode="dark"><Dashboard /></VizTheme>
```

## One brand colour in, four tokens out

Each accent is drawn four ways: the base, a deeper shade, a tint and the ink
placed over it. `accentColors` derives the other three from one hex.

```tsx
import { accentColors } from 'vizfootprint-ui';

<VizTheme tokens={{ colors: accentColors('brand', '#0a7d5a') }}>…</VizTheme>
```

It accepts `#rgb` and `#rrggbb` and refuses anything else. Pass `'dark'` as the
third argument when the theme's ground is dark.

## Derive a variant from a preset

```ts
import { mergeTokens, slateLight } from 'vizfootprint-ui';

const compact = mergeTokens(slateLight, { spacing: { md: '12px', lg: '16px' } });
```

## Plain CSS, no React

The provider is a convenience. Any rule that sets a property on an ancestor of
the components does the same thing.

```css
.my-app .vzf-theme, .my-app .vzf { --vzf-brand: #0a7d5a; }
```

`tokensToCSSVars(theme)` gives the same properties as an object, for a host
that sets them itself or hands them to a renderer through the contract's
`RenderState.theme`.

## The cockpit

`<VizCockpit theme mode>` takes the same two inputs and declares them on its own
root.

## Token groups

| group | what it holds |
|---|---|
| `colors` | the ground and surfaces, ink, lines, the five accents (each with deep, tint and on-colour), the honesty line (`clay`), the magnitude ramp, the two y-scale hues, the modal's glass |
| `fontFamily` | `display`, `body`, `mono` |
| `typography` | `scale`, a multiplier on every text size |
| `spacing` | `xxs` to `xxl` |
| `radii` | `sm`, `md`, `lg`, `pill` |
| `elevation` | `sm`, `md`, `lg` shadows and the `focus` ring |

## Limits, stated

- **Token values are host configuration.** Never build one from record content
  or user input. A value containing `;`, `{` or `}` is refused, but the emitter
  does not otherwise validate CSS.
- **Not every size is a token yet.** Type sizes, most pixel sizes and motion are
  still written in the stylesheet. `COMPONENT_VARS` in `theme.test.tsx` lists
  the properties a component still declares for itself; the list only shrinks.
- **Host global rules still leak in.** The scoping is zero-specificity, as the
  package README explains.
