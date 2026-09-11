/**
 * The built-in channel requirements — what each chart kind's channels accept
 * — and the merge that lets a def add or override them per kind. Two layers:
 * a requirement BY CHANNEL NAME that holds for any chart kind (x carries a
 * magnitude wherever it appears), and per-kind specifics on top (a bar's x
 * is discrete, a scatter's is a number or a date). A def's
 * `encodingRules.channels` sits above both. A channel no layer mentions
 * accepts anything.
 *
 * THE LAW THIS TABLE KEEPS: the door and the renderer agree, kind by kind. A
 * door that accepts what the renderer refuses sends a definition author into a
 * refusal they cannot see at declaration; a door that refuses what the
 * renderer draws hides a capability. So an entry here widens or narrows WITH
 * the chart that draws the kind — never ahead of it, never behind it — and the
 * reason sits at the entry.
 */
import type { ChannelRequirement, ChannelRequirements } from './types.js';

/**
 * Holds for any chart kind, by channel name: the CLASS facts. A magnitude
 * channel never takes an identifier; size and angle are numbers anywhere;
 * a panel or a shape is discrete anywhere. Which TYPES x and y take is the
 * chart kind's to say (a bar's x is categories, a scatter's is numbers).
 */
export const DEFAULT_CHANNEL_REQUIREMENTS: readonly ChannelRequirement[] = [
  { channel: 'x', notRoles: ['identifier'] },
  { channel: 'y', notRoles: ['identifier'] },
  { channel: 'size', accepts: ['number'], notRoles: ['identifier'] },
  { channel: 'r', accepts: ['number'], notRoles: ['identifier'] },
  { channel: 'radius', accepts: ['number'], notRoles: ['identifier'] },
  { channel: 'theta', accepts: ['number'], notRoles: ['identifier'] },
  { channel: 'category', scale: 'discrete' },
  { channel: 'facet', scale: 'discrete' },
  { channel: 'column', scale: 'discrete' },
  { channel: 'row', scale: 'discrete' },
  { channel: 'shape', scale: 'discrete' },
  { channel: 'region', accepts: ['string'] },
];

const QUANTITY: Pick<ChannelRequirement, 'accepts' | 'notRoles'> = { accepts: ['number'], notRoles: ['identifier'] };
const POSITION: Pick<ChannelRequirement, 'accepts' | 'notRoles'> = { accepts: ['number', 'date'], notRoles: ['identifier'] };

/** Per chart kind, overriding the defaults channel by channel. `point` is the VL/Mosaic name for a scatter. */
export const CHART_REQUIREMENTS: ChannelRequirements = Object.freeze({
  line: [
    // A LINE'S X TAKES A CATEGORY. The frame renderer draws a line whose x is a
    // string or a boolean as a BAND line — each point at its slot's centre, the
    // segments connectors in slot order, claiming nothing between slots
    // (`bandX`, ui/src/contract/renderers.tsx) — so the door accepts what the
    // renderer draws. No `scale` is fixed here: the scale FOLLOWS THE COLUMN,
    // continuous for a number or a date and discrete for a string or a boolean,
    // which is exactly what the frame's fold decides on its own
    // (`frameScaleOf`, ./frame.ts). `notRoles: ['identifier']` stays: an
    // identifier along a run is a lie about order, and whether an identifier
    // makes an honest BAND for a line is a separate question this entry does
    // not take (a bar allows it; a line implies an ordering that means
    // something).
    { channel: 'x', accepts: ['number', 'date', 'string', 'boolean'], notRoles: ['identifier'] },
    { channel: 'y', ...QUANTITY },
    // A line draws without a colour — the colour SPLITS it into series. A
    // heatmap's colour, one entry down, is the value itself, so it is not
    // optional. That difference is a fact about the chart kinds and belongs
    // here rather than in whoever enumerates them.
    { channel: 'color', scale: 'discrete', optional: true },
  ],
  // A SCATTER'S X STAYS A NUMBER OR A DATE, deliberately, while a line's just
  // widened: `VizScatter` places x on a run and draws no band in this version,
  // and the frame refuses a point on a band in words ("a point chart draws no
  // band in this version" — `stackRefusal`, ui/src/contract/renderers.tsx).
  // The door refusing it too is the two AGREEING. When the scatter learns a
  // band, this entry widens with it — and `point` is the same chart under its
  // VL/Mosaic name, so the two entries move together.
  scatter: [
    { channel: 'x', ...POSITION },
    { channel: 'y', ...POSITION },
  ],
  point: [
    { channel: 'x', ...POSITION },
    { channel: 'y', ...POSITION },
  ],
  histogram: [{ channel: 'x', ...POSITION }],
  bar: [
    { channel: 'x', scale: 'discrete' },
    { channel: 'y', ...QUANTITY },
  ],
  heatmap: [
    { channel: 'x', scale: 'discrete' },
    { channel: 'y', scale: 'discrete' },
    { channel: 'color', ...QUANTITY },
  ],
  boxplot: [
    { channel: 'x', scale: 'discrete' },
    { channel: 'y', ...QUANTITY },
  ],
  map: [{ channel: 'region', accepts: ['string'] }],
  // A node-link's x and y are ordinary positions — the layout act writes them
  // as plain number columns on the nodes table, and nothing about them is a
  // network. Its KEY is the thing no other kind has: a node's identity is what
  // the edges point at, and the by-name defaults above refuse role
  // 'identifier' on x and y (rightly — one mark per row on an axis is a list
  // rather than a chart). WHY the kind names `key` at all: a kind's row
  // REPLACES the by-name default whole (`requirementFor` takes the first whole
  // match and never merges field by field), and no by-name default mentions
  // `key`, `source` or `target` — so this row exists to make those channels
  // EXIST for `channelsOf` and `whatFits`, and the identifier the axes turn
  // away has somewhere to go. `key` refuses only what is evidence AGAINST an
  // identity: a magnitude is not one, and neither is the silence vocabulary.
  network: [
    { channel: 'x', ...POSITION },
    { channel: 'y', ...POSITION },
    { channel: 'key', notRoles: ['measure', 'absence'] },
    // WHY these six are optional: they are the EDGE layer's columns, so a
    // nodes-only layer binds none of them and still fits. `source`/`target`
    // are the edges table's OWN endpoint ids (a relation's `from.column`),
    // unconstrained because a node key may be a string or a number;
    // `bringOver` never writes them. `sourceX` … `targetY` are the POSITIONS
    // `bringOver` writes across the declared relations (source_x, source_y,
    // target_x, target_y) — and it is ALL FOUR or none: a layer binding three
    // is read as a nodes layer and draws no links (ui/src/contract/
    // renderers.tsx, `endpointFieldsOf`), so a partial carry-over is a missing
    // picture, not a partial one.
    { channel: 'source', optional: true },
    { channel: 'target', optional: true },
    { channel: 'sourceX', ...POSITION, optional: true },
    { channel: 'sourceY', ...POSITION, optional: true },
    { channel: 'targetX', ...POSITION, optional: true },
    { channel: 'targetY', ...POSITION, optional: true },
  ],
  table: [],
});

