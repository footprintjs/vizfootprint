/**
 * THE JUDGE — is this declaration a column, and what type is it?
 *
 * A derived column is judged ONCE, at declaration, against the table it will
 * read, with nothing moved: an op the grammar does not have, an op given the
 * wrong number of arguments, an op given the wrong KIND of argument, a column
 * the table does not hold — each of them a sentence that quotes the offending
 * value and says what is known, and none of them a column of silences somebody
 * has to explain later.
 *
 * The law it follows is the session's own first law: **judge before anything
 * moves.** The formula door already keeps it (`../analysis/formula.ts`), and
 * this is the same door widened to a tree — one sentence, never a throw, never
 * a half-judged answer.
 *
 * The second thing it answers is the type, and that is not a by-product. The
 * type of a derived column is COMPUTED from the op table at declaration; it is
 * never tallied from the values afterwards. So a column that is absent on every
 * row still knows it is a number, and a column whose bytes are ISO strings
 * still knows it is a date.
 *
 * ```ts
 * judgeExpr({ op: 'div', args: [{ col: 'cases' }, { col: 'population' }] }, 'cells', columns);
 * // { ok: true, type: 'number', reads: ['cases', 'population'], expr: … }
 *
 * judgeExpr({ op: 'div', args: [{ col: 'cases' }, { col: 'region' }] }, 'cells', columns);
 * // { ok: false, problem: 'argument 2 of the op "div" must be a number, and the column "region" is a string' }
 * ```
 *
 * The first customers are the column verb's declaration door and the sheet's
 * add-a-column panel; the walker never re-checks what the judge settled.
 */

import type { ColumnInfo, ColumnType } from '../data/types.js';
import { epochDayOf } from './dates.js';
import { CALENDARS, CAST_TARGETS, DATE_UNITS, OP_NAMES, opOf, RESERVED_OPS, wantAt, type ArgWant, type Op } from './ops.js';
import { OPS_VERSION, type Calendar, type DeriveJudgement, type DeriveType, type DerivedColumn, type Expr, type ExprJudgement, type Over } from './types.js';

/**
 * How deep a tree may nest.
 *
 * Not a performance ceiling: a tree deeper than this is a column no person can
 * read back, and an unreadable column cannot be checked by the one who has to
 * live with its numbers. It also bounds the recursion, so the walker below can
 * be a plain recursive function over a tree the judge already accepted.
 */
export const MAX_TREE_DEPTH = 32;

/**
 * How many nodes a tree may hold — counted as the walk VISITS them.
 *
 * The depth bounds the shape and not the work: a node reused as both arguments
 * of its parent is walked once per reference, so thirty-three shared objects
 * are billions of visits. A column a person can read back is a few dozen
 * nodes; this ceiling is far above any of them and far below a hang. WHY not
 * memoise by node identity instead: a shared node judged first inside a
 * reducer (folded) and then outside it would skip its `loose` recording and
 * silently turn a row column into an aggregate.
 */
export const MAX_TREE_NODES = 4096;

/** The types that can be put in an order — the ones `lt`, `between` and their family may compare. */
const ORDERED: readonly DeriveType[] = Object.freeze(['number', 'string', 'date']);

/** The keys the three node forms are told apart by. */
const FORMS: readonly string[] = Object.freeze(['col', 'lit', 'op']);

/** The only four keys a declaration may carry. */
const COLUMN_KEYS: readonly string[] = Object.freeze(['ops', 'kind', 'expr', 'over']);

/**
 * A judged node's type, or the absence a WRITTEN-DOWN `null` literal is. A
 * written-down absence has no type, so it may stand only where an op does not
 * pin one — inside `coalesce`, an `if` arm or a `case` fallback.
 */
type Judged = DeriveType | 'absent';

/** The one refusal channel. Caught at the doors below — it never escapes this module. */
class Refusal extends Error {}

function refuse(problem: string): never {
  throw new Refusal(problem);
}

// ── quoting the offending value ──────────────────────────────────────────────

/** A value as a refusal quotes it: short, written down, and never a stack trace. */
function showValue(value: unknown): string {
  // A number goes through `String` and not `JSON.stringify`, which writes NaN and Infinity as "null" — the two values a reader most needs to see.
  if (typeof value === 'number') return String(value);
  const text = written(value);
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

function written(value: unknown): string {
  if (typeof value === 'function') return 'a function';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return 'a value that cannot be written down';
  }
}

