import type { CommandEnvelope, GameCommand, GameState } from '@guildmaster/game-protocol';
import { getDefinition, getPlayer } from '../model/factories.js';
import type { Ruleset } from '../rules/ruleset.js';

export function getPurchasePower(state: GameState, ruleset: Ruleset, playerId: string): number {
  const player = getPlayer(state, playerId);
  const handPower = player.hand.reduce((sum, cardId) => sum + (getDefinition(ruleset.registry, state, cardId).purchasePower ?? 0), 0);
  return handPower + player.turnPurchaseBonus - player.turnPurchaseSpent;
}

export function getCombatPrefix(state: GameState, ruleset: Ruleset, playerId: string, required: number): { slotCount: number; power: number } | undefined {
  const player = getPlayer(state, playerId);
  let power = player.turnCombatBonus;
  for (let index = 0; index < player.party.length; index += 1) {
    const slot = player.party[index]!;
    power += getDefinition(ruleset.registry, state, slot.adventurerId).combat ?? 0;
    if (slot.equipmentId) power += getDefinition(ruleset.registry, state, slot.equipmentId).combat ?? 0;
    if (power >= required) return { slotCount: index + 1, power };
  }
  return undefined;
}

export function getLegalCommands(state: GameState, ruleset: Ruleset, actorId: string): GameCommand[] {
  if (state.status !== 'playing' && state.status !== 'finalRound') return [];
  if (state.activePlayerId !== actorId) return [];
  const player = getPlayer(state, actorId);
  const commands: GameCommand[] = [];
  if (state.phase === 'action1' || state.phase === 'action2') {
    for (const cardId of player.hand) {
      const definition = getDefinition(ruleset.registry, state, cardId);
      if (definition.type === 'adventurer') commands.push({ type: 'PLAY_ADVENTURER', cardId });
      if (definition.type === 'item') commands.push({ type: 'USE_ITEM', cardId });
      if (definition.type === 'equipment') for (const slot of player.party) commands.push({ type: 'EQUIP_ITEM', cardId, adventurerId: slot.adventurerId });
    }
  }
  if (state.phase === 'combat') {
    for (const target of Object.values(state.enemyTargets)) {
      if (target.status !== 'available') continue;
      const required = getDefinition(ruleset.registry, state, target.cardInstanceId).combat ?? Number.POSITIVE_INFINITY;
      if (getCombatPrefix(state, ruleset, actorId, required)) commands.push({ type: 'ATTACK_TARGET', targetId: target.targetId });
    }
  }
  if (state.phase === 'purchase') {
    const power = getPurchasePower(state, ruleset, actorId);
    for (const cardId of [...state.sharedZones.adventurerRow, ...state.sharedZones.itemRow]) {
      if ((getDefinition(ruleset.registry, state, cardId).cost ?? Number.POSITIVE_INFINITY) <= power) commands.push({ type: 'BUY_CARD', cardId });
    }
  }
  commands.push({ type: 'END_PHASE', phase: state.phase });
  return commands;
}

export function envelope(state: GameState, actorId: string, command: GameCommand, commandId = `legal-${state.revision + 1}`): CommandEnvelope {
  return { protocolVersion: 1, gameId: state.gameId, commandId, actorId, expectedRevision: state.revision, command };
}
