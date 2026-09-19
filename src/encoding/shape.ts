/**
 * Shape checks for the two doors that take a column DECLARATION — is
 * `encodingRules` / `columns` well-formed data (the def door), and is what an
 * ACT says about a column it lands one this vocabulary admits (the landing
 * door, {@link landedColumnProblems})? Sentences, appended to the caller's
 * list. Meaning (does a rule name a real column, does a binding fit) is the
 * validator's job, not this.
 */
import { CHANNEL_CLASSES, COLUMN_MEANING_KEYS, COLUMN_ROLES, COLUMN_SCALES, RULE_KINDS, RULE_SCOPES } from './types.js';

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const isName = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNameList = (v: unknown): v is readonly string[] => Array.isArray(v) && v.length > 0 && v.every(isName);
const COLUMN_TYPES = new Set(['number', 'string', 'boolean', 'date', 'unknown']);
const REQUIREMENT_KEYS = new Set(['channel', 'accepts', 'scale', 'roles', 'notRoles', 'optional', 'sentence']);
const RULES_KEYS = new Set(['channels', 'rules', 'onInvalid', 'ruleScope']);
/** The five keys a DEF's column declaration may carry: the four vocabulary words, plus the type it may override. */
const COLUMN_DECL_KEYS = new Set<string>(['type', ...COLUMN_MEANING_KEYS]);
/** The four words alone — whether an ACT said any of them is what makes it the column's owner. */
const MEANING_KEYS: readonly string[] = COLUMN_MEANING_KEYS;

/**
 * `DataSourceDef.columns` — field → { type?, role?, scale?, label?, unit? }. A
 * state column may not claim another role.
 *
 * `absenceFields` is PLURAL because silence belongs to a column: a list
 * declaration has one state column per entry (`../data/silence.ts` ·
 * `TableSilence.stateColumns`), and each of them owes its role `absence`.
 */
export function validateColumnDecls(raw: unknown, where: string, problems: string[], absenceFields: readonly string[] = []): void {
  if (!isObject(raw)) {
    problems.push(`${where} must be an object mapping field -> { type?, role?, scale?, label?, unit? }`);
    return;
  }
  for (const [field, decl] of Object.entries(raw)) {
    const at = `${where}["${field}"]`;
    if (!isObject(decl)) {
      problems.push(`${at} must be an object`);
      continue;
    }
    for (const key of Object.keys(decl)) if (!COLUMN_DECL_KEYS.has(key)) problems.push(`${at}.${key} is not a column declaration key`);
    if (decl.type !== undefined && !COLUMN_TYPES.has(decl.type as string)) problems.push(`${at}.type must be one of ${[...COLUMN_TYPES].join(', ')}`);
    if (decl.role !== undefined && !COLUMN_ROLES.includes(decl.role as never)) problems.push(`${at}.role must be one of ${COLUMN_ROLES.join(', ')}`);
    if (decl.scale !== undefined && !COLUMN_SCALES.includes(decl.scale as never)) problems.push(`${at}.scale must be one of ${COLUMN_SCALES.join(', ')}`);
    if (decl.label !== undefined && typeof decl.label !== 'string') problems.push(`${at}.label must be a string`);
    if (decl.unit !== undefined && typeof decl.unit !== 'string') problems.push(`${at}.unit must be a string`);
    if (absenceFields.includes(field) && decl.role !== undefined && decl.role !== 'absence') {
      problems.push(`${at}.role is "${String(decl.role)}" but "${field}" is the table's declared absence column — its role is absence`);
    }
  }
}

/** The keys an ACT's landed column may carry — {@link COLUMN_DECL_KEYS}'s twin, and the same five words. */
const LANDED_COLUMN_KEYS = COLUMN_DECL_KEYS;

