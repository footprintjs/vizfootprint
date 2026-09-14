/** Totals describe reported usage. One unknown call makes its total unknown. */
export function summarizeUsage(calls) {
  const metric = field => {
    const values = calls.map(call => call.usage?.[field]);
    const missing = values.filter(value => !Number.isSafeInteger(value) || value < 0).length;
    return { total: missing ? null : values.reduce((sum, value) => sum + value, 0), missing };
  };
  const input = metric('input_tokens'), output = metric('output_tokens');
  return { inputTokens: input.total, outputTokens: output.total,
    missingInputUsage: input.missing, missingOutputUsage: output.missing };
}
