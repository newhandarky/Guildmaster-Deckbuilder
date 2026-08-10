import type { GameState } from '@guildmaster/game-protocol';
import { rulesModuleRegistryIdentity, type ComposableRulesModule } from './rules-module-composition.js';

type CompatibilityRuleset = {
  registry: { packs: readonly { id: string; version: string; hash: string }[] };
  modules: readonly (ComposableRulesModule & { config?: Record<string, unknown> })[];
};

/** Shared full registry gate for every ruleset-dependent public API. */
export function validateRulesetStateCompatibility(
  state: GameState,
  ruleset: CompatibilityRuleset,
): string | undefined {
  const packs = ruleset.registry.packs.map(({ id, version, hash }) => ({ id, version, hash }));
  const modules = ruleset.modules.map(rulesModuleRegistryIdentity);
  if (JSON.stringify(state.contentPacks) !== JSON.stringify(packs)) return 'Content Pack registry fingerprint mismatch.';
  if (JSON.stringify(state.rulesModules) !== JSON.stringify(modules)) return 'Rules Module registry fingerprint mismatch.';
  return undefined;
}
