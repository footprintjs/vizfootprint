/**
 * THE ONE READER that answers "what TYPE does this expression land?" over a
 * table whose column types are DECLARED — without running it, and without
 * refusing anything.
 *
 * ## Why it exists beside the judge
 *
 * {@link ./judge.ts} answers the same question, but it answers it as a DOOR:
 * it needs every column's type to be known, and it refuses — with a sentence —
 * the moment one is not. That is right for a column somebody is declaring.
 * It is wrong for the def door, which reads a definition's aggregate to learn
 * what the act will land and must survive a parent table that declared no
 * types at all. So this reader is TOTAL: every op, every shape, and an honest
 * `'unknown'` for anything it cannot settle without running the act.
 *
 * The RULE itself is not re-implemented here — {@link yieldOf} in the judge
 * owns "what does this op's `yields` row say", and this file supplies it the
 * argument agreement it needs. One owner, two callers with opposite manners.
 *
 * ## What `'unknown'` means here
 *
 * Exactly what it means everywhere else in the engine: nobody could tell. It
 * is the answer for a column the parent did not declare, for a column the
 * parent DERIVES (its type is its own act's to answer, and it is not in
 * `DataSourceDef.columns`), for two arms of one `if` that disagree, for a
 * tree malformed enough that the judge would refuse it, and for a tree the
 * judge would refuse OUTRIGHT regardless of type — a `min`/`max` over a
 * column that has no order (a boolean), or a reducer standing inside another
 * reducer's own argument. Those two are not type disagreements; they are
 * shapes this op family can never legally take, so a type answer for them
 * would name a column that will never exist. A guess would be worse than the
 * gap: the encoding door declines to judge an `unknown` facet, so an honest
 * `'unknown'` costs a door refusal and a wrong type buys a wrong one.
 */

import type { ColumnType } from '../data/types.js';
import { epochDayOf } from './dates.js';
import { MAX_TREE_DEPTH, MAX_TREE_NODES, ORDERED, yieldOf } from './judge.js';
import { opOf, wantAt, type Op } from './ops.js';
import type { DeriveType } from './types.js';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * One node as this reader settles it: a type, the written-down ABSENCE a
 * `{lit: null}` is, or `null` for "could not tell".
 *
 * WHY absence is its own answer and not `null`: the judge's agreement law skips
 * an absent arm (`coalesce(x, absent)` is the type of `x`), and a reader that
 * could not tell the two apart would have to choose between calling that whole
 * tree unknown and calling a genuinely unresolved arm agreeable.
 */
type Read = DeriveType | 'absent' | null;

/**
 * How many nodes this walk has visited — the ceiling the judge already keeps,
 * kept here for the same reason — and whether the walk stands inside a
 * reducer's own argument, the judge's `ground.folded` under a different name.
 *
 * WHY folded travels here and not as its own parameter: a reducer's argument
 * is walked by the same recursive `typeAt`/`opType` pair every other node is,
 * and threading a second flag through every call for one op family the walker
 * mostly never revisits is the kind of edit that gets forgotten at the next
 * new op. The budget already visits every node, so it is where a fact ABOUT
 * the walk belongs.
 */
interface Budget {
  nodes: number;
  folded: boolean;
}

/**
 * The type an expression lands over a table's DECLARED column types, or
 * `'unknown'` when it cannot be settled without running.
 *
 * `types` is the parent's declaration read as a plain map — a column absent
 * from it, or present as `'unknown'`, is one this reader cannot use.
 *
 * ```ts
 * resultTypeOf({ op: 'count', args: [{ col: 'planet' }] }, { planet: 'string' }); // 'number' — count says so whatever it counts
 * resultTypeOf({ op: 'min', args: [{ col: 'radius' }] }, { radius: 'number' });    // 'number' — min yields the type it reduces
 * resultTypeOf({ op: 'min', args: [{ col: 'seen' }] }, { seen: 'date' });          // 'date'
 * resultTypeOf({ op: 'min', args: [{ col: 'seen' }] }, {});                        // 'unknown' — the parent never said
 * ```
 */
export function resultTypeOf(expr: unknown, types: Readonly<Record<string, ColumnType>>): ColumnType {
  const read = typeAt(expr, types, 0, { nodes: 0, folded: false });
  // a written-down absence is not a type either, and a column that lands one is a column nobody can say the type of
  return read === null || read === 'absent' ? 'unknown' : read;
}

