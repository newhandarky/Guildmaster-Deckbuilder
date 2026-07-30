import { describe, expect, it } from 'vitest';
import { baseProvisionalEffectCapabilityMatrix, capabilityStatuses, validateEffectCapabilityMatrix } from '../src/capabilities/index.js';

describe('base provisional effect capability matrix', () => {
  it('is a valid, auditable gap analysis without requiring artificial unresolved gaps', () => {
    expect(validateEffectCapabilityMatrix(baseProvisionalEffectCapabilityMatrix)).toEqual([]);
    const statuses = new Set(baseProvisionalEffectCapabilityMatrix.capabilities.map((capability) => capability.status));
    for (const status of statuses) expect(capabilityStatuses).toContain(status);
    expect(statuses).toContain('supported'); expect(statuses).toContain('blocked-by-rule-exception'); expect(statuses).toContain('not-in-MVP-yet');
    expect(statuses).not.toContain('missing-generic-capability');
  });
  it('keeps all confirmed supply-copy gaps blocked and never invents a composition policy', () => {
    const copies = baseProvisionalEffectCapabilityMatrix.capabilities.find((capability) => capability.id === 'supply/base-composition-by-copy-count')!;
    expect(copies.status).toBe('blocked-by-rule-exception');
    expect(copies.gapOrConstraint).toMatch(/不可由總數反推/);
    expect(copies.recommendedNextStep).toMatch(/官方資料/);
  });
  it('requires supported evidence and uses only neutral mechanics IDs', () => {
    for (const capability of baseProvisionalEffectCapabilityMatrix.capabilities) {
      expect(capability.engineEvidence.length).toBeGreaterThan(0);
      for (const definitionId of capability.candidateDefinitionIds ?? []) expect(definitionId).not.toMatch(/麥娜|慕莎|卡儂|修爾蒂|辛芙妮|\.jpg|\.png/);
    }
  });
  it('rejects a matrix that claims a non-evidenced supported capability', () => {
    const invalid = { ...baseProvisionalEffectCapabilityMatrix, capabilities: [{ ...baseProvisionalEffectCapabilityMatrix.capabilities[0]!, engineEvidence: [] }] };
    expect(validateEffectCapabilityMatrix(invalid)).toContain('Capability card-movement/player-draw-rebuild requires auditable engine evidence.');
  });
});
