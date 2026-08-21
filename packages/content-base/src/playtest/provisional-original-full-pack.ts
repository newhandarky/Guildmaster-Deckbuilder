import type { CardDefinition, ContentPack, EffectDefinition, EffectNode, PlayerDecisionKind } from '@guildmaster/game-protocol';
import { baseProvisionalFoundationContentPack } from './provisional-foundation-pack.js';

const source = 'provisional-original-full-playtest';
const pad = (value: number) => String(value).padStart(2, '0');
const disabled = ['playtest:effects-disabled', 'project-policy:digital-copy-count'];
const enabledFoundationIds = new Set(['resource-01', 'resource-02', 'resource-03', 'resource-04', 'resource-05', 'resource-06', 'resource-07', 'resource-08', 'resource-09', 'resource-10', 'resource-11', 'resource-12', 'resource-13', 'resource-14', 'resource-15', 'resource-16', 'resource-17', 'resource-18', 'resource-19', 'resource-20', 'resource-21', 'resource-22', 'resource-23', 'resource-24', 'resource-25', 'resource-26', 'resource-27', 'resource-28']);
const enabledAdventurerRuleIds = new Set(['adventurer-01', 'adventurer-02', 'adventurer-03', 'adventurer-04', 'adventurer-05', 'adventurer-06', 'adventurer-07', 'adventurer-08', 'adventurer-09', 'adventurer-10', 'adventurer-11', 'adventurer-12', 'adventurer-13', 'adventurer-14', 'adventurer-15', 'adventurer-16', 'adventurer-17', 'adventurer-18', 'adventurer-19', 'adventurer-20', 'adventurer-21', 'adventurer-22', 'adventurer-23', 'adventurer-24', 'adventurer-25', 'adventurer-26', 'adventurer-27', 'adventurer-28', 'adventurer-29', 'adventurer-30']);
const enabledAdventurerRestrictionIds = new Set(['adventurer-02']);
const enabledEquipmentEligibilityResourceIds = new Set(['resource-14', 'resource-16', 'resource-19']);
const enabledAdventurerModifierIds = new Set(['adventurer-09']);
const enabledPartyCombatModifierIds = new Set(['adventurer-04', 'adventurer-10', 'adventurer-14', 'adventurer-15', 'adventurer-20', 'adventurer-24', 'adventurer-27', 'resource-11']);
const enabledPurchaseCostModifierIds = new Set(['adventurer-05']);
const enabledEquipmentDepartureIds = new Set(['resource-12', 'resource-14', 'resource-24']);
const enabledLifecycleIds = new Set(['adventurer-01', 'adventurer-03', 'adventurer-06', 'adventurer-07', 'adventurer-08', 'adventurer-11', 'adventurer-12', 'adventurer-13', 'adventurer-14', 'adventurer-16', 'adventurer-17', 'adventurer-18', 'adventurer-23', 'adventurer-26', 'adventurer-28', 'adventurer-30', 'resource-16', 'resource-19', 'resource-20', 'resource-21']);
const enabledMonsterRewardIds = new Set(['monster-01', 'monster-02', 'monster-03', 'monster-04', 'monster-05', 'monster-06', 'monster-07', 'monster-08', 'monster-09', 'monster-10', 'monster-11', 'monster-12', 'monster-13', 'monster-14']);
const enabledBossRuleIds = new Set(['boss-01', 'boss-02', 'boss-03', 'boss-04', 'boss-05', 'boss-06', 'boss-07', 'boss-08', 'boss-09', 'boss-10', 'boss-11']);
const publicRowBossRewardIds = new Set(['boss-01', 'boss-05', 'boss-08', 'boss-11']);
const publicRowMonsterRewardIds = new Set(['monster-04', 'monster-07', 'monster-08', 'monster-12']);
const sharedDeckBossRewardIds = new Set(['boss-02', 'boss-06', 'boss-07', 'boss-09']);
const monsterRewardChoiceMetadata = new Map<string, readonly PlayerDecisionKind[]>([
  ['monster-01', ['choose-effect-option']],
  ['monster-02', ['choose-effect-option']],
  ['monster-03', ['remove-card']],
  ['monster-04', ['choose-effect-option', 'choose-market-card']],
  ['monster-05', ['draft-card', 'draft-card', 'draft-card', 'draft-card']],
  ['monster-06', ['remove-card', 'remove-card']],
  ['monster-07', ['choose-effect-option', 'choose-market-card']],
  ['monster-08', ['choose-effect-option', 'choose-market-card']],
  ['monster-09', ['choose-effect-option']],
  ['monster-10', ['remove-card']],
  ['monster-11', ['remove-card']],
  ['monster-12', ['choose-effect-option', 'choose-market-card']],
  ['monster-13', ['choose-effect-option']],
  ['monster-14', ['choose-effect-option']],
]);
const bossRewardChoiceMetadata = new Map<string, readonly PlayerDecisionKind[]>([
  ['boss-01', ['choose-market-card', 'choose-market-card']],
  ['boss-03', ['discard-card', 'remove-card', 'remove-card']],
  ['boss-05', ['choose-market-card', 'choose-market-card']],
  ['boss-08', ['choose-market-card', 'choose-market-card']],
  ['boss-11', ['choose-market-card', 'choose-market-card']],
]);
const lifecycleChoiceMetadata = new Map<string, readonly PlayerDecisionKind[]>([
  ['adventurer-01', ['recover-card']],
  ['adventurer-07', ['choose-enemy-target']],
  ['adventurer-12', ['choose-effect-option']],
  ['adventurer-13', ['remove-card']],
  ['adventurer-08', ['choose-enemy-target']],
  ['adventurer-11', ['choose-order']],
  ['adventurer-23', ['choose-enemy-target', 'choose-enemy-target', 'choose-enemy-target', 'choose-enemy-target', 'choose-enemy-target', 'choose-enemy-target']],
  ['adventurer-17', ['discard-card']],
  ['adventurer-30', ['remove-card']],
  ['resource-16', ['discard-card']],
  ['resource-20', ['discard-card']],
]);
const enabledEquipmentModifierIds = new Set(['resource-02', 'resource-03', 'resource-07', 'resource-09', 'resource-25']);
const foundationById = new Map(baseProvisionalFoundationContentPack.definitions.map((definition) => [definition.id, definition]));

