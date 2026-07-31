import type { DomainEvent, GameState } from '@guildmaster/game-protocol';
import { getZone } from '../model/zones.js';
import { handleSupplyDepleted, type Ruleset, type SupplyKind } from '../rules/ruleset.js';
import { evaluateSupplyRowRefill } from '../rules/supply-row-evaluator.js';
import { supplyContinuityPolicyForConfiguration } from '../rules/supply-continuity-evaluator.js';
import type { SupplyRowConfiguration } from '@guildmaster/game-protocol';
export function refillSupplyConfiguration(state: GameState, ruleset: Ruleset, config: SupplyRowConfiguration, events: DomainEvent[]): string[] {
  const evaluation = evaluateSupplyRowRefill(state, ruleset, config.sourceDeckZoneId, config.targetRowZoneId); if (evaluation.status !== 'ready') throw new Error(evaluation.error);
  const continuity = supplyContinuityPolicyForConfiguration(ruleset, config.configurationId);
  if (continuity?.status === 'failed') throw new Error(continuity.error);
  const deck = getZone(state, config.sourceDeckZoneId).cardIds; const row = getZone(state, config.targetRowZoneId).cardIds; const revealed: string[] = [];
  for (let count = 0; count < evaluation.evaluation.actualDrawCount; count += 1) { const cardId = deck.pop(); if (!cardId) break; row.push(cardId); revealed.push(cardId); }
  if (continuity?.status === 'ready' && continuity.policy.mode === 'require-full-cycle') {
    if (row.length !== continuity.policy.targetSize) throw new Error(`SUPPLY_CONTINUITY_VIOLATION: monster row must refill to ${continuity.policy.targetSize}.`);
    return revealed;
  }
  if (continuity?.status === 'ready' && continuity.policy.mode === 'allow-partial' && continuity.policy.depletionEvent === 'emit-on-empty' && deck.length === 0 && revealed.length > 0) {
    events.push({ eventId: `event-${events.length + 1}`, revision: state.revision + 1, type: 'SUPPLY_DECK_DEPLETED', message: `${config.supply} 公共供應牌庫已抽空。`, moduleId: config.moduleId });
    handleSupplyDepleted(ruleset, state, config.supply);
  }
  return revealed;
}
export function refillSupply(state: GameState, ruleset: Ruleset, supply: SupplyKind, events: DomainEvent[]): string[] {
  const configs = ruleset.modules.flatMap((module) => module.supplyRowConfigurations ?? []).filter((entry) => entry.supply === supply); if (configs.length !== 1) throw new Error(configs.length ? `Ambiguous supply configuration: ${supply}` : `Missing supply configuration: ${supply}`);
  return refillSupplyConfiguration(state, ruleset, configs[0]!, events);
}
/** Refill every registered row in deterministic module/configuration order. */
export function refillConfiguredSupplyRows(state: GameState, ruleset: Ruleset, events: DomainEvent[]): void {
  for (const config of ruleset.modules.flatMap((module) => module.supplyRowConfigurations ?? [])) refillSupplyConfiguration(state, ruleset, config, events);
}
