export const capabilityStatuses = ['supported', 'missing-generic-capability', 'blocked-by-rule-exception', 'not-in-MVP-yet'] as const;
export type CapabilityStatus = (typeof capabilityStatuses)[number];

export const capabilityCategories = ['card-movement', 'supply', 'combat', 'party-and-equipment', 'randomness-and-visibility', 'timing-and-effects', 'bonds-endgame-and-scoring'] as const;
export type CapabilityCategory = (typeof capabilityCategories)[number];

/** Auditable current engine coverage; never player-facing card presentation. */
export type EffectCapability = {
  id: string;
  category: CapabilityCategory;
  status: CapabilityStatus;
  summary: string;
  candidateDefinitionIds?: readonly string[];
  engineEvidence: readonly string[];
  gapOrConstraint?: string;
  recommendedNextStep?: string;
};

export type EffectCapabilityMatrix = {
  schemaVersion: 1;
  contentScope: 'base:provisional';
  generatedFor: 'provisional-gap-analysis';
  capabilities: readonly EffectCapability[];
};

const idPattern = /^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*$/;
const definitionIdPattern = /^[a-z0-9-]+:[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;

export function validateEffectCapabilityMatrix(matrix: EffectCapabilityMatrix): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  if (matrix.schemaVersion !== 1 || matrix.contentScope !== 'base:provisional' || matrix.generatedFor !== 'provisional-gap-analysis') errors.push('Capability matrix must identify schema v1 and the provisional base gap-analysis scope.');
  for (const capability of matrix.capabilities) {
    if (!idPattern.test(capability.id) || ids.has(capability.id)) errors.push(`Capability has an invalid or duplicate ID: ${capability.id}.`);
    ids.add(capability.id);
    if (!capability.summary.trim()) errors.push(`Capability ${capability.id} requires a summary.`);
    if (!capability.engineEvidence.length || capability.engineEvidence.some((evidence) => !evidence.trim())) errors.push(`Capability ${capability.id} requires auditable engine evidence.`);
    if (capability.status === 'supported' && capability.gapOrConstraint) errors.push(`Supported capability ${capability.id} must not claim a gap or rule exception.`);
    if (capability.status !== 'supported' && !capability.gapOrConstraint?.trim()) errors.push(`Non-supported capability ${capability.id} requires a gap or constraint.`);
    for (const definitionId of capability.candidateDefinitionIds ?? []) if (!definitionIdPattern.test(definitionId)) errors.push(`Capability ${capability.id} has a non-neutral candidate definition ID: ${definitionId}.`);
  }
  return errors;
}