const starters: CardDefinition[] = [
  ['support', 1], ['melee', 2], ['mage', 1], ['tank', 1], ['ranged', 1],
].map(([profession, combat], index) => ({ id: `base:starter/adventurer-${pad(index + 1)}`, name: `候選起始冒險者 ${pad(index + 1)}`, type: 'starter', copies: 1, source, tags: [`profession:${profession}`], combat: combat as number }));
starters.push(
  { id: 'base:starter/summoning-stone', name: '候選起始資源 A', type: 'starter', copies: 1, source, purchasePower: 1 },
  { id: 'base:starter/spirit-crystal', name: '候選起始裝備 B', type: 'equipment', copies: 1, source, combat: 1 },
);

const adventurerStats: readonly [number, number, number, string][] = [
  [4,2,2,'support'],[3,3,2,'melee'],[4,3,1,'mage'],[4,2,2,'tank'],[3,1,1,'support'],[4,2,2,'melee'],[3,2,1,'ranged'],[3,2,1,'melee'],[3,1,1,'tank'],[4,2,2,'melee'],
  [4,1,1,'mage'],[3,2,2,'tank'],[4,1,1,'support'],[4,0,1,'melee'],[3,2,1,'ranged'],[4,3,2,'tank'],[3,1,1,'support'],[4,2,2,'melee'],[4,2,2,'mage'],[3,5,1,'mage'],
  [4,3,2,'melee'],[3,1,1,'tank'],[3,1,1,'mage'],[4,1,1,'melee'],[4,2,2,'tank'],[4,3,2,'ranged'],[3,1,1,'support'],[3,1,1,'support'],[4,1,1,'mage'],[5,0,3,'support'],
];
const adventurers: CardDefinition[] = adventurerStats.map(([cost, combat, honor, profession], index) => {
  const suffix = `adventurer-${pad(index + 1)}`;
  return { id: `base:adventurer/${suffix}`, name: `候選冒險者 ${pad(index + 1)}`, type: 'adventurer', copies: 2, source, tags: [`profession:${profession}`, enabledAdventurerRuleIds.has(suffix) ? 'playtest:effect-enabled' : 'playtest:effects-disabled', 'project-policy:digital-copy-count'], cost, combat, honor };
});

