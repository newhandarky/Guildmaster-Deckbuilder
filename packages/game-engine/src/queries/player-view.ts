import type { GameState, PlayerView } from '@guildmaster/game-protocol';
import { getPlayer } from '../model/factories.js';
import { getPartyLimit, type Ruleset } from '../rules/ruleset.js';

export function projectPlayerView(state: GameState, ruleset: Ruleset, viewerId: string): PlayerView {
  const player = getPlayer(state, viewerId);
  const { drawPile, ...visibleSelf } = structuredClone(player);
  const visibleIds = new Set([...visibleSelf.hand, ...visibleSelf.discardPile, ...visibleSelf.playArea, ...visibleSelf.party.flatMap((slot) => [slot.adventurerId, ...(slot.equipmentId ? [slot.equipmentId] : [])]), ...state.sharedZones.adventurerRow, ...state.sharedZones.itemRow, ...state.sharedZones.monsterRow, ...state.sharedZones.bossRow]);
  const cards = Object.fromEntries(Object.entries(state.cards).filter(([id]) => visibleIds.has(id)));
  return {
    viewerId, gameId: state.gameId, status: state.status, phase: state.phase, round: state.round, revision: state.revision, activePlayerId: state.activePlayerId,
    self: { ...visibleSelf, drawPileCount: drawPile.length }, partyLimit: getPartyLimit(ruleset, state, player),
    opponents: state.players.filter((player) => player.id !== viewerId).map((player) => ({ id: player.id, name: player.name, handCount: player.hand.length, partyCount: player.party.length, discardCount: player.discardPile.length, defeatedBosses: player.history.defeatedBosses })),
    sharedZones: structuredClone(state.sharedZones), enemyTargets: structuredClone(state.enemyTargets), cards, ...(state.endState ? { endState: structuredClone(state.endState) } : {})
  };
}
