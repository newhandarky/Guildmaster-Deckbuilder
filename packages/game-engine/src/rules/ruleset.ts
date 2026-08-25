import { isFiniteJsonValue, validateAttachmentPolicy, validateAttackResolutionPolicy, validateBondConditionRule, validateCardUseEffectDefinition, validateCombatParticipantDeparturePolicy, validateCombatRewardPolicy, validateCombatRule, validateContinuousRule, validateCounterConsentPolicy, validateDiceDefinition, validateDiscardRedirectPolicy, validateEncounterResolutionPolicy, validateEnemyAttachmentPolicy, validateEquipmentCombatModifierRule, validateEquipmentDeparturePolicy, validateEquipmentEligibilityRule, validateEquipmentEventTrigger, validateLifecycleHook, validatePartyCombatModifierRule, validatePurchaseCostModifierRule, validateRestHandSizePolicy, validateSetupCardPoolContribution, validateSupplyRowConfiguration, validateSupplyRowRefreshPolicy, validateTeamCapacityEnforcementPolicy, validateTeamOverflowPolicy, type AttachmentPolicy, type AttackResolutionPolicy, type BondConditionRule, type CombatCondition, type CombatParticipantDeparturePolicy, type CombatRewardPolicy, type CombatRule, type ContentPack, type ContentRegistry, type ContinuousRule, type CounterConsentPolicy, type DiceDefinition, type DiscardRedirectPolicy, type EffectNode, type EncounterResolutionPolicy, type EnemyAttachmentPolicy, type EquipmentCombatModifierRule, type EquipmentDeparturePolicy, type EquipmentEligibilityRule, type GameState, type LifecycleActivation, type LifecycleHook, type OptionalRulesModuleComposition, type PartyCombatModifierRule, type PlayerState, type PurchaseCostModifierRule, type RestHandSizePolicy, type SetupCardPoolContribution, type SupplyRowConfiguration, type SupplyRowRefreshPolicy, type TeamCapacityEnforcementPolicy, type TeamOverflowPolicy } from '@guildmaster/game-protocol';
import type { ZoneDefinition } from '../model/zones.js';
import { validateCombatDepartureReplacementPolicy, type CombatDepartureReplacementPolicy } from '@guildmaster/game-protocol';
import { validateCombatReserveContributionPolicy, type CombatReserveContributionPolicy } from '@guildmaster/game-protocol';
import { validateCombatAssistPolicy, type CombatAssistPolicy } from '@guildmaster/game-protocol';
import { evaluateContinuousEffects } from './continuous-evaluator.js';
import { composeRulesModules } from './rules-module-composition.js';
import { validateRulesetStateCompatibility } from './ruleset-compatibility.js';
import { validateSupplyContinuityPolicy, validateSupplyContinuityRegistry, type SupplyContinuityPolicy } from './supply-continuity-evaluator.js';

export { validateRulesetStateCompatibility } from './ruleset-compatibility.js';

export type SupplyKind = string;
export type EndCondition = { id: string; priority?: number; evaluate: (state: GameState) => boolean };
export type ScoreContribution = { playerId: string; ruleId: string; amount: number; label: string };
export type RulesModule = {
  id: string; version: string; config?: Record<string, unknown>;
  composition?: OptionalRulesModuleComposition;
  createInitialState?: () => unknown; zoneDefinitions?: readonly ZoneDefinition[];
  validateState?: (state: unknown) => readonly string[];
  getBossSetupCount?: (playerCount: number, currentCount: number) => number;
  getPartyLimit: (state: GameState, player: PlayerState, currentLimit: number) => number;
  onSupplyDepleted: (state: GameState, supply: SupplyKind) => 'pendingOfficialRuling' | 'handled';
  lifecycleHooks?: readonly LifecycleHook[];
  combatRules?: readonly CombatRule[];
  attackResolutionPolicies?: readonly AttackResolutionPolicy[];
  combatRewardPolicies?: readonly CombatRewardPolicy[];
  encounterResolutionPolicies?: readonly EncounterResolutionPolicy[];
  equipmentEligibilityRules?: readonly EquipmentEligibilityRule[];
  equipmentCombatModifierRules?: readonly EquipmentCombatModifierRule[];
  equipmentDeparturePolicies?: readonly EquipmentDeparturePolicy[];
  attachmentPolicies?: readonly AttachmentPolicy[];
  enemyAttachmentPolicies?: readonly EnemyAttachmentPolicy[];
  discardRedirectPolicies?: readonly DiscardRedirectPolicy[];
  combatParticipantDeparturePolicies?: readonly CombatParticipantDeparturePolicy[];
  combatDepartureReplacementPolicies?: readonly CombatDepartureReplacementPolicy[];
  combatReserveContributionPolicies?: readonly CombatReserveContributionPolicy[];
  combatAssistPolicies?: readonly CombatAssistPolicy[];
  partyCombatModifierRules?: readonly PartyCombatModifierRule[];
  teamOverflowPolicies?: readonly TeamOverflowPolicy[];
  teamCapacityEnforcementPolicies?: readonly TeamCapacityEnforcementPolicy[];
  setupContributions?: readonly SetupCardPoolContribution[];
  supplyRowConfigurations?: readonly SupplyRowConfiguration[];
  supplyRowRefreshPolicies?: readonly SupplyRowRefreshPolicy[];
  supplyContinuityPolicies?: readonly SupplyContinuityPolicy[];
  continuousRules?: readonly ContinuousRule[];
  purchaseCostModifierRules?: readonly PurchaseCostModifierRule[];
  restHandSizePolicies?: readonly RestHandSizePolicy[];
  bondConditionRules?: readonly BondConditionRule[];
  diceDefinitions?: readonly DiceDefinition[];
  counterConsentPolicies?: readonly CounterConsentPolicy[];
  endConditions?: readonly EndCondition[];
  getScoreContributions?: (state: GameState, registry: ContentRegistry) => readonly ScoreContribution[];
};
export type Ruleset = { registry: ContentRegistry; modules: readonly RulesModule[] };
export type ContentRegistryOptions = { allowProvisionalPlaytest?: boolean };

