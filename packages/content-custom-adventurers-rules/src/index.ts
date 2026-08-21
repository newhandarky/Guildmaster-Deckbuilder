import { baseProvisionalOriginalFullRulesModule, baseProvisionalOriginalFullRulesModuleId } from '@guildmaster/content-base-rules';
import { customAdventurerMechanicBindings, customAdventurerRulesModuleId } from '@guildmaster/content-custom-adventurers';
import type { RulesModule } from '@guildmaster/game-engine';

const identityMap: Readonly<Record<string, string>> = {
  ...customAdventurerMechanicBindings,
  [baseProvisionalOriginalFullRulesModuleId]: customAdventurerRulesModuleId,
};

function rewriteRulesData(value: unknown): unknown {
  if (typeof value === 'string') {
    const exact = identityMap[value];
    if (exact) return exact;
    const modulePrefix = `${baseProvisionalOriginalFullRulesModuleId}/`;
    return value.startsWith(modulePrefix)
      ? `${customAdventurerRulesModuleId}/${value.slice(modulePrefix.length)}`
      : value;
  }
  if (Array.isArray(value)) return value.map(rewriteRulesData);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, rewriteRulesData(entry)]));
}

type RulesData = Pick<RulesModule,
  | 'config'
  | 'composition'
  | 'zoneDefinitions'
  | 'lifecycleHooks'
  | 'combatRules'
  | 'attackResolutionPolicies'
  | 'combatRewardPolicies'
  | 'encounterResolutionPolicies'
  | 'equipmentEligibilityRules'
  | 'equipmentCombatModifierRules'
  | 'equipmentDeparturePolicies'
  | 'attachmentPolicies'
  | 'enemyAttachmentPolicies'
  | 'discardRedirectPolicies'
  | 'combatParticipantDeparturePolicies'
  | 'combatDepartureReplacementPolicies'
  | 'combatReserveContributionPolicies'
  | 'partyCombatModifierRules'
  | 'teamOverflowPolicies'
  | 'teamCapacityEnforcementPolicies'
  | 'setupContributions'
  | 'supplyRowConfigurations'
  | 'supplyRowRefreshPolicies'
  | 'supplyContinuityPolicies'
  | 'continuousRules'
  | 'purchaseCostModifierRules'
  | 'restHandSizePolicies'
  | 'bondConditionRules'
  | 'diceDefinitions'
  | 'counterConsentPolicies'
>;

const data: RulesData = rewriteRulesData({
  config: baseProvisionalOriginalFullRulesModule.config,
  composition: baseProvisionalOriginalFullRulesModule.composition,
  zoneDefinitions: baseProvisionalOriginalFullRulesModule.zoneDefinitions,
  lifecycleHooks: baseProvisionalOriginalFullRulesModule.lifecycleHooks,
  combatRules: baseProvisionalOriginalFullRulesModule.combatRules,
  attackResolutionPolicies: baseProvisionalOriginalFullRulesModule.attackResolutionPolicies,
  combatRewardPolicies: baseProvisionalOriginalFullRulesModule.combatRewardPolicies,
  encounterResolutionPolicies: baseProvisionalOriginalFullRulesModule.encounterResolutionPolicies,
  equipmentEligibilityRules: baseProvisionalOriginalFullRulesModule.equipmentEligibilityRules,
  equipmentCombatModifierRules: baseProvisionalOriginalFullRulesModule.equipmentCombatModifierRules,
  equipmentDeparturePolicies: baseProvisionalOriginalFullRulesModule.equipmentDeparturePolicies,
  attachmentPolicies: baseProvisionalOriginalFullRulesModule.attachmentPolicies,
  enemyAttachmentPolicies: baseProvisionalOriginalFullRulesModule.enemyAttachmentPolicies,
  discardRedirectPolicies: baseProvisionalOriginalFullRulesModule.discardRedirectPolicies,
  combatParticipantDeparturePolicies: baseProvisionalOriginalFullRulesModule.combatParticipantDeparturePolicies,
  combatDepartureReplacementPolicies: baseProvisionalOriginalFullRulesModule.combatDepartureReplacementPolicies,
  combatReserveContributionPolicies: baseProvisionalOriginalFullRulesModule.combatReserveContributionPolicies,
  partyCombatModifierRules: baseProvisionalOriginalFullRulesModule.partyCombatModifierRules,
  teamOverflowPolicies: baseProvisionalOriginalFullRulesModule.teamOverflowPolicies,
  teamCapacityEnforcementPolicies: baseProvisionalOriginalFullRulesModule.teamCapacityEnforcementPolicies,
  setupContributions: baseProvisionalOriginalFullRulesModule.setupContributions,
  supplyRowConfigurations: baseProvisionalOriginalFullRulesModule.supplyRowConfigurations,
  supplyRowRefreshPolicies: baseProvisionalOriginalFullRulesModule.supplyRowRefreshPolicies,
  supplyContinuityPolicies: baseProvisionalOriginalFullRulesModule.supplyContinuityPolicies,
  continuousRules: baseProvisionalOriginalFullRulesModule.continuousRules,
  purchaseCostModifierRules: baseProvisionalOriginalFullRulesModule.purchaseCostModifierRules,
  restHandSizePolicies: baseProvisionalOriginalFullRulesModule.restHandSizePolicies,
  bondConditionRules: baseProvisionalOriginalFullRulesModule.bondConditionRules,
  diceDefinitions: baseProvisionalOriginalFullRulesModule.diceDefinitions,
  counterConsentPolicies: baseProvisionalOriginalFullRulesModule.counterConsentPolicies,
}) as RulesData;