/** One node, by its form — the three forms the grammar has, and "could not tell" for everything else. */
function typeAt(node: unknown, types: Readonly<Record<string, ColumnType>>, depth: number, budget: Budget): Read {
  if (depth > MAX_TREE_DEPTH) return null;
  budget.nodes += 1;
  if (budget.nodes > MAX_TREE_NODES) return null;
  if (!isRecord(node)) return null;
  if ('col' in node) return declaredType(node['col'], types);
  if ('lit' in node) return literalType(node['lit']);
  if ('op' in node) return opType(node, types, depth, budget);
  return null;
}

/** A column read: the parent's own declaration, and nothing else. An undeclared column — or one declared `unknown` — is one this reader cannot use. */
function declaredType(name: unknown, types: Readonly<Record<string, ColumnType>>): Read {
  if (typeof name !== 'string') return null;
  const declared = types[name];
  return declared === undefined || declared === 'unknown' ? null : declared;
}

/** A literal, by the same law the judge reads one by: ISO text is a date, because the grammar has no other way to write one down. */
function literalType(value: unknown): Read {
  if (value === null) return 'absent';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') return epochDayOf(value) === null ? 'string' : 'date';
  if (typeof value === 'number' && Number.isFinite(value)) return 'number';
  return null;
}

/**
 * An op: its row's `yields` rule, applied to whatever agreement its arguments
 * reach.
 *
 * WHY only the `same`/`ordered` positions are walked: they are the ONLY ones
 * the answer can come from. A fixed want (`sum` wants a number) cannot change
 * what the row yields, so `sum` over a column nobody declared is still a
 * number — the brief's own rule — and a `unit` or `target` position holds a
 * written WORD, which {@link yieldOf} reads for itself.
 */
function opType(node: Record<string, unknown>, types: Readonly<Record<string, ColumnType>>, depth: number, budget: Budget): Read {
  const name = node['op'];
  if (typeof name !== 'string') return null;
  const op = opOf(name);
  if (op === undefined) return null;
  // a reducer inside a reducer's own argument has no rows of its own to run over — the judge refuses
  // it structurally (`judgeReducer`'s `ground.folded` check), before it ever asks about types, and this
  // reader must not name a type for a tree that can never exist
  if (op.reduces === true && budget.folded) return null;
  const args: unknown = node['args'];
  // a shape the judge would refuse by name is a shape this reader has no answer for — it does not
  // get to guess what the author meant, and the refusal arrives on its own line from the act door
  if (!Array.isArray(args) || !countFits(op, args.length)) return null;
  const wasFolded = budget.folded;
  if (op.reduces === true) budget.folded = true;
  const agreed = agreementOf(op, args, types, depth, budget);
  budget.folded = wasFolded;
  if (agreed === 'unresolved') return null;
  return yieldOf(op, args, agreed);
}

/** The arity law, read from the row — the same three clauses the judge refuses on. */
function countFits(op: Op, count: number): boolean {
  return count >= op.least && count <= op.most && !(op.odd === true && count % 2 === 0);
}

/**
 * What the `same`/`ordered` positions settle on: one type, `null` for "there
 * were none" (the rule will not need it), or `'unresolved'` when a position
 * could not be read or two positions disagreed.
 */
function agreementOf(op: Op, args: readonly unknown[], types: Readonly<Record<string, ColumnType>>, depth: number, budget: Budget): DeriveType | null | 'unresolved' {
  let agreed: DeriveType | null = null;
  for (let at = 0; at < args.length; at += 1) {
    const want = wantAt(op, at, args.length);
    if (want !== 'same' && want !== 'ordered') continue;
    const read = typeAt(args[at], types, depth + 1, budget);
    if (read === 'absent') continue; // the judge's own law: a written-down absence has no type to agree with
    if (read === null) return 'unresolved';
    if (agreed === null) agreed = read;
    else if (agreed !== read) return 'unresolved'; // two kinds in one order — the judge refuses it, and no one type is the answer
  }
  // the judge's other half of `agreedOn`: an `ordered` position needs a type that HAS an order, and a
  // `min`/`max`/`rowMin`/`rowMax` over a boolean is refused for that reason alone — this reader must
  // answer `unknown` for it rather than a type that op can never actually produce
  if (agreed !== null && op.wants.includes('ordered') && !ORDERED.includes(agreed)) return 'unresolved';
  return agreed;
}
