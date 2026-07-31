import { baseZoneIds } from '../model/zones.js';
import { getDefinition } from '../model/factories.js';
import type { RulesModule } from './ruleset.js';

export const baseRulesModule: RulesModule = {
  id: 'base:rules', version: '0.3.0', createInitialState: () => ({}),
  zoneDefinitions: [
    { zoneId: baseZoneIds.adventurerDeck, kind: 'orderedDeck', visibility: 'public', rulesModuleId: 'base:rules' }, { zoneId: baseZoneIds.adventurerRow, kind: 'faceUpRow', visibility: 'public', rulesModuleId: 'base:rules' },
    { zoneId: baseZoneIds.itemDeck, kind: 'orderedDeck', visibility: 'public', rulesModuleId: 'base:rules' }, { zoneId: baseZoneIds.itemRow, kind: 'faceUpRow', visibility: 'public', rulesModuleId: 'base:rules' },
    { zoneId: baseZoneIds.monsterDeck, kind: 'orderedDeck', visibility: 'public', rulesModuleId: 'base:rules' }, { zoneId: baseZoneIds.monsterRow, kind: 'faceUpRow', visibility: 'public', rulesModuleId: 'base:rules' },
    { zoneId: baseZoneIds.bossDeck, kind: 'orderedDeck', visibility: 'public', rulesModuleId: 'base:rules' }, { zoneId: baseZoneIds.bossRow, kind: 'singleSlot', visibility: 'public', rulesModuleId: 'base:rules' }
  ],
  getPartyLimit: (_state, _player, currentLimit) => Math.min(currentLimit, 5),
  teamOverflowPolicies: [{ schemaVersion: 1, policyId: 'base:discard-oldest', moduleId: 'base:rules', priority: 1, teamScope: 'player-party', mode: 'discard-oldest', reasonCode: 'TEAM_CAPACITY_OVERFLOW' }],
  supplyRowConfigurations: [
    { schemaVersion: 1, configurationId: 'base:adventurer-row', moduleId: 'base:rules', priority: 1, supply: 'adventurer', sourceDeckZoneId: baseZoneIds.adventurerDeck, targetRowZoneId: baseZoneIds.adventurerRow, targetSize: 3, mode: 'refill-to-target' },
    { schemaVersion: 1, configurationId: 'base:item-row', moduleId: 'base:rules', priority: 1, supply: 'item', sourceDeckZoneId: baseZoneIds.itemDeck, targetRowZoneId: baseZoneIds.itemRow, targetSize: 3, mode: 'refill-to-target' },
    { schemaVersion: 1, configurationId: 'base:monster-row', moduleId: 'base:rules', priority: 1, supply: 'monster', sourceDeckZoneId: baseZoneIds.monsterDeck, targetRowZoneId: baseZoneIds.monsterRow, targetSize: 3, mode: 'refill-to-target' },
    { schemaVersion: 1, configurationId: 'base:boss-row', moduleId: 'base:rules', priority: 1, supply: 'boss', sourceDeckZoneId: baseZoneIds.bossDeck, targetRowZoneId: baseZoneIds.bossRow, targetSize: 1, mode: 'refill-to-target' }
  ],
  supplyContinuityPolicies: [
    { schemaVersion: 1, policyId: 'base:adventurer-partial', moduleId: 'base:rules', priority: 1, supply: 'adventurer', supplyRowConfigurationId: 'base:adventurer-row', mode: 'allow-partial', depletionEvent: 'emit-on-empty' },
    { schemaVersion: 1, policyId: 'base:item-partial', moduleId: 'base:rules', priority: 1, supply: 'item', supplyRowConfigurationId: 'base:item-row', mode: 'allow-partial', depletionEvent: 'emit-on-empty' },
    { schemaVersion: 1, policyId: 'base:monster-cycle', moduleId: 'base:rules', priority: 1, supply: 'monster', supplyRowConfigurationId: 'base:monster-row', mode: 'require-full-cycle', targetSize: 3, cycleAnchorTag: 'base:supply-cycle-anchor', cycleDestination: 'source-deck-bottom', depletionEvent: 'never' }
  ],
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
  onSupplyDepleted: () => 'handled'
};
