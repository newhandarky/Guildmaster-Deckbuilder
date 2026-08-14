import { isFiniteJsonValue, type DomainEvent, type GameState, type PlayerKind, type TurnFactLedger } from '@guildmaster/game-protocol';
import { createCard } from '../model/factories.js';
import { baseZoneIds } from '../model/zones.js';
import { shuffle } from '../ports/random.js';
import { rulesModuleRegistryIdentity } from '../rules/rules-module-composition.js';
import type { Ruleset } from '../rules/ruleset.js';
import { refillConfiguredSupplyRows } from './supply.js';
import { assertGameStateInvariants, assertRulesetGameStateInvariants } from './state-invariants.js';
import { supplyContinuityPolicyFor, validateSupplyContinuityState } from '../rules/supply-continuity-evaluator.js';
export type GamePlayerConfig = { id: string; name: string; kind: PlayerKind };
export type CreateGameConfig = { gameId: string; seed: number; players: readonly GamePlayerConfig[]; startingPlayerId?: string };
export function createTurnFactLedger(playerId: string): TurnFactLedger {
  return { schemaVersion: 1, playerId, adventurersRecruited: 0, adventurersAddedToParty: 0, itemsBought: 0, equipmentBought: 0, purchasePowerSpent: 0, extraCardsDrawn: 0, itemsUsed: 0, bossesDefeated: 0, monstersDefeated: 0, marketRefreshed: false, combatResolved: false, combatSkipped: false };
}
function createEmptyState(config: CreateGameConfig, ruleset: Ruleset): GameState {
  const startingPlayerId = config.startingPlayerId ?? config.players[0]?.id;
  const playerIds = config.players.map(({ id }) => id);
  if (!config.gameId.trim() || !Number.isFinite(config.seed) || !Number.isInteger(config.seed) || config.seed === 0) throw new Error('A game needs a non-empty ID and a finite, non-zero integer seed.');
  if (!startingPlayerId || config.players.length < 2 || config.players.some(({ id, name }) => !id.trim() || !name.trim()) || new Set(playerIds).size !== playerIds.length || !playerIds.includes(startingPlayerId)) throw new Error('A game needs at least two uniquely identified players and an existing starting player.');
  const zones = Object.fromEntries(ruleset.modules.flatMap((module) => module.zoneDefinitions ?? []).map((definition) => [definition.zoneId, { ...definition, cardIds: [] }]));
  const moduleState = Object.fromEntries(ruleset.modules.map((module) => [module.id, module.createInitialState?.() ?? {}]));
  if (!isFiniteJsonValue(moduleState)) throw new Error('Rules Module initial state must contain finite, acyclic, plain JSON data only.');
  const hasSetupContributions = ruleset.modules.some((module) => (module.setupContributions?.length ?? 0) > 0);
  const usesBondSetup = ruleset.registry.bonds.length >= config.players.length * 7;
  return { schemaVersion: 2, engineVersion: '0.2.0', rulesetVersion: '0.2.0', contentPacks: ruleset.registry.packs.map(({ id, version, hash }) => ({ id, version, hash })), rulesModules: ruleset.modules.map(rulesModuleRegistryIdentity), gameId: config.gameId, seed: config.seed, rngState: config.seed, revision: 0, status: usesBondSetup ? 'setup' : 'playing', players: config.players.map((player) => ({ ...player, drawPile: [], hand: [], discardPile: [], party: [], playArea: [], bonds: usesBondSetup ? [] : ruleset.registry.bonds.map((bond) => ({ bondId: bond.id, completed: false })), counters: [], moduleState: {}, turnPurchaseBonus: 0, turnPurchaseSpent: 0, turnCombatBonus: 0, turnMarketRefreshed: false, history: { defeatedBosses: 0, defeatedMonsters: 0 } })), activePlayerId: startingPlayerId, startingPlayerId, round: 1, phase: 'action1', cards: {}, zones, ...(hasSetupContributions ? { setupSelections: {} } : {}), turnFacts: createTurnFactLedger(startingPlayerId), enemyTargets: {}, enemyEncounters: [{ encounterId: 'base:enemies', targetIds: [], kind: 'base:enemies', status: 'active', rulesModuleId: 'base:rules', state: {} }], removedCards: [], moduleState, effectState: {}, eventLogCursor: 0 };
}

