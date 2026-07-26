import type { ContentPack, ContentRegistry, GameState, PlayerState } from '@guildmaster/game-protocol';
import type { ZoneDefinition } from '../model/zones.js';

export type SupplyKind = 'adventurer' | 'item' | 'monster' | 'boss';
export type EndCondition = { id: string; priority?: number; evaluate: (state: GameState) => boolean };
export type ScoreContribution = { playerId: string; ruleId: string; amount: number; label: string };
export type RulesModule = {
  id: string; version: string; config?: Record<string, unknown>;
  createInitialState?: () => unknown; zoneDefinitions?: readonly ZoneDefinition[];
  getPartyLimit: (state: GameState, player: PlayerState, currentLimit: number) => number;
  onSupplyDepleted: (state: GameState, supply: SupplyKind) => 'pendingOfficialRuling' | 'handled';
  endConditions?: readonly EndCondition[];
  getScoreContributions?: (state: GameState, registry: ContentRegistry) => readonly ScoreContribution[];
};
export type Ruleset = { registry: ContentRegistry; modules: readonly RulesModule[] };

export function createContentRegistry(packs: readonly ContentPack[]): ContentRegistry {
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
  for (const replacement of packs.flatMap((pack) => pack.replacements ?? [])) {
    if (!definitions[replacement.replacesDefinitionId] || !definitions[replacement.replacementDefinitionId]) throw new Error(`Invalid card replacement: ${replacement.replacesDefinitionId}`);
    if (replacementMap[replacement.replacesDefinitionId]) throw new Error(`Conflicting replacement: ${replacement.replacesDefinitionId}`);
    replacementMap[replacement.replacesDefinitionId] = replacement.replacementDefinitionId;
    delete definitions[replacement.replacesDefinitionId];
  }
  const base = basePacks[0]!;
  if (!base.starter || !base.bonds) throw new Error('The base Content Pack must define starter cards and bonds.');
  return { packs: manifests, definitions, starter: base.starter, bonds: base.bonds, replacementMap };
}
export function createRuleset(packs: readonly ContentPack[], modules: readonly RulesModule[]): Ruleset {
  const moduleIds = new Set<string>();
  for (const module of modules) { if (moduleIds.has(module.id)) throw new Error(`Duplicate Rules Module: ${module.id}`); moduleIds.add(module.id); }
  return { registry: createContentRegistry(packs), modules };
}
export function getPartyLimit(ruleset: Ruleset, state: GameState, player: PlayerState): number { return Math.max(0, ruleset.modules.reduce((limit, module) => module.getPartyLimit(state, player, limit), Number.MAX_SAFE_INTEGER)); }
export function getEndCondition(ruleset: Ruleset, state: GameState): string | undefined {
  return ruleset.modules.flatMap((module) => module.endConditions ?? []).sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0)).find((condition) => condition.evaluate(state))?.id;
}
export function handleSupplyDepleted(ruleset: Ruleset, state: GameState, supply: SupplyKind): void { if (ruleset.modules.map((module) => module.onSupplyDepleted(state, supply)).includes('pendingOfficialRuling')) state.status = 'pendingOfficialRuling'; }
