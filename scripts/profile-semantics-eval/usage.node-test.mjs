import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeUsage } from './usage.mjs';

test('usage totals sum provider counts, including reported zero', () => {
  assert.deepEqual(summarizeUsage([{ usage: { input_tokens: 12, output_tokens: 4 } },
    { usage: { input_tokens: 0, output_tokens: 2 } }]),
  { inputTokens: 12, outputTokens: 6, missingInputUsage: 0, missingOutputUsage: 0 });
});

test('missing or invalid usage is unavailable, never silently zero', () => {
  for (const usage of [null, {}, { input_tokens: -1, output_tokens: Infinity }]) {
    assert.deepEqual(summarizeUsage([{ usage: { input_tokens: 12, output_tokens: 4 } }, { usage }]),
      { inputTokens: null, outputTokens: null, missingInputUsage: 1, missingOutputUsage: 1 });
  }
  assert.deepEqual(summarizeUsage([{ usage: { input_tokens: 12 } }]),
    { inputTokens: 12, outputTokens: null, missingInputUsage: 0, missingOutputUsage: 1 });
});
