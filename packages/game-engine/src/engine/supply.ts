import type { DomainEvent, GameState } from '@guildmaster/game-protocol';
import { baseZoneIds, getZone } from '../model/zones.js';
import { handleSupplyDepleted, type Ruleset, type SupplyKind } from '../rules/ruleset.js';
const supplyZones: Record<SupplyKind, { deck: string; row: string; rowLimit: number }> = { adventurer: { deck: baseZoneIds.adventurerDeck, row: baseZoneIds.adventurerRow, rowLimit: 3 }, item: { deck: baseZoneIds.itemDeck, row: baseZoneIds.itemRow, rowLimit: 3 }, monster: { deck: baseZoneIds.monsterDeck, row: baseZoneIds.monsterRow, rowLimit: 3 }, boss: { deck: baseZoneIds.bossDeck, row: baseZoneIds.bossRow, rowLimit: 1 } };
export function refillSupply(state: GameState, ruleset: Ruleset, supply: SupplyKind, events: DomainEvent[]): string[] {
  const config = supplyZones[supply]; const deck = getZone(state, config.deck).cardIds; const row = getZone(state, config.row).cardIds; const revealed: string[] = [];
  while (row.length < config.rowLimit && deck.length > 0) { const cardId = deck.pop(); if (!cardId) break; row.push(cardId); revealed.push(cardId); }
  if (deck.length === 0 && revealed.length > 0) { events.push({ eventId: `event-${events.length + 1}`, revision: state.revision + 1, type: 'SUPPLY_DECK_DEPLETED', message: `${supply} 公共供應牌庫已抽空。`, moduleId: 'base:rules' }); if (supply !== 'boss') handleSupplyDepleted(ruleset, state, supply); }
  return revealed;
}
