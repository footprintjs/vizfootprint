/**
 * VALIDATE — refusals at declaration, in plain sentences. An edge whose kind
 * is not in the source's voice, whose ends are not declared views, or that
 * repeats another edge's (source, kind, target) is refused before any session
 * exists. The aggregation-crossing rule: an edge whose source emits over an
 * aggregate the target does not show must state its `fold` — judged only when
 * both views declare a grain (see grain.ts).
 */
import { ENCODING_KIND, ENCODING_RESPONSES, LINK_DEFAULTS, LINK_KINDS, LINK_ON_CLEAR, LINK_RESPONSES, edgeId, type LinkKind, type LinkView } from './types.js';
import { crossesGrain, grainWords } from './grain.js';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Push problems for `links` / `linkDefault` onto `problems`; `views` are the declared views with their voices. */
export function validateLinks(links: unknown, linkDefault: unknown, views: readonly LinkView[], problems: string[]): void {
  if (linkDefault !== undefined && !(LINK_DEFAULTS as readonly unknown[]).includes(linkDefault)) {
    problems.push(`linkDefault, if present, must be one of ${LINK_DEFAULTS.join('|')}`);
  }
  if (links === undefined) return;
  if (!Array.isArray(links)) {
    problems.push('links, if present, must be an array of LinkDecl');
    return;
  }
  const voices = new Map(views.map((v) => [v.viewId, v.voice]));
  const channelsOf = new Map(views.map((v) => [v.viewId, v.channels]));
  const viewById = new Map(views.map((v) => [v.viewId, v]));
  const seen = new Set<string>();
  links.forEach((link, i) => {
    const where = `links[${i}]`;
    if (!isObject(link)) {
      problems.push(`${where} must be an object { source, kind, target, response, mapping?, channels?, onClear?, fold?, label? }`);
      return;
    }
    for (const key of Object.keys(link)) {
      if (!['source', 'kind', 'target', 'response', 'mapping', 'channels', 'onClear', 'fold', 'label'].includes(key)) problems.push(`${where}: unknown key "${key}"`);
    }
    const isEncodingEdge = link.kind === ENCODING_KIND;
    if (!nonEmpty(link.source)) problems.push(`${where}.source must be a declared view id`);
    else if (!voices.has(link.source)) problems.push(`${where}.source "${link.source}" is not a declared view`);
    if (!nonEmpty(link.target)) problems.push(`${where}.target must be a declared view id`);
    else if (!voices.has(link.target)) problems.push(`${where}.target "${link.target}" is not a declared view`);
    if (nonEmpty(link.source) && link.source === link.target) problems.push(`${where}: a view cannot link to itself (self-exclusion is the rule)`);
    if (!(LINK_KINDS as readonly unknown[]).includes(link.kind)) {
      problems.push(`${where}.kind must be one of ${LINK_KINDS.join('|')}`);
    } else if (nonEmpty(link.source) && voices.has(link.source) && !voices.get(link.source)!.includes(link.kind as LinkKind)) {
      const voice = voices.get(link.source)!;
      problems.push(
        isEncodingEdge
          ? `${where}: view "${link.source}" declares no encoding surface — it has no binding to follow`
          : `${where}: view "${link.source}" does not emit ${String(link.kind)} — its voice is ${voice.filter((k) => k !== ENCODING_KIND).join(', ') || 'silent (canProbe: false)'}`,
      );
    }
    if (isEncodingEdge) {
      if (!(ENCODING_RESPONSES as readonly unknown[]).includes(link.response)) problems.push(`${where}.response: an encoding edge's response must be one of ${ENCODING_RESPONSES.join('|')}`);
      if (nonEmpty(link.target) && voices.has(link.target) && channelsOf.get(link.target) === undefined) {
        problems.push(`${where}: view "${link.target}" declares no encoding surface — nothing to follow into`);
      }
      if (link.channels !== undefined) {
        if (!Array.isArray(link.channels) || link.channels.some((c) => !isObject(c) || !nonEmpty(c.from) || !nonEmpty(c.to))) {
          problems.push(`${where}.channels, if present, must be an array of { from, to } channel names`);
        } else {
          link.channels.forEach((pair, j) => {
            const c = pair as { from: string; to: string };
            const sourceChannels = nonEmpty(link.source) ? channelsOf.get(link.source) : undefined;
            const targetChannels = nonEmpty(link.target) ? channelsOf.get(link.target) : undefined;
            if (sourceChannels !== undefined && !sourceChannels.includes(c.from)) problems.push(`${where}.channels[${j}]: view "${link.source}" has no "${c.from}" channel — valid: ${sourceChannels.join(', ')}`);
            if (targetChannels !== undefined && !targetChannels.includes(c.to)) problems.push(`${where}.channels[${j}]: view "${link.target}" has no "${c.to}" channel — valid: ${targetChannels.join(', ')}`);
          });
        }
      }
      if (link.onClear !== undefined) problems.push(`${where}.onClear does not apply to an encoding edge — a binding is never cleared`);
      if (link.fold !== undefined) problems.push(`${where}.fold does not apply to an encoding edge — a binding has no grain`);
    } else {
      if (!(LINK_RESPONSES as readonly unknown[]).includes(link.response)) problems.push(`${where}.response must be one of ${LINK_RESPONSES.join('|')}`);
      if (link.channels !== undefined) problems.push(`${where}.channels applies to an encoding edge only`);
      // the aggregation-crossing rule: judged only when both grains are declared, and only where rows FOLD —
      // filter and highlight; navigate moves a viewport, mirror outlines a value, none carries nothing across
      if (link.fold === undefined && (link.response === 'filter' || link.response === 'highlight') && nonEmpty(link.source) && nonEmpty(link.target)) {
        const sv = viewById.get(link.source);
        const tv = viewById.get(link.target);
        if (sv?.grain !== undefined && tv?.grain !== undefined && crossesGrain(sv, tv)) {
          problems.push(`${where}: view "${link.source}" emits over ${grainWords(sv.grain)} and view "${link.target}" shows ${grainWords(tv.grain)} — an edge that crosses grains must state its fold`);
        }
      }
    }
    if (link.mapping !== undefined) {
      if (!Array.isArray(link.mapping) || link.mapping.some((m) => !isObject(m) || !nonEmpty(m.from) || !nonEmpty(m.to))) {
        problems.push(`${where}.mapping, if present, must be an array of { from, to } field names`);
      }
    }
    if (!isEncodingEdge && link.onClear !== undefined && !(LINK_ON_CLEAR as readonly unknown[]).includes(link.onClear)) problems.push(`${where}.onClear, if present, must be one of ${LINK_ON_CLEAR.join('|')}`);
    if (!isEncodingEdge && link.fold !== undefined && !nonEmpty(link.fold)) problems.push(`${where}.fold, if present, must be a non-empty string`);
    if (link.label !== undefined && typeof link.label !== 'string') problems.push(`${where}.label, if present, must be a string`);
    if (nonEmpty(link.source) && nonEmpty(link.target) && (LINK_KINDS as readonly unknown[]).includes(link.kind)) {
      const id = edgeId(link.source, link.kind as LinkKind, link.target);
      if (seen.has(id)) problems.push(`${where} repeats the edge ${id} — one edge per (source, kind, target)`);
      seen.add(id);
    }
  });
}
