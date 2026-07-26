import type { GameState, ZoneId, ZoneState } from '@guildmaster/game-protocol';

export const baseZoneIds = {
  adventurerDeck: 'base:adventurer-deck', adventurerRow: 'base:adventurer-row',
  itemDeck: 'base:item-deck', itemRow: 'base:item-row', monsterDeck: 'base:monster-deck',
  monsterRow: 'base:monster-row', bossDeck: 'base:boss-deck', bossRow: 'base:boss-row'
} as const;

export type ZoneDefinition = Pick<ZoneState, 'zoneId' | 'kind' | 'visibility'> & { rulesModuleId: string };
export function getZone(state: GameState, zoneId: ZoneId): ZoneState {
  const zone = state.zones[zoneId];
  if (!zone) throw new Error(`Unknown zone: ${zoneId}`);
  return zone;
}