const resourceStats: readonly ['item' | 'equipment', number, number | undefined, number][] = [
  ['item',3,undefined,1],['equipment',3,1,2],['equipment',3,1,2],['item',2,undefined,1],['item',3,undefined,1],
  ['item',1,undefined,-1],['equipment',3,1,2],['item',4,undefined,1],['equipment',5,3,3],['item',3,undefined,1],
  ['equipment',6,2,2],['equipment',5,3,2],['item',3,undefined,1],['equipment',3,2,2],['item',4,undefined,1],
  ['equipment',6,2,2],['item',4,undefined,2],['equipment',4,2,1],['equipment',4,1,1],['equipment',5,2,2],
  ['equipment',4,1,1],['item',3,undefined,1],['item',4,undefined,2],['equipment',4,1,1],['equipment',5,1,2],
  ['item',4,undefined,1],['item',5,undefined,2],['item',3,undefined,1],
];
const resources: CardDefinition[] = resourceStats.map(([type, cost, combat, honor], index) => {
  const suffix = `resource-${pad(index + 1)}`;
  const audited = foundationById.get(`base:resource/${suffix}`);
  const effectEnabled = enabledFoundationIds.has(suffix);
  const localUseEffect: EffectDefinition | undefined = suffix === 'resource-23' ? {
    schemaVersion: 1, effectId: 'base:provisional-original-full-rules/resource-23-use', body: { kind: 'sequence', effects: [
      { kind: 'record-turn-effect-use', player: { kind: 'controller' }, usageId: 'base:resource/resource-23', maxUses: 1 },
      { kind: 'discard-party-and-hand', player: { kind: 'controller' } },
      { kind: 'draw', player: { kind: 'controller' }, count: 5 },
    ] },
  } : suffix === 'resource-26' ? {
    schemaVersion: 1, effectId: 'base:provisional-original-full-rules/resource-26-use', body: { kind: 'sequence', effects: [
      { kind: 'assert-turn-fact-at-most', player: { kind: 'controller' }, fact: 'bossesDefeated', amount: 0, reasonCode: 'RESOURCE_26_ENEMY_ALREADY_DEFEATED' },
      { kind: 'assert-turn-fact-at-most', player: { kind: 'controller' }, fact: 'monstersDefeated', amount: 0, reasonCode: 'RESOURCE_26_ENEMY_ALREADY_DEFEATED' },
      { kind: 'draw', player: { kind: 'controller' }, count: 3 },
      { kind: 'skip-combat-this-turn', player: { kind: 'controller' } },
    ] },
  } : suffix === 'resource-28' ? {
    schemaVersion: 1,
    effectId: 'base:provisional-original-full-rules/resource-28-use',
    body: {
      kind: 'choose-card', choiceId: 'base:resource/resource-28-discard-adventurer', decisionKind: 'discard-card', actor: { kind: 'controller' },
      from: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'hand' }, predicate: { kind: 'tag-prefix', value: 'profession:' }, selectedCardKey: 'resource28Adventurer',
      effect: { kind: 'sequence', effects: [
        { kind: 'discard-card', card: { kind: 'context-card', key: 'resource28Adventurer' }, from: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'hand' } },
        { kind: 'draw', player: { kind: 'controller' }, count: { kind: 'card-stat', card: { kind: 'context-card', key: 'resource28Adventurer' }, stat: 'combat' } },
      ] },
    },
  } : suffix === 'resource-22' ? {
    schemaVersion: 1,
    effectId: 'base:provisional-original-full-rules/resource-22-use',
    body: {
      kind: 'choose-card',
      choiceId: 'base:resource/resource-22-target-monster',
      decisionKind: 'choose-enemy-target',
      actor: { kind: 'controller' },
      from: { kind: 'shared-zone', zoneId: 'base:monster-row' },
      predicate: { kind: 'definition-type-in', values: ['monster'] },
      selectedCardKey: 'resource22Target',
      effect: { kind: 'add-temporary-target-combat-modifier', modifierId: 'resource-22-monster-penalty', moduleId: 'base:rules', targetCard: { kind: 'context-card', key: 'resource22Target' }, amount: -1, expires: 'turn-end' },
    },
  } : undefined;
  const useEffect = effectEnabled ? audited?.useEffect ?? localUseEffect : undefined;
  return {
    id: `base:resource/${suffix}`, name: `候選物資 ${pad(index + 1)}`, type,
    copies: index < 3 ? 3 : 2, source, cost, honor,
    ...(combat === undefined ? {} : { combat }),
    tags: [...(audited?.tags?.filter((tag) => tag.startsWith('affinity:')) ?? []), effectEnabled ? 'playtest:effect-enabled' : 'playtest:effects-disabled', 'project-policy:digital-copy-count'],
    ...(useEffect ? { useEffect: structuredClone(useEffect) } : {}),
    ...(effectEnabled && audited?.equipmentEventTriggers ? { equipmentEventTriggers: structuredClone(audited.equipmentEventTriggers) } : {}),
  };
});