/** A node as a refusal NAMES it, once it is known to be a node — "the column "cases"" reads better than its JSON. */
function sketchOf(node: unknown): string {
  const record = node as Record<string, unknown>;
  if (typeof record['col'] === 'string') return `the column "${record['col']}"`;
  if (typeof record['op'] === 'string') return `the op "${record['op']}"`;
  return `the value ${showValue(record['lit'])}`;
}

// ── the table the tree reads ─────────────────────────────────────────────────

interface Ground {
  readonly table: string;
  readonly types: ReadonlyMap<string, ColumnType>;
  /** What the table has, as a refusal lists it. */
  readonly has: string;
  /** Every column the tree reads, in first-seen order. */
  readonly reads: string[];
  /**
   * Why a reducer may not stand here, or `null` when one may.
   *
   * A sentence and not a flag, because the three places a reducer is refused
   * are refused for three different reasons — no group was declared, this is
   * the group's own filter, or we are already inside a reducer — and a person
   * who wrote `sum` needs to know WHICH.
   */
  noReduce: string | null;
  /**
   * Set where a column READ cannot make this column vary within its group: a
   * reducer's own argument (folded away) and the group's `where` (which picks
   * rows and is no part of the value). Both are also places a reducer may not
   * stand, for two different reasons — {@link Ground.noReduce} says which.
   */
  folded: boolean;
  /** How many reducer nodes the tree holds — what the kind law is judged on. */
  reducers: number;
  /** How many nodes the walk has visited — what {@link MAX_TREE_NODES} is judged on. */
  nodes: number;
  /** The columns read OUTSIDE every reducer: the ones that can change within a group. */
  readonly loose: string[];
}

/** A reducer with no group named is the ordinary case, and this is what it is told. */
const NO_GROUP = 'a reducer needs to say which rows it runs over — declare over: { groupBy: [...] }, and an empty groupBy means the whole table';

function groundOf(table: string, columns: readonly ColumnInfo[], noReduce: string | null): Ground {
  return {
    table,
    types: new Map(columns.map((column) => [column.name, column.type] as const)),
    has: columns.length === 0 ? 'that table has no columns' : `it has ${columns.map((column) => column.name).join(', ')}`,
    reads: [],
    noReduce,
    folded: false,
    reducers: 0,
    nodes: 0,
    loose: [],
  };
}

// ── the walk ─────────────────────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The literal WORD a node holds, for the positions that take one written down. */
function wordOf(node: unknown): string | null {
  return isRecord(node) && typeof node['lit'] === 'string' ? node['lit'] : null;
}

function judgeNode(value: unknown, ground: Ground, depth: number): Judged {
  if (depth > MAX_TREE_DEPTH) {
    refuse(`this tree nests more than ${String(MAX_TREE_DEPTH)} deep — a column nobody can read back is a column nobody can check`);
  }
  ground.nodes += 1;
  if (ground.nodes > MAX_TREE_NODES) {
    refuse(`this tree has more than ${String(MAX_TREE_NODES)} nodes in it — a column nobody can read back is a column nobody can check`);
  }
  if (!isRecord(value)) refuse(`a node of a derived column is one of {col}, {lit} or {op, args}, and this one is ${showValue(value)}`);
  if ('param' in value) refuse('named parameters are reserved and not built — a column reads its table, and everything else it needs is written down in it');
  // WHY refused rather than read as the first form found: the judge is the one door, so the shape it
  // settles must be the shape every later walk reads — and the walks dispatch on different keys first.
  const forms = FORMS.filter((key) => key in value);
  if (forms.length > 1) refuse(`a node of a derived column is one of {col}, {lit} or {op, args}, and this one names ${forms.join(' and ')} at once`);
  if ('col' in value) return judgeCol(value, ground);
  if ('lit' in value) return judgeLit(value);
  if ('op' in value) return judgeOp(value, ground, depth);
  refuse(`a node of a derived column is one of {col}, {lit} or {op, args}, and this one is ${showValue(value)}`);
}

function judgeCol(node: Record<string, unknown>, ground: Ground): Judged {
  const name = node['col'];
  if (typeof name !== 'string') refuse(`a {col} node names its column with a string, and this one names ${showValue(name)}`);
  const type = typeOf(name, ground);
  if (!ground.reads.includes(name)) ground.reads.push(name);
  // Read outside every reducer, this column can change from row to row within a
  // group — which is the whole of what tells a row column from an aggregate.
  if (!ground.folded && !ground.loose.includes(name)) ground.loose.push(name);
  return type;
}

