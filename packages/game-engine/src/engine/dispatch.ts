import type { CommandEnvelope, DomainEvent, EngineError, EngineResult, GameCommand, GameState, Phase, PlayerState } from '@guildmaster/game-protocol';
import { getDefinition, getPlayer } from '../model/factories.js';
import { getCombatPrefix, getPurchasePower } from '../queries/legal-commands.js';
import { getEndCondition, getPartyLimit, type Ruleset } from '../rules/ruleset.js';
import { drawCards } from './draw.js';
import { attachTargets } from './create-game.js';
import { refillSupply } from './supply.js';
import { baseZoneIds, getZone } from '../model/zones.js';
import { resumeEffectChoice } from '../effects/executor.js';

function event(state: GameState, events: DomainEvent[], type: string, message: string, commandId?: string): void {
  events.push({ eventId: `event-${state.revision + 1}-${events.length + 1}`, revision: state.revision + 1, type, message, ...(commandId ? { causedByCommandId: commandId } : {}) });
}

function fail(state: GameState, code: EngineError['code'], message: string): EngineResult {
  return { state, events: [], error: { code, message } };
}

function removeFrom<T>(items: T[], item: T): boolean {
  const index = items.indexOf(item);
  if (index < 0) return false;
  items.splice(index, 1);
  return true;
}

function requirePhase(state: GameState, phases: readonly Phase[]): EngineError | undefined {
  return phases.includes(state.phase) ? undefined : { code: 'INVALID_COMMAND', message: `目前是 ${state.phase}，無法執行此操作。` };
}

function resolveItem(player: PlayerState, effect: string | undefined): void {
  if (effect === 'purchase+2') player.turnPurchaseBonus += 2;
  if (effect === 'combat+2') player.turnCombatBonus += 2;
}

function maybeCompleteBonds(state: GameState, player: PlayerState, ruleset: Ruleset, events: DomainEvent[], commandId: string): void {
  for (const bond of player.bonds) {
    const definition = ruleset.registry.bonds.find((candidate) => candidate.id === bond.bondId);
    if (!bond.completed && definition && player.history.defeatedBosses >= definition.requiredBosses) {
      bond.completed = true;
      event(state, events, 'BOND_COMPLETED', `${player.name} 完成羈絆：${definition.name}。`, commandId);
    }
  }
}

function checkEnd(state: GameState, ruleset: Ruleset, events: DomainEvent[], commandId: string): void {
  if (state.status !== 'playing') return;
  const conditionId = getEndCondition(ruleset, state);
  if (!conditionId) return;
  const startingIndex = state.players.findIndex((player) => player.id === state.startingPlayerId);
  const finalRoundEndPlayerId = state.players[(startingIndex + 1) % state.players.length]!.id;
  state.status = 'finalRound';
  state.endState = { conditionId, finalRoundEndPlayerId, triggeredAtRevision: state.revision + 1 };
  event(state, events, 'FINAL_ROUND_TRIGGERED', '已觸發遊戲結束，將完成目前輪次。', commandId);
}

function playAdventurer(state: GameState, ruleset: Ruleset, player: PlayerState, command: Extract<GameCommand, { type: 'PLAY_ADVENTURER' }>, events: DomainEvent[], commandId: string): EngineError | undefined {
  const phaseError = requirePhase(state, ['action1', 'action2']);
  if (phaseError) return phaseError;
  if (!removeFrom(player.hand, command.cardId)) return { code: 'INVALID_COMMAND', message: '該卡不在手牌中。' };
  const definition = getDefinition(ruleset.registry, state, command.cardId);
  if (definition.type !== 'adventurer') return { code: 'INVALID_COMMAND', message: '只有冒險者可加入隊伍。' };
  const limit = getPartyLimit(ruleset, state, player);
  if (player.party.length >= limit) {
    const displaced = player.party.shift();
    if (displaced) {
      player.discardPile.push(displaced.adventurerId);
      if (displaced.equipmentId) player.discardPile.push(displaced.equipmentId);
      event(state, events, 'PARTY_MEMBER_DISCARDED', `${player.name} 的隊伍已滿，最左側冒險者離隊。`, commandId);
    }
  }
  player.party.push({ adventurerId: command.cardId });
  event(state, events, 'ADVENTURER_ENTERED_PARTY', `${player.name} 加入了一名冒險者。`, commandId);
  return undefined;
}

