/**
 * Shape checks for the def door — is `encodingRules` / `columns` well-formed
 * data? Sentences, appended to the def validator's list. Meaning (does a rule
 * name a real column, does a binding fit) is the validator's job, not this.
 */
import { CHANNEL_CLASSES, COLUMN_ROLES, COLUMN_SCALES, RULE_KINDS, RULE_SCOPES } from './types.js';

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const isName = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNameList = (v: unknown): v is readonly string[] => Array.isArray(v) && v.length > 0 && v.every(isName);
const COLUMN_TYPES = new Set(['number', 'string', 'boolean', 'date', 'unknown']);
const REQUIREMENT_KEYS = new Set(['channel', 'accepts', 'scale', 'roles', 'notRoles', 'sentence']);
const RULES_KEYS = new Set(['channels', 'rules', 'onInvalid', 'ruleScope']);
const COLUMN_DECL_KEYS = new Set(['type', 'role', 'scale', 'label']);

/** `DataSourceDef.columns` — field → { role?, scale?, label? }. The absence column may not claim another role. */
export function validateColumnDecls(raw: unknown, where: string, problems: string[], absenceField?: string): void {
  if (!isObject(raw)) {
    problems.push(`${where} must be an object mapping field -> { type?, role?, scale?, label? }`);
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
    if (absenceField === field && decl.role !== undefined && decl.role !== 'absence') {
      problems.push(`${at}.role is "${String(decl.role)}" but "${field}" is the table's declared absence column — its role is absence`);
    }
  }
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
