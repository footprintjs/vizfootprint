/**
 * VALIDATE — refusals at declaration, in plain sentences. An edge whose kind
 * is not in the source's voice, whose ends are not declared views, or that
 * repeats another edge's (source, kind, target) is refused before any session
 * exists. The aggregation-crossing rule (`fold` required when an emission
 * crosses a grain) is NOT enforced yet: the def does not carry enough about
 * each view's grain to judge it honestly, so the README says so.
 */
import { EMISSION_KINDS, LINK_DEFAULTS, LINK_ON_CLEAR, LINK_RESPONSES, edgeId, type EmissionKind, type LinkView } from './types.js';

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
  const seen = new Set<string>();
  links.forEach((link, i) => {
    const where = `links[${i}]`;
    if (!isObject(link)) {
      problems.push(`${where} must be an object { source, kind, target, response, mapping?, onClear?, fold?, label? }`);
      return;
    }
    for (const key of Object.keys(link)) {
      if (!['source', 'kind', 'target', 'response', 'mapping', 'onClear', 'fold', 'label'].includes(key)) problems.push(`${where}: unknown key "${key}"`);
    }
    if (!nonEmpty(link.source)) problems.push(`${where}.source must be a declared view id`);
    else if (!voices.has(link.source)) problems.push(`${where}.source "${link.source}" is not a declared view`);
    if (!nonEmpty(link.target)) problems.push(`${where}.target must be a declared view id`);
    else if (!voices.has(link.target)) problems.push(`${where}.target "${link.target}" is not a declared view`);
    if (nonEmpty(link.source) && link.source === link.target) problems.push(`${where}: a view cannot link to itself (self-exclusion is the rule)`);
    if (!(EMISSION_KINDS as readonly unknown[]).includes(link.kind)) {
      problems.push(`${where}.kind must be one of ${EMISSION_KINDS.join('|')}`);
    } else if (nonEmpty(link.source) && voices.has(link.source) && !voices.get(link.source)!.includes(link.kind as EmissionKind)) {
      problems.push(`${where}: view "${link.source}" does not emit ${String(link.kind)} — its voice is ${voices.get(link.source)!.join(', ') || 'silent (canProbe: false)'}`);
    }
    if (!(LINK_RESPONSES as readonly unknown[]).includes(link.response)) problems.push(`${where}.response must be one of ${LINK_RESPONSES.join('|')}`);
    if (link.mapping !== undefined) {
      if (!Array.isArray(link.mapping) || link.mapping.some((m) => !isObject(m) || !nonEmpty(m.from) || !nonEmpty(m.to))) {
        problems.push(`${where}.mapping, if present, must be an array of { from, to } field names`);
      }
    }
    if (link.onClear !== undefined && !(LINK_ON_CLEAR as readonly unknown[]).includes(link.onClear)) problems.push(`${where}.onClear, if present, must be one of ${LINK_ON_CLEAR.join('|')}`);
    if (link.fold !== undefined && !nonEmpty(link.fold)) problems.push(`${where}.fold, if present, must be a non-empty string`);
    if (link.label !== undefined && typeof link.label !== 'string') problems.push(`${where}.label, if present, must be a string`);
    if (nonEmpty(link.source) && nonEmpty(link.target) && (EMISSION_KINDS as readonly unknown[]).includes(link.kind)) {
      const id = edgeId(link.source, link.kind as EmissionKind, link.target);
      if (seen.has(id)) problems.push(`${where} repeats the edge ${id} — one edge per (source, kind, target)`);
      seen.add(id);
    }
  });
}