const monsterStats: readonly [number, number, number][] = [[5,2,1],[5,2,5],[6,2,5],[5,2,4],[4,1,2],[7,2,5],[5,2,4],[6,2,4],[2,1,2],[4,2,5],[4,2,5],[6,2,4],[4,1,2],[5,1,2]];
const monsters: CardDefinition[] = monsterStats.map(([combat, purchasePower, honor], index) => {
  const suffix = `monster-${pad(index + 1)}`;
  return {
    id: `base:monster/${suffix}`, name: `候選魔物 ${pad(index + 1)}`, type: 'monster',
    copies: index < 4 ? 3 : 2, source, combat, purchasePower, honor,
    tags: [
      ...(index === 0 ? ['base:supply-cycle-anchor'] : []),
      enabledMonsterRewardIds.has(suffix) ? 'playtest:effect-enabled' : 'playtest:effects-disabled',
      'project-policy:digital-copy-count',
    ],
  };
});
const bossStats: readonly [number, number, number][] = [[9,3,10],[9,3,10],[10,3,10],[5,3,10],[9,3,10],[8,3,10],[9,3,8],[9,3,8],[8,3,8],[14,3,8],[6,3,8]];
const bosses: CardDefinition[] = bossStats.map(([combat, purchasePower, honor], index) => {
  const suffix = `boss-${pad(index + 1)}`;
  return { id: `base:boss/${suffix}`, name: `候選魔王 ${pad(index + 1)}`, type: 'boss', copies: 1, source, combat, purchasePower, honor, tags: enabledBossRuleIds.has(suffix) ? ['playtest:effect-enabled', 'project-policy:digital-copy-count'] : disabled };
});
const bondHonor = [4,4,3,3,3,3,4,4,4,4,5,5,4,6,5,5,7,5,5,5,5,4,6,3,4,4,4,4,4,4];

export const baseProvisionalOriginalFullContentPack: ContentPack = {
  manifest: { id: 'base:provisional-original-full', version: '0.20.0', hash: 'base-provisional-original-full-v21-all-base-card-effects-enabled', role: 'base', contentStatus: 'provisional-playtest' },
  definitions: [...starters, ...adventurers, ...resources, ...monsters, ...bosses],
  starter: { partyDefinitionIds: starters.slice(0, 5).map(({ id }) => id), summonStoneDefinitionId: 'base:starter/summoning-stone', crystalDefinitionId: 'base:starter/spirit-crystal' },
  bonds: bondHonor.map((honor, index) => ({ id: `base:bond/bond-${pad(index + 1)}`, name: `候選羈絆 ${pad(index + 1)}`, honor, requiredBosses: 99 })),
  rulesModuleIds: ['base:rules', 'base:provisional-original-full-rules'],
};

export type FullProvisionalCapabilityEntry = {
  contentId: string; contentKind: 'definition' | 'bond'; evidenceStatus: 'visual-provisional' | 'project-policy'; evidenceReference: string; copyPolicy: string;
  effectStatus: 'enabled' | 'blocked'; requiredCapabilities: readonly string[]; decisionKinds: readonly string[];
  effectPaths: readonly string[]; cpuResolver: string; testIds: readonly string[]; blocker?: 'unverified-effect-semantics' | 'unverified-bond-condition';
};
export const baseProvisionalOriginalFullCapabilityRegistry = {
  engineCapabilities: ['effect-ast', 'snapshot-continuation', 'combat-evaluator', 'combat-reward-policy', 'combat-participant-departure-policy', 'combat-departure-replacement-policy', 'discard-redirect-policy', 'attachment-policy', 'enemy-attachment-policy', 'public-row-card-choice', 'shared-deck-draw', 'private-deck-order', 'dice-roll', 'temporary-target-modifier', 'equipment-eligibility', 'equipment-combat-modifier', 'equipment-departure-policy', 'party-combat-modifier', 'purchase-cost-modifier', 'equipment-event-lifecycle', 'lifecycle-source-activation', 'bond-condition-rules', 'turn-fact-ledger', 'typed-player-view-choice'] as const,
  cpuResolvers: ['base:cpu-balanced/effect-card-choice', 'base:cpu-balanced/legal-command-scoring', 'base:cpu-balanced/keep-bonds', 'none-effect-disabled'] as const,
  testIds: ['content:provisional-foundation-pack', 'content:provisional-original-full-roster', 'content:provisional-original-full-rules', 'engine:card-use-effect', 'engine:combat-reward-policy', 'engine:combat-participant-departure-policy', 'engine:combat-departure-replacement-policy', 'engine:attachment-policy', 'engine:enemy-attachment-policy', 'engine:dice-roll', 'engine:equipment-eligibility', 'engine:equipment-combat-modifier', 'engine:equipment-departure-policy', 'engine:party-combat-modifier', 'engine:purchase-cost-modifier', 'engine:post-command-pipeline', 'engine:bond-setup', 'cpu:deterministic-choice', 'cpu:deterministic-legal-scoring', 'cpu:keep-bonds'] as const,
};

