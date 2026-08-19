import { CommandEnvelopeSchema, type CommandEnvelope, type DomainEvent, type EngineError, type EngineResult, type GameCommand, type GameState, type PendingCommandContinuation, type Phase, type PlayerState } from '@guildmaster/game-protocol';
import { getDefinition, getPlayer, isPartyMemberCard } from '../model/factories.js';
import { getPurchasePower } from '../queries/legal-commands.js';
import { validateRulesetStateCompatibility, type Ruleset } from '../rules/ruleset.js';
import { baseZoneIds, getZone } from '../model/zones.js';
import { resumeEffectChoice, resumeEffectCounterConsent } from '../effects/executor.js';
import { dispatchLifecycle, resumeLifecycleChoice, resumeLifecycleCounterConsent } from '../effects/lifecycle-dispatcher.js';
import { beginPostCommandPipeline, resumePostCommandPipeline, resumePostCommandCounterConsent } from './post-command-pipeline.js';
import { evaluateEquipmentEligibility } from '../rules/equipment-eligibility-evaluator.js';
import { evaluateTeamOverflow } from '../rules/team-overflow-evaluator.js';
import { resumeCombatRewardPipeline, resumeCombatRewardCounterConsent } from './combat-reward-pipeline.js';
import { validateGameStateInvariants, validateRulesetGameStateInvariants } from './state-invariants.js';
import { evaluateCounterConsent } from '../rules/counter-consent-evaluator.js';
import { validateSupplyContinuityState } from '../rules/supply-continuity-evaluator.js';
import { beginCardUseEffectPipeline, resumeCardUseEffectChoice, resumeCardUseEffectCounterConsent } from './card-use-effect-pipeline.js';
import { createTurnFactLedger } from './create-game.js';
import { dispatchBondSetup } from './bond-setup.js';
import { applyMarketRefresh } from './market-refresh.js';
import { applyPhaseTransition } from './phase-transition.js';
import { applyBondCompletion, checkEndConditions } from './bond-completion.js';
import { evaluatePurchaseCost } from '../rules/purchase-cost-evaluator.js';
import { pushDiscard } from '../rules/discard-redirect-evaluator.js';
import { attachedCardIds, setAttachedCardIds } from '../model/attachments.js';
import { evaluateAttachment } from '../rules/attachment-evaluator.js';
import { attackTarget, finishAttackAfterRewards } from './combat-command.js';

function event(state: GameState, events: DomainEvent[], type: string, message: string, commandId?: string, payload?: DomainEvent['payload']): void { events.push({ eventId: `event-${state.revision + 1}-${events.length + 1}`, revision: state.revision + 1, type, message, ...(commandId ? { causedByCommandId: commandId } : {}), ...(payload ? { payload } : {}) }); }
function fail(state: GameState, code: EngineError['code'], message: string): EngineResult { return { state, events: [], error: { code, message } }; }
function removeFrom<T>(items: T[], item: T): boolean { const index = items.indexOf(item); if (index < 0) return false; items.splice(index, 1); return true; }
function facts(state: GameState, playerId: string) { if (!state.turnFacts || state.turnFacts.playerId !== playerId) state.turnFacts = createTurnFactLedger(playerId); return state.turnFacts; }
const pendingCommandFor = (state: GameState) => state.effectState.pendingCommand;
type CounterConsentCommand = Extract<GameCommand, { type: 'RESPOND_COUNTER_CONSENT' | 'CANCEL_COUNTER_CONSENT' | 'EXPIRE_COUNTER_CONSENT' }>;
const isCounterConsentCommand = (command: GameCommand): command is CounterConsentCommand => command.type === 'RESPOND_COUNTER_CONSENT' || command.type === 'CANCEL_COUNTER_CONSENT' || command.type === 'EXPIRE_COUNTER_CONSENT';
const counterConsentAction = (command: CounterConsentCommand): 'accept' | 'decline' | 'cancel' | 'expire' => command.type === 'RESPOND_COUNTER_CONSENT' ? command.response : command.type === 'CANCEL_COUNTER_CONSENT' ? 'cancel' : 'expire';
const transactionEvents = (events: readonly DomainEvent[], commandId: string): DomainEvent[] => events.map((entry, index) => ({ ...entry, eventId: `transaction:${commandId}:${index + 1}`, causedByCommandId: commandId }));
function combinations(ids: readonly string[], count: number, limit = 257): string[][] { const results: string[][] = []; const visit = (start: number, prefix: string[]): void => { if (results.length >= limit) return; if (prefix.length === count) { results.push(prefix); return; } for (let index = start; index < ids.length && results.length < limit; index += 1) visit(index + 1, [...prefix, ids[index]!]); }; visit(0, []); return results; }

function requirePhase(state: GameState, phases: readonly Phase[]): EngineError | undefined { return phases.includes(state.phase) ? undefined : { code: 'INVALID_COMMAND', message: `目前是 ${state.phase}，無法執行此操作。` }; }
function resolveItem(player: PlayerState, effect: string | undefined): void { if (effect === 'purchase+2') player.turnPurchaseBonus += 2; if (effect === 'combat+2') player.turnCombatBonus += 2; }


