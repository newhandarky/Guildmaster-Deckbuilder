import type { DomainEvent, GameState } from '@guildmaster/game-protocol';
import { getZone } from '../model/zones.js';
import { handleSupplyDepleted, type Ruleset, type SupplyKind } from '../rules/ruleset.js';
import { evaluateSupplyRowRefill } from '../rules/supply-row-evaluator.js';
export function refillSupply(state: GameState, ruleset: Ruleset, supply: SupplyKind, events: DomainEvent[]): string[] {
  const config = ruleset.modules.flatMap((module) => module.supplyRowConfigurations ?? []).find((entry) => entry.supply === supply); if (!config) throw new Error(`Missing supply configuration: ${supply}`);
  const evaluation = evaluateSupplyRowRefill(state, ruleset, config.sourceDeckZoneId, config.targetRowZoneId); if (evaluation.status !== 'ready') throw new Error(evaluation.error);
  const deck = getZone(state, config.sourceDeckZoneId).cardIds; const row = getZone(state, config.targetRowZoneId).cardIds; const revealed: string[] = [];
  for (let count = 0; count < evaluation.evaluation.actualDrawCount; count += 1) { const cardId = deck.pop(); if (!cardId) break; row.push(cardId); revealed.push(cardId); }
  if (deck.length === 0 && revealed.length > 0) { events.push({ eventId: `event-${events.length + 1}`, revision: state.revision + 1, type: 'SUPPLY_DECK_DEPLETED', message: `${supply} 公共供應牌庫已抽空。`, moduleId: 'base:rules' }); if (supply !== 'boss') handleSupplyDepleted(ruleset, state, supply); }
  return revealed;
}
/** Refill every registered row in deterministic module/configuration order. */
export function refillConfiguredSupplyRows(state: GameState, ruleset: Ruleset, events: DomainEvent[]): void {
  for (const config of ruleset.modules.flatMap((module) => module.supplyRowConfigurations ?? [])) refillSupply(state, ruleset, config.supply, events);
}