function effectChoices(node: EffectNode, path = '$'): { path: string; decisionKind?: PlayerDecisionKind }[] {
  if (node.kind === 'choice') return [{ path, ...(node.decisionKind ? { decisionKind: node.decisionKind } : {}) }, ...node.options.flatMap((option, index) => effectChoices(option.effect, `${path}.options[${index}]`))];
  if (node.kind === 'choose-card') return [{ path, ...(node.decisionKind ? { decisionKind: node.decisionKind } : {}) }, ...effectChoices(node.effect, `${path}.effect`)];
  if (node.kind === 'choose-shared-row-refresh-subset') return [{ path, decisionKind: 'choose-enemy-target' }];
  if (node.kind === 'sequence') return node.effects.flatMap((effect, index) => effectChoices(effect, `${path}.effects[${index}]`));
  if (node.kind === 'conditional') return [...effectChoices(node.whenTrue, `${path}.whenTrue`), ...(node.whenFalse ? effectChoices(node.whenFalse, `${path}.whenFalse`) : [])];
  if (node.kind === 'random' || node.kind === 'roll-die') return node.outcomes.flatMap((outcome, index) => effectChoices(outcome.effect, `${path}.outcomes[${index}]`));
  if (node.kind === 'request-counter-consent') return Object.entries(node.outcomes).flatMap(([outcome, effect]) => effectChoices(effect, `${path}.outcomes.${outcome}`));
  return [];
}