function playAdventurer(state: GameState, ruleset: Ruleset, player: PlayerState, command: Extract<GameCommand, { type: 'PLAY_ADVENTURER' }>, events: DomainEvent[], commandId: string, fixedCandidates?: readonly string[]): EngineError | undefined {
  const phaseError = requirePhase(state, ['action1', 'action2']);
  if (phaseError) return phaseError;
  if (!removeFrom(player.hand, command.cardId)) return { code: 'INVALID_COMMAND', message: '該卡不在手牌中。' };
  if (!isPartyMemberCard(ruleset.registry, state, command.cardId)) return { code: 'INVALID_COMMAND', message: '只有冒險者可加入隊伍。' };
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
      player.discardPile.push(...attachedCardIds(slot!));
      const policy = fixedCandidates ? undefined : { moduleId: overflow!.evaluation.policy!.moduleId, policyId: overflow!.evaluation.policy!.policyId };
      event(state, events, 'PARTY_MEMBER_DISCARDED', `${player.name} 的隊伍容量 policy 移出成員。`, commandId, { schemaVersion: 1, kind: 'team-overflow', ...(policy ? { policy } : {}), candidateIds: [...candidates] });
    }
  }
  player.party.push({ adventurerId: command.cardId });
  facts(state, player.id).adventurersAddedToParty += 1;
  event(state, events, 'ADVENTURER_ENTERED_PARTY', `${player.name} 加入了一名冒險者。`, commandId);
  return undefined;
}

function equipItem(state: GameState, ruleset: Ruleset, player: PlayerState, command: Extract<GameCommand, { type: 'EQUIP_ITEM' }>, events: DomainEvent[], commandId: string): EngineError | undefined {
  const phaseError = requirePhase(state, ['action1', 'action2']);
  if (phaseError) return phaseError;
  const eligibility = evaluateEquipmentEligibility(state, ruleset, { schemaVersion: 1, playerId: player.id, equipmentCardId: command.cardId, adventurerId: command.adventurerId });
  if (eligibility.status !== 'ready') return { code: 'INVALID_COMMAND', message: eligibility.error };
  if (!eligibility.evaluation.eligible) return { code: 'INVALID_COMMAND', message: `該裝備不符合資格限制：${eligibility.evaluation.rejectionReasonCodes.join(', ')}。` };
  const slot = player.party.find((candidate) => candidate.adventurerId === command.adventurerId);
  if (!slot) return { code: 'INVALID_COMMAND', message: '找不到指定的隊伍冒險者。' };
  const attachment = evaluateAttachment(state, ruleset, { schemaVersion: 1, playerId: player.id, cardId: command.cardId, adventurerId: command.adventurerId });
  if (attachment.status !== 'ready' || !attachment.evaluation.eligible) return { code: 'INVALID_COMMAND', message: attachment.status === 'ready' ? `該卡不可附著：${attachment.evaluation.reasonCode}。` : attachment.error };
  const current = attachedCardIds(slot);
  if (attachment.evaluation.capacity > 1 && attachment.evaluation.requiresReplacement) return { code: 'INVALID_COMMAND', message: '附件欄已滿，請明確選擇要替換的附件。' };
  if (!removeFrom(player.hand, command.cardId)) return { code: 'INVALID_COMMAND', message: '該物資不在手牌中。' };
  if (attachment.evaluation.capacity === 1 && current[0]) player.discardPile.push(current[0]);
  setAttachedCardIds(slot, attachment.evaluation.capacity === 1 ? [command.cardId] : [...current, command.cardId]);
  event(state, events, 'EQUIPMENT_ATTACHED', `${player.name} 配戴了一件裝備。`, commandId);
  return undefined;
}

function attachCard(state: GameState, ruleset: Ruleset, player: PlayerState, command: Extract<GameCommand, { type: 'ATTACH_CARD' }>, events: DomainEvent[], commandId: string): EngineError | undefined {
  const phaseError = requirePhase(state, ['action1', 'action2']);
  if (phaseError) return phaseError;
  const evaluation = evaluateAttachment(state, ruleset, { schemaVersion: 1, playerId: player.id, cardId: command.cardId, adventurerId: command.adventurerId });
  if (evaluation.status !== 'ready' || !evaluation.evaluation.eligible) return { code: 'INVALID_COMMAND', message: evaluation.status === 'ready' ? `該卡不可附著：${evaluation.evaluation.reasonCode}。` : evaluation.error };
  const slot = player.party.find(({ adventurerId }) => adventurerId === command.adventurerId)!;
  const current = attachedCardIds(slot);
  if (evaluation.evaluation.requiresReplacement) {
    if (!command.replaceCardId || !current.includes(command.replaceCardId)) return { code: 'INVALID_COMMAND', message: '附件欄已滿，必須選擇目前配戴的一張卡替換。' };
  } else if (command.replaceCardId) return { code: 'INVALID_COMMAND', message: '附件欄未滿時不可指定替換。' };
  if (!removeFrom(player.hand, command.cardId)) return { code: 'INVALID_COMMAND', message: '該卡不在手牌中。' };
  const next = command.replaceCardId ? current.map((id) => id === command.replaceCardId ? command.cardId : id) : [...current, command.cardId];
  if (command.replaceCardId) player.discardPile.push(command.replaceCardId);
  setAttachedCardIds(slot, next);
  event(state, events, 'CARD_ATTACHED', `${player.name} 將一張卡附著到隊伍成員。`, commandId);
  return undefined;
}

