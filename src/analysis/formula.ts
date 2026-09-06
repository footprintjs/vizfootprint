/**
 * THE FORMULA — a derived column a person can write, as data.
 *
 * Everything else in this folder is an analysis a DEVELOPER wrote: a flowchart,
 * a fit, a statistic. A formula is the one analysis whose whole content is a
 * sentence somebody typed — `cases / population * 1000` — and that is exactly
 * why it needs its own evaluator rather than the language's. `eval`, `new
 * Function` and a prototype walk are all ways of running a person's text as a
 * PROGRAM, and the text on this door is not a program: it is an arithmetic
 * expression over the columns of one table, and nothing in this file can
 * express anything else.
 *
 * So the grammar is written out by hand and it is the whole of what may be
 * said:
 *
 *     expression := term (('+' | '-') term)*
 *     term       := unary (('*' | '/') unary)*
 *     unary      := '-' unary | primary
 *     primary    := number | column | call | '(' expression ')'
 *     call       := function '(' expression (',' expression)* ')'
 *     column     := identifier | '"' any name '"'
 *
 * A tokenizer, a precedence parser to an AST, and a walker over one row. No
 * strings, no comparisons, no assignment, no property access, no calls but the
 * five named below. **Anything outside the grammar is refused at PARSE, in a
 * sentence naming the token and where it sits** — never at run, over a row,
 * once half a column has already been computed.
 *
 * ## A silence stays a silence
 *
 * One rule covers every arithmetic edge, and it is the rule the rest of this
 * library already keeps: an absence is not a number and must not become one.
 * **A step that cannot produce a finite number produces `null`, and `null`
 * spreads through everything above it.** So a division by zero is `null`, never
 * `Infinity`; a row whose column is empty, or text, or a date, is `null` for
 * that row, never `0`; `log(0)` is `null`, never `-Infinity`. A column of
 * silences reads as a column of silences.
 */

import { flowChart } from 'footprintjs';
import type { FlowChart } from 'footprintjs';
import { columnar, foldOnce } from '../data/fold.js';
import type { ColumnInfo } from '../data/types.js';
import { defineAnalysis } from './defineAnalysis.js';
import type { DataRow } from './builtins.js';
import type { AnalysisModule, ColumnsOutput } from './types.js';

// ── the functions, and nothing else ──────────────────────────────────────────

/**
 * What each function is called, how many arguments it takes (in numbers for the
 * check and in WORDS for the refusal, so neither has to be derived from the
 * other), and what it does.
 *
 * Five, closed: a name that is not here is refused at parse. `log` is the
 * natural logarithm — and, by the silence rule above, `log(0)` and `log(-1)`
 * are `null` rather than `-Infinity` and `NaN`.
 */
interface FormulaFunction {
  readonly least: number;
  readonly most: number;
  /** How many arguments it takes, as a refusal says it. */
  readonly takes: string;
  readonly of: (args: readonly number[]) => number;
}

const FUNCTIONS: Readonly<Record<string, FormulaFunction>> = Object.freeze({
  abs: { least: 1, most: 1, takes: 'one argument', of: (a) => Math.abs(a[0]!) },
  log: { least: 1, most: 1, takes: 'one argument', of: (a) => Math.log(a[0]!) },
  max: { least: 2, most: Number.POSITIVE_INFINITY, takes: 'two or more arguments', of: (a) => Math.max(...a) },
  min: { least: 2, most: Number.POSITIVE_INFINITY, takes: 'two or more arguments', of: (a) => Math.min(...a) },
  round: { least: 1, most: 1, takes: 'one argument', of: (a) => Math.round(a[0]!) },
});

/** The function names a formula may call, in the order a refusal lists them. */
export const FORMULA_FUNCTIONS: readonly string[] = Object.freeze(Object.keys(FUNCTIONS));

// ── the tree ─────────────────────────────────────────────────────────────────

/** One node of a parsed formula. Inert data: a walker reads it, nothing executes it. */
export type FormulaNode =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'column'; readonly name: string }
  | { readonly kind: 'negate'; readonly of: FormulaNode }
  | { readonly kind: 'binary'; readonly op: '+' | '-' | '*' | '/'; readonly left: FormulaNode; readonly right: FormulaNode }
  | { readonly kind: 'call'; readonly name: string; readonly args: readonly FormulaNode[] };

