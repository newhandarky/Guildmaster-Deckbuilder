import type { DomainEvent, GameState, PlayerKind } from '@guildmaster/game-protocol';
import { createCard } from '../model/factories.js';
import { baseZoneIds } from '../model/zones.js';
import { shuffle } from '../ports/random.js';
import type { Ruleset } from '../rules/ruleset.js';
import { refillSupply } from './supply.js';
export type GamePlayerConfig = { id: string; name: string; kind: PlayerKind };
export type CreateGameConfig = { gameId: string; seed: number; players: readonly GamePlayerConfig[]; startingPlayerId?: string };
function createEmptyState(config: CreateGameConfig, ruleset: Ruleset): GameState {
  const startingPlayerId = config.startingPlayerId ?? config.players[0]?.id;
  if (!startingPlayerId || config.players.length < 2) throw new Error('A game needs at least two players and a starting player.');
  const zones = Object.fromEntries(ruleset.modules.flatMap((module) => module.zoneDefinitions ?? []).map((definition) => [definition.zoneId, { ...definition, cardIds: [] }]));
  return { schemaVersion: 2, engineVersion: '0.2.0', rulesetVersion: '0.2.0', contentPacks: ruleset.registry.packs.map(({ id, version, hash }) => ({ id, version, hash })), rulesModules: ruleset.modules.map((module) => ({ id: module.id, version: module.version, ...(module.config ? { config: module.config } : {}) })), gameId: config.gameId, seed: config.seed, rngState: config.seed, revision: 0, status: 'playing', players: config.players.map((player) => ({ ...player, drawPile: [], hand: [], discardPile: [], party: [], playArea: [], bonds: ruleset.registry.bonds.map((bond) => ({ bondId: bond.id, completed: false })), counters: [], moduleState: {}, turnPurchaseBonus: 0, turnPurchaseSpent: 0, turnCombatBonus: 0, history: { defeatedBosses: 0, defeatedMonsters: 0 } })), activePlayerId: startingPlayerId, startingPlayerId, round: 1, phase: 'action1', cards: {}, zones, enemyTargets: {}, enemyEncounters: [{ encounterId: 'base:enemies', targetIds: [], kind: 'base:enemies', status: 'active', rulesModuleId: 'base:rules', state: {} }], removedCards: [], moduleState: Object.fromEntries(ruleset.modules.map((module) => [module.id, module.createInitialState?.() ?? {}])), eventLogCursor: 0 };
}
export function createGame(config: CreateGameConfig, ruleset: Ruleset): GameState {
  const state = createEmptyState(config, ruleset); const events: DomainEvent[] = [];
  const groups = { adventurer: [] as string[], equipment: [] as string[], item: [] as string[], monster: [] as string[], boss: [] as string[] };
  for (const definition of Object.values(ruleset.registry.definitions)) { if (definition.type === 'starter' || definition.type === 'bond') continue; for (let copy = 0; copy < definition.copies; copy += 1) { const card = createCard(state, definition.id); if (definition.type === 'adventurer') groups.adventurer.push(card.id); if (definition.type === 'equipment') groups.equipment.push(card.id); if (definition.type === 'item') groups.item.push(card.id); if (definition.type === 'monster') groups.monster.push(card.id); if (definition.type === 'boss') groups.boss.push(card.id); } }
  state.zones[baseZoneIds.adventurerDeck]!.cardIds = shuffle(state, groups.adventurer); state.zones[baseZoneIds.itemDeck]!.cardIds = shuffle(state, [...groups.equipment, ...groups.item]); state.zones[baseZoneIds.monsterDeck]!.cardIds = shuffle(state, groups.monster); state.zones[baseZoneIds.bossDeck]!.cardIds = shuffle(state, groups.boss).slice(0, config.players.length + 2);
  for (const player of state.players) { for (let count = 0; count < 5; count += 1) player.party.push({ adventurerId: createCard(state, ruleset.registry.starter.adventurerDefinitionId, player.id).id }); for (let count = 0; count < 4; count += 1) player.hand.push(createCard(state, ruleset.registry.starter.summonStoneDefinitionId, player.id).id); player.hand.push(createCard(state, ruleset.registry.starter.crystalDefinitionId, player.id).id); }
  refillSupply(state, ruleset, 'adventurer', events); refillSupply(state, ruleset, 'item', events); refillSupply(state, ruleset, 'monster', events); refillSupply(state, ruleset, 'boss', events); attachTargets(state); return state;
}
export function attachTargets(state: GameState): void {
  const encounter = state.enemyEncounters[0]!;
  const rows: [string, string, string][] = [...state.zones[baseZoneIds.monsterRow]!.cardIds.map((id) => [id, 'monster', baseZoneIds.monsterRow] as [string, string, string]), ...state.zones[baseZoneIds.bossRow]!.cardIds.map((id) => [id, 'boss', baseZoneIds.bossRow] as [string, string, string])];
  for (const [cardInstanceId, kind, zoneId] of rows) if (!Object.values(state.enemyTargets).some((target) => target.cardInstanceId === cardInstanceId)) { const targetId = `target-${Object.keys(state.enemyTargets).length + 1}`; state.enemyTargets[targetId] = { targetId, cardInstanceId, kind, status: 'available', parentEncounterId: encounter.encounterId, zoneId, attachments: [], moduleState: {} }; encounter.targetIds.push(targetId); }
}