function applyItem(state: GameState, ruleset: Ruleset, player: PlayerState, envelope: CommandEnvelope, resolutionEnvelopes: readonly CommandEnvelope[], events: DomainEvent[], rollbackState: GameState, factStart: number): EngineError | undefined {
  const command = envelope.command as Extract<GameCommand, { type: 'USE_ITEM' }>;
  const phaseError = requirePhase(state, ['action1', 'action2']);
  if (phaseError) return phaseError;
  if (!removeFrom(player.hand, command.cardId)) return { code: 'INVALID_COMMAND', message: '該物資不在手牌中。' };
  const definition = getDefinition(ruleset.registry, state, command.cardId);
  if (definition.type !== 'item') return { code: 'INVALID_COMMAND', message: '只有道具可使用。' };
  if (definition.tags?.includes('playtest:effects-disabled')) return { code: 'INVALID_COMMAND', message: '此卡效果尚未啟用，不能作為空白道具使用。' };
  player.playArea.push(command.cardId);
  facts(state, player.id).itemsUsed += 1;
  facts(state, player.id).actionPhaseItemsUsed = (facts(state, player.id).actionPhaseItemsUsed ?? 0) + 1;
  resolveItem(player, definition.itemEffect);
  if (definition.useEffect) {
    const result = beginCardUseEffectPipeline(state, ruleset, envelope, resolutionEnvelopes, rollbackState, events, factStart, definition.useEffect, { controllerId: player.id, cardRefs: { source: command.cardId } });
    if (result.status === 'failed' || result.status === 'unsupported') return { code: 'INVALID_COMMAND', message: result.error ?? '道具效果執行失敗。' };
    events.splice(0, events.length, ...result.events);
    if (result.status === 'suspended') return undefined;
  }
  event(state, events, 'ITEM_USED', `${player.name} 使用了道具；休息階段才會棄置。`, envelope.commandId);
  return undefined;
}

function buyCard(state: GameState, ruleset: Ruleset, player: PlayerState, command: Extract<GameCommand, { type: 'BUY_CARD' }>, events: DomainEvent[], commandId: string): EngineError | undefined {
  const phaseError = requirePhase(state, ['purchase']);
  if (phaseError) return phaseError;
  const isAdventurer = getZone(state, baseZoneIds.adventurerRow).cardIds.includes(command.cardId);
  const isItem = getZone(state, baseZoneIds.itemRow).cardIds.includes(command.cardId);
  if (!isAdventurer && !isItem) return { code: 'INVALID_COMMAND', message: '只能購買招募區或商店的公開卡。' };
  const definition = getDefinition(ruleset.registry, state, command.cardId);
  const evaluation = evaluatePurchaseCost(state, ruleset, { schemaVersion: 1, playerId: player.id, cardId: command.cardId });
  if (evaluation.status !== 'ready') return { code: 'INVALID_COMMAND', message: evaluation.error };
  const cost = evaluation.evaluation.effectiveCost;
  if (getPurchasePower(state, ruleset, player.id) < cost) return { code: 'INVALID_COMMAND', message: '購買力不足。' };
  removeFrom(getZone(state, isAdventurer ? baseZoneIds.adventurerRow : baseZoneIds.itemRow).cardIds, command.cardId);
  player.turnPurchaseSpent += cost;
  facts(state, player.id).purchasePowerSpent += cost;
  if (definition.type === 'adventurer') facts(state, player.id).adventurersRecruited += 1;
  if (definition.type === 'equipment') facts(state, player.id).equipmentBought += 1;
  if (definition.type === 'item') facts(state, player.id).itemsBought += 1;
  const monsterCardsInHand = player.hand.filter((cardId) => getDefinition(ruleset.registry, state, cardId).type === 'monster').length;
  facts(state, player.id).monstersUsedForPurchase = Math.max(facts(state, player.id).monstersUsedForPurchase ?? 0, monsterCardsInHand);
  const destination = pushDiscard(state, ruleset, player.id, command.cardId);
  event(state, events, 'CARD_ACQUIRED', `${player.name} 取得了 ${definition.name}。`, commandId);
  if (destination.id !== player.id) event(state, events, 'CARD_DISCARD_REDIRECTED', `${definition.name} 改置於 ${destination.name} 的棄牌堆。`, commandId);
  return undefined;
}

