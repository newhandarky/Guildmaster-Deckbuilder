import type { CommandEnvelope, DomainEvent, EngineError, EngineResult, GameCommand, GameState, Phase, PlayerState } from '@guildmaster/game-protocol';
import { getDefinition, getPlayer } from '../model/factories.js';
import { getCombatPrefix, getPurchasePower } from '../queries/legal-commands.js';
import { getEndCondition, type Ruleset } from '../rules/ruleset.js';
import { drawCards } from './draw.js';
import { attachTargets } from './create-game.js';
import { refillSupply } from './supply.js';
import { baseZoneIds, getZone } from '../model/zones.js';
import { resumeEffectChoice } from '../effects/executor.js';
import { dispatchLifecycle, resumeLifecycleChoice } from '../effects/lifecycle-dispatcher.js';
import { beginPostCommandPipeline, resumePostCommandPipeline } from './post-command-pipeline.js';
import { evaluateCombat } from '../rules/combat-evaluator.js';
import { evaluateEquipmentEligibility } from '../rules/equipment-eligibility-evaluator.js';
import { evaluateTeamOverflow } from '../rules/team-overflow-evaluator.js';

function event(state: GameState, events: DomainEvent[], type: string, message: string, commandId?: string, payload?: DomainEvent['payload']): void {
  events.push({ eventId: `event-${state.revision + 1}-${events.length + 1}`, revision: state.revision + 1, type, message, ...(commandId ? { causedByCommandId: commandId } : {}), ...(payload ? { payload } : {}) });
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
function combinations(ids: readonly string[], count: number, start = 0, prefix: string[] = []): string[][] { if (prefix.length === count) return [prefix]; return ids.slice(start).flatMap((id, offset) => combinations(ids, count, start + offset + 1, [...prefix, id])); }

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

function playAdventurer(state: GameState, ruleset: Ruleset, player: PlayerState, command: Extract<GameCommand, { type: 'PLAY_ADVENTURER' }>, events: DomainEvent[], commandId: string, fixedCandidates?: readonly string[]): EngineError | undefined {
  const phaseError = requirePhase(state, ['action1', 'action2']);
  if (phaseError) return phaseError;
  if (!removeFrom(player.hand, command.cardId)) return { code: 'INVALID_COMMAND', message: '該卡不在手牌中。' };
  const definition = getDefinition(ruleset.registry, state, command.cardId);
  if (definition.type !== 'adventurer') return { code: 'INVALID_COMMAND', message: '只有冒險者可加入隊伍。' };
  const overflow = fixedCandidates ? undefined : evaluateTeamOverflow(state, ruleset, { schemaVersion: 1, playerId: player.id, incomingMemberId: command.cardId });
  if (overflow && overflow.status !== 'ready') return { code: 'INVALID_COMMAND', message: overflow.error };
  if (fixedCandidates || overflow?.evaluation.status === 'overflow-required') {
    const candidates = fixedCandidates ?? overflow?.evaluation.candidateIds ?? [];
    const expectedCount = fixedCandidates ? fixedCandidates.length : overflow!.evaluation.overflowCount;
    if (!expectedCount || candidates.length !== expectedCount || new Set(candidates).size !== candidates.length) return { code: 'INVALID_COMMAND', message: 'Team overflow candidates are invalid.' };
    const displaced = candidates.map((id) => player.party.find((slot) => slot.adventurerId === id));
    if (displaced.some((slot) => !slot)) return { code: 'INVALID_COMMAND', message: 'Team overflow candidate is not in the party.' };
    for (const slot of displaced) {
      const index = player.party.indexOf(slot!); player.party.splice(index, 1);
      player.discardPile.push(slot!.adventurerId);
      if (slot!.equipmentId) player.discardPile.push(slot!.equipmentId);
      event(state, events, 'PARTY_MEMBER_DISCARDED', `${player.name} 的隊伍容量 policy 移出成員。`, commandId, { schemaVersion: 1, kind: 'team-overflow', policy: fixedCandidates ? undefined : overflow!.evaluation.policy, candidateIds: [...candidates] } as DomainEvent['payload']);
    }
  }
  player.party.push({ adventurerId: command.cardId });
  event(state, events, 'ADVENTURER_ENTERED_PARTY', `${player.name} 加入了一名冒險者。`, commandId);
  return undefined;
}

function equipItem(state: GameState, ruleset: Ruleset, player: PlayerState, command: Extract<GameCommand, { type: 'EQUIP_ITEM' }>, events: DomainEvent[], commandId: string): EngineError | undefined {
  const phaseError = requirePhase(state, ['action1', 'action2']);
  if (phaseError) return phaseError;
  const eligibility = evaluateEquipmentEligibility(state, ruleset, { schemaVersion: 1, playerId: player.id, equipmentCardId: command.cardId, adventurerId: command.adventurerId });
  if (eligibility.status !== 'ready') return { code: 'INVALID_COMMAND', message: eligibility.error };
  if (!eligibility.evaluation.eligible) return { code: 'INVALID_COMMAND', message: `該裝備不符合資格限制：${eligibility.evaluation.rejectionReasonCodes.join(', ')}。` };
  if (!removeFrom(player.hand, command.cardId)) return { code: 'INVALID_COMMAND', message: '該物資不在手牌中。' };
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
  const combat = evaluateCombat(state, ruleset, player.id, command.targetId);
  if (combat.status !== 'ready') return { code: 'INVALID_COMMAND', message: combat.error };
  if (!combat.evaluation.eligible) return { code: 'INVALID_COMMAND', message: `該敵方目標受到討伐限制：${combat.evaluation.restrictionReasonCodes.join(', ')}。` };
  const definition = getDefinition(ruleset.registry, state, target.cardInstanceId);
  const prefix = getCombatPrefix(state, ruleset, player.id, combat.evaluation.requiredCombat);
  if (!prefix) return { code: 'INVALID_COMMAND', message: '隊伍戰力不足以討伐該目標。' };
  const participants = player.party.splice(0, prefix.slotCount);
  for (const slot of participants) {
    player.discardPile.push(slot.adventurerId);
    if (slot.equipmentId) player.discardPile.push(slot.equipmentId);
  }
  event(state, events, 'COMBAT_EVALUATED', `討伐需求為 ${combat.evaluation.requiredCombat}；套用規則：${combat.evaluation.appliedRules.map(({ moduleId, ruleId }) => `${moduleId}/${ruleId}`).join(', ') || 'none'}。`, commandId, { schemaVersion: 1, kind: 'combat-evaluation', evaluation: structuredClone(combat.evaluation) });
  if (target.zoneId) removeFrom(getZone(state, target.zoneId).cardIds, target.cardInstanceId);
  if (combat.evaluation.outcome.kind === 'remove-target') {
    target.status = 'removed';
    state.removedCards.push(target.cardInstanceId);
    event(state, events, 'ENEMY_REMOVED', `${definition.name} 的討伐結果被替代為移出遊戲。`, commandId);
    return undefined;
  }
  target.status = 'defeated';
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

function reduceCommand(state: GameState, ruleset: Ruleset, envelope: CommandEnvelope, events: DomainEvent[]): EngineError | undefined {
  const player = getPlayer(state, envelope.actorId);
  switch (envelope.command.type) {
    case 'PLAY_ADVENTURER': return playAdventurer(state, ruleset, player, envelope.command, events, envelope.commandId);
    case 'EQUIP_ITEM': return equipItem(state, ruleset, player, envelope.command, events, envelope.commandId);
    case 'USE_ITEM': return applyItem(state, ruleset, player, envelope.command, events, envelope.commandId);
    case 'ATTACK_TARGET': return attackTarget(state, ruleset, player, envelope.command, events, envelope.commandId);
    case 'BUY_CARD': return buyCard(state, ruleset, player, envelope.command, events, envelope.commandId);
    case 'END_PHASE': return endPhase(state, ruleset, player, envelope.command, events, envelope.commandId);
    case 'RESOLVE_EFFECT_CHOICE': return { code: 'INVALID_COMMAND', message: 'A choice command cannot be used as an original command continuation.' };
  }
}

function resolveEffectChoice(state: GameState, ruleset: Ruleset, player: PlayerState, command: Extract<GameCommand, { type: 'RESOLVE_EFFECT_CHOICE' }>, events: DomainEvent[]): EngineError | undefined {
  const result = state.effectState.pendingLifecycle
    ? resumeLifecycleChoice(state, ruleset, player.id, command.executionId, command.choiceId, command.optionId)
    : resumeEffectChoice(state, ruleset, player.id, command.executionId, command.choiceId, command.optionId);
  events.push(...result.events);
  const resultError = 'error' in result && typeof result.error === 'string' ? result.error : undefined;
  const resultReason = 'reason' in result && typeof result.reason === 'string' ? result.reason : undefined;
  const message = resultError ?? resultReason ?? '無法恢復效果選擇。';
  return result.status === 'failed' || result.status === 'unsupported' ? { code: 'INVALID_COMMAND', message } : undefined;
}

export function dispatch(state: GameState, ruleset: Ruleset, envelope: CommandEnvelope): EngineResult {
  if (state.status === 'finished') return fail(state, 'GAME_FINISHED', '遊戲已結束。');
  if (state.status === 'pendingOfficialRuling') return fail(state, 'RULE_CLARIFICATION_REQUIRED', '公共供應牌庫耗盡的官方結果尚待確認。');
  if (envelope.gameId !== state.gameId || envelope.expectedRevision !== state.revision) return fail(state, 'STALE_REVISION', '指令使用了過期的對局版本。');
  if (envelope.actorId !== (state.effectState.pendingChoice?.actorId ?? state.activePlayerId)) return fail(state, 'NOT_AUTHORIZED', '目前不是此玩家的回合。');
  if ((state.effectState.pendingChoice || state.effectState.pendingLifecycle || state.effectState.pendingCommand || state.effectState.pendingPostCommand) && envelope.command.type !== 'RESOLVE_EFFECT_CHOICE') return fail(state, 'INVALID_COMMAND', '必須先完成待處理的效果選擇。');
  const nextState = structuredClone(state);
  if (envelope.command.type === 'RESOLVE_EFFECT_CHOICE' && nextState.effectState.pendingPostCommand) {
    const rollback = structuredClone(nextState.effectState.pendingPostCommand.rollbackState);
    const result = resumePostCommandPipeline(nextState, ruleset, envelope.actorId, envelope.command.executionId, envelope.command.choiceId, envelope.command.optionId);
    if (result.status === 'failed' || result.status === 'unsupported') return result.rollback === 'command' ? { state: rollback, events: [], error: { code: 'INVALID_COMMAND', message: result.error ?? '無法恢復 post-command lifecycle。' } } : fail(state, 'INVALID_COMMAND', result.error ?? '無法恢復 post-command lifecycle。');
    if (result.status === 'suspended') return { state: nextState, events: result.events };
    nextState.revision += 1;
    nextState.eventLogCursor += result.events.length;
    return { state: nextState, events: result.events };
  }
  if (envelope.command.type === 'RESOLVE_EFFECT_CHOICE' && nextState.effectState.pendingCommand) {
    const resolution = envelope.command;
    const continuation = structuredClone(nextState.effectState.pendingCommand); const pending = nextState.effectState.pendingLifecycle; const rollback = pending?.rollbackState;
    if (continuation.kind === 'team-overflow') {
      const choice = nextState.effectState.pendingChoice; const selected = continuation.optionCandidates[resolution.optionId];
      if (!choice || !selected || choice.actorId !== envelope.actorId || choice.executionId !== resolution.executionId || choice.choiceId !== resolution.choiceId || continuation.envelope.gameId !== state.gameId || continuation.envelope.expectedRevision !== state.revision || continuation.envelope.actorId !== envelope.actorId || selected.length !== continuation.requiredSelectionCount || new Set(selected).size !== selected.length) return fail(state, 'INVALID_COMMAND', 'No matching pending team overflow choice.');
      const player = getPlayer(nextState, envelope.actorId); if (selected.some((id) => !player.party.some((slot) => slot.adventurerId === id))) return { state: structuredClone(continuation.rollbackState), events: [], error: { code: 'INVALID_COMMAND', message: 'Team overflow candidate is no longer in the party.' } };
      delete nextState.effectState.pendingChoice; delete nextState.effectState.pendingCommand;
      const events = [...continuation.events]; const factStart = events.length;
      const error = playAdventurer(nextState, ruleset, player, continuation.envelope.command as Extract<GameCommand, { type: 'PLAY_ADVENTURER' }>, events, continuation.envelope.commandId, selected);
      if (error) return { state: structuredClone(continuation.rollbackState), events: [], error };
      const pipeline = beginPostCommandPipeline(nextState, ruleset, continuation.envelope, structuredClone(continuation.rollbackState), events.slice(factStart), events);
      if (pipeline.status === 'failed' || pipeline.status === 'unsupported') return { state: structuredClone(continuation.rollbackState), events: [], error: { code: 'INVALID_COMMAND', message: pipeline.error ?? 'Post-command lifecycle failed.' } };
      if (pipeline.status === 'suspended') return { state: nextState, events: pipeline.events };
      nextState.revision += 1; nextState.eventLogCursor += pipeline.events.length; return { state: nextState, events: pipeline.events };
    }
    if (!pending || continuation.envelope.actorId !== envelope.actorId || continuation.envelope.gameId !== state.gameId || continuation.envelope.expectedRevision !== state.revision) return fail(state, 'INVALID_COMMAND', '待處理 command continuation 不相容。');
    const choice = nextState.effectState.pendingChoice;
    if (!choice || choice.actorId !== envelope.actorId || choice.executionId !== resolution.executionId || choice.choiceId !== resolution.choiceId || !choice.options.some((option) => option.id === resolution.optionId)) return fail(state, 'INVALID_COMMAND', 'No matching pending command-before effect choice.');
    const resumed = resumeLifecycleChoice(nextState, ruleset, envelope.actorId, envelope.command.executionId, envelope.command.choiceId, envelope.command.optionId);
    if (resumed.status === 'failed' || resumed.status === 'unsupported') return { state: rollback ? structuredClone(rollback) : state, events: [], error: { code: 'INVALID_COMMAND', message: resumed.error ?? resumed.reason ?? '無法恢復 command-before lifecycle。' } };
    const events = [...continuation.events, ...resumed.events];
    if (resumed.status === 'suspended') { nextState.effectState.pendingCommand!.events = structuredClone(events); return { state: nextState, events }; }
    delete nextState.effectState.pendingCommand;
    const factStart = events.length;
    const error = reduceCommand(nextState, ruleset, continuation.envelope, events);
    if (error) return { state: rollback ? structuredClone(rollback) : state, events: [], error };
    const pipeline = beginPostCommandPipeline(nextState, ruleset, continuation.envelope, rollback ? structuredClone(rollback) : structuredClone(state), events.slice(factStart), events);
    if (pipeline.status === 'failed' || pipeline.status === 'unsupported') return { state: rollback ? structuredClone(rollback) : state, events: [], error: { code: 'INVALID_COMMAND', message: pipeline.error ?? 'Post-command lifecycle failed.' } };
    if (pipeline.status === 'suspended') return { state: nextState, events: pipeline.events };
    nextState.revision += 1; nextState.eventLogCursor += pipeline.events.length; return { state: nextState, events: pipeline.events };
  }
  const events: DomainEvent[] = [];
  if (envelope.command.type === 'RESOLVE_EFFECT_CHOICE') {
    const error = resolveEffectChoice(nextState, ruleset, getPlayer(nextState, envelope.actorId), envelope.command, events);
    if (error) return { state, events: [], error };
    nextState.revision += 1; nextState.eventLogCursor += events.length; return { state: nextState, events };
  }
  const rollback = structuredClone(state);
  const before = dispatchLifecycle(nextState, ruleset, { schemaVersion: 1, point: 'command-before', actorId: envelope.actorId, commandType: envelope.command.type, phase: nextState.phase, metadata: { commandId: envelope.commandId } }, { controllerId: envelope.actorId });
  events.push(...before.events);
  if (before.status === 'suspended') { nextState.effectState.pendingCommand = { schemaVersion: 1, envelope: structuredClone(envelope), events: structuredClone(events) }; return { state: nextState, events }; }
  if (before.status === 'failed' || before.status === 'unsupported') return { state, events: [], error: { code: 'INVALID_COMMAND', message: before.error ?? before.reason ?? 'command-before lifecycle failed.' } };
  if (envelope.command.type === 'PLAY_ADVENTURER') {
    const overflow = evaluateTeamOverflow(nextState, ruleset, { schemaVersion: 1, playerId: envelope.actorId, incomingMemberId: envelope.command.cardId });
    if (overflow.status !== 'ready') return { state, events: [], error: { code: 'INVALID_COMMAND', message: overflow.error } };
    if (overflow.evaluation.status === 'overflow-required' && overflow.evaluation.policy?.mode === 'player-choice') {
      const candidateIds = overflow.evaluation.candidateIds; const count = overflow.evaluation.overflowCount; const sets = combinations(candidateIds, count); if (!sets.length) return { state, events: [], error: { code: 'INVALID_COMMAND', message: 'Team overflow has insufficient candidates.' } };
      const optionCandidates = Object.fromEntries(sets.map((set, index) => [`overflow-${index + 1}`, set])); const choiceId = `team-overflow:${overflow.evaluation.policy.policyId}`; const executionId = `team-overflow:${envelope.commandId}`;
      nextState.effectState.pendingChoice = { schemaVersion: 1, executionId, choiceId, actorId: envelope.actorId, options: Object.keys(optionCandidates).map((id) => ({ id, effect: { kind: 'modify-value', target: { kind: 'turn-combat-bonus', player: { kind: 'controller' } }, amount: 0 } })), remaining: [], context: { controllerId: envelope.actorId } };
      nextState.effectState.pendingCommand = { schemaVersion: 1, kind: 'team-overflow', envelope: structuredClone(envelope), events: structuredClone(events), rollbackState: structuredClone(rollback), policy: { moduleId: overflow.evaluation.policy.moduleId, policyId: overflow.evaluation.policy.policyId }, candidateIds: structuredClone(candidateIds), requiredSelectionCount: count, optionCandidates: structuredClone(optionCandidates), registry: structuredClone(overflow.evaluation.registry) };
      return { state: nextState, events };
    }
  }
  const factStart = events.length;
  const error = reduceCommand(nextState, ruleset, envelope, events);
  if (error) return { state, events: [], error };
  const pipeline = beginPostCommandPipeline(nextState, ruleset, envelope, rollback, events.slice(factStart), events);
  if (pipeline.status === 'failed' || pipeline.status === 'unsupported') return { state: rollback, events: [], error: { code: 'INVALID_COMMAND', message: pipeline.error ?? 'Post-command lifecycle failed.' } };
  if (pipeline.status === 'suspended') return { state: nextState, events: pipeline.events };
  nextState.revision += 1;
  nextState.eventLogCursor += pipeline.events.length;
  return { state: nextState, events: pipeline.events };
}