/**
 * THE LANDING DOOR'S TWIN of {@link validateColumnDecls}: is what an ACT says
 * about one column it lands a declaration this vocabulary admits, and is the
 * def silent about that column?
 *
 * ── WHAT IS JUDGED, AND WHAT DELIBERATELY IS NOT ───────────────────────────
 * The four {@link ColumnMeaning} words and the keys. `type` is NOT judged: it
 * is the act's own shape vocabulary, it was always required, and every act
 * written before an act could speak carries it alone — judging it here would
 * move an output that has never moved. So an act that declares nothing beyond
 * `type` has nothing judged and nothing refused, which is the whole of the
 * existing world.
 *
 * ── AND WHY A DEF ENTRY IS A PROBLEM AT ALL ────────────────────────────────
 * One column, one owner, and the act owns the one it lands
 * (`./facets.ts` · `meaningOf`). Two authorities over one name is the fault
 * the landing door already refuses one law along — a computed column may not
 * take a declared column's name — and the answer is the same: the column does
 * not land, the refusal names both places, and the repair is to delete one.
 * NOT "identical is allowed": a def entry nothing reads is a declaration
 * waiting to be believed, and an entry that agrees today is one edit from
 * disagreeing silently.
 *
 * `decl` is the def's `data[table].columns` for the table landed ON, or
 * undefined when the def declares none (a derived table, a table with no
 * `columns` map). `at` names the act and the column; the caller owns the
 * sentence's subject, so the same judge serves `declareAnalysis` and `replay`.
 *
 * Returns one sentence per problem, an empty array for "nothing to say" —
 * `judgeTable`'s own shape, and never a throw.
 */
export function landedColumnProblems(raw: unknown, at: string, field: string, decl: unknown): string[] {
  const problems: string[] = [];
  if (!isObject(raw)) return [`${at} must be an object { type, role?, scale?, label?, unit? }`];
  for (const key of Object.keys(raw)) if (!LANDED_COLUMN_KEYS.has(key)) problems.push(`${at} carries "${key}", which is not a landed column key (${[...LANDED_COLUMN_KEYS].join(', ')})`);
  if (raw.role !== undefined && !COLUMN_ROLES.includes(raw.role as never)) problems.push(`${at} declares role "${String(raw.role)}" — a role is one of ${COLUMN_ROLES.join(', ')}`);
  if (raw.scale !== undefined && !COLUMN_SCALES.includes(raw.scale as never)) problems.push(`${at} declares scale "${String(raw.scale)}" — a scale is one of ${COLUMN_SCALES.join(', ')}`);
  if (raw.label !== undefined && typeof raw.label !== 'string') problems.push(`${at} declares a label that is not a string`);
  if (raw.unit !== undefined && typeof raw.unit !== 'string') problems.push(`${at} declares a unit that is not a string`);
  // The act SPOKE only if it said one of the four words — `type` alone is the world as it was.
  const spoke = MEANING_KEYS.some((key) => raw[key] !== undefined);
  if (spoke && isObject(decl)) {
    problems.push(
      `${at} declares what it lands, and the definition declares "${field}" too — a column has ONE owner and the act owns the one it lands, so this column was not written. Delete the definition's entry for "${field}", or take the declaration off the act.`,
    );
  }
  return problems;
}

/** `DashboardDef.encodingRules` — { channels?, rules?, onInvalid?, ruleScope? }. */
export function validateEncodingRulesShape(raw: unknown, where: string, problems: string[]): void {
  if (!isObject(raw)) {
    problems.push(`${where} must be an object { channels?, rules?, onInvalid?, ruleScope? }`);
    return;
  }
  for (const key of Object.keys(raw)) if (!RULES_KEYS.has(key)) problems.push(`${where}.${key} is not an encodingRules key`);
  if (raw.onInvalid !== undefined && !isName(raw.onInvalid)) problems.push(`${where}.onInvalid must be "refuse" or the name of a coercer passed at build`);
  if (raw.ruleScope !== undefined && !RULE_SCOPES.includes(raw.ruleScope as never)) problems.push(`${where}.ruleScope must be one of ${RULE_SCOPES.join(', ')}`);
  if (raw.channels !== undefined) {
    if (!isObject(raw.channels)) problems.push(`${where}.channels must be an object mapping chartKind -> ChannelRequirement[]`);
    else {
      for (const [kind, list] of Object.entries(raw.channels)) {
        if (!Array.isArray(list)) {
          problems.push(`${where}.channels["${kind}"] must be an array of ChannelRequirement`);
          continue;
        }
        list.forEach((req, i) => validateRequirement(req, `${where}.channels["${kind}"][${i}]`, problems));
      }
    }
  }
  if (raw.rules !== undefined) {
    if (!Array.isArray(raw.rules)) problems.push(`${where}.rules must be an array of BusinessRule`);
    else raw.rules.forEach((rule, i) => validateRule(rule, `${where}.rules[${i}]`, problems));
  }
}

