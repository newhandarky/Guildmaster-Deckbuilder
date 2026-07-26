import type { RulesModule } from './ruleset.js';

export const baseRulesModule: RulesModule = {
  id: 'base:rules',
  version: '0.1.0',
  getPartyLimit: (state, player, currentLimit) => {
    void state;
    void player;
    return Math.min(currentLimit, 5);
  },
  getEndCondition: (state) => {
    const bossTargets = Object.values(state.enemyTargets).filter((target) => target.kind === 'boss');
    const allBossesDefeated = state.sharedZones.bossDeck.length === 0 && state.sharedZones.bossRow.length === 0 && bossTargets.length > 0 && bossTargets.every((target) => target.status === 'defeated');
    if (allBossesDefeated) return 'base:all-bosses-defeated';
    if (state.players.some((player) => player.bonds.every((bond) => bond.completed))) return 'base:all-bonds-completed';
    return undefined;
  },
  onSupplyDepleted: () => 'pendingOfficialRuling'
};
