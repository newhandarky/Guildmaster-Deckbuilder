import { isFiniteJsonValue, validateAttackResolutionPolicy, validateBondConditionRule, validateCardUseEffectDefinition, validateCombatRewardPolicy, validateCombatRule, validateContinuousRule, validateCounterConsentPolicy, validateDiceDefinition, validateEncounterResolutionPolicy, validateEquipmentCombatModifierRule, validateEquipmentEligibilityRule, validateEquipmentEventTrigger, validateLifecycleHook, validateSupplyRowConfiguration, validateSupplyRowRefreshPolicy, validateTeamOverflowPolicy, type AttackResolutionPolicy, type BondConditionRule, type CombatRewardPolicy, type CombatRule, type ContentPack, type ContentRegistry, type ContinuousRule, type CounterConsentPolicy, type DiceDefinition, type EncounterResolutionPolicy, type EquipmentCombatModifierRule, type EquipmentEligibilityRule, type GameState, type LifecycleHook, type PlayerState, type SupplyRowConfiguration, type SupplyRowRefreshPolicy, type TeamOverflowPolicy } from '@guildmaster/game-protocol';
import type { ZoneDefinition } from '../model/zones.js';
import { evaluateContinuousEffects } from './continuous-evaluator.js';
import { validateSupplyContinuityPolicy, validateSupplyContinuityRegistry, type SupplyContinuityPolicy } from './supply-continuity-evaluator.js';

