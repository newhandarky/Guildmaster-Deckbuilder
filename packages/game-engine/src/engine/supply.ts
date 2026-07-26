import type { DomainEvent, GameState, SharedZones } from '@guildmaster/game-protocol';
import type { Ruleset, SupplyKind } from '../rules/ruleset.js';
import { handleSupplyDepleted } from '../rules/ruleset.js';

const supplyKeys: Record<SupplyKind, { deck: keyof SharedZones; row: keyof SharedZones }> = {
  adventurer: { deck: 'adventurerDeck', row: 'adventurerRow' },
  item: { deck: 'itemDeck', row: 'itemRow' },
  monster: { deck: 'monsterDeck', row: 'monsterRow' },
  boss: { deck: 'bossDeck', row: 'bossRow' }
};

export function refillSupply(state: GameState, ruleset: Ruleset, supply: SupplyKind, events: DomainEvent[]): string[] {
  const keys = supplyKeys[supply];
  const deck = state.sharedZones[keys.deck] as string[];
  const row = state.sharedZones[keys.row] as string[];
  const revealed: string[] = [];
  const rowLimit = supply === 'boss' ? 1 : 3;
  while (row.length < rowLimit && deck.length > 0) {
    const cardId = deck.pop();
    if (!cardId) break;
    row.push(cardId);
    revealed.push(cardId);
  }
  if (deck.length === 0 && revealed.length > 0) {
    events.push({ eventId: `event-${events.length + 1}`, revision: state.revision + 1, type: 'SUPPLY_DECK_DEPLETED', message: `${supply} 公共供應牌庫已抽空。`, moduleId: 'base:rules' });
    if (supply !== 'boss') handleSupplyDepleted(ruleset, state, supply);
  }
  return revealed;
}