/** A parsed formula, or the one sentence saying why it is not one. */
export type FormulaParse =
  | { readonly ok: true; readonly node: FormulaNode; readonly columns: readonly string[] }
  | { readonly ok: false; readonly problem: string };

/** Thrown by {@link formulaAnalysis} when it is handed an expression that does not parse. */
export class FormulaError extends Error {
  readonly problem: string;
  constructor(problem: string) {
    super(`invalid formula: ${problem}`);
    this.name = 'FormulaError';
    this.problem = problem;
  }
}

// ── the tokenizer ────────────────────────────────────────────────────────────

type TokenKind = 'number' | 'name' | 'column' | 'op' | '(' | ')' | ',' | 'end';

interface Token {
  readonly kind: TokenKind;
  /** The token as it was written — what a refusal quotes back. */
  readonly text: string;
  /** Where it starts, counted from 1, the way a person counts the characters they typed. */
  readonly at: number;
  /** A number token's value; a name or column token's name. */
  readonly value?: number | string;
}

/** The one refusal channel. Caught at the door of {@link parseFormula} — it never escapes this module. */
class Refusal extends Error {}

function refuse(problem: string): never {
  throw new Refusal(problem);
}

const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const isNameStart = (c: string): boolean => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
const isNameRest = (c: string): boolean => isNameStart(c) || isDigit(c);
const isSpace = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r';

/**
 * The text as tokens. Every character is either part of a token this grammar
 * has a rule for, or the reason the formula is refused — there is no third
 * outcome, and no character is silently skipped.
 */
function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (isSpace(c)) {
      i += 1;
      continue;
    }
    const at = i + 1;
    if (isDigit(c) || (c === '.' && isDigit(text[i + 1] ?? ''))) {
      let j = i;
      while (j < text.length && isDigit(text[j]!)) j += 1;
      if (text[j] === '.') {
        j += 1;
        while (j < text.length && isDigit(text[j]!)) j += 1;
      }
      const raw = text.slice(i, j);
      // A second point is a second number stuck to the first — never a decimal.
      if (text[j] === '.') refuse(`"${raw}." at position ${String(at)} is not a number — a number has one decimal point`);
      out.push({ kind: 'number', text: raw, at, value: Number(raw) });
      i = j;
      continue;
    }
    if (isNameStart(c)) {
      let j = i;
      while (j < text.length && isNameRest(text[j]!)) j += 1;
      const raw = text.slice(i, j);
      out.push({ kind: 'name', text: raw, at, value: raw });
      i = j;
      continue;
    }
    if (c === '"') {
      const close = text.indexOf('"', i + 1);
      if (close === -1) refuse(`the column name opened with " at position ${String(at)} is never closed`);
      const raw = text.slice(i + 1, close);
      if (raw.length === 0) refuse(`the empty name at position ${String(at)} is not a column`);
      out.push({ kind: 'column', text: raw, at, value: raw });
      i = close + 1;
      continue;
    }
    if (c === '+' || c === '-' || c === '*' || c === '/') {
      out.push({ kind: 'op', text: c, at });
      i += 1;
      continue;
    }
    if (c === '(' || c === ')' || c === ',') {
      out.push({ kind: c, text: c, at });
      i += 1;
      continue;
    }
    refuse(`the formula has no rule for "${c}" at position ${String(at)}`);
  }
  out.push({ kind: 'end', text: '', at: text.length + 1 });
  return out;
}

// ── the parser ───────────────────────────────────────────────────────────────

/**
 * A precedence parser over the tokens: `+`/`-` bind loosest, then `*`/`/`, then
 * a unary minus, then a primary. Recursive descent, one method per rule, so the
 * grammar in this file's header and the code below are the same six lines.
 */
class Parser {
  private at = 0;
  /** Every column the formula mentions, in first-seen order — the read-set the judge checks. */
  readonly columns: string[] = [];

  constructor(private readonly tokens: readonly Token[]) {}

  private peek(): Token {
    return this.tokens[this.at]!;
  }