/**
 * The custom mode inherits only audited mechanics. Rewriting is performed once
 * at module construction; authoritative runtime still receives immutable,
 * explicit custom definition IDs and never follows presentation names.
 */
export const customAdventurerRulesModule: RulesModule = {
  id: customAdventurerRulesModuleId,
  version: '0.8.0',
  ...data,
  lifecycleHooks: [...(data.lifecycleHooks ?? []), {
    schemaVersion: 1,
    hookId: 'custom-melee-07-roll-combat-multiplier',
    moduleId: customAdventurerRulesModuleId,
    point: 'phase-start', kind: 'trigger', priority: 400,
    activation: { kind: 'all', conditions: [{ kind: 'phase-is', phase: 'combat' }, { kind: 'definition-in-actor-party', definitionId: 'custom:adventurer/melee-07' }] },
    effect: { schemaVersion: 1, effectId: `${customAdventurerRulesModuleId}/melee-07-roll-combat-multiplier`, body: {
      kind: 'roll-die', moduleId: customAdventurerRulesModuleId, diceId: 'custom-melee-07-combat-d6',
      outcomes: Array.from({ length: 6 }, (_, index) => ({ face: index + 1, effect: { kind: 'set-turn-card-combat-multiplier' as const, player: { kind: 'controller' as const }, definitionId: 'custom:adventurer/melee-07', numerator: index < 2 ? 1 : index < 4 ? 3 : 2, denominator: index < 2 || index >= 4 ? 1 : 2, rounding: 'floor' as const } })),
    } },
  }, {
    schemaVersion: 1,
    hookId: 'custom-support-06-reorder-party-on-entry',
    moduleId: customAdventurerRulesModuleId,
    point: 'event-after', eventType: 'ADVENTURER_ENTERED_PARTY', kind: 'trigger', priority: 410,
    activation: { kind: 'metadata-equals', key: 'commandDefinitionId', value: 'custom:adventurer/support-06' },
    effect: { schemaVersion: 1, effectId: `${customAdventurerRulesModuleId}/support-06-reorder-party-on-entry`, body: { kind: 'choose-order-player-party', orderId: 'custom:adventurer/support-06-party-order', actor: { kind: 'controller' }, player: { kind: 'controller' } } },
  }, {
    schemaVersion: 1,
    hookId: 'custom-ranged-05-repeat-item-on-entry',
    moduleId: customAdventurerRulesModuleId,
    point: 'event-after', eventType: 'ADVENTURER_ENTERED_PARTY', kind: 'trigger', priority: 420,
    activation: { kind: 'metadata-equals', key: 'commandDefinitionId', value: 'custom:adventurer/ranged-05' },
    effect: { schemaVersion: 1, effectId: `${customAdventurerRulesModuleId}/ranged-05-repeat-item-on-entry`, body: {
      kind: 'choose-card', choiceId: 'custom:adventurer/ranged-05-item', decisionKind: 'choose-effect-option', actor: { kind: 'controller' },
      from: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'hand' },
      predicate: { kind: 'all', predicates: [{ kind: 'definition-type-in', values: ['item'] }, { kind: 'definition-has-use-effect' }] },
      selectedCardKey: 'custom:adventurer/ranged-05-selected-item', skipOptionId: 'skip', zeroCandidateBehavior: 'skip',
      effect: { kind: 'repeat-item-use-effect', card: { kind: 'context-card', key: 'custom:adventurer/ranged-05-selected-item' }, player: { kind: 'controller' }, times: 2 },
    } },
  }],
  combatReserveContributionPolicies: [...(data.combatReserveContributionPolicies ?? []), {
    schemaVersion: 1, moduleId: customAdventurerRulesModuleId, policyId: 'custom-ranged-03-reserve-combat', priority: 400,
    sourceDefinitionIds: ['custom:adventurer/ranged-03'], contribution: 'effective-combat', destination: 'first-participant', onlyWhileSourceNotParticipant: true,
    reasonCode: 'CUSTOM_RANGED_03_RESERVE_COMBAT',
  }],
  partyCombatModifierRules: [...(data.partyCombatModifierRules ?? []), {
    schemaVersion: 1,
    moduleId: customAdventurerRulesModuleId,
    ruleId: 'custom-mage-07-three-mage-aura',
    priority: 450,
    sourceDefinitionIds: ['custom:adventurer/mage-07'],
    subject: 'all',
    when: { kind: 'all', conditions: [
      { kind: 'party-tag-count-at-least', tags: ['profession:mage'], amount: 3 },
      { kind: 'subject-tag-in', tags: ['profession:mage'] },
    ] },
    amount: { kind: 'fixed', value: 2 },
  }, {
    schemaVersion: 1,
    moduleId: customAdventurerRulesModuleId,
    ruleId: 'custom-tank-09-three-tank-aura',
    priority: 460,
    sourceDefinitionIds: ['custom:adventurer/tank-09'],
    subject: 'all',
    when: { kind: 'all', conditions: [
      { kind: 'party-tag-count-at-least', tags: ['profession:tank'], amount: 3 },
      { kind: 'subject-tag-in', tags: ['profession:tank'] },
    ] },
    amount: { kind: 'fixed', value: 2 },
  }],
  diceDefinitions: [...(data.diceDefinitions ?? []), { schemaVersion: 1, moduleId: customAdventurerRulesModuleId, diceId: 'custom-melee-07-combat-d6', sides: 6 }],
  getPartyLimit: baseProvisionalOriginalFullRulesModule.getPartyLimit,
  onSupplyDepleted: baseProvisionalOriginalFullRulesModule.onSupplyDepleted,
};