/** The type of one column of the table, refusing the two ways there is not one. */
function typeOf(name: string, ground: Ground): DeriveType {
  const type = ground.types.get(name);
  if (type === undefined) refuse(`this column reads "${name}", which table "${ground.table}" does not have — ${ground.has}`);
  // WHY refused rather than read: `unknown` is what the engine says when it could not tell, and a
  // column built on a type nobody can name is a column whose refusals would arrive one row at a time.
  if (type === 'unknown') refuse(`this column reads "${name}", which table "${ground.table}" holds as unknown — a derived column reads columns whose type is known`);
  return type;
}

function judgeLit(node: Record<string, unknown>): Judged {
  const value = node['lit'];
  if (value === null) return 'absent';
  if (typeof value === 'boolean') return 'boolean';
  // WHY a date and not a string: there is no date literal FORM, so ISO text is the only way to write a
  // date down — and a grammar in which no date constant can be written is a grammar with no date ops.
  if (typeof value === 'string') return epochDayOf(value) === null ? 'string' : 'date';
  // A literal that is not a finite number is not a value a column can hold — and `Infinity` is not something a log can carry.
  if (typeof value === 'number' && Number.isFinite(value)) return 'number';
  refuse(`a {lit} node holds a number, a string, a boolean or null, and this one holds ${showValue(value)}`);
}

/** One judged argument, kept for the agreement check that runs once the whole list is walked. */
interface Agreeing {
  readonly type: Judged;
  readonly node: unknown;
}

function judgeOp(node: Record<string, unknown>, ground: Ground, depth: number): Judged {
  const name = node['op'];
  if (typeof name !== 'string') refuse(`an {op} node names its op with a string, and this one names ${showValue(name)}`);
  const reserved = RESERVED_OPS[name];
  if (reserved !== undefined) refuse(`the op "${name}" is reserved: ${reserved}`);
  const op = opOf(name);
  if (op === undefined) refuse(`there is no op named "${name}" — the ops this version knows are ${OP_NAMES.join(', ')}`);
  const args: unknown = node['args'];
  if (!Array.isArray(args)) refuse(`the op "${name}" carries its arguments in a list, and this one carries ${showValue(args)}`);
  const count = args.length;
  if (count < op.least || count > op.most || (op.odd === true && count % 2 === 0)) {
    refuse(`the op "${name}" takes ${op.takes}, and it was given ${String(count)}`);
  }
  if (op.reduces === true) return judgeReducer(op, name, args, node['calendar'], ground, depth);
  return judgeArgs(op, name, args, node['calendar'], ground, depth);
}

/**
 * A reducer, and the three places it may not stand.
 *
 * Its ARGUMENT is judged as an ordinary row tree with reducing switched off —
 * which is both the nesting refusal and the reason `sum(if(cond, x, absent))`
 * is a legal SUMIF. The columns it reads are not `loose`: they are folded away
 * inside the group and cannot change the answer from row to row.
 */
function judgeReducer(op: Op, name: string, args: readonly unknown[], calendar: unknown, ground: Ground, depth: number): Judged {
  if (ground.noReduce !== null) refuse(`the op "${name}" folds many rows into one answer, and ${ground.noReduce}`);
  if (ground.folded) refuse(`the op "${name}" stands inside another reducer, and a reducer inside a reducer has no rows of its own to run over`);
  ground.reducers += 1;
  ground.folded = true;
  const type = judgeArgs(op, name, args, calendar, ground, depth);
  ground.folded = false;
  return type;
}

/** Every argument of an op, and then the type its row's rule says the whole thing has. */
function judgeArgs(op: Op, name: string, args: readonly unknown[], calendar: unknown, ground: Ground, depth: number): Judged {
  const count = args.length;
  const agreeing: Agreeing[] = [];
  for (let at = 0; at < count; at += 1) {
    const arg: unknown = args[at];
    const want = wantAt(op, at, count);
    if (want === 'unit' || want === 'target') {
      judgeWord(name, at, want, arg);
      continue;
    }
    const type = judgeNode(arg, ground, depth + 1);
    if (want === 'same' || want === 'ordered') agreeing.push({ type, node: arg });
    else if (want !== 'any' && type !== want) refuse(mismatch(name, at, want, arg, type));
  }
  // Every `same`/`ordered` position settles on ONE type — for `eq` and `lt` that is the whole check, and for `if` it is also the answer.
  const agreed = agreeing.length === 0 ? null : agreedOn(op, name, agreeing);
  judgeCalendar(calendar, op, name, args);
  return yieldOf(op, args, agreed);
}