function combatConditionDefinitionIds(condition: CombatCondition): string[] {
  if (condition.kind === 'target-definition-id-in') return [...condition.definitionIds];
  if (condition.kind === 'all' || condition.kind === 'any') return condition.conditions.flatMap(combatConditionDefinitionIds);
  return condition.kind === 'not' ? combatConditionDefinitionIds(condition.condition) : [];
}

function selectableSharedZoneIds(node: EffectNode): string[] {
  if (node.kind === 'choose-card') {
    const locations = node.from.kind === 'one-of' ? node.from.locations : [node.from];
    return [...locations.filter((location): location is Extract<typeof location, { kind: 'shared-zone' }> => location.kind === 'shared-zone').map(({ zoneId }) => zoneId), ...selectableSharedZoneIds(node.effect), ...(node.zeroCandidateEffect ? selectableSharedZoneIds(node.zeroCandidateEffect) : [])];
  }
  if (node.kind === 'sequence') return node.effects.flatMap(selectableSharedZoneIds);
  if (node.kind === 'conditional') return [...selectableSharedZoneIds(node.whenTrue), ...(node.whenFalse ? selectableSharedZoneIds(node.whenFalse) : [])];
  if (node.kind === 'choice') return node.options.flatMap(({ effect }) => selectableSharedZoneIds(effect));
  if (node.kind === 'random' || node.kind === 'roll-die') return node.outcomes.flatMap(({ effect }) => selectableSharedZoneIds(effect));
  if (node.kind === 'request-counter-consent') return Object.values(node.outcomes).flatMap(selectableSharedZoneIds);
  return [];
}

type EffectStaticRefs = { orderedSourceZoneIds: string[]; publicDestinationZoneIds: string[]; conditionZoneIds: string[]; conditionDefinitionIds: string[] };
function effectStaticRefs(node: EffectNode): EffectStaticRefs {
  const empty = (): EffectStaticRefs => ({ orderedSourceZoneIds: [], publicDestinationZoneIds: [], conditionZoneIds: [], conditionDefinitionIds: [] });
  const merge = (refs: readonly EffectStaticRefs[]): EffectStaticRefs => refs.reduce<EffectStaticRefs>((result, child) => ({
    orderedSourceZoneIds: [...result.orderedSourceZoneIds, ...child.orderedSourceZoneIds],
    publicDestinationZoneIds: [...result.publicDestinationZoneIds, ...child.publicDestinationZoneIds],
    conditionZoneIds: [...result.conditionZoneIds, ...child.conditionZoneIds],
    conditionDefinitionIds: [...result.conditionDefinitionIds, ...child.conditionDefinitionIds],
  }), empty());
  if (node.kind === 'draw-shared-deck') return { ...empty(), orderedSourceZoneIds: [node.sourceZoneId] };
  if (node.kind === 'reveal-shared-deck-to-zone') return { ...empty(), orderedSourceZoneIds: [node.sourceZoneId], publicDestinationZoneIds: [node.destinationZoneId] };
  if (node.kind === 'add-turn-card-combat-bonus' || node.kind === 'set-turn-card-combat-multiplier') return { ...empty(), conditionDefinitionIds: [node.definitionId] };
  if (node.kind === 'choose-shared-row-refresh-subset' || node.kind === 'refresh-shared-row-selection') return { ...empty(), orderedSourceZoneIds: [node.sourceDeckZoneId], conditionZoneIds: [node.rowZoneId] };
  if (node.kind === 'choose-card') return merge([effectStaticRefs(node.effect), ...(node.zeroCandidateEffect ? [effectStaticRefs(node.zeroCandidateEffect)] : [])]);
  if (node.kind === 'sequence') return merge(node.effects.map(effectStaticRefs));
  if (node.kind === 'conditional') {
    const branches = merge([effectStaticRefs(node.whenTrue), ...(node.whenFalse ? [effectStaticRefs(node.whenFalse)] : [])]);
    if (node.condition.kind !== 'definition-in-zone') return branches;
    return {
      ...branches,
      conditionZoneIds: [...branches.conditionZoneIds, node.condition.zoneId],
      conditionDefinitionIds: [...branches.conditionDefinitionIds, node.condition.definitionId],
    };
  }
  if (node.kind === 'choice') return merge(node.options.map(({ effect }) => effectStaticRefs(effect)));
  if (node.kind === 'random' || node.kind === 'roll-die') return merge(node.outcomes.map(({ effect }) => effectStaticRefs(effect)));
  if (node.kind === 'request-counter-consent') return merge(Object.values(node.outcomes).map(effectStaticRefs));
  return empty();
}

function lifecycleActivationRefs(activation: LifecycleActivation | undefined): { definitionIds: string[]; zoneIds: string[] } {
  if (!activation) return { definitionIds: [], zoneIds: [] };
  if (activation.kind === 'all' || activation.kind === 'any') return activation.conditions.reduce((refs, condition) => {
    const child = lifecycleActivationRefs(condition);
    refs.definitionIds.push(...child.definitionIds);
    refs.zoneIds.push(...child.zoneIds);
    return refs;
  }, { definitionIds: [] as string[], zoneIds: [] as string[] });
  if (activation.kind === 'not') return lifecycleActivationRefs(activation.condition);
  if (activation.kind === 'definition-in-actor-party' || activation.kind === 'definition-at-actor-party-position' || activation.kind === 'definition-equipped-by-actor') return { definitionIds: [activation.definitionId], zoneIds: [] };
  if (activation.kind === 'definition-in-zone') return { definitionIds: [activation.definitionId], zoneIds: [activation.zoneId] };
  if (activation.kind === 'zone-card-count-at-least') return { definitionIds: [], zoneIds: [activation.zoneId] };
  return { definitionIds: [], zoneIds: [] };
}