function setupPrivateBonds(state: GameState, ruleset: Ruleset): void {
  if (state.status !== 'setup') return;
  const required = state.players.length * 7;
  if (ruleset.registry.bonds.length < required) throw new Error(`Bond setup requires ${required} unique bonds; found ${ruleset.registry.bonds.length}.`);
  const shuffled = shuffle(state, ruleset.registry.bonds.map(({ id }) => id));
  state.bondSetup = {
    schemaVersion: 1,
    offerId: `base:bond-setup:${state.gameId}`,
    currentActorId: state.startingPlayerId,
    offers: Object.fromEntries(state.players.map((player, index) => [player.id, shuffled.slice(index * 7, (index + 1) * 7)])),
    completedPlayerIds: [],
  };
}

function executeSetupContributions(state: GameState, ruleset: Ruleset): void {
  const contributions = ruleset.modules
    .flatMap((module) => module.setupContributions ?? [])
    .sort((left, right) => left.priority - right.priority);
  for (const contribution of contributions) {
    const destination = state.zones[contribution.destinationZoneId];
    if (!destination || destination.kind !== 'orderedDeck' || destination.rulesModuleId !== contribution.moduleId || destination.cardIds.length) {
      throw new Error(`Setup contribution ${contribution.contributionId} has an invalid or non-empty destination.`);
    }
    const count = contribution.count.zoneIds.reduce((total, zoneId) => {
      const zone = state.zones[zoneId];
      if (!zone) throw new Error(`Setup contribution ${contribution.contributionId} has unknown count zone ${zoneId}.`);
      return total + zone.cardIds.length;
    }, 0);
    const candidates = Object.values(ruleset.registry.definitions)
      .filter(({ type }) => type === contribution.selector.value)
      .flatMap((definition) => Array.from({ length: definition.copies }, () => definition.id));
    if (candidates.length < count) {
      throw new Error(`Setup contribution ${contribution.contributionId} requires ${count} cards but only ${candidates.length} candidates exist.`);
    }
    const definitionIds = shuffle(state, candidates).slice(0, count);
    destination.cardIds = definitionIds.map((definitionId) => createCard(state, definitionId).id);
    if (!state.setupSelections) throw new Error(`Setup contribution ${contribution.contributionId} has no selection registry.`);
    state.setupSelections[contribution.contributionId] = {
      schemaVersion: 1,
      contributionId: contribution.contributionId,
      moduleId: contribution.moduleId,
      destinationZoneId: contribution.destinationZoneId,
      cardIds: [...destination.cardIds],
      definitionIds: [...definitionIds],
    };
  }
}