/** A position that takes a word written down — the unit a date op counts in, the type a cast reads as. */
function judgeWord(name: string, at: number, want: 'unit' | 'target', arg: unknown): void {
  const words: readonly string[] = want === 'unit' ? DATE_UNITS : CAST_TARGETS;
  const word = wordOf(arg);
  if (word !== null && words.includes(word)) return;
  const what = want === 'unit' ? 'the unit it counts in' : 'the type it reads as';
  // WHY written down and never computed: a unit that came from a cell is a column whose meaning changes row by row.
  refuse(`argument ${String(at + 1)} of the op "${name}" is ${what}, written down as one of ${words.join(', ')} — and it was given ${showValue(arg)}`);
}

/**
 * The way out of the one type disagreement that is a shape accident: an
 * ISO-shaped constant is read as a date, so beside a string it is refused —
 * and the refusal must name the cast, or it reads as the judge contradicting
 * what the person can see. Empty for every other pair.
 */
function castDoor(dated: unknown, other: Judged): string {
  const word = wordOf(dated);
  if (word === null || other !== 'string') return '';
  return ` — an ISO-shaped constant reads as a date; to compare it as text, cast it: { op: "cast", args: [{ lit: ${JSON.stringify(word)} }, { lit: "string" }] }`;
}

function mismatch(name: string, at: number, want: ArgWant, arg: unknown, type: Judged): string {
  const head = `argument ${String(at + 1)} of the op "${name}" must be a ${want}`;
  if (type === 'absent') {
    return `${head}, and ${sketchOf(arg)} is a written-down absence, which has no type — one may stand only where an op does not pin one: inside coalesce, an if arm or a case fallback`;
  }
  return `${head}, and ${sketchOf(arg)} is a ${type}${type === 'date' ? castDoor(arg, want as Judged) : ''}`;
}

/**
 * Calendars are data: an op whose answer moves with which day a week starts on
 * MUST say which calendar counted it, and an op whose answer does not may not
 * pretend otherwise.
 */
function judgeCalendar(declared: unknown, op: Op, name: string, args: readonly unknown[]): void {
  const byWeek = op.calendar === 'when-week' && wordOf(args[op.wants.indexOf('unit')]) === 'week';
  if (op.calendar !== 'always' && !byWeek) {
    if (declared === undefined) return;
    refuse(
      op.calendar === undefined
        ? `the op "${name}" does not count on a calendar, so it may not name one — only week, dayOfWeek and a dateTrunc by week do`
        : `a ${name} by ${String(wordOf(args[op.wants.indexOf('unit')]))} does not depend on which day a week starts, so it may not name a calendar`,
    );
  }
  if (declared === undefined) {
    refuse(`the op "${name}" must say which calendar counts its weeks — one of ${CALENDARS.join(', ')} — because a week number that does not say agrees with nothing and disagrees silently`);
  }
  if (!CALENDARS.includes(declared as Calendar)) refuse(`${showValue(declared)} is not a calendar this version knows — the calendars are ${CALENDARS.join(', ')}`);
}

/** The type the op's result has, by the rule its row declares. */
function yieldOf(op: Op, args: readonly unknown[], agreed: DeriveType | null): DeriveType {
  if (op.yields === 'target') return wordOf(args[op.wants.indexOf('target')]) as DeriveType;
  if (op.yields !== 'args') return op.yields;
  // WHY safe: every row whose `yields` is 'args' (if, case, coalesce, rowMin, rowMax, min, max) has at least one
  // `same`/`ordered` position that is always reached, so `agreedOn` ran and either settled on a type or refused.
  return agreed!;
}

