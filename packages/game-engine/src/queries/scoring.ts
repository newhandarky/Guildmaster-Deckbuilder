import type { GameState } from '@guildmaster/game-protocol';
import { getDefinition } from '../model/factories.js';
import type { Ruleset } from '../rules/ruleset.js';

export type ScoreRow = { playerId: string; name: string; honor: number; defeatedBosses: number; defeatedMonsters: number; rank: number };

export function getScoreboard(state: GameState, ruleset: Ruleset): ScoreRow[] {
  const rows = state.players.map((player) => {
    const cardIds = [...player.drawPile, ...player.hand, ...player.discardPile, ...player.playArea, ...player.party.flatMap((slot) => [slot.adventurerId, ...(slot.equipmentId ? [slot.equipmentId] : [])])];
    const cardHonor = cardIds.reduce((sum, cardId) => sum + (getDefinition(ruleset.registry, state, cardId).honor ?? 0), 0);
    const bondHonor = player.bonds.filter((bond) => bond.completed).reduce((sum, bond) => sum + (ruleset.registry.bonds.find((definition) => definition.id === bond.bondId)?.honor ?? 0), 0);
    return { playerId: player.id, name: player.name, honor: cardHonor + bondHonor, defeatedBosses: player.history.defeatedBosses, defeatedMonsters: player.history.defeatedMonsters, rank: 0 };
  });
  rows.sort((left, right) => right.honor - left.honor || right.defeatedBosses - left.defeatedBosses || right.defeatedMonsters - left.defeatedMonsters || left.name.localeCompare(right.name));
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}
