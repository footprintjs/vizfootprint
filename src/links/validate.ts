/**
 * VALIDATE — refusals at declaration, in plain sentences. An edge whose kind
 * is not in the source's voice, whose ends are not declared views, or that
 * repeats another edge's (source, kind, target) is refused before any session
 * exists. The aggregation-crossing rule: an edge whose source emits over an
 * aggregate the target does not show must state its `fold` — judged only when
 * both views declare a grain (see grain.ts).
 */
import { ENCODING_KIND, ENCODING_RESPONSES, LINK_DEFAULTS, LINK_KINDS, LINK_ON_CLEAR, LINK_RESPONSES, edgeId, type FieldMapping, type LinkKind, type LinkView } from './types.js';
import { crossesGrain, grainWords } from './grain.js';
import { unmappedColumn, unmappedColumnWords, unreachableWords, viewsCanReach, type TableReach } from './reach.js';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/**
 * Push problems for `links` / `linkDefault` onto `problems`; `views` are the
 * declared views with their voices.
 *
 * @param reach - What the TABLES say about reaching one another (`./reach.ts`).
 *   Omitted = the reach rule is not judged, which is what every caller that
 *   knows no tables gets.
 */
export function validateLinks(links: unknown, linkDefault: unknown, views: readonly LinkView[], problems: string[], reach?: TableReach): void {
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
  /**
   * One END of an edge, judged in order: named, declared, and a place that
   * READS ROWS. THE FRAME IS ITS LAYERS: an endpoint that IS a declared view
   * but reads nothing at its own address (`LinkView.frame`) is refused by THAT
   * name, never as "not a declared view" — it is declared; what it lacks is
   * rows for an edge to carry anything to or from. The remedy is the list the
   * map already holds: the layer addresses that read for it. One judge for
   * both ends, so an author meets the same words whichever end named a frame.
   */
  const judgeEnd = (where: string, end: 'source' | 'target', address: unknown): void => {
    if (!nonEmpty(address)) problems.push(`${where}.${end} must be a declared view id`);
    else if (!voices.has(address)) problems.push(`${where}.${end} "${address}" is not a declared view`);
    else if (viewById.get(address)!.frame !== undefined) problems.push(`${where}.${end} "${address}" is a frame that reads only through its layers — name one: ${viewById.get(address)!.frame!.join(', ')}`);
  };
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
    judgeEnd(where, 'source', link.source);
    judgeEnd(where, 'target', link.target);
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
      // THE REACH RULE, where it is knowable at the DOOR: an edge whose clause
      // could never be judged where it lands is a promise nothing can keep, and
      // it is refused by name rather than left to fail on somebody's gesture.
      //
      // Judged for `filter` ALONE. WHY that narrow: `filter` is the one
      // response that makes an ENGINE judge the source's sentence against the
      // target's rows, so an unjudgeable filter is a read that would have
      // failed — the exact break this packet exists for. `highlight` and
      // `mirror` are DRAWN, not queried: an unjudgeable one dims nothing and
      // costs no read, and law 3 reports it on the clause.
      //
      // TWO grounds, never both judged on the same edge: with no `mapping`,
      // the tables' own reach decides (a declared relation, or a shared column
      // name — `tablesCanReach`). With a `mapping`, the author has NAMED the
      // landing column by hand, which voids the shared-column-name evidence
      // entirely (two unrelated tables may still be joined by an aimed
      // mapping) — but the name itself is now evidence of its own, and
      // `unmappedColumn` judges THAT instead: a mapping onto a column the
      // target does not have is an author error, not a coincidence, and
      // review found the first cut of this door skipped it (a mapped-but-wrong
      // edge was caught nowhere).
      //
      // Where the rule is NOT knowable here — a table that declares no columns
      // (so `reach.columns` has no entry for it), or a field that depends on
      // the gesture — law 2 catches it at run time: the unmapped case narrows
      // and reports (`../session/clausesReaching.ts` · `unjudgeableColumn`);
      // the mapped case still REFUSES, because an aim that misses is an author
      // error wherever it is caught (`../session/session.ts` · `viewClauses`,
      // `ReachingClause.mappedFields`).
      if (link.response === 'filter' && nonEmpty(link.source) && nonEmpty(link.target)) {
        const sv = viewById.get(link.source);
        const tv = viewById.get(link.target);
        if (link.mapping === undefined) {
          if (sv !== undefined && tv !== undefined && !viewsCanReach(sv, tv, reach)) {
            problems.push(`${where}: ${unreachableWords(sv, tv)}. Declare a relation between the tables, map the field to one the target has, or write response: 'none'`);
          }
        } else if (Array.isArray(link.mapping) && tv?.table !== undefined) {
          // malformed entries are skipped here — the shape check below refuses them by name; this ground only judges the well-formed ones.
          // `tv.table`, not `link.target` — `reach.columns` is keyed by TABLE, and an unstated table is the ignorance ground already refuses to judge on.
          const wellFormed = link.mapping.filter((m): m is FieldMapping => isObject(m) && nonEmpty(m.from) && nonEmpty(m.to));
          const bad = unmappedColumn(wellFormed, tv.table, reach);
          if (bad !== undefined) {
            problems.push(`${where}: ${unmappedColumnWords(link.source, tv.table, bad)}. Name a column the table has, or write response: 'none'`);
          }
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