function equipItem(state: GameState, ruleset: Ruleset, player: PlayerState, command: Extract<GameCommand, { type: 'EQUIP_ITEM' }>, events: DomainEvent[], commandId: string): EngineError | undefined {
  const phaseError = requirePhase(state, ['action1', 'action2']);
  if (phaseError) return phaseError;
  if (!removeFrom(player.hand, command.cardId)) return { code: 'INVALID_COMMAND', message: '該物資不在手牌中。' };
  if (getDefinition(ruleset.registry, state, command.cardId).type !== 'equipment') return { code: 'INVALID_COMMAND', message: '只有裝備可配戴。' };
  const slot = player.party.find((candidate) => candidate.adventurerId === command.adventurerId);
  if (!slot) return { code: 'INVALID_COMMAND', message: '找不到指定的隊伍冒險者。' };
  if (slot.equipmentId) player.discardPile.push(slot.equipmentId);
  slot.equipmentId = command.cardId;
  event(state, events, 'EQUIPMENT_ATTACHED', `${player.name} 配戴了一件裝備。`, commandId);
  return undefined;
}

function applyItem(state: GameState, ruleset: Ruleset, player: PlayerState, command: Extract<GameCommand, { type: 'USE_ITEM' }>, events: DomainEvent[], commandId: string): EngineError | undefined {
  const phaseError = requirePhase(state, ['action1', 'action2']);
  if (phaseError) return phaseError;
  if (!removeFrom(player.hand, command.cardId)) return { code: 'INVALID_COMMAND', message: '該物資不在手牌中。' };
  const definition = getDefinition(ruleset.registry, state, command.cardId);
  if (definition.type !== 'item') return { code: 'INVALID_COMMAND', message: '只有道具可使用。' };
  player.playArea.push(command.cardId);
  resolveItem(player, definition.itemEffect);
  event(state, events, 'ITEM_USED', `${player.name} 使用了道具；休息階段才會棄置。`, commandId);
  return undefined;
}

function attackTarget(state: GameState, ruleset: Ruleset, player: PlayerState, command: Extract<GameCommand, { type: 'ATTACK_TARGET' }>, events: DomainEvent[], commandId: string): EngineError | undefined {
  const phaseError = requirePhase(state, ['combat']);
  if (phaseError) return phaseError;
  const target = state.enemyTargets[command.targetId];
  if (!target || target.status !== 'available') return { code: 'INVALID_COMMAND', message: '該敵方目標不可討伐。' };
  const definition = getDefinition(ruleset.registry, state, target.cardInstanceId);
  const prefix = getCombatPrefix(state, ruleset, player.id, definition.combat ?? Number.POSITIVE_INFINITY);
  if (!prefix) return { code: 'INVALID_COMMAND', message: '隊伍戰力不足以討伐該目標。' };
  const participants = player.party.splice(0, prefix.slotCount);
  for (const slot of participants) {
    player.discardPile.push(slot.adventurerId);
    if (slot.equipmentId) player.discardPile.push(slot.equipmentId);
  }
  target.status = 'defeated';
  if (target.zoneId) removeFrom(getZone(state, target.zoneId).cardIds, target.cardInstanceId);
  player.discardPile.push(target.cardInstanceId);
  if (target.kind === 'boss') player.history.defeatedBosses += 1;
  else player.history.defeatedMonsters += 1;
  maybeCompleteBonds(state, player, ruleset, events, commandId);
  event(state, events, 'ENEMY_DEFEATED', `${player.name} 討伐了 ${definition.name}（投入 ${prefix.slotCount} 位冒險者）。`, commandId);
  checkEnd(state, ruleset, events, commandId);
  return undefined;
}

function buyCard(state: GameState, ruleset: Ruleset, player: PlayerState, command: Extract<GameCommand, { type: 'BUY_CARD' }>, events: DomainEvent[], commandId: string): EngineError | undefined {
  const phaseError = requirePhase(state, ['purchase']);
  if (phaseError) return phaseError;
  const isAdventurer = getZone(state, baseZoneIds.adventurerRow).cardIds.includes(command.cardId);
  const isItem = getZone(state, baseZoneIds.itemRow).cardIds.includes(command.cardId);
  if (!isAdventurer && !isItem) return { code: 'INVALID_COMMAND', message: '只能購買招募區或商店的公開卡。' };
  const definition = getDefinition(ruleset.registry, state, command.cardId);
  const cost = definition.cost ?? Number.POSITIVE_INFINITY;
  if (getPurchasePower(state, ruleset, player.id) < cost) return { code: 'INVALID_COMMAND', message: '購買力不足。' };
  removeFrom(getZone(state, isAdventurer ? baseZoneIds.adventurerRow : baseZoneIds.itemRow).cardIds, command.cardId);
  player.turnPurchaseSpent += cost;
  player.discardPile.push(command.cardId);
  event(state, events, 'CARD_ACQUIRED', `${player.name} 取得了 ${definition.name}。`, commandId);
  return undefined;
}

