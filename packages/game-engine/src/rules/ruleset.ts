import type { ContentPack, ContentRegistry, GameState, PlayerState } from '@guildmaster/game-protocol';

export type SupplyKind = 'adventurer' | 'item' | 'monster' | 'boss';
export type RulesModule = {
  id: string;
  version: string;
  getPartyLimit: (state: GameState, player: PlayerState, currentLimit: number) => number;
  getEndCondition: (state: GameState) => string | undefined;
  onSupplyDepleted: (state: GameState, supply: SupplyKind) => 'pendingOfficialRuling' | 'handled';
};

export type Ruleset = { registry: ContentRegistry; modules: readonly RulesModule[] };

export function createContentRegistry(packs: readonly ContentPack[]): ContentRegistry {
  const definitions: Record<string, ContentRegistry['definitions'][string]> = {};
  for (const pack of packs) {
    for (const definition of pack.definitions) {
      if (definitions[definition.id]) throw new Error(`Duplicate card definition: ${definition.id}`);
      definitions[definition.id] = definition;
    }
  }
  const base = packs[0];
  if (!base) throw new Error('At least one Content Pack is required.');
  return { packs: packs.map((pack) => pack.manifest), definitions, starter: base.starter, bonds: base.bonds };
}

export function createRuleset(packs: readonly ContentPack[], modules: readonly RulesModule[]): Ruleset {
  return { registry: createContentRegistry(packs), modules };
}

export function getPartyLimit(ruleset: Ruleset, state: GameState, player: PlayerState): number {
  return Math.max(0, ruleset.modules.reduce((limit, module) => module.getPartyLimit(state, player, limit), Number.MAX_SAFE_INTEGER));
}

export function getEndCondition(ruleset: Ruleset, state: GameState): string | undefined {
  return ruleset.modules.map((module) => module.getEndCondition(state)).find(Boolean);
}

export function handleSupplyDepleted(ruleset: Ruleset, state: GameState, supply: SupplyKind): void {
  const results = ruleset.modules.map((module) => module.onSupplyDepleted(state, supply));
  if (results.includes('pendingOfficialRuling')) state.status = 'pendingOfficialRuling';
}