function validateRequirement(raw: unknown, at: string, problems: string[]): void {
  if (!isObject(raw)) {
    problems.push(`${at} must be an object`);
    return;
  }
  for (const key of Object.keys(raw)) if (!REQUIREMENT_KEYS.has(key)) problems.push(`${at}.${key} is not a ChannelRequirement key`);
  if (!isName(raw.channel)) problems.push(`${at}.channel must be a non-empty string`);
  else if (raw.channel === '*') problems.push(`${at}.channel may not be "*" — it is reserved for a binding set`);
  if (raw.accepts !== undefined && !(Array.isArray(raw.accepts) && raw.accepts.every((t) => COLUMN_TYPES.has(t as string)))) {
    problems.push(`${at}.accepts must be an array of column types (${[...COLUMN_TYPES].join(', ')})`);
  }
  if (raw.scale !== undefined && !COLUMN_SCALES.includes(raw.scale as never)) problems.push(`${at}.scale must be one of ${COLUMN_SCALES.join(', ')}`);
  for (const key of ['roles', 'notRoles'] as const) {
    if (raw[key] !== undefined && !(Array.isArray(raw[key]) && (raw[key] as unknown[]).every((r) => COLUMN_ROLES.includes(r as never)))) {
      problems.push(`${at}.${key} must be an array of roles (${COLUMN_ROLES.join(', ')})`);
    }
  }
  if (raw.optional !== undefined && typeof raw.optional !== 'boolean') problems.push(`${at}.optional must be true or false`);
  if (raw.sentence !== undefined && typeof raw.sentence !== 'string') problems.push(`${at}.sentence must be a string`);
}

function validateRule(raw: unknown, at: string, problems: string[]): void {
  if (!isObject(raw)) {
    problems.push(`${at} must be an object`);
    return;
  }
  if (!RULE_KINDS.includes(raw.rule as never)) {
    problems.push(`${at}.rule must be one of ${RULE_KINDS.join(', ')}`);
    return;
  }
  if (raw.id !== undefined && !isName(raw.id)) problems.push(`${at}.id must be a non-empty string`);
  if (raw.sentence !== undefined && typeof raw.sentence !== 'string') problems.push(`${at}.sentence must be a string`);
  if (raw.scope !== undefined && !RULE_SCOPES.includes(raw.scope as never)) problems.push(`${at}.scope must be one of ${RULE_SCOPES.join(', ')}`);
  switch (raw.rule) {
    case 'never-on': {
      const byColumn = raw.column !== undefined;
      const byRole = raw.role !== undefined;
      if (byColumn === byRole) problems.push(`${at} must name exactly one of column, role`);
      if (byColumn && !isName(raw.column)) problems.push(`${at}.column must be a non-empty string`);
      if (byRole && !COLUMN_ROLES.includes(raw.role as never)) problems.push(`${at}.role must be one of ${COLUMN_ROLES.join(', ')}`);
      const byChannels = raw.channels !== undefined;
      const byClass = raw.class !== undefined;
      if (byChannels === byClass) problems.push(`${at} must name exactly one of channels, class`);
      if (byChannels && !isNameList(raw.channels)) problems.push(`${at}.channels must be a non-empty array of channel names`);
      if (byClass && !(raw.class as string in CHANNEL_CLASSES)) problems.push(`${at}.class must be one of ${Object.keys(CHANNEL_CLASSES).join(', ')}`);
      if (raw.scope !== undefined) problems.push(`${at}.scope does not apply to never-on`);
      break;
    }
    case 'never-together': {
      const cols = raw.columns;
      if (!(Array.isArray(cols) && cols.length === 2 && cols.every(isName))) problems.push(`${at}.columns must be exactly two column names`);
      else if (cols[0] === cols[1]) problems.push(`${at}.columns names the same column twice`);
      break;
    }
    case 'only-with': {
      if (!isName(raw.column)) problems.push(`${at}.column must be a non-empty string`);
      if (!isName(raw.companion)) problems.push(`${at}.companion must be a non-empty string`);
      if (isName(raw.column) && raw.column === raw.companion) problems.push(`${at}.companion is the column itself`);
      break;
    }
  }
}
