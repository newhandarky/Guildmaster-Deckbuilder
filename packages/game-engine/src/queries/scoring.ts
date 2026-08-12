import type { GameState } from '@guildmaster/game-protocol';
import { validateRulesetStateCompatibility, type Ruleset } from '../rules/ruleset.js';

export type ScoreRow = { playerId: string; name: string; honor: number; defeatedBosses: number; defeatedMonsters: number; rank: number };

export function getScoreboard(state: GameState, ruleset: Ruleset): ScoreRow[] {
  const compatibility = validateRulesetStateCompatibility(state, ruleset);
  if (compatibility) throw new Error(compatibility);
  const contributions = ruleset.modules.flatMap((module) => module.getScoreContributions?.(state, ruleset.registry) ?? []);
  const rows = state.players.map((player) => ({ playerId: player.id, name: player.name, honor: contributions.filter((contribution) => contribution.playerId === player.id).reduce((sum, contribution) => sum + contribution.amount, 0), defeatedBosses: player.history.defeatedBosses, defeatedMonsters: player.history.defeatedMonsters, rank: 0 }));
  rows.sort((left, right) => right.honor - left.honor || right.defeatedBosses - left.defeatedBosses || right.defeatedMonsters - left.defeatedMonsters || left.name.localeCompare(right.name));
  let rank = 0;
  return rows.map((row, index) => {
    const previous = rows[index - 1];
    if (!previous || previous.honor !== row.honor || previous.defeatedBosses !== row.defeatedBosses || previous.defeatedMonsters !== row.defeatedMonsters) rank = index + 1;
    return { ...row, rank };
  });
}