/**
 * Kinds a ONE-TABLE proposer may not offer. WHY: a node-link needs a declared
 * relation and a layout act's output, and `proposeCharts` sees neither — only
 * FitColumns — so it could never tell a laid-out nodes table from any table
 * with two numbers. A host that HAS the graph passes `kinds` explicitly, which
 * is what that input is for. The kind stays in `CHART_REQUIREMENTS` because
 * the validator and the renderer both need its row.
 */
export const KINDS_NOT_PROPOSED: readonly string[] = ['network'];

/**
 * The requirement in force for `channel` on a `chartKind` view: the def's
 * override wins, then the kind's own, then the by-name default; undefined when
 * no layer constrains the channel.
 */
export function requirementFor(chartKind: string, channel: string, overrides?: ChannelRequirements): ChannelRequirement | undefined {
  const fromDef = overrides?.[chartKind]?.find((r) => r.channel === channel);
  if (fromDef !== undefined) return fromDef;
  const fromKind = CHART_REQUIREMENTS[chartKind]?.find((r) => r.channel === channel);
  if (fromKind !== undefined) return fromKind;
  return DEFAULT_CHANNEL_REQUIREMENTS.find((r) => r.channel === channel);
}

/**
 * The chart kinds the requirement tables KNOW: the built-ins, in the order this
 * file lists them, plus any kind a def declared requirements of its own for.
 */
export function chartKindsOf(overrides?: ChannelRequirements): readonly string[] {
  return [...new Set([...Object.keys(CHART_REQUIREMENTS), ...Object.keys(overrides ?? {})])];
}

/**
 * The channels a chart kind BINDS — every channel some layer names for the kind
 * (a def's own first, then the built-in list), minus the ones the requirement
 * in force calls `optional`.
 *
 * The by-NAME defaults are deliberately not consulted: they say what `x` means
 * wherever it appears, not that a chart kind has an `x`. A kind no layer names
 * a channel for binds nothing — `table` is the built-in example, and it is why
 * `proposeCharts` has nothing to propose for one.
 */
export function channelsOf(chartKind: string, overrides?: ChannelRequirements): readonly string[] {
  const merged = new Map<string, ChannelRequirement>();
  for (const req of [...(overrides?.[chartKind] ?? []), ...(CHART_REQUIREMENTS[chartKind] ?? [])]) if (!merged.has(req.channel)) merged.set(req.channel, req);
  return [...merged.values()].filter((req) => req.optional !== true).map((req) => req.channel);
}