function reduceCommand(state: GameState, ruleset: Ruleset, envelope: CommandEnvelope, resolutionEnvelopes: readonly CommandEnvelope[], events: DomainEvent[], rollbackState: GameState, factStart: number): EngineError | undefined {
  const player = getPlayer(state, envelope.actorId);
  switch (envelope.command.type) {
    case 'PLAY_ADVENTURER': return playAdventurer(state, ruleset, player, envelope.command, events, envelope.commandId);
    case 'EQUIP_ITEM': return equipItem(state, ruleset, player, envelope.command, events, envelope.commandId);
    case 'ATTACH_CARD': return attachCard(state, ruleset, player, envelope.command, events, envelope.commandId);
    case 'USE_ITEM': return applyItem(state, ruleset, player, envelope, resolutionEnvelopes, events, rollbackState, factStart);
    case 'ATTACK_TARGET': return attackTarget(state, ruleset, player, envelope as CommandEnvelope & { command: Extract<GameCommand, { type: 'ATTACK_TARGET' }> }, events, rollbackState);
    case 'BUY_CARD': return buyCard(state, ruleset, player, envelope.command, events, envelope.commandId);
    case 'REFRESH_MARKET': { const message = applyMarketRefresh(state, ruleset, player, envelope.command, events, envelope.commandId); if (!message) facts(state, player.id).marketRefreshed = true; return message ? { code: 'INVALID_COMMAND', message } : undefined; }
    case 'SELECT_BONDS': return { code: 'INVALID_COMMAND', message: 'Bond setup commands are only valid during setup.' };
    case 'COMPLETE_BONDS': return applyBondCompletion(state, player, ruleset, envelope.command, events, envelope.commandId);
    case 'END_PHASE': return applyPhaseTransition(state, ruleset, player, envelope.command.phase, events, envelope, rollbackState, factStart, () => undefined, (candidate, activeRuleset, _activePlayer, activeEvents, commandId) => { checkEndConditions(candidate, activeRuleset, activeEvents, commandId); return undefined; }, 'phase-end', resolutionEnvelopes);
    case 'RESOLVE_EFFECT_CHOICE': return { code: 'INVALID_COMMAND', message: 'A choice command cannot be used as an original command continuation.' };
    case 'RESPOND_COUNTER_CONSENT':
    case 'CANCEL_COUNTER_CONSENT':
    case 'EXPIRE_COUNTER_CONSENT': return { code: 'INVALID_COMMAND', message: 'A counter consent command cannot be used as an original command continuation.' };
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

function dispatchInternal(state: GameState, ruleset: Ruleset, envelope: CommandEnvelope): EngineResult {
  const parsedEnvelope = CommandEnvelopeSchema.safeParse(envelope);
  if (!parsedEnvelope.success) return fail(state, 'INVALID_COMMAND', `Malformed command envelope: ${parsedEnvelope.error.issues[0]?.message ?? 'invalid input'}.`);
  envelope = parsedEnvelope.data;
  if (envelope.command.type === 'RESOLVE_EFFECT_ORDER') {
    const order = state.effectState.pendingChoice?.order;
    const resolution = order?.resolutions.find((candidate) =>
      JSON.stringify(candidate.orderedCardIds) === JSON.stringify(envelope.command.type === 'RESOLVE_EFFECT_ORDER' ? envelope.command.orderedCardIds : [])
      && candidate.removeCardId === (envelope.command.type === 'RESOLVE_EFFECT_ORDER' ? envelope.command.removeCardId : undefined));
    if (!order || !resolution || state.effectState.pendingChoice?.executionId !== envelope.command.executionId || state.effectState.pendingChoice.choiceId !== envelope.command.orderId) return fail(state, 'INVALID_COMMAND', 'No matching pending effect order.');
    envelope = { ...envelope, command: { type: 'RESOLVE_EFFECT_CHOICE', executionId: envelope.command.executionId, choiceId: envelope.command.orderId, optionId: resolution.optionId } };
  }
  const stateErrors = [...validateGameStateInvariants(state), ...validateRulesetGameStateInvariants(state, ruleset)]; if (stateErrors.length) return fail(state, 'INVALID_COMMAND', `Invalid game state: ${stateErrors.join(' ')}`);
  const registryError = validateRulesetStateCompatibility(state, ruleset); if (registryError) return fail(state, 'INVALID_COMMAND', registryError);
  const continuityErrors = validateSupplyContinuityState(state, ruleset); if (continuityErrors.length) return fail(state, 'INVALID_COMMAND', continuityErrors.join(' '));
  if (state.status === 'finished') return fail(state, 'GAME_FINISHED', '遊戲已結束。');
  if (state.status === 'pendingOfficialRuling') return fail(state, 'RULE_CLARIFICATION_REQUIRED', '目前 Rules Module 尚有必須先完成的規則裁定。');
  if (envelope.gameId !== state.gameId || envelope.expectedRevision !== state.revision) return fail(state, 'STALE_REVISION', '指令使用了過期的對局版本。');
  if (state.status === 'setup') return dispatchBondSetup(state, ruleset, envelope);
  const pendingChoice = state.effectState.pendingChoice; const pendingConsent = state.effectState.pendingCounterConsent;
  if (pendingConsent ? !state.players.some(({ id }) => id === envelope.actorId) : envelope.actorId !== (pendingChoice?.actorId ?? state.activePlayerId)) return fail(state, 'NOT_AUTHORIZED', '目前不是此玩家可執行的指令。');
  const hasContinuation = pendingChoice || pendingConsent || state.effectState.pendingLifecycle || state.effectState.pendingCommand || state.effectState.pendingPostCommand;
  if (hasContinuation && ((pendingChoice && envelope.command.type !== 'RESOLVE_EFFECT_CHOICE') || (pendingConsent && !isCounterConsentCommand(envelope.command)) || (!pendingChoice && !pendingConsent))) return fail(state, 'INVALID_COMMAND', '必須先完成待處理的效果暫停。');
  if (pendingConsent && isCounterConsentCommand(envelope.command)) {
    const evaluation = evaluateCounterConsent(state, ruleset, {
      schemaVersion: 1,
      action: counterConsentAction(envelope.command),
      actorId: envelope.actorId,
      requestId: envelope.command.requestId,
      registry: structuredClone(pendingConsent.registry)
    });
    if (evaluation.status === 'failed') return fail(state, 'INVALID_COMMAND', `${evaluation.reason}: ${evaluation.error}`);
  }
  const nextState = structuredClone(state);
  if ((envelope.command.type === 'RESOLVE_EFFECT_CHOICE' || isCounterConsentCommand(envelope.command)) && nextState.effectState.pendingCommand?.kind === 'combat-reward') {
    const pending = nextState.effectState.pendingCommand; const resumed = envelope.command.type === 'RESOLVE_EFFECT_CHOICE' ? resumeCombatRewardPipeline(nextState, ruleset, envelope) : resumeCombatRewardCounterConsent(nextState, ruleset, envelope, counterConsentAction(envelope.command));
    if (resumed.status === 'failed' || resumed.status === 'unsupported') return { state: structuredClone(pending.rollbackState), events: [], error: { code: 'INVALID_COMMAND', message: resumed.error ?? 'Combat reward choice failed.' } };
    if (resumed.status === 'suspended') return { state: nextState, events: resumed.events };
    const tail = finishAttackAfterRewards(nextState, ruleset, pending.envelope, resumed.events); if (tail) return { state: structuredClone(pending.rollbackState), events: [], error: tail };
    const pipeline = beginPostCommandPipeline(nextState, ruleset, pending.envelope, structuredClone(pending.rollbackState), resumed.events.slice(pending.factStart), resumed.events);
    if (pipeline.status === 'failed' || pipeline.status === 'unsupported') return { state: structuredClone(pending.rollbackState), events: [], error: { code: 'INVALID_COMMAND', message: pipeline.error ?? 'Post-command lifecycle failed.' } };
    if (pipeline.status === 'suspended') return { state: nextState, events: pipeline.events }; nextState.revision += 1; nextState.eventLogCursor += pipeline.events.length; return { state: nextState, events: pipeline.events };
  }
  if ((envelope.command.type === 'RESOLVE_EFFECT_CHOICE' || isCounterConsentCommand(envelope.command)) && nextState.effectState.pendingCommand?.kind === 'card-use-effect') {
    const pending = structuredClone(nextState.effectState.pendingCommand);
    const resumed = envelope.command.type === 'RESOLVE_EFFECT_CHOICE'
      ? resumeCardUseEffectChoice(nextState, ruleset, envelope)
      : resumeCardUseEffectCounterConsent(nextState, ruleset, envelope, counterConsentAction(envelope.command));
    if (resumed.status === 'failed' || resumed.status === 'unsupported') return resumed.rollback === 'command'
      ? { state: structuredClone(pending.rollbackState), events: [], error: { code: 'INVALID_COMMAND', message: resumed.error ?? 'Card-use continuation failed.' } }
      : fail(state, 'INVALID_COMMAND', resumed.error ?? 'Card-use continuation failed.');
    if (resumed.status === 'suspended') return { state: nextState, events: resumed.events };
    const events = [...resumed.events];
    const player = getPlayer(nextState, pending.envelope.actorId);
    event(nextState, events, 'ITEM_USED', `${player.name} 使用了道具；休息階段才會棄置。`, pending.envelope.commandId);
    const committedEvents = transactionEvents(events, pending.envelope.commandId);
    const pipeline = beginPostCommandPipeline(nextState, ruleset, pending.envelope, structuredClone(pending.rollbackState), committedEvents.slice(pending.factStart), committedEvents, [...pending.resolutionEnvelopes, structuredClone(envelope)]);
    if (pipeline.status === 'failed' || pipeline.status === 'unsupported') return { state: structuredClone(pending.rollbackState), events: [], error: { code: 'INVALID_COMMAND', message: pipeline.error ?? 'Post-command lifecycle failed.' } };
    if (pipeline.status === 'suspended') return { state: nextState, events: pipeline.events };
    nextState.revision += 1; nextState.eventLogCursor += pipeline.events.length; return { state: nextState, events: pipeline.events };
  }
  if ((envelope.command.type === 'RESOLVE_EFFECT_CHOICE' || isCounterConsentCommand(envelope.command)) && nextState.effectState.pendingCommand?.kind === 'phase-transition') {
    const continuation = structuredClone(nextState.effectState.pendingCommand);
    if (!nextState.effectState.pendingLifecycle) return { state: structuredClone(continuation.rollbackState), events: [], error: { code: 'INVALID_COMMAND', message: 'Phase transition lifecycle continuation is missing.' } };
    const resumed = envelope.command.type === 'RESOLVE_EFFECT_CHOICE'
      ? resumeLifecycleChoice(nextState, ruleset, envelope.actorId, envelope.command.executionId, envelope.command.choiceId, envelope.command.optionId)
      : resumeLifecycleCounterConsent(nextState, ruleset, envelope.actorId, envelope.command.requestId, counterConsentAction(envelope.command));
    if (resumed.status === 'failed' || resumed.status === 'unsupported') return { state: structuredClone(continuation.rollbackState), events: [], error: { code: 'INVALID_COMMAND', message: resumed.error ?? resumed.reason ?? 'Unable to resume phase transition lifecycle.' } };
    const events = transactionEvents([...continuation.events, ...resumed.events], continuation.envelope.commandId);
    if (resumed.status === 'suspended') {
      const pending = nextState.effectState.pendingCommand;
      if (!pending || pending.kind !== 'phase-transition') return { state: structuredClone(continuation.rollbackState), events: [], error: { code: 'INVALID_COMMAND', message: 'Phase transition continuation changed kind while suspended.' } };
      pending.events = structuredClone(events);
      pending.resolutionEnvelopes = [...continuation.resolutionEnvelopes, structuredClone(envelope)];
      return { state: nextState, events };
    }
    delete nextState.effectState.pendingCommand;
    const player = getPlayer(nextState, continuation.envelope.actorId);
    const resolutionEnvelopes = [...continuation.resolutionEnvelopes, structuredClone(envelope)];
    const transitionError = applyPhaseTransition(nextState, ruleset, player, continuation.envelope.command.phase, events, continuation.envelope, continuation.rollbackState, continuation.factStart, () => undefined, (candidate, activeRuleset, _activePlayer, activeEvents, commandId) => { checkEndConditions(candidate, activeRuleset, activeEvents, commandId); return undefined; }, continuation.cursor, resolutionEnvelopes);
    if (transitionError) return { state: structuredClone(continuation.rollbackState), events: [], error: transitionError };
    const pending = nextState.effectState.pendingCommand as PendingCommandContinuation | undefined;
    if (pending?.kind === 'phase-transition') {
      const normalized = transactionEvents(events, continuation.envelope.commandId);
      pending.events = structuredClone(normalized);
      return { state: nextState, events: normalized };
    }
    const pipeline = beginPostCommandPipeline(nextState, ruleset, continuation.envelope, structuredClone(continuation.rollbackState), events.slice(continuation.factStart), events);
    if (pipeline.status === 'failed' || pipeline.status === 'unsupported') return { state: structuredClone(continuation.rollbackState), events: [], error: { code: 'INVALID_COMMAND', message: pipeline.error ?? 'Post-command lifecycle failed after phase transition.' } };
    if (pipeline.status === 'suspended') return { state: nextState, events: pipeline.events };
    nextState.revision += 1; nextState.eventLogCursor += pipeline.events.length; return { state: nextState, events: pipeline.events };
  }
  if ((envelope.command.type === 'RESOLVE_EFFECT_CHOICE' || isCounterConsentCommand(envelope.command)) && nextState.effectState.pendingPostCommand) {
    const rollback = structuredClone(nextState.effectState.pendingPostCommand.rollbackState);
    const result = envelope.command.type === 'RESOLVE_EFFECT_CHOICE' ? resumePostCommandPipeline(nextState, ruleset, envelope.actorId, envelope.command.executionId, envelope.command.choiceId, envelope.command.optionId, envelope) : resumePostCommandCounterConsent(nextState, ruleset, envelope.actorId, envelope.command.requestId, counterConsentAction(envelope.command), envelope);
    if (result.status === 'failed' || result.status === 'unsupported') return result.rollback === 'command' ? { state: rollback, events: [], error: { code: 'INVALID_COMMAND', message: result.error ?? '無法恢復 post-command lifecycle。' } } : fail(state, 'INVALID_COMMAND', result.error ?? '無法恢復 post-command lifecycle。');
    if (result.status === 'suspended') return { state: nextState, events: result.events };
    nextState.revision += 1;
    nextState.eventLogCursor += result.events.length;
    return { state: nextState, events: result.events };
  }
  if ((envelope.command.type === 'RESOLVE_EFFECT_CHOICE' || isCounterConsentCommand(envelope.command)) && nextState.effectState.pendingCommand) {
    const resolution = envelope.command;
    const continuation = structuredClone(nextState.effectState.pendingCommand); const pending = nextState.effectState.pendingLifecycle; const rollback = pending?.rollbackState;
    if (continuation.kind === 'team-overflow') {
      if (resolution.type !== 'RESOLVE_EFFECT_CHOICE') return fail(state, 'INVALID_COMMAND', 'Team overflow requires its matching effect choice.');
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
    if (continuation.kind === 'combat-departure-choice') {
      if (resolution.type !== 'RESOLVE_EFFECT_CHOICE') return fail(state, 'INVALID_COMMAND', 'Combat departure replacement requires its matching effect choice.');
      const choice = nextState.effectState.pendingChoice; const selected = continuation.optionCandidateIds[resolution.optionId];
      const candidateIds = continuation.candidates.map(({ candidateId }) => candidateId);
      if (!choice || !selected || choice.actorId !== envelope.actorId || choice.executionId !== resolution.executionId || choice.choiceId !== resolution.choiceId || continuation.envelope.gameId !== state.gameId || continuation.envelope.expectedRevision !== state.revision || continuation.envelope.actorId !== envelope.actorId || new Set(selected).size !== selected.length || selected.some((id) => !candidateIds.includes(id))) return fail(state, 'INVALID_COMMAND', 'No matching pending combat departure replacement choice.');
      delete nextState.effectState.pendingChoice; delete nextState.effectState.pendingCommand;
      const events = [...continuation.events]; const factStart = events.length; const player = getPlayer(nextState, envelope.actorId);
      const error = attackTarget(nextState, ruleset, player, continuation.envelope, events, continuation.rollbackState, selected);
      if (error) return { state: structuredClone(continuation.rollbackState), events: [], error };
      const reducerContinuation = pendingCommandFor(nextState);
      if (reducerContinuation?.kind === 'combat-reward') { reducerContinuation.rollbackState = structuredClone(continuation.rollbackState); reducerContinuation.factStart = factStart; return { state: nextState, events }; }
      const pipeline = beginPostCommandPipeline(nextState, ruleset, continuation.envelope, structuredClone(continuation.rollbackState), events.slice(factStart), events);
      if (pipeline.status === 'failed' || pipeline.status === 'unsupported') return { state: structuredClone(continuation.rollbackState), events: [], error: { code: 'INVALID_COMMAND', message: pipeline.error ?? 'Post-command lifecycle failed.' } };
      if (pipeline.status === 'suspended') return { state: nextState, events: pipeline.events };
      nextState.revision += 1; nextState.eventLogCursor += pipeline.events.length; return { state: nextState, events: pipeline.events };
    }
    if (continuation.kind === 'card-use-effect' || continuation.kind === 'combat-reward') return fail(state, 'INVALID_COMMAND', 'Unexpected specialized command continuation branch.');
    if (!pending || continuation.envelope.gameId !== state.gameId || continuation.envelope.expectedRevision !== state.revision) return fail(state, 'INVALID_COMMAND', '待處理 command continuation 不相容。');
    if (resolution.type === 'RESOLVE_EFFECT_CHOICE') { const choice = nextState.effectState.pendingChoice; if (!choice || choice.actorId !== envelope.actorId || choice.executionId !== resolution.executionId || choice.choiceId !== resolution.choiceId || !choice.options.some((option) => option.id === resolution.optionId)) return fail(state, 'INVALID_COMMAND', 'No matching pending command-before effect choice.'); }
    else if (nextState.effectState.pendingCounterConsent?.requestId !== resolution.requestId) return fail(state, 'INVALID_COMMAND', 'No matching pending command-before counter consent.');
    const resumed = resolution.type === 'RESOLVE_EFFECT_CHOICE' ? resumeLifecycleChoice(nextState, ruleset, envelope.actorId, resolution.executionId, resolution.choiceId, resolution.optionId) : resumeLifecycleCounterConsent(nextState, ruleset, envelope.actorId, resolution.requestId, counterConsentAction(resolution));
    if (resumed.status === 'failed' || resumed.status === 'unsupported') return { state: rollback ? structuredClone(rollback) : state, events: [], error: { code: 'INVALID_COMMAND', message: resumed.error ?? resumed.reason ?? '無法恢復 command-before lifecycle。' } };
    const events = transactionEvents([...continuation.events, ...resumed.events], continuation.envelope.commandId);
    const resolutionEnvelopes = [...(continuation.resolutionEnvelopes ?? []), structuredClone(envelope)];
    if (resumed.status === 'suspended') {
      const nextContinuation = nextState.effectState.pendingCommand;
      if (!nextContinuation || nextContinuation.kind === 'team-overflow' || nextContinuation.kind === 'combat-departure-choice' || nextContinuation.kind === 'card-use-effect' || nextContinuation.kind === 'combat-reward') return fail(state, 'INVALID_COMMAND', 'Command-before continuation changed kind while suspended.');
      nextContinuation.events = structuredClone(events);
      nextContinuation.resolutionEnvelopes = resolutionEnvelopes;
      return { state: nextState, events };
    }
    delete nextState.effectState.pendingCommand;
    const factStart = events.length;
    const commandRollback = rollback ? structuredClone(rollback) : structuredClone(state);
    const error = reduceCommand(nextState, ruleset, continuation.envelope, resolutionEnvelopes, events, commandRollback, factStart);
    if (error) return { state: rollback ? structuredClone(rollback) : state, events: [], error };
    const reducerContinuation = pendingCommandFor(nextState);
    if (reducerContinuation?.kind === 'combat-reward') {
      reducerContinuation.rollbackState = rollback ? structuredClone(rollback) : structuredClone(state);
      reducerContinuation.factStart = factStart;
      return { state: nextState, events };
    }
    if (reducerContinuation?.kind === 'card-use-effect') return { state: nextState, events: [...reducerContinuation.events] };
    if (reducerContinuation?.kind === 'phase-transition') {
      const normalized = transactionEvents(events, continuation.envelope.commandId);
      reducerContinuation.events = structuredClone(normalized);
      return { state: nextState, events: normalized };
    }
    const pipeline = beginPostCommandPipeline(nextState, ruleset, continuation.envelope, rollback ? structuredClone(rollback) : structuredClone(state), events.slice(factStart), events, continuation.envelope.command.type === 'USE_ITEM' ? resolutionEnvelopes : []);
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
  if (isCounterConsentCommand(envelope.command)) {
    const result = nextState.effectState.pendingLifecycle ? resumeLifecycleCounterConsent(nextState, ruleset, envelope.actorId, envelope.command.requestId, counterConsentAction(envelope.command)) : resumeEffectCounterConsent(nextState, ruleset, envelope.actorId, envelope.command.requestId, counterConsentAction(envelope.command));
    const reason = 'reason' in result && typeof result.reason === 'string' ? result.reason : undefined;
    if (result.status === 'failed' || result.status === 'unsupported') return { state, events: [], error: { code: 'INVALID_COMMAND', message: result.error ?? reason ?? '無法恢復 counter consent。' } };
    if (result.status === 'suspended') return { state: nextState, events: result.events };
    nextState.revision += 1; nextState.eventLogCursor += result.events.length; return { state: nextState, events: result.events };
  }
  const rollback = structuredClone(state);
  const before = dispatchLifecycle(nextState, ruleset, { schemaVersion: 1, point: 'command-before', actorId: envelope.actorId, commandType: envelope.command.type, phase: nextState.phase, metadata: { commandId: envelope.commandId } }, { controllerId: envelope.actorId });
  events.push(...before.events);
  if (before.status === 'suspended') {
    const pendingEvents = transactionEvents(events, envelope.commandId);
    nextState.effectState.pendingCommand = {
      schemaVersion: 1,
      envelope: structuredClone(envelope),
      events: structuredClone(pendingEvents),
      ...(envelope.command.type === 'USE_ITEM' ? { resolutionEnvelopes: [] } : {}),
    };
    return { state: nextState, events: pendingEvents };
  }
  if (before.status === 'failed' || before.status === 'unsupported') return { state, events: [], error: { code: 'INVALID_COMMAND', message: before.error ?? before.reason ?? 'command-before lifecycle failed.' } };
  if (envelope.command.type === 'PLAY_ADVENTURER') {
    const overflow = evaluateTeamOverflow(nextState, ruleset, { schemaVersion: 1, playerId: envelope.actorId, incomingMemberId: envelope.command.cardId });
    if (overflow.status !== 'ready') return { state, events: [], error: { code: 'INVALID_COMMAND', message: overflow.error } };
    if (overflow.evaluation.status === 'overflow-required' && overflow.evaluation.policy?.mode === 'player-choice') {
      const candidateIds = overflow.evaluation.candidateIds; const count = overflow.evaluation.overflowCount; const sets = combinations(candidateIds, count); if (!sets.length) return { state, events: [], error: { code: 'INVALID_COMMAND', message: 'Team overflow has insufficient candidates.' } }; if (sets.length > 256) return { state, events: [], error: { code: 'INVALID_COMMAND', message: 'Team overflow choice exceeds the supported option budget.' } };
      const optionCandidates = Object.fromEntries(sets.map((set, index) => [`overflow-${index + 1}`, set])); const choiceId = `team-overflow:${overflow.evaluation.policy.policyId}`; const executionId = `team-overflow:${envelope.commandId}`;
      nextState.effectState.pendingChoice = { schemaVersion: 1, executionId, choiceId, decisionKind: 'choose-party-member', actorId: envelope.actorId, options: Object.keys(optionCandidates).map((id) => ({ id, effect: { kind: 'modify-value', target: { kind: 'turn-combat-bonus', player: { kind: 'controller' } }, amount: 0 } })), remaining: [], context: { controllerId: envelope.actorId } };
      nextState.effectState.pendingCommand = { schemaVersion: 1, kind: 'team-overflow', envelope: structuredClone(envelope), events: structuredClone(events), rollbackState: structuredClone(rollback), policy: { moduleId: overflow.evaluation.policy.moduleId, policyId: overflow.evaluation.policy.policyId }, candidateIds: structuredClone(candidateIds), requiredSelectionCount: count, optionCandidates: structuredClone(optionCandidates), registry: structuredClone(overflow.evaluation.registry) };
      return { state: nextState, events };
    }
  }
  const factStart = events.length;
  const error = reduceCommand(nextState, ruleset, envelope, [], events, rollback, factStart);
  if (error) return { state, events: [], error };
  if (nextState.effectState.pendingCommand?.kind === 'phase-transition') {
    const pendingEvents = transactionEvents(events, envelope.commandId);
    nextState.effectState.pendingCommand.events = structuredClone(pendingEvents);
    return { state: nextState, events: pendingEvents };
  }
  if (nextState.effectState.pendingCommand?.kind === 'combat-departure-choice') return { state: nextState, events };
  if (nextState.effectState.pendingCommand?.kind === 'combat-reward') { nextState.effectState.pendingCommand.rollbackState = structuredClone(rollback); nextState.effectState.pendingCommand.factStart = factStart; return { state: nextState, events }; }
  if (nextState.effectState.pendingCommand?.kind === 'card-use-effect') return { state: nextState, events: [...nextState.effectState.pendingCommand.events] };
  const pipeline = beginPostCommandPipeline(nextState, ruleset, envelope, rollback, events.slice(factStart), events);
  if (pipeline.status === 'failed' || pipeline.status === 'unsupported') return { state: rollback, events: [], error: { code: 'INVALID_COMMAND', message: pipeline.error ?? 'Post-command lifecycle failed.' } };
  if (pipeline.status === 'suspended') return { state: nextState, events: pipeline.events };
  nextState.revision += 1;
  nextState.eventLogCursor += pipeline.events.length;
  return { state: nextState, events: pipeline.events };
}

export function dispatch(state: GameState, ruleset: Ruleset, envelope: CommandEnvelope): EngineResult {
  const result = dispatchInternal(state, ruleset, envelope);
  if (result.error) return result;
  const errors = [...validateGameStateInvariants(result.state), ...validateRulesetGameStateInvariants(result.state, ruleset), ...validateSupplyContinuityState(result.state, ruleset)]; const registryError = validateRulesetStateCompatibility(result.state, ruleset);
  if (errors.length || registryError) return fail(state, 'INVALID_COMMAND', `Command produced invalid state: ${[...errors, ...(registryError ? [registryError] : [])].join(' ')}`);
  return result;
}