const definitionCapabilities = baseProvisionalOriginalFullContentPack.definitions.map((definition): FullProvisionalCapabilityEntry => {
  const enabled = definition.tags?.includes('playtest:effect-enabled') ?? false;
  const hasNoIndividualEffect = definition.id.startsWith('base:starter/');
  const complete = enabled || hasNoIndividualEffect;
  const suffix = definition.id.split('/').at(-1) ?? '';
  const usesCombatRewardPolicy = (definition.type === 'monster' && enabledMonsterRewardIds.has(suffix)) || (definition.type === 'boss' && enabledBossRuleIds.has(suffix));
  const usesLifecycle = enabledLifecycleIds.has(suffix);
  const usesCombatRule = definition.type === 'boss' && enabledBossRuleIds.has(suffix);
  const usesPublicRowChoice = definition.type === 'boss' && publicRowBossRewardIds.has(suffix)
    || definition.type === 'monster' && publicRowMonsterRewardIds.has(suffix)
    || definition.id === 'base:adventurer/adventurer-07';
  const usesSharedDeckDraw = definition.type === 'boss' && sharedDeckBossRewardIds.has(suffix) || definition.id === 'base:monster/monster-05';
  const usesPrivateDeckOrder = definition.id === 'base:adventurer/adventurer-11';
  const usesParticipantDeparture = definition.id === 'base:boss/boss-02';
  const usesDepartureReplacement = definition.id === 'base:adventurer/adventurer-19' || definition.id === 'base:adventurer/adventurer-21';
  const usesDice = definition.id === 'base:monster/monster-02' || definition.id === 'base:adventurer/adventurer-03' || definition.id === 'base:adventurer/adventurer-23';
  const usesTemporaryTargetModifier = definition.id === 'base:adventurer/adventurer-08' || definition.id === 'base:adventurer/adventurer-23' || definition.id === 'base:resource/resource-22';
  const usesTurnEffectLedger = definition.id === 'base:resource/resource-23' || definition.id === 'base:resource/resource-26';
  const usesDiscardRedirect = definition.id === 'base:resource/resource-06';
  const usesAttachment = ['base:adventurer/adventurer-22', 'base:adventurer/adventurer-25', 'base:adventurer/adventurer-29'].includes(definition.id);
  const usesEnemyAttachment = ['base:boss/boss-04', 'base:boss/boss-07'].includes(definition.id);
  const usesEquipmentEligibility = definition.type === 'adventurer' && enabledAdventurerRestrictionIds.has(suffix)
    || definition.type === 'equipment' && enabledEquipmentEligibilityResourceIds.has(suffix);
  const usesEquipmentCombatModifier = (definition.type === 'equipment' && enabledEquipmentModifierIds.has(suffix)) || (definition.type === 'adventurer' && enabledAdventurerModifierIds.has(suffix));
  const usesPartyCombatModifier = (definition.type === 'adventurer' || definition.type === 'equipment') && enabledPartyCombatModifierIds.has(suffix);
  const usesPurchaseCostModifier = definition.type === 'adventurer' && enabledPurchaseCostModifierIds.has(suffix);
  const usesEquipmentDeparture = definition.type === 'equipment' && enabledEquipmentDepartureIds.has(suffix);
  const roots = [definition.useEffect?.body, ...(definition.equipmentEventTriggers ?? []).map(({ effect }) => effect.body)].filter((node): node is EffectNode => node !== undefined);
  const choices = [
    ...roots.flatMap((node, index) => effectChoices(node, `$effects[${index}]`)),
    ...(monsterRewardChoiceMetadata.get(suffix) ?? []).map((decisionKind, index) => ({ path: `$rules.combatReward[${index}]`, decisionKind })),
    ...(bossRewardChoiceMetadata.get(suffix) ?? []).map((decisionKind, index) => ({ path: `$rules.combatReward[${index}]`, decisionKind })),
    ...(lifecycleChoiceMetadata.get(suffix) ?? []).map((decisionKind, index) => ({ path: `$rules.lifecycle[${index}]`, decisionKind })),
    ...(usesDepartureReplacement ? [{ path: '$rules.combatDepartureReplacement[0]', decisionKind: 'choose-party-member' as const }] : []),
  ];
  const hasChoice = choices.length > 0;
  const requiredCapabilities = hasNoIndividualEffect
    ? ['snapshot-continuation']
    : enabled
      ? ['snapshot-continuation', ...(usesCombatRule ? ['combat-evaluator'] : []), ...(usesCombatRewardPolicy ? ['effect-ast', 'combat-reward-policy'] : []), ...(usesParticipantDeparture ? ['combat-participant-departure-policy'] : []), ...(usesDepartureReplacement ? ['combat-departure-replacement-policy'] : []), ...(usesDiscardRedirect ? ['discard-redirect-policy'] : []), ...(usesAttachment ? ['attachment-policy'] : []), ...(usesEnemyAttachment ? ['enemy-attachment-policy'] : []), ...(usesPublicRowChoice ? ['public-row-card-choice'] : []), ...(usesSharedDeckDraw ? ['shared-deck-draw'] : []), ...(usesPrivateDeckOrder ? ['private-deck-order'] : []), ...(usesTurnEffectLedger ? ['turn-fact-ledger'] : []), ...(usesDice ? ['dice-roll'] : []), ...(usesTemporaryTargetModifier ? ['temporary-target-modifier', 'combat-evaluator'] : []), ...(usesEquipmentEligibility ? ['equipment-eligibility'] : []), ...(usesEquipmentCombatModifier ? ['equipment-combat-modifier'] : []), ...(usesEquipmentDeparture ? ['equipment-departure-policy'] : []), ...(usesPartyCombatModifier ? ['party-combat-modifier'] : []), ...(usesPurchaseCostModifier ? ['purchase-cost-modifier'] : []), ...(!usesCombatRewardPolicy && !usesCombatRule && !usesAttachment && !usesEnemyAttachment && !usesEquipmentEligibility && !usesEquipmentCombatModifier && !usesEquipmentDeparture && !usesPartyCombatModifier && !usesPurchaseCostModifier && !usesDepartureReplacement ? ['effect-ast'] : []), ...(definition.equipmentEventTriggers ? ['equipment-event-lifecycle'] : []), ...(usesLifecycle ? ['lifecycle-source-activation'] : []), ...(hasChoice ? ['typed-player-view-choice'] : [])]
    : [];
  return {
    contentId: definition.id,
    contentKind: 'definition',
    evidenceStatus: definition.tags?.includes('project-policy:digital-copy-count') ? 'project-policy' : 'visual-provisional',
    evidenceReference: usesCombatRewardPolicy || usesCombatRule || usesEquipmentEligibility || usesEquipmentCombatModifier || usesEquipmentDeparture || usesPartyCombatModifier || usesPurchaseCostModifier ? `visual-high-confidence:${definition.id}` : enabled ? `foundation-audit:${definition.id}` : `visual-roster:${definition.id}`,
    copyPolicy: definition.id.startsWith('base:starter/')
      ? 'visual-provisional:starter-setup'
      : definition.type === 'adventurer'
        ? 'project-policy:2-each'
        : definition.type === 'monster'
          ? 'project-policy:32-card-distribution'
          : definition.type === 'item' || definition.type === 'equipment'
            ? 'project-policy:59-card-distribution'
            : 'visual-provisional',
    effectStatus: complete ? 'enabled' : 'blocked',
    requiredCapabilities,
    decisionKinds: choices.flatMap(({ decisionKind }) => decisionKind ? [decisionKind] : []),
    effectPaths: choices.map(({ path }) => path),
    cpuResolver: complete ? (hasChoice ? 'base:cpu-balanced/effect-card-choice' : 'base:cpu-balanced/legal-command-scoring') : 'none-effect-disabled',
    testIds: hasNoIndividualEffect
      ? ['content:provisional-original-full-roster', 'engine:bond-setup', 'cpu:deterministic-legal-scoring']
      : enabled ? [...new Set([usesCombatRewardPolicy ? 'engine:combat-reward-policy' : 'content:provisional-foundation-pack', ...(usesParticipantDeparture ? ['engine:combat-participant-departure-policy'] : []), ...(usesDepartureReplacement ? ['engine:combat-departure-replacement-policy'] : []), ...(usesAttachment ? ['engine:attachment-policy'] : []), ...(usesEnemyAttachment ? ['engine:enemy-attachment-policy'] : []), ...(usesEquipmentEligibility ? ['engine:equipment-eligibility'] : []), ...(usesEquipmentCombatModifier ? ['engine:equipment-combat-modifier'] : []), ...(usesEquipmentDeparture ? ['engine:equipment-departure-policy'] : []), ...(usesPartyCombatModifier ? ['engine:party-combat-modifier'] : []), ...(usesPurchaseCostModifier ? ['engine:purchase-cost-modifier'] : []), definition.equipmentEventTriggers ? 'engine:post-command-pipeline' : usesCombatRewardPolicy || usesAttachment || usesEnemyAttachment || usesEquipmentEligibility || usesEquipmentCombatModifier || usesEquipmentDeparture || usesPartyCombatModifier || usesPurchaseCostModifier || usesDepartureReplacement ? 'content:provisional-original-full-rules' : 'engine:card-use-effect', ...(usesDice ? ['engine:dice-roll'] : []), hasChoice ? 'cpu:deterministic-choice' : 'cpu:deterministic-legal-scoring'])] : ['content:provisional-original-full-roster'],
    ...(!complete ? { blocker: 'unverified-effect-semantics' as const } : {}),
  };
});

const bondCapabilities = (baseProvisionalOriginalFullContentPack.bonds ?? []).map((bond): FullProvisionalCapabilityEntry => ({
  contentId: bond.id,
  contentKind: 'bond',
  evidenceStatus: 'visual-provisional',
  evidenceReference: `visual-roster:${bond.id}`,
  copyPolicy: 'visual-provisional:1-each',
  effectStatus: 'enabled',
  requiredCapabilities: ['bond-condition-rules', 'turn-fact-ledger'],
  decisionKinds: ['keep-bonds'],
  effectPaths: ['$rules.bondCondition'],
  cpuResolver: 'base:cpu-balanced/keep-bonds',
  testIds: ['content:provisional-original-full-roster', 'engine:bond-setup', 'cpu:keep-bonds'],
}));

/** Machine-readable gate: roster completeness is intentionally separate from verified effect completeness. */
export const baseProvisionalOriginalFullCapabilityMatrix: readonly FullProvisionalCapabilityEntry[] = [...definitionCapabilities, ...bondCapabilities];