  private take(): Token {
    const token = this.tokens[this.at]!;
    this.at += 1;
    return token;
  }

  private note(name: string): void {
    if (!this.columns.includes(name)) this.columns.push(name);
  }

  parse(): FormulaNode {
    const node = this.expression();
    const rest = this.peek();
    if (rest.kind !== 'end') refuse(`"${rest.text}" at position ${String(rest.at)} is not part of the formula`);
    return node;
  }

  private expression(): FormulaNode {
    let left = this.term();
    for (let token = this.peek(); token.kind === 'op' && (token.text === '+' || token.text === '-'); token = this.peek()) {
      this.take();
      left = { kind: 'binary', op: token.text, left, right: this.term() };
    }
    return left;
  }

  private term(): FormulaNode {
    let left = this.unary();
    for (let token = this.peek(); token.kind === 'op' && (token.text === '*' || token.text === '/'); token = this.peek()) {
      this.take();
      left = { kind: 'binary', op: token.text, left, right: this.unary() };
    }
    return left;
  }

  private unary(): FormulaNode {
    const token = this.peek();
    if (token.kind === 'op' && token.text === '-') {
      this.take();
      return { kind: 'negate', of: this.unary() };
    }
    return this.primary();
  }

  private primary(): FormulaNode {
    const token = this.take();
    if (token.kind === 'number') return { kind: 'number', value: token.value as number };
    if (token.kind === 'column') {
      const name = token.value as string;
      this.note(name);
      return { kind: 'column', name };
    }
    if (token.kind === '(') {
      const inner = this.expression();
      if (this.take().kind !== ')') refuse(`the "(" at position ${String(token.at)} is never closed`);
      return inner;
    }
    if (token.kind === 'name') {
      const name = token.value as string;
      const fn = FUNCTIONS[name];
      if (this.peek().kind === '(') {
        if (fn === undefined) {
          refuse(`there is no function named "${name}" at position ${String(token.at)} — the formula knows ${FORMULA_FUNCTIONS.join(', ')}`);
        }
        return this.call(name, fn, token.at);
      }
      // A bare name that IS a function is a function somebody forgot to call.
      // Saying so is more use than reading it as a column nobody has.
      if (fn !== undefined) refuse(`"${name}" at position ${String(token.at)} is a function and needs its arguments in ( )`);
      this.note(name);
      return { kind: 'column', name };
    }
    refuse(
      token.kind === 'end'
        ? `the formula stops at position ${String(token.at)} — something is missing at the end`
        : `"${token.text}" at position ${String(token.at)} is not where a value can go`,
    );
  }

  private call(name: string, fn: FormulaFunction, at: number): FormulaNode {
    this.take(); // the '('
    const args: FormulaNode[] = [this.expression()];
    for (let token = this.peek(); token.kind === ','; token = this.peek()) {
      this.take();
      args.push(this.expression());
    }
    if (this.take().kind !== ')') refuse(`the arguments of "${name}" at position ${String(at)} are never closed`);
    if (args.length < fn.least || args.length > fn.most) {
      refuse(`"${name}" at position ${String(at)} takes ${fn.takes}, and it was given ${String(args.length)}`);
    }
    return { kind: 'call', name, args };
  }
}

/**
 * Read a formula. Total over any string: it answers with the tree and the
 * columns the tree reads, or with the ONE sentence saying what is wrong and
 * where — never a throw, and never a half-parsed tree.
 *
 * ```ts
 * parseFormula('cases / 1000');
 * // { ok: true, node: {…}, columns: ['cases'] }
 * parseFormula('cases % 2');
 * // { ok: false, problem: 'the formula has no rule for "%" at position 7' }
 * ```
 */
export function parseFormula(expression: string): FormulaParse {
  if (expression.trim().length === 0) {
    return { ok: false, problem: "the formula is empty — write an expression over this table's number columns" };
  }
  try {
    const parser = new Parser(tokenize(expression));
    const node = parser.parse();
    return { ok: true, node, columns: [...parser.columns] };
  } catch (error) {
    /* v8 ignore next 2 -- `Refusal` is this module's only throw; the rethrow exists so a genuine bug never reads as a formula problem */
    if (!(error instanceof Refusal)) throw error;
    return { ok: false, problem: error.message };
  }
}

