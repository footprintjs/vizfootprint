/**
 * Coverage packet COV-def — closes `demo-agent/src/def.ts`'s `withLayoutNavigate`
 * (LY-2): the demo-agent-only interception that lets the AGENT's `dispatch`
 * tool actually land a cockpit-layout arrangement, working around a gap in the
 * frozen `src/agent/vizAsTools.ts` (`buildAction`'s `navigate` case drops
 * `field`/`value` off every call — written for RP-1's declared-view pan/zoom
 * contract, never revisited when LY-1 added the `layout:${scope}` identity
 * that NEEDS them). See the doc comment on `withLayoutNavigate` itself.
 *
 * These call `buildAnalystSurface` directly and drive its returned `port`
 * (the SAME object `createAssistant`/the agent's tools wrap) — proving the
 * interception from the OUTSIDE, exactly the boundary the agent's `dispatch`
 * tool call crosses.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildAnalystSurface } from './def.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV = readFileSync(path.join(__dirname, '..', 'data', 'dresses.csv'), 'utf8');

describe('withLayoutNavigate — passthrough arms (every OTHER tool call is byte-identical to the raw vizAsTools port)', () => {
  it('a non-dispatch tool call (whats_here) passes straight through', async () => {
    const { port } = buildAnalystSurface(CSV);
    const res = await port.call('viz.whats_here', {});
    expect(res['ok']).toBe(true);
    expect(res).toHaveProperty('layouts', {}); // nothing landed yet — the honest empty fold
  });

  it('a call with NO args at all (the second parameter omitted) is handled — the `rawArgs ?? {}` fallback, never a crash', async () => {
    const { port } = buildAnalystSurface(CSV);
    const res = await port.call('viz.whats_here');
    expect(res['ok']).toBe(true);
  });

  it('a dispatch call whose verb is NOT navigate passes straight through', async () => {
    const { port } = buildAnalystSurface(CSV);
    const res: any = await port.call('viz.dispatch', { verb: 'filter', viewId: 'scatter', field: 'price', range: [10, 200] });
    expect(res.ok).toBe(true);
    expect(res.verb).toBe('filter');
  });

  it('a navigate to a DECLARED (non-layout) view passes straight through — identical to the raw vizAsTools navigate contract', async () => {
    const { port } = buildAnalystSurface(CSV);
    const res: any = await port.call('viz.dispatch', { verb: 'navigate', viewId: 'scatter' });
    // `intent` here is the classified IntentClass (session.ts's stampCause), not
    // the raw cause string — 'navigate' always classifies 'optional-interaction'.
    expect(res).toEqual({ ok: true, verb: 'navigate', intent: 'optional-interaction', navigatedTo: 'scatter' });
  });

  it('a navigate with no viewId at all passes through to vizAsTools\' own PAYLOAD_INVALID (the frozen port\'s own guard, untouched)', async () => {
    const { port } = buildAnalystSurface(CSV);
    const res: any = await port.call('viz.dispatch', { verb: 'navigate' });
    expect(res).toEqual({ ok: false, reason: 'PAYLOAD_INVALID', detail: 'navigate requires a string viewId' });
  });
});

describe('withLayoutNavigate — the intercepted layout:${scope} shape (this is the actual LY-2 fix)', () => {
  it('a well-formed layout navigate (field+value) lands a REAL agent-badged commit and echoes navigatedTo — the agent can now actually move the arrangement', async () => {
    const { port, session } = buildAnalystSurface(CSV);
    const res: any = await port.call('viz.dispatch', {
      verb: 'navigate',
      viewId: 'layout:dashboard',
      field: 'preset',
      value: 'focus',
      intent: 'layout = focus',
    });
    expect(res.ok).toBe(true);
    expect(res.verb).toBe('navigate');
    expect(res.navigatedTo).toBe('layout:dashboard');
    expect(res.intent).toBe('optional-interaction'); // the CLASSIFIED intent (DispatchResult.intent)
    expect(res.commit).toBeTruthy();
    expect(res.commit.cause.requestedBy).toBe('agent');
    expect(res.commit.cause.intent).toBe('layout = focus'); // the RAW plain-words intent, on the commit's cause

    // it really landed on the SAME session the agent shares with the human
    expect(session.log.records.some((r) => r.viewId === 'layout:dashboard' && r.field === 'preset' && r.value === 'focus')).toBe(true);
    expect((await session.overview()).layouts).toEqual({ dashboard: { preset: 'focus' } });
  });

  it('an intent-less layout navigate falls back to a plain "navigate <viewId>" cause intent (never undefined, never a crash)', async () => {
    const { port } = buildAnalystSurface(CSV);
    const res: any = await port.call('viz.dispatch', { verb: 'navigate', viewId: 'layout:dashboard', field: 'preset', value: 'grid' });
    expect(res.ok).toBe(true);
    expect(res.commit.cause.intent).toBe('navigate layout:dashboard');
  });

  it('a REJECTED layout navigate (missing field) surfaces the session\'s own typed gap — the wrapper never swallows a rejection', async () => {
    const { port } = buildAnalystSurface(CSV);
    const res: any = await port.call('viz.dispatch', { verb: 'navigate', viewId: 'layout:dashboard' });
    expect(res.ok).toBe(false);
    expect(res.verb).toBe('navigate');
    expect(res.gap.op).toBe('navigate');
    expect(res.gap.code).toBe('guard-failed');
  });

  it('a non-string value (e.g. a number) on a layout navigate is ALSO an honest guard-failed gap, not a silent coercion', async () => {
    const { port } = buildAnalystSurface(CSV);
    const res: any = await port.call('viz.dispatch', { verb: 'navigate', viewId: 'layout:dashboard', field: 'preset', value: 42 });
    expect(res.ok).toBe(false);
    expect(res.gap.code).toBe('guard-failed');
  });
});