export function createContentRegistry(packs: readonly ContentPack[], options: ContentRegistryOptions = {}): ContentRegistry {
  if (!isFiniteJsonValue(packs)) throw new Error('Content Packs must contain finite, acyclic, plain JSON data only.');
  if (!options.allowProvisionalPlaytest && packs.some((pack) => pack.manifest.contentStatus === 'provisional-playtest')) throw new Error('Provisional playtest Content Packs require explicit allowProvisionalPlaytest.');
  const manifests = packs.map((pack) => pack.manifest);
  if (new Set(manifests.map(({ id }) => id)).size !== manifests.length || manifests.some(({ id, version, hash }) => !id.trim() || !version.trim() || !hash.trim())) throw new Error('Content Pack manifests require unique, non-empty identity fields.');
  const ids = new Set(manifests.map((manifest) => manifest.id));
  for (const manifest of manifests) {
    for (const dependency of manifest.dependencies ?? []) if (!ids.has(dependency)) throw new Error(`Missing content dependency: ${manifest.id} -> ${dependency}`);
    for (const conflict of manifest.conflicts ?? []) if (ids.has(conflict)) throw new Error(`Conflicting content packs: ${manifest.id} and ${conflict}`);
  }
  const basePacks = packs.filter((pack) => pack.manifest.role === 'base');
  if (basePacks.length !== 1) throw new Error('Exactly one base Content Pack is required.');
  const definitions: Record<string, ContentRegistry['definitions'][string]> = {};
  for (const pack of packs) for (const definition of pack.definitions) {
    if (!definition.id.trim() || !definition.name.trim() || !definition.type.trim() || !definition.source.trim() || !Number.isFinite(definition.copies) || !Number.isInteger(definition.copies) || definition.copies < 0 || ['cost', 'combat', 'purchasePower'].some((field) => { const value = definition[field as keyof typeof definition]; return value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 0); }) || (definition.honor !== undefined && (typeof definition.honor !== 'number' || !Number.isFinite(definition.honor) || !Number.isInteger(definition.honor)))) throw new Error(`Invalid card definition: ${definition.id || '<empty>'}`);
    if (definition.useEffect) {
      const effectErrors = validateCardUseEffectDefinition(definition.useEffect);
      if (definition.type !== 'item') effectErrors.push('Only item definitions may declare useEffect.');
      if (definition.itemEffect) effectErrors.push('A card cannot declare both legacy itemEffect and useEffect.');
      if (effectErrors.length) throw new Error(`Invalid card use effect ${definition.id}: ${effectErrors.join(' ')}`);
    }
    if (definition.equipmentEventTriggers) {
      const triggerErrors = definition.equipmentEventTriggers.flatMap(validateEquipmentEventTrigger);
      if (definition.type !== 'equipment') triggerErrors.push('Only equipment definitions may declare equipmentEventTriggers.');
      if (new Set(definition.equipmentEventTriggers.map(({ triggerId }) => triggerId)).size !== definition.equipmentEventTriggers.length) triggerErrors.push('Equipment event trigger IDs must be unique within a card definition.');
      const groups = new Map<string, typeof definition.equipmentEventTriggers>();
      for (const trigger of definition.equipmentEventTriggers) groups.set(`${trigger.point}\u0000${trigger.eventType}`, [...(groups.get(`${trigger.point}\u0000${trigger.eventType}`) ?? []), trigger]);
      for (const triggers of groups.values()) {
        if (triggers.length > 1 && (triggers.some(({ priority }) => priority === undefined) || new Set(triggers.map(({ priority }) => priority)).size !== triggers.length)) triggerErrors.push('Multiple equipment event triggers for one boundary require distinct explicit priorities.');
      }
      if (triggerErrors.length) throw new Error(`Invalid equipment event triggers ${definition.id}: ${triggerErrors.join(' ')}`);
    }
    if (definitions[definition.id]) throw new Error(`Duplicate card definition: ${definition.id}`);
    definitions[definition.id] = definition;
  }
  const replacementMap: Record<string, string> = {};
  const replacements = packs.flatMap((pack) => pack.replacements ?? []).sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0));
  for (const replacement of replacements) {
    if (replacementMap[replacement.replacesDefinitionId]) {
      const winner = replacements.find((candidate) => candidate.replacesDefinitionId === replacement.replacesDefinitionId)!;
      if ((winner.priority ?? 0) === (replacement.priority ?? 0)) throw new Error(`Conflicting replacement: ${replacement.replacesDefinitionId}`);
      continue;
    }
    if (!definitions[replacement.replacesDefinitionId] || !definitions[replacement.replacementDefinitionId]) throw new Error(`Invalid card replacement: ${replacement.replacesDefinitionId}`);
    replacementMap[replacement.replacesDefinitionId] = replacement.replacementDefinitionId;
    delete definitions[replacement.replacesDefinitionId];
  }
  const base = basePacks[0]!;
  if (!base.starter || !base.bonds) throw new Error('The base Content Pack must define starter cards and bonds.');
  const resolveReplacement = (definitionId: string): string => replacementMap[definitionId] ?? definitionId;
  const starter: NonNullable<ContentPack['starter']> = 'partyDefinitionIds' in base.starter
    ? {
        partyDefinitionIds: base.starter.partyDefinitionIds.map(resolveReplacement),
        summonStoneDefinitionId: resolveReplacement(base.starter.summonStoneDefinitionId),
        crystalDefinitionId: resolveReplacement(base.starter.crystalDefinitionId),
      }
    : {
        adventurerDefinitionId: resolveReplacement(base.starter.adventurerDefinitionId),
        summonStoneDefinitionId: resolveReplacement(base.starter.summonStoneDefinitionId),
        crystalDefinitionId: resolveReplacement(base.starter.crystalDefinitionId),
      };
  const starterIds = 'partyDefinitionIds' in starter ? [...starter.partyDefinitionIds, starter.summonStoneDefinitionId, starter.crystalDefinitionId] : [starter.adventurerDefinitionId, starter.summonStoneDefinitionId, starter.crystalDefinitionId];
  if (starterIds.some((id) => !definitions[id])) throw new Error('Base starter setup references an unknown card definition.');
  if (base.bonds.some((bond) => !bond.id.trim() || !bond.name.trim() || !Number.isFinite(bond.honor) || !Number.isInteger(bond.honor) || bond.honor < 0 || !Number.isFinite(bond.requiredBosses) || !Number.isInteger(bond.requiredBosses) || bond.requiredBosses < 0) || new Set(base.bonds.map(({ id }) => id)).size !== base.bonds.length) throw new Error('Base bonds must have unique IDs and finite non-negative mechanics.');
  return { packs: manifests, definitions, starter, bonds: base.bonds, replacementMap };
}
export function createRuleset(packs: readonly ContentPack[], modules: readonly RulesModule[], options?: ContentRegistryOptions): Ruleset {
  for (const module of modules) {
    if (!module.id.trim() || module.id !== module.id.trim() || !module.version.trim() || module.version !== module.version.trim() || !isFiniteJsonValue(module.config ?? {})) throw new Error(`Rules Module ${module.id || '<empty>'} has invalid identity or config.`);
  }
  const composedModules = composeRulesModules(modules);
  const registry = createContentRegistry(packs, options);
  const moduleIds = new Set<string>(); const zoneRefs = new Set<string>(); const hookRefs = new Set<string>(); const combatRefs = new Set<string>(); const attackRefs = new Set<string>(); const rewardRefs = new Set<string>(); const encounterRefs = new Set<string>(); const equipmentRefs = new Set<string>(); const equipmentCombatRefs = new Set<string>(); const equipmentDepartureRefs = new Set<string>(); const attachmentRefs = new Set<string>(); const enemyAttachmentRefs = new Set<string>(); const registeredEquipmentDeparturePolicies: EquipmentDeparturePolicy[] = []; const discardRedirectRefs = new Set<string>(); const participantDepartureRefs = new Set<string>(); const registeredParticipantDeparturePolicies: CombatParticipantDeparturePolicy[] = []; const partyCombatRefs = new Set<string>(); const overflowRefs = new Set<string>(); const capacityRefs = new Set<string>(); const capacityPriorities = new Set<number>(); const setupRefs = new Set<string>(); const setupPriorities = new Set<number>(); const setupSelectors = new Set<string>(); const supplyRefs = new Set<string>(); const supplyPairs = new Set<string>(); const refreshRefs = new Set<string>(); const continuityRefs = new Set<string>(); const continuousRefs = new Set<string>(); const purchaseCostRefs = new Set<string>(); const purchaseCostPriorities = new Set<number>(); const restHandRefs = new Set<string>(); const restHandPriorities = new Set<number>(); const bondRefs = new Set<string>(); const diceRefs = new Set<string>(); const consentRefs = new Set<string>();
  const combatAssistRefs = new Set<string>();
  const registeredCombatAssistPolicies: CombatAssistPolicy[] = [];
  for (const module of composedModules) {
    if (moduleIds.has(module.id)) throw new Error(`Duplicate Rules Module: ${module.id}`);
    moduleIds.add(module.id);
    for (const zone of module.zoneDefinitions ?? []) {
      if (!zone.zoneId.trim() || zone.zoneId !== zone.zoneId.trim()) throw new Error(`Rules Module ${module.id} has an invalid zone ID.`);
      if (zone.rulesModuleId !== module.id) throw new Error(`Rules Module zone ownership mismatch: ${zone.zoneId} must belong to ${module.id}.`);
      if (zoneRefs.has(zone.zoneId)) throw new Error(`Conflicting Rules Module zone: ${zone.zoneId}.`);
      zoneRefs.add(zone.zoneId);
    }
    for (const hook of module.lifecycleHooks ?? []) { const errors = validateLifecycleHook(hook, module.id); const activationRefs = lifecycleActivationRefs(hook.activation); for (const definitionId of activationRefs.definitionIds) if (!registry.definitions[definitionId]) errors.push(`Lifecycle hook ${hook.hookId} references unknown activation definition ${definitionId}.`); for (const zoneId of activationRefs.zoneIds) if (!composedModules.flatMap((candidate) => candidate.zoneDefinitions ?? []).some((zone) => zone.zoneId === zoneId)) errors.push(`Lifecycle hook ${hook.hookId} references unknown activation zone ${zoneId}.`); const ref = `${module.id}\u0000${hook.hookId}`; if (hookRefs.has(ref)) errors.push(`Duplicate lifecycle hook: ${module.id}/${hook.hookId}.`); hookRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
    for (const rule of module.combatRules ?? []) { const errors = validateCombatRule(rule, module.id); const ref = `${module.id}\u0000${rule.ruleId}`; if (combatRefs.has(ref)) errors.push(`Duplicate combat rule: ${module.id}/${rule.ruleId}.`); combatRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
    for (const policy of module.attackResolutionPolicies ?? []) { const errors = validateAttackResolutionPolicy(policy, module.id); const policyId = typeof policy === 'object' && policy !== null && 'policyId' in policy ? String(policy.policyId) : '<invalid>'; const ref = `${module.id}\u0000${policyId}`; if (attackRefs.has(ref)) errors.push(`Duplicate attack resolution policy: ${module.id}/${policyId}.`); attackRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
    for (const policy of module.combatRewardPolicies ?? []) { const errors = validateCombatRewardPolicy(policy, module.id); if (rewardRefs.has(policy.rewardPolicyId)) errors.push(`Duplicate combat reward policy: ${policy.rewardPolicyId}.`); rewardRefs.add(policy.rewardPolicyId); if (errors.length) throw new Error(errors.join(' ')); }
    for (const policy of module.encounterResolutionPolicies ?? []) { const errors = validateEncounterResolutionPolicy(policy, module.id); const policyId = typeof policy === 'object' && policy !== null && 'policyId' in policy ? String(policy.policyId) : '<invalid>'; const ref = `${module.id}\u0000${policyId}`; if (encounterRefs.has(ref)) errors.push(`Duplicate encounter policy: ${module.id}/${policyId}.`); encounterRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
    for (const rule of module.equipmentEligibilityRules ?? []) { const errors = validateEquipmentEligibilityRule(rule, module.id); const ref = `${module.id}\u0000${rule.ruleId}`; if (equipmentRefs.has(ref)) errors.push(`Duplicate equipment eligibility rule: ${module.id}/${rule.ruleId}.`); equipmentRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
    for (const rule of module.equipmentCombatModifierRules ?? []) { const errors = validateEquipmentCombatModifierRule(rule, module.id); const ref = `${module.id}\u0000${rule.ruleId}`; if (equipmentCombatRefs.has(ref)) errors.push(`Duplicate equipment combat modifier rule: ${module.id}/${rule.ruleId}.`); equipmentCombatRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
    for (const policy of module.equipmentDeparturePolicies ?? []) { const errors = validateEquipmentDeparturePolicy(policy, module.id); const ref = `${module.id}\u0000${policy.policyId}`; if (equipmentDepartureRefs.has(ref)) errors.push(`Duplicate equipment departure policy: ${module.id}/${policy.policyId}.`); if (registeredEquipmentDeparturePolicies.some((candidate) => candidate.priority === policy.priority && candidate.cause === policy.cause && candidate.equipmentDefinitionIds.some((definitionId) => policy.equipmentDefinitionIds?.includes(definitionId)))) errors.push(`Equipment departure policy priority ${policy.priority} is ambiguous for an overlapping cause and definition.`); for (const definitionId of policy.equipmentDefinitionIds ?? []) { const definition = registry.definitions[definitionId]; if (!definition) errors.push(`Equipment departure policy ${policy.policyId} references unknown definition ${definitionId}.`); else if (definition.type !== 'equipment') errors.push(`Equipment departure policy ${policy.policyId} definition ${definitionId} must be equipment.`); } equipmentDepartureRefs.add(ref); registeredEquipmentDeparturePolicies.push(policy); if (errors.length) throw new Error(errors.join(' ')); }
    for (const policy of module.attachmentPolicies ?? []) { const errors = validateAttachmentPolicy(policy, module.id); const ref = `${module.id}\u0000${policy.policyId}`; if (attachmentRefs.has(ref)) errors.push(`Duplicate attachment policy: ${module.id}/${policy.policyId}.`); for (const definitionId of [...(policy.sourceDefinitionIds ?? []), ...(policy.wearerDefinitionIds ?? [])]) if (!registry.definitions[definitionId]) errors.push(`Attachment policy ${policy.policyId} references unknown definition ${definitionId}.`); attachmentRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
    for (const policy of module.enemyAttachmentPolicies ?? []) { const errors = validateEnemyAttachmentPolicy(policy, module.id); const ref = `${module.id}\u0000${policy.policyId}`; if (enemyAttachmentRefs.has(ref)) errors.push(`Duplicate enemy attachment policy: ${module.id}/${policy.policyId}.`); for (const definitionId of policy.targetDefinitionIds ?? []) if (!registry.definitions[definitionId]) errors.push(`Enemy attachment policy ${policy.policyId} references unknown target ${definitionId}.`); if (!composedModules.flatMap((candidate) => candidate.zoneDefinitions ?? []).some(({ zoneId }) => zoneId === policy.sourceZoneId)) errors.push(`Enemy attachment policy ${policy.policyId} references unknown source zone ${policy.sourceZoneId}.`); enemyAttachmentRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
    for (const policy of module.discardRedirectPolicies ?? []) { const errors = validateDiscardRedirectPolicy(policy, module.id); const ref = `${module.id}\u0000${policy.policyId}`; if (discardRedirectRefs.has(ref)) errors.push(`Duplicate discard redirect policy: ${module.id}/${policy.policyId}.`); for (const definitionId of policy.definitionIds ?? []) if (!registry.definitions[definitionId]) errors.push(`Discard redirect policy ${policy.policyId} references unknown definition ${definitionId}.`); discardRedirectRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
    for (const policy of module.combatParticipantDeparturePolicies ?? []) { const errors = validateCombatParticipantDeparturePolicy(policy, module.id); const ref = `${module.id}\u0000${policy.policyId}`; if (participantDepartureRefs.has(ref)) errors.push(`Duplicate combat participant departure policy: ${module.id}/${policy.policyId}.`); if (registeredParticipantDeparturePolicies.some((candidate) => candidate.priority === policy.priority && candidate.targetDefinitionIds.some((definitionId) => policy.targetDefinitionIds?.includes(definitionId)))) errors.push(`Combat participant departure policy priority ${policy.priority} is ambiguous for an overlapping target.`); for (const definitionId of policy.targetDefinitionIds ?? []) { const definition = registry.definitions[definitionId]; if (!definition) errors.push(`Combat participant departure policy ${policy.policyId} references unknown target ${definitionId}.`); else if (definition.type !== 'monster' && definition.type !== 'boss') errors.push(`Combat participant departure policy ${policy.policyId} target ${definitionId} must be an enemy.`); } for (const entry of policy.dispositions ?? []) for (const definitionType of entry.definitionTypes ?? []) if (!Object.values(registry.definitions).some(({ type }) => type === definitionType)) errors.push(`Combat participant departure policy ${policy.policyId} references unknown definition type ${definitionType}.`); participantDepartureRefs.add(ref); registeredParticipantDeparturePolicies.push(policy); if (errors.length) throw new Error(errors.join(' ')); }
    for (const policy of module.combatDepartureReplacementPolicies ?? []) {
      const errors = validateCombatDepartureReplacementPolicy(policy, module.id);
      const duplicates = composedModules.flatMap((candidate) => candidate.combatDepartureReplacementPolicies ?? []).filter((candidate) => candidate.moduleId === policy.moduleId && candidate.policyId === policy.policyId);
      if (duplicates.length > 1) errors.push(`Duplicate combat departure replacement policy: ${module.id}/${policy.policyId}.`);
      for (const definitionId of policy.sourceDefinitionIds ?? []) {
        const definition = registry.definitions[definitionId];
        if (!definition) errors.push(`Combat departure replacement policy ${policy.policyId} references unknown source ${definitionId}.`);
        else if (definition.type !== 'adventurer') errors.push(`Combat departure replacement policy ${policy.policyId} source ${definitionId} must be an adventurer.`);
      }
      if (policy.replacement.kind === 'discard-attached-card') for (const definitionType of policy.replacement.attachmentDefinitionTypes) if (!Object.values(registry.definitions).some(({ type }) => type === definitionType)) errors.push(`Combat departure replacement policy ${policy.policyId} references unknown attachment type ${definitionType}.`);
      if (errors.length) throw new Error(errors.join(' '));
    }
    for (const policy of module.combatReserveContributionPolicies ?? []) {
      const errors = validateCombatReserveContributionPolicy(policy, module.id);
      for (const definitionId of policy.sourceDefinitionIds ?? []) { const definition = registry.definitions[definitionId]; if (!definition) errors.push(`Combat reserve contribution policy ${policy.policyId} references unknown source ${definitionId}.`); else if (definition.type !== 'adventurer') errors.push(`Combat reserve contribution policy ${policy.policyId} source must be an adventurer.`); }
      if (errors.length) throw new Error(errors.join(' '));
    }
    for (const policy of module.combatAssistPolicies ?? []) {
      const errors = validateCombatAssistPolicy(policy, module.id);
      const ref = `${module.id}\u0000${policy.policyId}`;
      if (combatAssistRefs.has(ref)) errors.push(`Duplicate combat assist policy: ${module.id}/${policy.policyId}.`);
      if (registeredCombatAssistPolicies.some((candidate) => candidate.sourceDefinitionIds.some((definitionId) => policy.sourceDefinitionIds.includes(definitionId)) && candidate.targetKinds.some((kind) => policy.targetKinds.includes(kind)))) errors.push(`Combat assist policy ${module.id}/${policy.policyId} ambiguously overlaps another source and target kind.`);
      for (const definitionId of policy.sourceDefinitionIds) { const definition = registry.definitions[definitionId]; if (!definition) errors.push(`Combat assist policy ${policy.policyId} references unknown source ${definitionId}.`); else if (definition.type !== 'adventurer') errors.push(`Combat assist policy ${policy.policyId} source must be an adventurer.`); }
      combatAssistRefs.add(ref);
      registeredCombatAssistPolicies.push(policy);
      if (errors.length) throw new Error(errors.join(' '));
    }
    for (const rule of module.partyCombatModifierRules ?? []) { const errors = validatePartyCombatModifierRule(rule, module.id); const ref = `${module.id}\u0000${rule.ruleId}`; if (partyCombatRefs.has(ref)) errors.push(`Duplicate party combat modifier rule: ${module.id}/${rule.ruleId}.`); for (const definitionId of rule.sourceDefinitionIds ?? []) { const definition = registry.definitions[definitionId]; if (!definition) errors.push(`Party combat modifier rule ${rule.ruleId} references unknown source definition ${definitionId}.`); else if (definition.type !== 'adventurer' && definition.type !== 'starter' && definition.type !== 'equipment') errors.push(`Party combat modifier rule ${rule.ruleId} source ${definitionId} must be an adventurer, starter, or equipment.`); } partyCombatRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
    for (const policy of module.teamOverflowPolicies ?? []) { const errors = validateTeamOverflowPolicy(policy, module.id); const ref = `${module.id}\u0000${policy.policyId}`; if (overflowRefs.has(ref)) errors.push(`Duplicate team overflow policy: ${module.id}/${policy.policyId}.`); overflowRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
    for (const policy of module.teamCapacityEnforcementPolicies ?? []) { const errors = validateTeamCapacityEnforcementPolicy(policy, module.id); if (capacityRefs.has(policy.policyId)) errors.push(`Duplicate team capacity enforcement policy: ${policy.policyId}.`); if (capacityPriorities.has(policy.priority)) errors.push(`Team capacity enforcement policy priority ${policy.priority} is ambiguous.`); capacityRefs.add(policy.policyId); capacityPriorities.add(policy.priority); if (errors.length) throw new Error(errors.join(' ')); }
    for (const contribution of module.setupContributions ?? []) { const errors = validateSetupCardPoolContribution(contribution, module.id); if (setupRefs.has(contribution.contributionId)) errors.push(`Duplicate setup contribution: ${contribution.contributionId}.`); if (setupPriorities.has(contribution.priority)) errors.push(`Setup contribution priority ${contribution.priority} is ambiguous.`); const selector = `${contribution.selector.kind}\u0000${contribution.selector.value}`; if (setupSelectors.has(selector)) errors.push(`Conflicting setup contribution selector: ${contribution.selector.value}.`); setupRefs.add(contribution.contributionId); setupPriorities.add(contribution.priority); setupSelectors.add(selector); if (errors.length) throw new Error(errors.join(' ')); }
    for (const config of module.supplyRowConfigurations ?? []) { const errors = validateSupplyRowConfiguration(config, module.id); const ref = `${module.id}\u0000${config.configurationId}`; const pair = `${config.sourceDeckZoneId}\u0000${config.targetRowZoneId}`; if (supplyRefs.has(ref)) errors.push(`Duplicate supply configuration: ${module.id}/${config.configurationId}.`); if (supplyPairs.has(pair)) errors.push(`Duplicate supply deck/row configuration: ${pair}.`); supplyRefs.add(ref); supplyPairs.add(pair); if (errors.length) throw new Error(errors.join(' ')); }
    for (const policy of module.supplyRowRefreshPolicies ?? []) { const errors = validateSupplyRowRefreshPolicy(policy, module.id); const ref = `${module.id}\u0000${policy.refreshPolicyId}`; if (refreshRefs.has(ref)) errors.push(`Duplicate supply refresh policy: ${module.id}/${policy.refreshPolicyId}.`); if (!composedModules.flatMap((candidate) => candidate.supplyRowConfigurations ?? []).some((config) => config.configurationId === policy.supplyRowConfigurationId)) errors.push(`Unknown supply configuration: ${policy.supplyRowConfigurationId}.`); refreshRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
    for (const policy of module.supplyContinuityPolicies ?? []) { const errors = validateSupplyContinuityPolicy(policy, module.id); const ref = `${module.id}\u0000${policy.policyId}`; if (continuityRefs.has(ref)) errors.push(`Duplicate supply continuity policy: ${module.id}/${policy.policyId}.`); continuityRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
    for (const rule of module.continuousRules ?? []) { const errors = validateContinuousRule(rule, module.id); const ref = `${module.id}\u0000${rule.effectId}`; if (continuousRefs.has(ref)) errors.push(`Duplicate continuous rule: ${module.id}/${rule.effectId}.`); continuousRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
    for (const rule of module.purchaseCostModifierRules ?? []) { const errors = validatePurchaseCostModifierRule(rule, module.id); const ref = `${module.id}\u0000${rule.ruleId}`; if (purchaseCostRefs.has(ref)) errors.push(`Duplicate purchase cost modifier rule: ${module.id}/${rule.ruleId}.`); if (purchaseCostPriorities.has(rule.priority)) errors.push(`Purchase cost modifier priority ${rule.priority} is ambiguous.`); purchaseCostRefs.add(ref); purchaseCostPriorities.add(rule.priority); if (errors.length) throw new Error(errors.join(' ')); }
    for (const policy of module.restHandSizePolicies ?? []) { const errors = validateRestHandSizePolicy(policy, module.id); const ref = `${module.id}\u0000${policy.policyId}`; if (restHandRefs.has(ref)) errors.push(`Duplicate rest hand-size policy: ${module.id}/${policy.policyId}.`); if (restHandPriorities.has(policy.priority)) errors.push(`Rest hand-size priority ${policy.priority} is ambiguous.`); restHandRefs.add(ref); restHandPriorities.add(policy.priority); if (errors.length) throw new Error(errors.join(' ')); }
    for (const rule of module.bondConditionRules ?? []) { const errors = validateBondConditionRule(rule, module.id); const ref = `${module.id}\u0000${rule.ruleId}`; if (bondRefs.has(ref)) errors.push(`Duplicate bond condition rule: ${module.id}/${rule.ruleId}.`); bondRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
    for (const die of module.diceDefinitions ?? []) { const errors = validateDiceDefinition(die, module.id); const ref = `${module.id}\u0000${die.diceId}`; if (diceRefs.has(ref)) errors.push(`Duplicate dice definition: ${module.id}/${die.diceId}.`); diceRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
    for (const policy of module.counterConsentPolicies ?? []) { const errors = validateCounterConsentPolicy(policy, module.id); const ref = `${module.id}\u0000${policy.policyId}`; if (consentRefs.has(ref)) errors.push(`Duplicate counter consent policy: ${module.id}/${policy.policyId}.`); consentRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
  }
  const zoneDefinitions = new Map(composedModules.flatMap((module) => module.zoneDefinitions ?? []).map((zone) => [zone.zoneId, zone]));
  for (const module of composedModules) for (const policy of module.combatParticipantDeparturePolicies ?? []) {
    const zoneIds = [...policy.dispositions.filter(({ destination }) => destination.kind === 'shuffle-into-shared-deck').map(({ destination }) => destination.kind === 'shuffle-into-shared-deck' ? destination.zoneId : ''), ...(policy.replacementDraw ? [policy.replacementDraw.sourceZoneId] : [])];
    for (const zoneId of zoneIds) { const zone = zoneDefinitions.get(zoneId); if (!zone) throw new Error(`Combat participant departure policy ${policy.policyId} references unknown shared deck ${zoneId}.`); if (zone.kind !== 'orderedDeck') throw new Error(`Combat participant departure policy ${policy.policyId} shared deck ${zoneId} must be an ordered deck.`); }
  }
  const registeredEffects = [
    ...composedModules.flatMap((module) => [
      ...(module.lifecycleHooks ?? []).map(({ effect }) => effect),
      ...(module.combatRewardPolicies ?? []).map(({ reward }) => reward),
    ]),
    ...Object.values(registry.definitions).flatMap((definition) => [
      ...(definition.useEffect ? [definition.useEffect] : []),
      ...(definition.equipmentEventTriggers ?? []).map(({ effect }) => effect),
    ]),
  ];
  for (const effect of registeredEffects) for (const zoneId of selectableSharedZoneIds(effect.body)) {
    const zone = zoneDefinitions.get(zoneId);
    if (!zone) throw new Error(`Dynamic card choice references unknown shared zone ${zoneId}.`);
    if (zone.visibility !== 'public') throw new Error(`Dynamic card choice shared zone ${zoneId} must be public.`);
  }
  for (const effect of registeredEffects) {
    const refs = effectStaticRefs(effect.body);
    for (const zoneId of refs.orderedSourceZoneIds) {
      const zone = zoneDefinitions.get(zoneId);
      if (!zone) throw new Error(`Shared-deck draw references unknown zone ${zoneId}.`);
      if (zone.kind !== 'orderedDeck') throw new Error(`Shared-deck draw source ${zoneId} must be an ordered deck.`);
    }
    for (const zoneId of refs.publicDestinationZoneIds) {
      const zone = zoneDefinitions.get(zoneId);
      if (!zone) throw new Error(`Shared-deck reveal references unknown destination zone ${zoneId}.`);
      if (zone.kind !== 'moduleArea' || zone.visibility !== 'public') throw new Error(`Shared-deck reveal destination ${zoneId} must be a public module area.`);
    }
    for (const zoneId of refs.conditionZoneIds) if (!zoneDefinitions.has(zoneId)) throw new Error(`Effect condition references unknown zone ${zoneId}.`);
    for (const definitionId of refs.conditionDefinitionIds) if (!registry.definitions[definitionId]) throw new Error(`Effect condition references unknown definition ${definitionId}.`);
  }
  for (const module of composedModules) for (const entry of [...(module.purchaseCostModifierRules ?? []), ...(module.restHandSizePolicies ?? [])]) {
    if (entry.activation.kind === 'definition-in-zone') {
      const zone = zoneDefinitions.get(entry.activation.zoneId);
      if (!zone) throw new Error(`Rule activation references unknown zone ${entry.activation.zoneId}.`);
      if (zone.visibility !== 'public') throw new Error(`Rule activation zone ${entry.activation.zoneId} must be public.`);
    }
    if (!registry.definitions[entry.activation.definitionId]) throw new Error(`Rule activation references unknown definition ${entry.activation.definitionId}.`);
  }
  for (const module of composedModules) for (const rule of module.purchaseCostModifierRules ?? []) for (const type of rule.target.values) {
    if (!Object.values(registry.definitions).some((definition) => definition.type === type)) throw new Error(`Purchase cost modifier ${rule.ruleId} references unknown definition type ${type}.`);
  }
  for (const module of composedModules) for (const rule of module.combatRules ?? []) if (rule.kind === 'modifier' && typeof rule.amount !== 'number' && rule.amount.kind === 'public-zone-card-count') {
    const zone = zoneDefinitions.get(rule.amount.zoneId);
    if (!zone) throw new Error(`Combat modifier ${rule.ruleId} references unknown zone ${rule.amount.zoneId}.`);
    if (zone.visibility !== 'public') throw new Error(`Combat modifier ${rule.ruleId} zone ${rule.amount.zoneId} must be public.`);
    for (const type of rule.amount.definitionTypes) if (!Object.values(registry.definitions).some((definition) => definition.type === type)) throw new Error(`Combat modifier ${rule.ruleId} references unknown definition type ${type}.`);
  }
  for (const module of composedModules) for (const rule of module.combatRules ?? []) for (const definitionId of combatConditionDefinitionIds(rule.when)) {
    const definition = registry.definitions[definitionId];
    if (!definition) throw new Error(`Combat rule ${rule.ruleId} references unknown target definition ${definitionId}.`);
    if (definition.type !== 'monster' && definition.type !== 'boss') throw new Error(`Combat rule ${rule.ruleId} target definition ${definitionId} must be an enemy.`);
  }
  for (const module of composedModules) for (const contribution of module.setupContributions ?? []) {
    const destination = zoneDefinitions.get(contribution.destinationZoneId);
    if (!destination) throw new Error(`Setup contribution ${contribution.contributionId} has unknown destination zone ${contribution.destinationZoneId}.`);
    if (destination.rulesModuleId !== module.id || destination.kind !== 'orderedDeck') throw new Error(`Setup contribution ${contribution.contributionId} destination must be an ordered deck owned by ${module.id}.`);
    for (const zoneId of contribution.count.zoneIds) if (!zoneDefinitions.has(zoneId)) throw new Error(`Setup contribution ${contribution.contributionId} has unknown count zone ${zoneId}.`);
    if (!Object.values(registry.definitions).some(({ type }) => type === contribution.selector.value)) throw new Error(`Setup contribution ${contribution.contributionId} selector has no matching definitions.`);
  }
  const ruleset = { registry, modules: composedModules };
  for (const module of composedModules) for (const policy of module.attackResolutionPolicies ?? []) {
    const owner = composedModules.find(({ id }) => id === policy.encounterPolicy.moduleId);
    if (!owner?.encounterResolutionPolicies?.some(({ policyId }) => policyId === policy.encounterPolicy.policyId)) throw new Error(`Attack resolution policy ${module.id}/${policy.policyId} references unknown encounter policy ${policy.encounterPolicy.moduleId}/${policy.encounterPolicy.policyId}.`);
  }
  const continuityErrors = validateSupplyContinuityRegistry(ruleset);
  if (continuityErrors.length) throw new Error(continuityErrors.join(' '));
  return ruleset;
}
export function getPartyLimit(ruleset: Ruleset, state: GameState, player: PlayerState): number { const compatibility = validateRulesetStateCompatibility(state, ruleset); if (compatibility) throw new Error(compatibility); const base = ruleset.modules.reduce((limit, module) => module.getPartyLimit(state, player, limit), Number.MAX_SAFE_INTEGER); const continuous = evaluateContinuousEffects(state, ruleset); if (continuous.status !== 'ready') throw new Error(continuous.error); return Math.max(0, base + continuous.evaluation.active.filter((effect) => effect.target === 'team-capacity').reduce((sum, effect) => sum + effect.amount, 0)); }
export function getEndCondition(ruleset: Ruleset, state: GameState): string | undefined {
  return getEndConditions(ruleset, state)[0];
}
export function getEndConditions(ruleset: Ruleset, state: GameState): string[] {
  const compatibility = validateRulesetStateCompatibility(state, ruleset); if (compatibility) throw new Error(compatibility);
  return ruleset.modules.flatMap((module) => module.endConditions ?? []).sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0)).filter((condition) => condition.evaluate(state)).map(({ id }) => id);
}
export function handleSupplyDepleted(ruleset: Ruleset, state: GameState, supply: SupplyKind): void { const compatibility = validateRulesetStateCompatibility(state, ruleset); if (compatibility) throw new Error(compatibility); if (ruleset.modules.map((module) => module.onSupplyDepleted(state, supply)).includes('pendingOfficialRuling')) state.status = 'pendingOfficialRuling'; }