/** Every `same`/`ordered` position settles on ONE type. */
function agreedOn(op: Op, name: string, agreeing: readonly Agreeing[]): DeriveType {
  let agreed: DeriveType | null = null;
  let first: unknown;
  for (const entry of agreeing) {
    if (entry.type === 'absent') continue;
    if (agreed === null) {
      agreed = entry.type;
      first = entry.node;
    } else if (entry.type !== agreed) {
      const door = entry.type === 'date' ? castDoor(entry.node, agreed) : agreed === 'date' ? castDoor(first, entry.type) : '';
      refuse(`the op "${name}" needs its arguments to be of ONE type, and ${sketchOf(entry.node)} is a ${entry.type} where ${sketchOf(first)} is a ${agreed}${door}`);
    }
  }
  if (agreed === null) refuse(`the op "${name}" was given nothing but absences, so nothing in it says what type the column would be`);
  if (op.wants.includes('ordered') && !ORDERED.includes(agreed)) {
    refuse(`the op "${name}" puts its arguments in an order, and a ${agreed} has none — the types that do are ${ORDERED.join(', ')}`);
  }
  return agreed;
}

// ── the doors ────────────────────────────────────────────────────────────────

/** The one place a {@link Refusal} becomes an answer. Every door below is this function. */
function caught<T extends object>(work: () => T): ({ readonly ok: true } & T) | { readonly ok: false; readonly problem: string } {
  try {
    return { ok: true, ...work() };
  } catch (error) {
    /* v8 ignore next 2 -- `Refusal` is this module's only throw; the rethrow exists so a genuine bug never reads as a declaration problem */
    if (!(error instanceof Refusal)) throw error;
    return { ok: false, problem: error.message };
  }
}

/**
 * Judge one tree against the table it will read.
 *
 * Total over any value: it answers with the tree, the type it computes and the
 * columns it reads, or with the ONE sentence saying what is wrong — never a
 * throw, and never a half-judged tree. The types are the ENGINE'S own
 * ({@link ColumnInfo}), so a column this refuses is a column the dashboard also
 * calls text: there is no second sniffer here.
 *
 * A BARE tree has no group beside it, so a reducer in one is refused with the
 * sentence that says how to give it one.
 */
export function judgeExpr(value: unknown, table: string, columns: readonly ColumnInfo[]): ExprJudgement {
  return caught(() => {
    const ground = groundOf(table, columns, NO_GROUP);
    const type = judgeNode(value, ground, 1);
    // WHY refused: a tree that is `null` on every row of every table is a column with no answers in it at all.
    if (type === 'absent') refuse('this column is an absence on every row, so nothing in it says what type it would be');
    return { expr: value as Expr, type, reads: [...ground.reads] };
  });
}

// ── the group ────────────────────────────────────────────────────────────────

/** The only two keys an `over` may carry. */
const OVER_KEYS: readonly string[] = Object.freeze(['groupBy', 'where']);

/**
 * Judge the group a reducer runs over, and answer it back as data.
 *
 * The grouping columns are judged HERE and not by the tree walk, because they
 * are not read by the expression — they name the rows that go together — and a
 * refusal that said "this column reads x" about a group would send a person to
 * the wrong part of their own declaration.
 *
 * `where` IS a tree, judged against the same table, and it must come to a
 * boolean: a filter that answered a number would be picking rows by a rule
 * nobody wrote down. A reducer may not stand in it — the filter chooses the
 * rows a group is made of, so it cannot ask what that group came to.
 */
function judgeOver(value: unknown, ground: Ground): Over {
  if (!isRecord(value)) refuse(`a column's group is { groupBy, where? }, and this one is ${showValue(value)}`);
  for (const key of Object.keys(value)) {
    if (!OVER_KEYS.includes(key)) refuse(`a column's group names groupBy and where, and this one also names "${key}"`);
  }
  const groupBy: unknown = value['groupBy'];
  if (!Array.isArray(groupBy) || groupBy.some((name) => typeof name !== 'string')) {
    refuse(`over.groupBy is the list of columns whose values make the groups — [] means the whole table — and this one is ${showValue(groupBy)}`);
  }
  const named: string[] = [];
  for (const name of groupBy as readonly string[]) {
    if (named.includes(name)) refuse(`over.groupBy names "${name}" twice, and a column can only group by it once`);
    // The read's two refusals, reworded here in the group's own words — both of them.
    const type = ground.types.get(name);
    if (type === undefined) refuse(`this column groups by "${name}", which table "${ground.table}" does not have — ${ground.has}`);
    if (type === 'unknown') refuse(`this column groups by "${name}", which table "${ground.table}" holds as unknown — a column groups by columns whose type is known`);
    named.push(name);
    // The group is judged before the tree, so `reads` holds only the earlier grouping columns — and a repeat was refused above.
    ground.reads.push(name);
  }
  const raw: unknown = value['where'];
  if (raw === undefined) return { groupBy: named };
  // Nothing `where` reads is part of the VALUE, so its columns are not what
  // tells a row column from an aggregate — hence `folded`, beside the refusal
  // that keeps a reducer out of it.
  ground.noReduce = 'over.where picks the rows a group is made of, so it cannot itself ask what a group came to';
  ground.folded = true;
  const type = judgeNode(raw, ground, 1);
  ground.noReduce = null;
  ground.folded = false;
  if (type !== 'boolean') {
    refuse(`over.where says which rows the reducer runs over, so it must come to a boolean, and this one comes to ${type === 'absent' ? 'an absence' : `a ${type}`}`);
  }
  return { groupBy: named, where: raw as Expr };
}

