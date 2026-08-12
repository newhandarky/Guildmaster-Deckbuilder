import { describe, expect, it } from 'vitest';
import { baseProvisionalContentCatalog, baseProvisionalOriginalFullCapabilityMatrix, baseProvisionalOriginalFullCapabilityRegistry, baseProvisionalOriginalFullContentPack } from '../src/index.js';

describe('full provisional original-derived pack', () => {
  it('contains the complete neutral roster and the explicit project copy policy', () => {
    const definitions = baseProvisionalOriginalFullContentPack.definitions;
    expect(definitions).toHaveLength(90);
    expect(definitions.filter(({ type }) => type === 'starter')).toHaveLength(7);
    expect(definitions.filter(({ type }) => type === 'adventurer')).toHaveLength(30);
    expect(definitions.filter(({ type }) => type === 'item' || type === 'equipment')).toHaveLength(28);
    expect(definitions.filter(({ type }) => type === 'monster')).toHaveLength(14);
    expect(definitions.filter(({ type }) => type === 'boss')).toHaveLength(11);
    expect(definitions.filter(({ type }) => type === 'adventurer').reduce((sum, definition) => sum + definition.copies, 0)).toBe(60);
    expect(definitions.filter(({ type }) => type === 'item' || type === 'equipment').reduce((sum, definition) => sum + definition.copies, 0)).toBe(59);
    expect(definitions.filter(({ type }) => type === 'monster').reduce((sum, definition) => sum + definition.copies, 0)).toBe(32);
    expect(baseProvisionalOriginalFullContentPack.bonds).toHaveLength(30);
  });

  it('enables only audited foundation effects and never enables unknown effects', () => {
    const enabled = baseProvisionalOriginalFullContentPack.definitions.filter(({ tags }) => tags?.includes('playtest:effect-enabled'));
    expect(enabled.map(({ id }) => id).sort()).toEqual(['01','04','05','08','10','13','15','17','18','27'].map((id) => `base:resource/resource-${id}`).sort());
    expect(enabled.every((definition) => definition.useEffect || definition.equipmentEventTriggers)).toBe(true);
    expect(baseProvisionalOriginalFullCapabilityMatrix).toHaveLength(baseProvisionalOriginalFullContentPack.definitions.length + baseProvisionalOriginalFullContentPack.bonds!.length);
    const enabledEntries = baseProvisionalOriginalFullCapabilityMatrix.filter(({ effectStatus }) => effectStatus === 'enabled');
    expect(enabledEntries).toHaveLength(10);
    expect(enabledEntries.every(({ requiredCapabilities, cpuResolver, testIds, blocker }) => requiredCapabilities.length > 0 && cpuResolver !== 'none-effect-disabled' && testIds.length >= 3 && blocker === undefined)).toBe(true);
    const blockedEntries = baseProvisionalOriginalFullCapabilityMatrix.filter(({ effectStatus }) => effectStatus === 'blocked');
    expect(blockedEntries.every(({ blocker, evidenceReference, testIds }) => blocker !== undefined && evidenceReference.length > 0 && testIds.length > 0)).toBe(true);
    expect(baseProvisionalOriginalFullCapabilityMatrix.filter(({ contentKind }) => contentKind === 'bond')).toHaveLength(30);
    expect(baseProvisionalOriginalFullCapabilityMatrix.filter(({ contentKind }) => contentKind === 'bond').every(({ blocker }) => blocker === 'unverified-bond-condition')).toBe(true);
    expect(baseProvisionalOriginalFullCapabilityMatrix.every((entry) => entry.requiredCapabilities.every((capability) => baseProvisionalOriginalFullCapabilityRegistry.engineCapabilities.includes(capability as never)) && baseProvisionalOriginalFullCapabilityRegistry.cpuResolvers.includes(entry.cpuResolver as never) && entry.testIds.every((testId) => baseProvisionalOriginalFullCapabilityRegistry.testIds.includes(testId as never)))).toBe(true);
    expect(enabledEntries.every(({ effectPaths, decisionKinds }) => effectPaths.length === decisionKinds.length)).toBe(true);
  });

  it('does not put source names into Runtime or Presentation-facing names', () => {
    const sourceNames = new Set(baseProvisionalContentCatalog.candidates.map((candidate) => candidate.fields.find(({ field }) => field === 'sourceName')?.candidateValue).filter((name): name is string => typeof name === 'string'));
    expect(baseProvisionalOriginalFullContentPack.definitions.every(({ name }) => !sourceNames.has(name) && name.startsWith('候選'))).toBe(true);
    expect(baseProvisionalOriginalFullContentPack.bonds!.every(({ name }) => !sourceNames.has(name) && name.startsWith('候選羈絆'))).toBe(true);
  });
});
