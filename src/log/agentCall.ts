/**
 * The one validation/copy rule for native execution identity. A stored identity
 * is strict; a host context is structurally wider, so only its two identity
 * fields are copied. Every public mutation door asks this before doing work.
 */
export interface AgentCallIdentity {
  readonly toolCallId: string;
  readonly runId?: string;
}

export type AgentCallParseResult =
  | { readonly ok: true; readonly identity: AgentCallIdentity | undefined }
  | { readonly ok: false; readonly detail: string };

export function parseAgentCall(raw: unknown, options: { readonly optional?: boolean; readonly hostContext?: boolean } = {}): AgentCallParseResult {
  if (raw === undefined && options.optional === true) return { ok: true, identity: undefined };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, detail: 'agentCall must carry a non-empty toolCallId' };
  const value = raw as Record<string, unknown>;
  try {
    // Snapshot accessor-bearing host objects ONCE; validate the exact values
    // that will be saved, not a later read of the same property.
    const toolCallId = value.toolCallId;
    const runId = value.runId;
    if (typeof toolCallId !== 'string' || toolCallId.trim().length === 0) return { ok: false, detail: 'agentCall must carry a non-empty toolCallId' };
    if ('runId' in value && !(options.hostContext === true && runId === undefined) && (typeof runId !== 'string' || runId.trim().length === 0)) return { ok: false, detail: 'agentCall.runId, if present, must be a non-empty string' };
    if (options.hostContext !== true && Object.keys(value).some((key) => key !== 'toolCallId' && key !== 'runId')) return { ok: false, detail: 'agentCall carries an unknown key' };
    return { ok: true, identity: Object.freeze({ toolCallId, ...(typeof runId === 'string' ? { runId } : {}) }) };
  } catch {
    return { ok: false, detail: 'agentCall could not be read as native execution identity' };
  }
}