/**
 * THE KIND LAW — the word a declaration says about itself, held to the tree.
 *
 * A column is an AGGREGATE when it is the same on every row of its group, and
 * that is checkable rather than a matter of taste: it holds a reducer, and
 * every column it reads outside one is a grouping column (which cannot vary
 * within the group by definition). Malloy makes the same split between a
 * dimension and a measure; here the judge enforces it in both directions, so a
 * caption that says "an aggregate" is quoting a fact.
 */
function judgeKind(kind: string, over: Over | undefined, ground: Ground): void {
  // WHY nothing here about a reducer with no group: the tree walk already
  // refused every one of them, in the sentence that says how to give it a group.
  if (over === undefined) {
    if (kind === 'aggregate') refuse(`an aggregate column is one a reducer folds, and this one holds none — ${NO_GROUP}`);
    return;
  }
  if (ground.reducers === 0) {
    refuse('this column names a group and holds no reducer, so the group would fold nothing — a group is the rows a reducer runs over');
  }
  const varying = ground.loose.filter((name) => !over.groupBy.includes(name));
  if (kind === 'aggregate' && varying.length > 0) {
    refuse(`this column says it is an aggregate, and it reads "${varying[0]!}" outside its reducers — a column that changes within its own group is a row column`);
  }
  if (kind === 'row' && varying.length === 0) {
    refuse('this column says it is a row column, and every part of it is the same on every row of its group — that is an aggregate');
  }
}

/**
 * Judge a whole declaration: the op-vocabulary version, the kind, the group and
 * the tree.
 *
 * `window` is refused BY NAME rather than as an unknown word — a person who
 * declares one has understood the model correctly and is early, and the
 * sentence should say what is missing rather than that the word is unknown.
 */
export function judgeDerivedColumn(value: unknown, table: string, columns: readonly ColumnInfo[]): DeriveJudgement {
  return caught(() => {
    if (!isRecord(value)) refuse(`a derived column is a declaration — { ops, kind, expr, over? } — and this one is ${showValue(value)}`);
    // WHY refused and not dropped: a typo'd `over` would otherwise turn a refusal into a silent success, and the column minted below carries only the four keys.
    for (const key of Object.keys(value)) {
      if (!COLUMN_KEYS.includes(key)) refuse(`a derived column names ops, kind, expr and over, and this one also names "${key}"`);
    }
    if (value['ops'] !== OPS_VERSION) {
      refuse(`this column is written against ops ${showValue(value['ops'])}, and this build knows ops ${String(OPS_VERSION)}`);
    }
    const kind = value['kind'];
    if (kind === 'window') refuse('a window column needs an ordering as well as a group, and an ordering is not in this version');
    if (kind !== 'row' && kind !== 'aggregate') refuse(`a derived column's kind is row or aggregate, and this one says ${showValue(kind)}`);
    // A GROUP FIRST: the tree is judged knowing whether a reducer may stand in
    // it, so `sum` with no group is told how to get one rather than told the
    // op is unknown.
    const ground = groundOf(table, columns, value['over'] === undefined ? NO_GROUP : null);
    const over = value['over'] === undefined ? undefined : judgeOver(value['over'], ground);
    const type = judgeNode(value['expr'], ground, 1);
    if (type === 'absent') refuse('this column is an absence on every row, so nothing in it says what type it would be');
    judgeKind(kind, over, ground);
    const column: DerivedColumn = { ops: OPS_VERSION, kind, expr: value['expr'] as Expr, ...(over === undefined ? {} : { over }) };
    return { column, type, reads: [...ground.reads] };
  });
}
