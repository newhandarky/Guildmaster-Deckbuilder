import { describe, expect, it } from 'vitest';
import { baseRulesModule, createRuleset, type RulesModule } from '../src/index.js';
import { baseZoneIds } from '../src/model/zones.js';
import { testPack } from './fixtures.js';

function policyModule(overrides: Partial<RulesModule> = {}): RulesModule {
  return {
    id: 'test:modifiers',
    version: '1.0.0',
    getPartyLimit: (_state, _player, limit) => limit,
    onSupplyDepleted: () => 'handled',
    purchaseCostModifierRules: [{
      schemaVersion: 1,
      ruleId: 'test:item-discount',
      moduleId: 'test:modifiers',
      priority: 10,
      activation: { kind: 'definition-in-zone', zoneId: baseZoneIds.itemRow, definitionId: 'test:item/ration' },
      target: { kind: 'definition-type-in', values: ['item', 'equipment'] },
      amount: -1,
    }],
    restHandSizePolicies: [{
      schemaVersion: 1,
      policyId: 'test:rest-six',
      moduleId: 'test:modifiers',
      priority: 10,
      activation: { kind: 'definition-in-zone', zoneId: baseZoneIds.itemRow, definitionId: 'test:item/ration' },
      playerScope: 'active-player',
      mode: 'replace',
      handSize: 6,
    }],
    ...overrides,
  };
}

describe('purchase cost and rest hand-size policy contracts', () => {
  it('accepts canonical JSON-only rules and detaches their nested source data', () => {
    const source = policyModule();
    const ruleset = createRuleset([testPack], [baseRulesModule, source]);
    (source.purchaseCostModifierRules as unknown as Array<{ amount: number }>)[0]!.amount = -99;
    expect(ruleset.modules[1]!.purchaseCostModifierRules![0]!.amount).toBe(-1);
    expect(Object.isFrozen(ruleset.modules[1]!.purchaseCostModifierRules)).toBe(true);
    expect(Object.isFrozen(ruleset.modules[1]!.restHandSizePolicies![0]!.activation)).toBe(true);
  });

  it('rejects malformed identity, ownership, references, visibility, and priorities', () => {
    const purchase = policyModule().purchaseCostModifierRules![0]!;
    const rest = policyModule().restHandSizePolicies![0]!;
    expect(() => createRuleset([testPack], [baseRulesModule, policyModule({ purchaseCostModifierRules: [{ ...purchase, ruleId: ' test:item-discount' }] })])).toThrow(/leading or trailing whitespace/);
    expect(() => createRuleset([testPack], [baseRulesModule, policyModule({ purchaseCostModifierRules: [{ ...purchase, moduleId: 'wrong' }] })])).toThrow(/must belong/);
    expect(() => createRuleset([testPack], [baseRulesModule, policyModule({ restHandSizePolicies: [{ ...rest, handSize: -1 }] })])).toThrow(/greater than or equal to 0/);
    expect(() => createRuleset([testPack], [baseRulesModule, policyModule({ purchaseCostModifierRules: [{ ...purchase, activation: { ...purchase.activation, zoneId: 'test:missing' } }] })])).toThrow(/unknown zone/);
    expect(() => createRuleset([testPack], [baseRulesModule, policyModule({ purchaseCostModifierRules: [{ ...purchase, activation: { ...purchase.activation, definitionId: 'test:missing' } }] })])).toThrow(/unknown definition/);
    expect(() => createRuleset([testPack], [baseRulesModule, policyModule({ purchaseCostModifierRules: [{ ...purchase, target: { kind: 'definition-type-in', values: ['missing-type'] } }] })])).toThrow(/unknown definition type/);
    expect(() => createRuleset([testPack], [baseRulesModule, policyModule({
      zoneDefinitions: [{ zoneId: 'test:hidden-activation', kind: 'singleSlot', visibility: 'hidden', rulesModuleId: 'test:modifiers' }],
      restHandSizePolicies: [{ ...rest, activation: { ...rest.activation, zoneId: 'test:hidden-activation' } }],
    })])).toThrow(/must be public/);
    expect(() => createRuleset([testPack], [baseRulesModule, policyModule({ purchaseCostModifierRules: [purchase, { ...purchase, ruleId: 'test:second-discount' }] })])).toThrow(/priority 10 is ambiguous/);
    expect(() => createRuleset([testPack], [baseRulesModule, policyModule({ restHandSizePolicies: [rest, { ...rest, policyId: 'test:second-rest' }] })])).toThrow(/priority 10 is ambiguous/);
  });
});
