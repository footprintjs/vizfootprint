import { createArrayProfileProvider, profileData, profileStatisticAssertion } from 'vizfootprint/data';
// ContextFootprint is the HOST's install, not a dependency of vizfootprint: install it beside the
// library to run this example (`npm install contextfootprint`, or the reviewed archive under vendor/).
import { conflictsOf, participates } from 'contextfootprint';

// Synthetic records. This example uses no model, server, file or browser API.
const schema = {
  source: { id: 'example:requests', version: 'snapshot-1' },
  table: 'requests', grain: 'one completed request',
  columns: [{ name: 'duration', type: 'number', role: 'measure', unit: 'ms', meaning: 'Completed duration' }],
};
const plan = {
  kind: 'profile', version: 1, ops: 1, source: schema.source,
  selectionRef: 'all-requests', fields: [{ field: 'duration', statistics: ['mean'] }],
};
const result = await profileData(createArrayProfileProvider(schema, [
  { duration: 0 }, { duration: null }, { duration: 20 },
]), plan, { operationId: 'example:profile', resultRef: 'example:result' });
const options = { field: 'duration', statistic: 'mean', scope: 'example:investigation', epoch: 1, stratum: 'asserted' };
const observation = profileStatisticAssertion(result, options);

// A claim explicitly about this exact referenced measure. Its units are supplied
// by the evidence renderer, not silently borrowed for a free-text claim.
const claim = { ...observation, value: 20, provenance: 'example:explicit-claim-about-this-measure' };
const mismatches = conflictsOf([observation, claim]);
const unknownResult = await profileData(createArrayProfileProvider(schema, [{ duration: null }]),
  plan, { operationId: 'example:empty-profile', resultRef: 'example:empty-result' });
const unknown = profileStatisticAssertion(unknownResult, options);

const summary = {
  observedValue: observation.value,
  mismatchConflicts: mismatches.length,
  unknownParticipates: participates(unknown.value),
};
if (summary.observedValue !== 10 || summary.mismatchConflicts !== 1 || summary.unknownParticipates !== false) {
  throw new Error('Profile assertion example failed');
}
console.log(JSON.stringify(summary));
// No conflict is not verification: unknown, quoted or differently scoped values
// are not contradictory. The host still owns coverage, freshness and delivery.