export function createGame(config: CreateGameConfig, ruleset: Ruleset): GameState {
  if (config.players.length > 4) throw new Error('Base games support two to four players.');
  const state = createEmptyState(config, ruleset); const events: DomainEvent[] = [];
  const groups = { adventurer: [] as string[], equipment: [] as string[], item: [] as string[], monster: [] as string[] }; const cycleAnchors: string[] = []; const bossDefinitionIds: string[] = [];
  const starter = ruleset.registry.starter;
  const starterDefinitionIds = new Set('partyDefinitionIds' in starter
    ? [...starter.partyDefinitionIds, starter.summonStoneDefinitionId, starter.crystalDefinitionId]
    : [starter.adventurerDefinitionId, starter.summonStoneDefinitionId, starter.crystalDefinitionId]);
  const setupDefinitionTypes = new Set(ruleset.modules.flatMap((module) => module.setupContributions ?? []).map(({ selector }) => selector.value));
  const monsterContinuity = supplyContinuityPolicyFor(ruleset, 'monster');
  if (monsterContinuity.status !== 'ready' || monsterContinuity.policy.mode !== 'require-full-cycle') throw new Error(monsterContinuity.status === 'failed' ? monsterContinuity.error : 'Base monster supply requires a full-cycle continuity policy.');
  for (const definition of Object.values(ruleset.registry.definitions)) { if (starterDefinitionIds.has(definition.id) || definition.type === 'starter' || definition.type === 'bond' || setupDefinitionTypes.has(definition.type)) continue; for (let copy = 0; copy < definition.copies; copy += 1) { if (definition.type === 'boss') { bossDefinitionIds.push(definition.id); continue; } const card = createCard(state, definition.id); if (definition.type === 'adventurer') groups.adventurer.push(card.id); if (definition.type === 'equipment') groups.equipment.push(card.id); if (definition.type === 'item') groups.item.push(card.id); if (definition.type === 'monster') { if (definition.tags?.includes(monsterContinuity.policy.cycleAnchorTag)) cycleAnchors.push(card.id); else groups.monster.push(card.id); } } }
  const hasExplicitBossSetupPolicy = ruleset.modules.some((module) => module.getBossSetupCount);
  const defaultBossCount = config.players.length === 4 ? config.players.length + 2 : bossDefinitionIds.length;
  const bossCount = ruleset.modules.reduce((count, module) => module.getBossSetupCount?.(config.players.length, count) ?? count, defaultBossCount);
  if (!Number.isInteger(bossCount) || bossCount < 0 || (hasExplicitBossSetupPolicy && bossCount < 1)) throw new Error(`Rules Modules produced an invalid boss setup count: ${bossCount}.`);
  if (bossDefinitionIds.length < bossCount) throw new Error(`A ${config.players.length}-player base game requires ${bossCount} boss definitions; found ${bossDefinitionIds.length}.`);
  state.zones[baseZoneIds.adventurerDeck]!.cardIds = shuffle(state, groups.adventurer); state.zones[baseZoneIds.itemDeck]!.cardIds = shuffle(state, [...groups.equipment, ...groups.item]); state.zones[baseZoneIds.monsterDeck]!.cardIds = [...cycleAnchors, ...shuffle(state, groups.monster)]; state.zones[baseZoneIds.bossDeck]!.cardIds = shuffle(state, bossDefinitionIds).slice(0, bossCount).map((definitionId) => createCard(state, definitionId).id);
  executeSetupContributions(state, ruleset);
  setupPrivateBonds(state, ruleset);
  let partyDefinitionIds: readonly string[];
  if ('partyDefinitionIds' in starter) partyDefinitionIds = starter.partyDefinitionIds;
  else partyDefinitionIds = Array.from({ length: 5 }, () => starter.adventurerDefinitionId);
  for (const player of state.players) { for (const definitionId of shuffle(state, [...partyDefinitionIds])) player.party.push({ adventurerId: createCard(state, definitionId, player.id).id }); for (let count = 0; count < 4; count += 1) player.hand.push(createCard(state, ruleset.registry.starter.summonStoneDefinitionId, player.id).id); player.hand.push(createCard(state, ruleset.registry.starter.crystalDefinitionId, player.id).id); }
  refillConfiguredSupplyRows(state, ruleset, events); attachTargets(state); assertGameStateInvariants(state); assertRulesetGameStateInvariants(state, ruleset);
  const continuityErrors = validateSupplyContinuityState(state, ruleset); if (continuityErrors.length) throw new Error(continuityErrors.join(' '));
  return state;
}
export function attachTargets(state: GameState): void {
  const encounter = state.enemyEncounters.find(({ encounterId }) => encounterId === 'base:enemies'); if (!encounter) throw new Error('Missing base enemy encounter.');
  const rows: [string, string, string][] = [...state.zones[baseZoneIds.monsterRow]!.cardIds.map((id) => [id, 'monster', baseZoneIds.monsterRow] as [string, string, string]), ...state.zones[baseZoneIds.bossRow]!.cardIds.map((id) => [id, 'boss', baseZoneIds.bossRow] as [string, string, string])];
  for (const [cardInstanceId, kind, zoneId] of rows) if (!Object.values(state.enemyTargets).some((target) => target.cardInstanceId === cardInstanceId && target.status !== 'defeated' && target.status !== 'removed')) { let sequence = Object.keys(state.enemyTargets).length + 1; while (state.enemyTargets[`base:target-${sequence}`]) sequence += 1; const targetId = `base:target-${sequence}`; state.enemyTargets[targetId] = { targetId, cardInstanceId, kind, status: 'available', parentEncounterId: encounter.encounterId, zoneId, attachments: [], moduleState: {} }; encounter.targetIds.push(targetId); }
}