export type SupplyKind = 'adventurer' | 'item' | 'monster' | 'boss';
export type EndCondition = { id: string; priority?: number; evaluate: (state: GameState) => boolean };
export type ScoreContribution = { playerId: string; ruleId: string; amount: number; label: string };
export type RulesModule = {
  id: string; version: string; config?: Record<string, unknown>;
  createInitialState?: () => unknown; zoneDefinitions?: readonly ZoneDefinition[];
  getPartyLimit: (state: GameState, player: PlayerState, currentLimit: number) => number;
  onSupplyDepleted: (state: GameState, supply: SupplyKind) => 'pendingOfficialRuling' | 'handled';
  lifecycleHooks?: readonly LifecycleHook[];
  combatRules?: readonly CombatRule[];
  attackResolutionPolicies?: readonly AttackResolutionPolicy[];
  combatRewardPolicies?: readonly CombatRewardPolicy[];
  encounterResolutionPolicies?: readonly EncounterResolutionPolicy[];
  equipmentEligibilityRules?: readonly EquipmentEligibilityRule[];
  equipmentCombatModifierRules?: readonly EquipmentCombatModifierRule[];
  teamOverflowPolicies?: readonly TeamOverflowPolicy[];
  supplyRowConfigurations?: readonly SupplyRowConfiguration[];
  supplyRowRefreshPolicies?: readonly SupplyRowRefreshPolicy[];
  supplyContinuityPolicies?: readonly SupplyContinuityPolicy[];
  continuousRules?: readonly ContinuousRule[];
  bondConditionRules?: readonly BondConditionRule[];
  diceDefinitions?: readonly DiceDefinition[];
  counterConsentPolicies?: readonly CounterConsentPolicy[];
  endConditions?: readonly EndCondition[];
  getScoreContributions?: (state: GameState, registry: ContentRegistry) => readonly ScoreContribution[];
};
export type Ruleset = { registry: ContentRegistry; modules: readonly RulesModule[] };
export type ContentRegistryOptions = { allowProvisionalPlaytest?: boolean };

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
    if (!definition.id.trim() || !definition.name.trim() || !definition.type.trim() || !definition.source.trim() || !Number.isFinite(definition.copies) || !Number.isInteger(definition.copies) || definition.copies < 0 || ['cost', 'combat', 'purchasePower', 'honor'].some((field) => { const value = definition[field as keyof typeof definition]; return value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 0); })) throw new Error(`Invalid card definition: ${definition.id || '<empty>'}`);
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
  const starterIds = 'partyDefinitionIds' in base.starter ? [...base.starter.partyDefinitionIds, base.starter.summonStoneDefinitionId, base.starter.crystalDefinitionId] : [base.starter.adventurerDefinitionId, base.starter.summonStoneDefinitionId, base.starter.crystalDefinitionId];
  if (starterIds.some((id) => !definitions[id])) throw new Error('Base starter setup references an unknown card definition.');
  if (base.bonds.some((bond) => !bond.id.trim() || !bond.name.trim() || !Number.isFinite(bond.honor) || !Number.isInteger(bond.honor) || bond.honor < 0 || !Number.isFinite(bond.requiredBosses) || !Number.isInteger(bond.requiredBosses) || bond.requiredBosses < 0) || new Set(base.bonds.map(({ id }) => id)).size !== base.bonds.length) throw new Error('Base bonds must have unique IDs and finite non-negative mechanics.');
  return { packs: manifests, definitions, starter: base.starter, bonds: base.bonds, replacementMap };
}
export function createRuleset(packs: readonly ContentPack[], modules: readonly RulesModule[], options?: ContentRegistryOptions): Ruleset {
  const moduleIds = new Set<string>(); const hookRefs = new Set<string>(); const combatRefs = new Set<string>(); const attackRefs = new Set<string>(); const rewardRefs = new Set<string>(); const encounterRefs = new Set<string>(); const equipmentRefs = new Set<string>(); const equipmentCombatRefs = new Set<string>(); const overflowRefs = new Set<string>(); const supplyRefs = new Set<string>(); const supplyPairs = new Set<string>(); const refreshRefs = new Set<string>(); const continuityRefs = new Set<string>(); const continuousRefs = new Set<string>(); const bondRefs = new Set<string>(); const diceRefs = new Set<string>(); const consentRefs = new Set<string>();
  for (const module of modules) {
    if (!module.id.trim() || !module.version.trim() || !isFiniteJsonValue(module.config ?? {})) throw new Error(`Rules Module ${module.id || '<empty>'} has invalid identity or config.`);
    if (moduleIds.has(module.id)) throw new Error(`Duplicate Rules Module: ${module.id}`);
    moduleIds.add(module.id);
    for (const hook of module.lifecycleHooks ?? []) { const errors = validateLifecycleHook(hook, module.id); const ref = `${module.id}\u0000${hook.hookId}`; if (hookRefs.has(ref)) errors.push(`Duplicate lifecycle hook: ${module.id}/${hook.hookId}.`); hookRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
    for (const rule of module.combatRules ?? []) { const errors = validateCombatRule(rule, module.id); const ref = `${module.id}\u0000${rule.ruleId}`; if (combatRefs.has(ref)) errors.push(`Duplicate combat rule: ${module.id}/${rule.ruleId}.`); combatRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
    for (const policy of module.attackResolutionPolicies ?? []) { const errors = validateAttackResolutionPolicy(policy, module.id); const policyId = typeof policy === 'object' && policy !== null && 'policyId' in policy ? String(policy.policyId) : '<invalid>'; const ref = `${module.id}\u0000${policyId}`; if (attackRefs.has(ref)) errors.push(`Duplicate attack resolution policy: ${module.id}/${policyId}.`); attackRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
    for (const policy of module.combatRewardPolicies ?? []) { const errors = validateCombatRewardPolicy(policy, module.id); if (rewardRefs.has(policy.rewardPolicyId)) errors.push(`Duplicate combat reward policy: ${policy.rewardPolicyId}.`); rewardRefs.add(policy.rewardPolicyId); if (errors.length) throw new Error(errors.join(' ')); }
    for (const policy of module.encounterResolutionPolicies ?? []) { const errors = validateEncounterResolutionPolicy(policy, module.id); const policyId = typeof policy === 'object' && policy !== null && 'policyId' in policy ? String(policy.policyId) : '<invalid>'; const ref = `${module.id}\u0000${policyId}`; if (encounterRefs.has(ref)) errors.push(`Duplicate encounter policy: ${module.id}/${policyId}.`); encounterRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
    for (const rule of module.equipmentEligibilityRules ?? []) { const errors = validateEquipmentEligibilityRule(rule, module.id); const ref = `${module.id}\u0000${rule.ruleId}`; if (equipmentRefs.has(ref)) errors.push(`Duplicate equipment eligibility rule: ${module.id}/${rule.ruleId}.`); equipmentRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
    for (const rule of module.equipmentCombatModifierRules ?? []) { const errors = validateEquipmentCombatModifierRule(rule, module.id); const ref = `${module.id}\u0000${rule.ruleId}`; if (equipmentCombatRefs.has(ref)) errors.push(`Duplicate equipment combat modifier rule: ${module.id}/${rule.ruleId}.`); equipmentCombatRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
    for (const policy of module.teamOverflowPolicies ?? []) { const errors = validateTeamOverflowPolicy(policy, module.id); const ref = `${module.id}\u0000${policy.policyId}`; if (overflowRefs.has(ref)) errors.push(`Duplicate team overflow policy: ${module.id}/${policy.policyId}.`); overflowRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
    for (const config of module.supplyRowConfigurations ?? []) { const errors = validateSupplyRowConfiguration(config, module.id); const ref = `${module.id}\u0000${config.configurationId}`; const pair = `${config.sourceDeckZoneId}\u0000${config.targetRowZoneId}`; if (supplyRefs.has(ref)) errors.push(`Duplicate supply configuration: ${module.id}/${config.configurationId}.`); if (supplyPairs.has(pair)) errors.push(`Duplicate supply deck/row configuration: ${pair}.`); supplyRefs.add(ref); supplyPairs.add(pair); if (errors.length) throw new Error(errors.join(' ')); }
    for (const policy of module.supplyRowRefreshPolicies ?? []) { const errors = validateSupplyRowRefreshPolicy(policy, module.id); const ref = `${module.id}\u0000${policy.refreshPolicyId}`; if (refreshRefs.has(ref)) errors.push(`Duplicate supply refresh policy: ${module.id}/${policy.refreshPolicyId}.`); if (!modules.flatMap((candidate) => candidate.supplyRowConfigurations ?? []).some((config) => config.configurationId === policy.supplyRowConfigurationId)) errors.push(`Unknown supply configuration: ${policy.supplyRowConfigurationId}.`); refreshRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
    for (const policy of module.supplyContinuityPolicies ?? []) { const errors = validateSupplyContinuityPolicy(policy, module.id); const ref = `${module.id}\u0000${policy.policyId}`; if (continuityRefs.has(ref)) errors.push(`Duplicate supply continuity policy: ${module.id}/${policy.policyId}.`); continuityRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
    for (const rule of module.continuousRules ?? []) { const errors = validateContinuousRule(rule, module.id); const ref = `${module.id}\u0000${rule.effectId}`; if (continuousRefs.has(ref)) errors.push(`Duplicate continuous rule: ${module.id}/${rule.effectId}.`); continuousRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
    for (const rule of module.bondConditionRules ?? []) { const errors = validateBondConditionRule(rule, module.id); const ref = `${module.id}\u0000${rule.ruleId}`; if (bondRefs.has(ref)) errors.push(`Duplicate bond condition rule: ${module.id}/${rule.ruleId}.`); bondRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
    for (const die of module.diceDefinitions ?? []) { const errors = validateDiceDefinition(die, module.id); const ref = `${module.id}\u0000${die.diceId}`; if (diceRefs.has(ref)) errors.push(`Duplicate dice definition: ${module.id}/${die.diceId}.`); diceRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
    for (const policy of module.counterConsentPolicies ?? []) { const errors = validateCounterConsentPolicy(policy, module.id); const ref = `${module.id}\u0000${policy.policyId}`; if (consentRefs.has(ref)) errors.push(`Duplicate counter consent policy: ${module.id}/${policy.policyId}.`); consentRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
  }
  const ruleset = { registry: createContentRegistry(packs, options), modules };
  for (const module of modules) for (const policy of module.attackResolutionPolicies ?? []) {
    const owner = modules.find(({ id }) => id === policy.encounterPolicy.moduleId);
    if (!owner?.encounterResolutionPolicies?.some(({ policyId }) => policyId === policy.encounterPolicy.policyId)) throw new Error(`Attack resolution policy ${module.id}/${policy.policyId} references unknown encounter policy ${policy.encounterPolicy.moduleId}/${policy.encounterPolicy.policyId}.`);
  }
  const continuityErrors = validateSupplyContinuityRegistry(ruleset);
  if (continuityErrors.length) throw new Error(continuityErrors.join(' '));
  return ruleset;
}
export function validateRulesetStateCompatibility(state: GameState, ruleset: Ruleset): string | undefined {
  const packs = ruleset.registry.packs.map(({ id, version, hash }) => ({ id, version, hash }));
  const modules = ruleset.modules.map(({ id, version, config }) => ({ id, version, ...(config ? { config } : {}) }));
  if (JSON.stringify(state.contentPacks) !== JSON.stringify(packs)) return 'Content Pack registry fingerprint mismatch.';
  if (JSON.stringify(state.rulesModules) !== JSON.stringify(modules)) return 'Rules Module registry fingerprint mismatch.';
  return undefined;
}
export function getPartyLimit(ruleset: Ruleset, state: GameState, player: PlayerState): number { const base = ruleset.modules.reduce((limit, module) => module.getPartyLimit(state, player, limit), Number.MAX_SAFE_INTEGER); const continuous = evaluateContinuousEffects(state, ruleset); if (continuous.status !== 'ready') throw new Error(continuous.error); return Math.max(0, base + continuous.evaluation.active.filter((effect) => effect.target === 'team-capacity').reduce((sum, effect) => sum + effect.amount, 0)); }
export function getEndCondition(ruleset: Ruleset, state: GameState): string | undefined {
  return ruleset.modules.flatMap((module) => module.endConditions ?? []).sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0)).find((condition) => condition.evaluate(state))?.id;
}
export function handleSupplyDepleted(ruleset: Ruleset, state: GameState, supply: SupplyKind): void { if (ruleset.modules.map((module) => module.onSupplyDepleted(state, supply)).includes('pendingOfficialRuling')) state.status = 'pendingOfficialRuling'; }