// ── the walker ───────────────────────────────────────────────────────────────

/** A cell as a number, or `null` when it is not one — text, a date, a boolean, an absence. */
function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A number, or the silence it really is. The whole of the arithmetic-edge law. */
function finite(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

/** Where one cell's value comes from. The walker's only way of reaching data — a row, or a column and an index. */
export type CellReader = (column: string) => unknown;

/**
 * One walk of the tree. `null` is the answer whenever an answer would not be a
 * finite number, and it spreads: a `null` anywhere under a node makes that node
 * `null` too. That single rule is what makes a division by zero, an empty cell
 * and `log(0)` all read the same way — as a silence, which is what they are.
 *
 * The reader is a parameter and not a row, so there is ONE walker: the row door
 * below and the columnar walk the chart runs are the same code seen from two
 * sides, and neither can drift into a second opinion about what a formula means.
 */
export function evaluateWith(node: FormulaNode, read: CellReader): number | null {
  switch (node.kind) {
    case 'number':
      return node.value;
    case 'column':
      return asNumber(read(node.name));
    case 'negate': {
      const of = evaluateWith(node.of, read);
      return of === null ? null : finite(-of);
    }
    case 'binary': {
      const left = evaluateWith(node.left, read);
      if (left === null) return null;
      const right = evaluateWith(node.right, read);
      if (right === null) return null;
      return finite(node.op === '+' ? left + right : node.op === '-' ? left - right : node.op === '*' ? left * right : left / right);
    }
    case 'call': {
      const args: number[] = [];
      for (const arg of node.args) {
        const value = evaluateWith(arg, read);
        if (value === null) return null;
        args.push(value);
      }
      return finite(FUNCTIONS[node.name]!.of(args));
    }
  }
}

/** One ROW through the tree — the door a caller holding rows wants. */
export function evaluateFormula(node: FormulaNode, row: DataRow): number | null {
  return evaluateWith(node, (name) => (row as Record<string, unknown>)[name]);
}

// ── the judge ────────────────────────────────────────────────────────────────

/**
 * Judge a parsed formula against the table it will read: every column it
 * mentions must BE a column of that table, and must be one the engine calls a
 * number. Sentences, one per problem, and never a throw.
 *
 * The type rule is the engine's own — `ColumnInfo.type` is what `describeTable`
 * and the memory provider both settle on — so a column this refuses is a column
 * the dashboard also calls text.
 */
export function formulaColumnProblems(
  expression: string,
  referenced: readonly string[],
  table: string,
  columns: readonly ColumnInfo[],
): string[] {
  const problems: string[] = [];
  const types = new Map(columns.map((c) => [c.name, c.type] as const));
  const numbers = columns.filter((c) => c.type === 'number').map((c) => c.name);
  const knows = numbers.length === 0 ? 'this table has no number columns' : `the numbers it may read are ${numbers.join(', ')}`;
  for (const name of referenced) {
    const type = types.get(name);
    if (type === undefined) {
      problems.push(`the formula "${expression}" reads "${name}", which table "${table}" does not have — ${knows}`);
    } else if (type !== 'number') {
      problems.push(`the formula "${expression}" reads "${name}", which table "${table}" holds as ${type} — a formula reads numbers`);
    }
  }
  return problems;
}

// ── the analysis ─────────────────────────────────────────────────────────────

/** The type a formula's column is DECLARED as — the columns channel's own vocabulary, narrowed to what arithmetic can produce. */
export type FormulaColumnType = 'int' | 'float';

export interface FormulaOptions {
  /** The expression, in the grammar above. */
  readonly expression: string;
  /** The column it writes. A derived column may never take a source column's name — the session's own law judges that. */
  readonly name: string;
  /** The table the column is written into. Default `data`. */
  readonly table?: string;
  /** What the column is declared as. Default `float` — division is the point of a formula. */
  readonly type?: FormulaColumnType;
  /** Default `formula:<name>`. */
  readonly id?: string;
}

/** What the chart is handed: the columns the formula reads, and how many rows there are. */
interface FormulaInput {
  readonly columns: Readonly<Record<string, readonly unknown[]>>;
  readonly rows: number;
}

/**
 * The two keys this chart uses beside the column's own, both DERIVED from the
 * column name so neither can ever collide with it.
 *
 * footprintjs guards an input key as readonly and THROWS on a colliding write,
 * and the final committed key here has to BE the column's name (that is the key
 * `writeColumns` reads the values back off). A fixed arg name would therefore
 * break the day somebody derived a column called `rows`. Both of these are
 * strictly longer than the column name, and differ from each other, so no
 * column name can produce a collision.
 */
function chartKeys(column: string): { readonly arg: string; readonly held: string } {
  return { arg: `${column} input`, held: `${column} loaded` };
}

/**
 * The chart. Two stages, like every other analysis here: load, then walk.
 *
 * What it loads is **columns, not rows** — the arrays `columnar` folded out of
 * the table in one walk, and only for the columns the expression names. That is
 * smaller and faster than the whole table, but the reason it is written this way
 * is correctness: a value handed to the engine is COMMITTED, and a committed
 * value is frozen. Handing over the provider's own row objects would freeze the
 * table itself, and the next analysis to materialize a column into it would find
 * the rows unextensible. Fresh arrays of the cells are ours to give.
 */
function buildFormulaChart(node: FormulaNode, column: string): FlowChart {
  const { arg, held } = chartKeys(column);
  return flowChart<Record<string, unknown>>(
    'load the columns it reads',
    (scope) => {
      const args = scope.$getArgs<Record<string, FormulaInput>>();
      scope.$setValue(held, args[arg]!);
    },
    'load',
  )
    .addFunction(
      'evaluate the formula',
      (scope) => {
        const input = scope.$getValue(held) as FormulaInput;
        // ONE closure over a moving index, rather than one per row: the walker
        // reaches data only through this, so the columnar walk and the row door
        // are the same evaluation.
        let at = 0;
        const read: CellReader = (name) => input.columns[name]?.[at];
        const values: (number | null)[] = [];
        for (at = 0; at < input.rows; at += 1) values.push(evaluateWith(node, read));
        scope.$setValue(column, values);
      },
      'formula',
    )
    .build();
}

/**
 * A formula as an analysis: `produces: 'columns'`, run row-wise over the table
 * it reads, landing ONE column at the act's own slot through the same path
 * every other columns-channel analysis uses.
 *
 * The expression is parsed HERE, once, before anything is built — an expression
 * that is not in the grammar throws {@link FormulaError} rather than reaching a
 * row. A record declared through the def never gets this far unparsed: the def
 * door parses it as part of validating the record, so a person reads a sentence
 * and not a stack trace.
 */
export function formulaAnalysis(opts: FormulaOptions): AnalysisModule<readonly DataRow[], ColumnsOutput> {
  const parsed = parseFormula(opts.expression);
  if (!parsed.ok) throw new FormulaError(parsed.problem);
  const column = opts.name;
  const table = opts.table ?? 'data';
  const type = opts.type ?? 'float';
  return defineAnalysis<readonly DataRow[], ColumnsOutput>({
    id: opts.id ?? `formula:${column}`,
    kind: 'transform',
    produces: 'columns',
    inputs: parsed.columns.map((name) => ({ column: name, role: 'value' })),
    // JUDGE BEFORE ANYTHING MOVES: the session asks this the moment the act is
    // declared, with the columns visible at the cursor — so a formula over a
    // column this table does not have, or holds as text, is a sentence and no
    // commit, rather than a column of nulls nobody asked for.
    judgeTable: (readTable, columns) => formulaColumnProblems(opts.expression, parsed.columns, readTable, columns),
    build: () => buildFormulaChart(parsed.node, column),
    // ONE walk of the table, folding out only the columns the formula names.
    toRunInput: (rows) => ({
      [chartKeys(column).arg]: { columns: foldOnce(rows, { c: columnar(parsed.columns) }).c, rows: rows.length } satisfies FormulaInput,
    }),
    readOutput: () => ({
      ok: true,
      output: { as: 'columns', table, columns: { [column]: { type } } },
    }),
  });
}
