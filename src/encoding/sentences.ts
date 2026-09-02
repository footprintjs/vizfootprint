/**
 * The refusal sentences — templates beside the rules, filled with the names
 * of the act. The same words for the person, the agent and the test suite;
 * an explainer port may ADD prose, never replace these.
 */
export const SENTENCES = Object.freeze({
  notAColumn: '"{column}" is not a column of the table',
  accepts: '"{column}" is {type}; the {channel} channel of a {chart} needs {accepts}',
  scale: '"{column}" is {scale}; the {channel} channel of a {chart} needs a {needScale} column',
  roles: '"{column}" is {role}; the {channel} channel of a {chart} only takes {roles}',
  notRoles: '"{column}" is {role} — it cannot be the {channel} of a {chart}',
  neverOn: '"{column}" never binds to {channel}',
  neverOnRole: '"{column}" is {role} — it never binds to {channel}',
  neverTogetherView: '"{column}" and "{other}" never share a chart',
  neverTogetherDashboard: '"{column}" and "{other}" never share the page',
  onlyWithView: '"{column}" is only meaningful with "{companion}" on the same chart — bind "{companion}" first',
  onlyWithDashboard: '"{column}" is only meaningful while "{companion}" is on the page — bind "{companion}" first',
});

/** Fill `{slot}` markers; a slot the caller did not name is left visible, never silently emptied. */
export function fill(template: string, slots: Readonly<Record<string, string | undefined>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => slots[key] ?? whole);
}

/** "a number or a date" for a list of accepted types. */
export function listOf(items: readonly string[]): string {
  if (items.length === 0) return 'nothing';
  if (items.length === 1) return `a ${items[0]}`;
  return `a ${items.slice(0, -1).join(', a ')} or a ${items[items.length - 1]}`;
}
