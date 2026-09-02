/**
 * The built-in channel requirements — what each chart kind's channels accept
 * — and the merge that lets a def add or override them per kind. Two layers:
 * a requirement BY CHANNEL NAME that holds for any chart kind (x carries a
 * magnitude wherever it appears), and per-kind specifics on top (a line's x
 * is continuous, a heatmap's x is discrete). A def's `encodingRules.channels`
 * sits above both. A channel no layer mentions accepts anything.
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
    { channel: 'x', ...POSITION, scale: 'continuous' },
    { channel: 'y', ...QUANTITY },
    { channel: 'color', scale: 'discrete' },
  ],
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
  table: [],
});

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
