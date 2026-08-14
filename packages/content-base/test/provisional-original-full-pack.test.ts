import { describe, expect, it } from 'vitest';
import { baseProvisionalContentCatalog, baseProvisionalOriginalFullCapabilityMatrix, baseProvisionalOriginalFullCapabilityRegistry, baseProvisionalOriginalFullContentPack } from '../src/index.js';

describe('full provisional original-derived pack', () => {
  it('contains the complete neutral roster and the explicit project copy policy', () => {
    const definitions = baseProvisionalOriginalFullContentPack.definitions;
    expect(definitions).toHaveLength(90);
    expect(definitions.filter(({ id }) => id.startsWith('base:starter/'))).toHaveLength(7);
    expect(definitions.filter(({ type }) => type === 'adventurer')).toHaveLength(30);
    expect(definitions.filter(({ id }) => id.startsWith('base:resource/'))).toHaveLength(28);
    expect(definitions.filter(({ type }) => type === 'monster')).toHaveLength(14);
    expect(definitions.filter(({ type }) => type === 'boss')).toHaveLength(11);
    expect(definitions.filter(({ type }) => type === 'adventurer').reduce((sum, definition) => sum + definition.copies, 0)).toBe(60);
    expect(definitions.filter(({ id }) => id.startsWith('base:resource/')).reduce((sum, definition) => sum + definition.copies, 0)).toBe(59);
    expect(definitions.filter(({ type }) => type === 'monster').reduce((sum, definition) => sum + definition.copies, 0)).toBe(32);
    expect(baseProvisionalOriginalFullContentPack.bonds).toHaveLength(30);
    expect(baseProvisionalOriginalFullCapabilityMatrix.find(({ contentId }) => contentId === 'base:starter/spirit-crystal')?.copyPolicy).toBe('visual-provisional:starter-setup');
    expect(definitions.filter(({ id }) => id.startsWith('base:resource/')).map(({ id, cost, combat, honor }) => [id, cost, combat, honor])).toEqual([
      ['base:resource/resource-01',3,undefined,1],['base:resource/resource-02',3,1,2],['base:resource/resource-03',3,1,2],['base:resource/resource-04',2,undefined,1],['base:resource/resource-05',3,undefined,1],
      ['base:resource/resource-06',1,undefined,-1],['base:resource/resource-07',3,1,2],['base:resource/resource-08',4,undefined,1],['base:resource/resource-09',5,3,3],['base:resource/resource-10',3,undefined,1],
      ['base:resource/resource-11',6,2,2],['base:resource/resource-12',5,3,2],['base:resource/resource-13',3,undefined,1],['base:resource/resource-14',3,2,2],['base:resource/resource-15',4,undefined,1],
      ['base:resource/resource-16',6,2,2],['base:resource/resource-17',4,undefined,2],['base:resource/resource-18',4,2,1],['base:resource/resource-19',4,1,1],['base:resource/resource-20',5,2,2],
      ['base:resource/resource-21',4,1,1],['base:resource/resource-22',3,undefined,1],['base:resource/resource-23',4,undefined,2],['base:resource/resource-24',4,1,1],['base:resource/resource-25',5,1,2],
      ['base:resource/resource-26',4,undefined,1],['base:resource/resource-27',5,undefined,2],['base:resource/resource-28',3,undefined,1],
    ]);
    expect(definitions.find(({ id }) => id === 'base:adventurer/adventurer-24')).toMatchObject({ cost: 4, combat: 1, honor: 1 });
    expect(definitions.find(({ id }) => id === 'base:adventurer/adventurer-25')).toMatchObject({ cost: 4, combat: 2, honor: 2 });
  });

  it('enables only audited foundation effects and the first high-confidence card-rules batch', () => {
    const enabled = baseProvisionalOriginalFullContentPack.definitions.filter(({ tags }) => tags?.includes('playtest:effect-enabled'));
    expect(enabled.map(({ id }) => id).sort()).toEqual([
      'base:adventurer/adventurer-02',
      'base:adventurer/adventurer-09',
      ...['01','02','03','04','05','07','08','10','13','15','17','18','25','27'].map((id) => `base:resource/resource-${id}`),
      ...['01', '02', '03', '06', '09', '10', '11', '14'].map((id) => `base:monster/monster-${id}`),
    ].sort());
    expect(enabled.every((definition) => definition.useEffect || definition.equipmentEventTriggers || definition.type === 'monster' || ['base:adventurer/adventurer-02', 'base:adventurer/adventurer-09'].includes(definition.id) || ['02', '03', '07', '25'].some((id) => definition.id === `base:resource/resource-${id}`))).toBe(true);
    expect(baseProvisionalOriginalFullCapabilityMatrix).toHaveLength(baseProvisionalOriginalFullContentPack.definitions.length + baseProvisionalOriginalFullContentPack.bonds!.length);
    const enabledEntries = baseProvisionalOriginalFullCapabilityMatrix.filter(({ effectStatus }) => effectStatus === 'enabled');
    expect(enabledEntries).toHaveLength(24);
    expect(enabledEntries.every(({ requiredCapabilities, cpuResolver, testIds, blocker }) => requiredCapabilities.length > 0 && cpuResolver !== 'none-effect-disabled' && testIds.length >= 3 && blocker === undefined)).toBe(true);
    const blockedEntries = baseProvisionalOriginalFullCapabilityMatrix.filter(({ effectStatus }) => effectStatus === 'blocked');
    expect(blockedEntries.every(({ blocker, evidenceReference, testIds }) => blocker !== undefined && evidenceReference.length > 0 && testIds.length > 0)).toBe(true);
    expect(baseProvisionalOriginalFullCapabilityMatrix.filter(({ contentKind }) => contentKind === 'bond')).toHaveLength(30);
    expect(baseProvisionalOriginalFullCapabilityMatrix.filter(({ contentKind }) => contentKind === 'bond').every(({ blocker }) => blocker === 'unverified-bond-condition')).toBe(true);
    expect(baseProvisionalOriginalFullCapabilityMatrix.every((entry) => entry.requiredCapabilities.every((capability) => baseProvisionalOriginalFullCapabilityRegistry.engineCapabilities.includes(capability as never)) && baseProvisionalOriginalFullCapabilityRegistry.cpuResolvers.includes(entry.cpuResolver as never) && entry.testIds.every((testId) => baseProvisionalOriginalFullCapabilityRegistry.testIds.includes(testId as never)))).toBe(true);
    expect(enabledEntries.every(({ effectPaths, decisionKinds }) => effectPaths.length === decisionKinds.length)).toBe(true);
    for (const id of ['01', '02', '09', '14']) {
      expect(enabledEntries.find(({ contentId }) => contentId === `base:monster/monster-${id}`)).toMatchObject({
        decisionKinds: ['choose-effect-option'],
        requiredCapabilities: expect.arrayContaining(['typed-player-view-choice']),
        cpuResolver: 'base:cpu-balanced/effect-card-choice',
        testIds: expect.arrayContaining(['engine:combat-reward-policy', 'cpu:deterministic-choice']),
      });
    }
    expect(enabledEntries.find(({ contentId }) => contentId === 'base:adventurer/adventurer-02')).toMatchObject({ requiredCapabilities: expect.arrayContaining(['equipment-eligibility']), testIds: expect.arrayContaining(['engine:equipment-eligibility']) });
    expect(enabledEntries.find(({ contentId }) => contentId === 'base:adventurer/adventurer-09')).toMatchObject({ requiredCapabilities: expect.arrayContaining(['equipment-combat-modifier']), testIds: expect.arrayContaining(['engine:equipment-combat-modifier']) });
    expect(enabledEntries.find(({ contentId }) => contentId === 'base:adventurer/adventurer-09')?.requiredCapabilities).not.toContain('equipment-eligibility');
  });

  it('does not put source names into Runtime or Presentation-facing names', () => {
    const sourceNames = new Set(baseProvisionalContentCatalog.candidates.map((candidate) => candidate.fields.find(({ field }) => field === 'sourceName')?.candidateValue).filter((name): name is string => typeof name === 'string'));
    expect(baseProvisionalOriginalFullContentPack.definitions.every(({ name }) => !sourceNames.has(name) && name.startsWith('候選'))).toBe(true);
    expect(baseProvisionalOriginalFullContentPack.bonds!.every(({ name }) => !sourceNames.has(name) && name.startsWith('候選羈絆'))).toBe(true);
  });
});
