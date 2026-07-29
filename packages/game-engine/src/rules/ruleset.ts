import { validateCombatRule, validateContinuousRule, validateEquipmentEligibilityRule, validateLifecycleHook, validateSupplyRowConfiguration, validateSupplyRowRefreshPolicy, validateTeamOverflowPolicy, type CombatRule, type ContentPack, type ContentRegistry, type ContinuousRule, type EquipmentEligibilityRule, type GameState, type LifecycleHook, type PlayerState, type SupplyRowConfiguration, type SupplyRowRefreshPolicy, type TeamOverflowPolicy } from '@guildmaster/game-protocol';
import type { ZoneDefinition } from '../model/zones.js';

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
  equipmentEligibilityRules?: readonly EquipmentEligibilityRule[];
  teamOverflowPolicies?: readonly TeamOverflowPolicy[];
  supplyRowConfigurations?: readonly SupplyRowConfiguration[];
  supplyRowRefreshPolicies?: readonly SupplyRowRefreshPolicy[];
  continuousRules?: readonly ContinuousRule[];
  endConditions?: readonly EndCondition[];
  getScoreContributions?: (state: GameState, registry: ContentRegistry) => readonly ScoreContribution[];
};
export type Ruleset = { registry: ContentRegistry; modules: readonly RulesModule[] };
export type ContentRegistryOptions = { allowProvisionalPlaytest?: boolean };

export function createContentRegistry(packs: readonly ContentPack[], options: ContentRegistryOptions = {}): ContentRegistry {
  if (!options.allowProvisionalPlaytest && packs.some((pack) => pack.manifest.contentStatus === 'provisional-playtest')) throw new Error('Provisional playtest Content Packs require explicit allowProvisionalPlaytest.');
  const manifests = packs.map((pack) => pack.manifest);
  const ids = new Set(manifests.map((manifest) => manifest.id));
  for (const manifest of manifests) {
    for (const dependency of manifest.dependencies ?? []) if (!ids.has(dependency)) throw new Error(`Missing content dependency: ${manifest.id} -> ${dependency}`);
    for (const conflict of manifest.conflicts ?? []) if (ids.has(conflict)) throw new Error(`Conflicting content packs: ${manifest.id} and ${conflict}`);
  }
  const basePacks = packs.filter((pack) => pack.manifest.role === 'base');
  if (basePacks.length !== 1) throw new Error('Exactly one base Content Pack is required.');
  const definitions: Record<string, ContentRegistry['definitions'][string]> = {};
  for (const pack of packs) for (const definition of pack.definitions) {
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
  return { packs: manifests, definitions, starter: base.starter, bonds: base.bonds, replacementMap };
}
export function createRuleset(packs: readonly ContentPack[], modules: readonly RulesModule[], options?: ContentRegistryOptions): Ruleset {
  const moduleIds = new Set<string>(); const hookRefs = new Set<string>(); const combatRefs = new Set<string>(); const equipmentRefs = new Set<string>(); const overflowRefs = new Set<string>(); const supplyRefs = new Set<string>(); const supplyPairs = new Set<string>(); const refreshRefs = new Set<string>(); const continuousRefs = new Set<string>();
  for (const module of modules) {
    if (moduleIds.has(module.id)) throw new Error(`Duplicate Rules Module: ${module.id}`);
    moduleIds.add(module.id);
    for (const hook of module.lifecycleHooks ?? []) { const errors = validateLifecycleHook(hook, module.id); const ref = `${module.id}\u0000${hook.hookId}`; if (hookRefs.has(ref)) errors.push(`Duplicate lifecycle hook: ${module.id}/${hook.hookId}.`); hookRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
    for (const rule of module.combatRules ?? []) { const errors = validateCombatRule(rule, module.id); const ref = `${module.id}\u0000${rule.ruleId}`; if (combatRefs.has(ref)) errors.push(`Duplicate combat rule: ${module.id}/${rule.ruleId}.`); combatRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
    for (const rule of module.equipmentEligibilityRules ?? []) { const errors = validateEquipmentEligibilityRule(rule, module.id); const ref = `${module.id}\u0000${rule.ruleId}`; if (equipmentRefs.has(ref)) errors.push(`Duplicate equipment eligibility rule: ${module.id}/${rule.ruleId}.`); equipmentRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
    for (const policy of module.teamOverflowPolicies ?? []) { const errors = validateTeamOverflowPolicy(policy, module.id); const ref = `${module.id}\u0000${policy.policyId}`; if (overflowRefs.has(ref)) errors.push(`Duplicate team overflow policy: ${module.id}/${policy.policyId}.`); overflowRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
    for (const config of module.supplyRowConfigurations ?? []) { const errors = validateSupplyRowConfiguration(config, module.id); const ref = `${module.id}\u0000${config.configurationId}`; const pair = `${config.sourceDeckZoneId}\u0000${config.targetRowZoneId}`; if (supplyRefs.has(ref)) errors.push(`Duplicate supply configuration: ${module.id}/${config.configurationId}.`); if (supplyPairs.has(pair)) errors.push(`Duplicate supply deck/row configuration: ${pair}.`); supplyRefs.add(ref); supplyPairs.add(pair); if (errors.length) throw new Error(errors.join(' ')); }
    for (const policy of module.supplyRowRefreshPolicies ?? []) { const errors = validateSupplyRowRefreshPolicy(policy, module.id); const ref = `${module.id}\u0000${policy.refreshPolicyId}`; if (refreshRefs.has(ref)) errors.push(`Duplicate supply refresh policy: ${module.id}/${policy.refreshPolicyId}.`); if (!modules.flatMap((candidate) => candidate.supplyRowConfigurations ?? []).some((config) => config.configurationId === policy.supplyRowConfigurationId)) errors.push(`Unknown supply configuration: ${policy.supplyRowConfigurationId}.`); refreshRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
    for (const rule of module.continuousRules ?? []) { const errors = validateContinuousRule(rule, module.id); const ref = `${module.id}\u0000${rule.effectId}`; if (continuousRefs.has(ref)) errors.push(`Duplicate continuous rule: ${module.id}/${rule.effectId}.`); continuousRefs.add(ref); if (errors.length) throw new Error(errors.join(' ')); }
  }
  return { registry: createContentRegistry(packs, options), modules };
}
export function getPartyLimit(ruleset: Ruleset, state: GameState, player: PlayerState): number { return Math.max(0, ruleset.modules.reduce((limit, module) => module.getPartyLimit(state, player, limit), Number.MAX_SAFE_INTEGER)); }
export function getEndCondition(ruleset: Ruleset, state: GameState): string | undefined {
  return ruleset.modules.flatMap((module) => module.endConditions ?? []).sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0)).find((condition) => condition.evaluate(state))?.id;
}
export function handleSupplyDepleted(ruleset: Ruleset, state: GameState, supply: SupplyKind): void { if (ruleset.modules.map((module) => module.onSupplyDepleted(state, supply)).includes('pendingOfficialRuling')) state.status = 'pendingOfficialRuling'; }
