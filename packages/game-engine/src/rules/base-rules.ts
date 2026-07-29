import { baseZoneIds } from '../model/zones.js';
import { getDefinition } from '../model/factories.js';
import type { RulesModule } from './ruleset.js';

export const baseRulesModule: RulesModule = {
  id: 'base:rules', version: '0.2.0', createInitialState: () => ({}),
  zoneDefinitions: [
    { zoneId: baseZoneIds.adventurerDeck, kind: 'orderedDeck', visibility: 'public', rulesModuleId: 'base:rules' }, { zoneId: baseZoneIds.adventurerRow, kind: 'faceUpRow', visibility: 'public', rulesModuleId: 'base:rules' },
    { zoneId: baseZoneIds.itemDeck, kind: 'orderedDeck', visibility: 'public', rulesModuleId: 'base:rules' }, { zoneId: baseZoneIds.itemRow, kind: 'faceUpRow', visibility: 'public', rulesModuleId: 'base:rules' },
    { zoneId: baseZoneIds.monsterDeck, kind: 'orderedDeck', visibility: 'public', rulesModuleId: 'base:rules' }, { zoneId: baseZoneIds.monsterRow, kind: 'faceUpRow', visibility: 'public', rulesModuleId: 'base:rules' },
    { zoneId: baseZoneIds.bossDeck, kind: 'orderedDeck', visibility: 'public', rulesModuleId: 'base:rules' }, { zoneId: baseZoneIds.bossRow, kind: 'singleSlot', visibility: 'public', rulesModuleId: 'base:rules' }
  ],
  getPartyLimit: (_state, _player, currentLimit) => Math.min(currentLimit, 5),
  teamOverflowPolicies: [{ schemaVersion: 1, policyId: 'base:discard-oldest', moduleId: 'base:rules', priority: 1, teamScope: 'player-party', mode: 'discard-oldest', reasonCode: 'TEAM_CAPACITY_OVERFLOW' }],
  endConditions: [
    { id: 'base:all-bosses-defeated', evaluate: (state) => state.zones[baseZoneIds.bossDeck]!.cardIds.length === 0 && state.zones[baseZoneIds.bossRow]!.cardIds.length === 0 && Object.values(state.enemyTargets).filter((target) => target.kind === 'boss').some((target) => target.status === 'defeated') && Object.values(state.enemyTargets).filter((target) => target.kind === 'boss').every((target) => target.status === 'defeated') },
    { id: 'base:all-bonds-completed', evaluate: (state) => state.players.some((player) => player.bonds.every((bond) => bond.completed)) }
  ],
  getScoreContributions: (state, registry) => state.players.flatMap((player) => {
    const cardIds = [...player.drawPile, ...player.hand, ...player.discardPile, ...player.playArea, ...player.party.flatMap((slot) => [slot.adventurerId, ...(slot.equipmentId ? [slot.equipmentId] : [])])];
    const cardHonor = cardIds.reduce((sum, cardId) => sum + (getDefinition(registry, state, cardId).honor ?? 0), 0);
    const bondHonor = player.bonds.filter((bond) => bond.completed).reduce((sum, bond) => sum + (registry.bonds.find((definition) => definition.id === bond.bondId)?.honor ?? 0), 0);
    return [{ playerId: player.id, ruleId: 'base:card-honor', amount: cardHonor, label: '公會卡牌' }, { playerId: player.id, ruleId: 'base:bond-honor', amount: bondHonor, label: '已完成羈絆' }];
  }),
  onSupplyDepleted: () => 'pendingOfficialRuling'
};