function finishRest(state: GameState, ruleset: Ruleset, player: PlayerState, events: DomainEvent[], commandId: string): void {
  player.discardPile.push(...player.hand, ...player.playArea);
  player.hand = [];
  player.playArea = [];
  player.turnPurchaseBonus = 0;
  player.turnPurchaseSpent = 0;
  player.turnCombatBonus = 0;
  refillSupply(state, ruleset, 'adventurer', events);
  refillSupply(state, ruleset, 'item', events);
  refillSupply(state, ruleset, 'monster', events);
  refillSupply(state, ruleset, 'boss', events);
  attachTargets(state);
  drawCards(state, player.id, 5, events);
  event(state, events, 'REST_FINISHED', `${player.name} 完成休息。`, commandId);
  if (state.status === 'finalRound' && state.endState?.finalRoundEndPlayerId === player.id) {
    state.status = 'finished';
    event(state, events, 'GAME_FINISHED', '目前輪次已完成，遊戲結束。', commandId);
    return;
  }
  const currentIndex = state.players.findIndex((candidate) => candidate.id === player.id);
  const next = state.players[(currentIndex + 1) % state.players.length]!;
  state.activePlayerId = next.id;
  state.phase = 'action1';
  if (next.id === state.startingPlayerId) state.round += 1;
}

function endPhase(state: GameState, ruleset: Ruleset, player: PlayerState, command: Extract<GameCommand, { type: 'END_PHASE' }>, events: DomainEvent[], commandId: string): EngineError | undefined {
  if (command.phase !== state.phase) return { code: 'INVALID_COMMAND', message: '指令階段與目前階段不一致。' };
  const next: Record<Exclude<Phase, 'rest'>, Phase> = { action1: 'combat', combat: 'action2', action2: 'purchase', purchase: 'rest' };
  if (state.phase === 'rest') finishRest(state, ruleset, player, events, commandId);
  else {
    state.phase = next[state.phase];
    event(state, events, 'PHASE_ENDED', `${player.name} 結束階段。`, commandId);
  }
  return undefined;
}

function resolveEffectChoice(state: GameState, ruleset: Ruleset, player: PlayerState, command: Extract<GameCommand, { type: 'RESOLVE_EFFECT_CHOICE' }>, events: DomainEvent[]): EngineError | undefined {
  const result = resumeEffectChoice(state, ruleset, player.id, command.executionId, command.choiceId, command.optionId);
  events.push(...result.events);
  return result.status === 'failed' ? { code: 'INVALID_COMMAND', message: result.error ?? '無法恢復效果選擇。' } : undefined;
}

export function dispatch(state: GameState, ruleset: Ruleset, envelope: CommandEnvelope): EngineResult {
  if (state.status === 'finished') return fail(state, 'GAME_FINISHED', '遊戲已結束。');
  if (state.status === 'pendingOfficialRuling') return fail(state, 'RULE_CLARIFICATION_REQUIRED', '公共供應牌庫耗盡的官方結果尚待確認。');
  if (envelope.gameId !== state.gameId || envelope.expectedRevision !== state.revision) return fail(state, 'STALE_REVISION', '指令使用了過期的對局版本。');
  if (envelope.actorId !== state.activePlayerId) return fail(state, 'NOT_AUTHORIZED', '目前不是此玩家的回合。');
  if (state.effectState.pendingChoice && envelope.command.type !== 'RESOLVE_EFFECT_CHOICE') return fail(state, 'INVALID_COMMAND', '必須先完成待處理的效果選擇。');
  const nextState = structuredClone(state);
  const player = getPlayer(nextState, envelope.actorId);
  const events: DomainEvent[] = [];
  let error: EngineError | undefined;
  switch (envelope.command.type) {
    case 'PLAY_ADVENTURER': error = playAdventurer(nextState, ruleset, player, envelope.command, events, envelope.commandId); break;
    case 'EQUIP_ITEM': error = equipItem(nextState, ruleset, player, envelope.command, events, envelope.commandId); break;
    case 'USE_ITEM': error = applyItem(nextState, ruleset, player, envelope.command, events, envelope.commandId); break;
    case 'ATTACK_TARGET': error = attackTarget(nextState, ruleset, player, envelope.command, events, envelope.commandId); break;
    case 'BUY_CARD': error = buyCard(nextState, ruleset, player, envelope.command, events, envelope.commandId); break;
    case 'RESOLVE_EFFECT_CHOICE': error = resolveEffectChoice(nextState, ruleset, player, envelope.command, events); break;
    case 'END_PHASE': error = endPhase(nextState, ruleset, player, envelope.command, events, envelope.commandId); break;
  }
  if (error) return { state, events: [], error };
  nextState.revision += 1;
  nextState.eventLogCursor += events.length;
  return { state: nextState, events };
}
