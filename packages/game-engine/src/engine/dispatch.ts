import { CommandEnvelopeSchema, type CommandEnvelope, type DomainEvent, type EngineError, type EngineResult, type GameCommand, type GameState, type Phase, type PlayerState } from '@guildmaster/game-protocol';
import { getDefinition, getPlayer } from '../model/factories.js';
import { getCombatPrefix, getPurchasePower } from '../queries/legal-commands.js';
import { getEndCondition, validateRulesetStateCompatibility, type Ruleset } from '../rules/ruleset.js';
import { drawCards } from './draw.js';
import { attachTargets } from './create-game.js';
import { refillConfiguredSupplyRows, refillSupply } from './supply.js';
import { baseZoneIds, getZone } from '../model/zones.js';
import { resumeEffectChoice, resumeEffectCounterConsent } from '../effects/executor.js';
import { dispatchLifecycle, resumeLifecycleChoice, resumeLifecycleCounterConsent } from '../effects/lifecycle-dispatcher.js';
import { beginPostCommandPipeline, resumePostCommandPipeline, resumePostCommandCounterConsent } from './post-command-pipeline.js';
import { evaluateCombat } from '../rules/combat-evaluator.js';
import { evaluateCombatRewards } from '../rules/combat-reward-evaluator.js';
import { evaluateEquipmentEligibility } from '../rules/equipment-eligibility-evaluator.js';
import { evaluateBondCondition } from '../rules/bond-condition-evaluator.js';
import { evaluateTeamOverflow } from '../rules/team-overflow-evaluator.js';
import { beginCombatRewardPipeline, resumeCombatRewardPipeline, resumeCombatRewardCounterConsent } from './combat-reward-pipeline.js';
import { applyEnemyTargetDamageEvaluation, defeatEnemyTarget, removeEnemyTarget } from './encounter-resolution.js';
import { validateGameStateInvariants, validateRulesetGameStateInvariants } from './state-invariants.js';
import { evaluateCounterConsent } from '../rules/counter-consent-evaluator.js';
import { evaluateMonsterDefeatContinuity, validateSupplyContinuityState } from '../rules/supply-continuity-evaluator.js';
import { evaluateAttackResolution } from '../rules/attack-resolution-evaluator.js';
import { beginCardUseEffectPipeline, resumeCardUseEffectChoice, resumeCardUseEffectCounterConsent } from './card-use-effect-pipeline.js';
import { nextSeat, previousSeat } from '../model/seats.js';
import { shuffle } from '../ports/random.js';
import { createTurnFactLedger } from './create-game.js';

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
function facts(state: GameState, playerId: string) {
  if (!state.turnFacts || state.turnFacts.playerId !== playerId) state.turnFacts = createTurnFactLedger(playerId);
  return state.turnFacts;
}
const pendingCommandFor = (state: GameState) => state.effectState.pendingCommand;
type CounterConsentCommand = Extract<GameCommand, { type: 'RESPOND_COUNTER_CONSENT' | 'CANCEL_COUNTER_CONSENT' | 'EXPIRE_COUNTER_CONSENT' }>;
const isCounterConsentCommand = (command: GameCommand): command is CounterConsentCommand => command.type === 'RESPOND_COUNTER_CONSENT' || command.type === 'CANCEL_COUNTER_CONSENT' || command.type === 'EXPIRE_COUNTER_CONSENT';
const counterConsentAction = (command: CounterConsentCommand): 'accept' | 'decline' | 'cancel' | 'expire' => command.type === 'RESPOND_COUNTER_CONSENT' ? command.response : command.type === 'CANCEL_COUNTER_CONSENT' ? 'cancel' : 'expire';
const transactionEvents = (events: readonly DomainEvent[], commandId: string): DomainEvent[] => events.map((entry, index) => ({ ...entry, eventId: `transaction:${commandId}:${index + 1}`, causedByCommandId: commandId }));
function combinations(ids: readonly string[], count: number, limit = 257): string[][] { const results: string[][] = []; const visit = (start: number, prefix: string[]): void => { if (results.length >= limit) return; if (prefix.length === count) { results.push(prefix); return; } for (let index = start; index < ids.length && results.length < limit; index += 1) visit(index + 1, [...prefix, ids[index]!]); }; visit(0, []); return results; }

function requirePhase(state: GameState, phases: readonly Phase[]): EngineError | undefined {
  return phases.includes(state.phase) ? undefined : { code: 'INVALID_COMMAND', message: `目前是 ${state.phase}，無法執行此操作。` };
}

function resolveItem(player: PlayerState, effect: string | undefined): void {
  if (effect === 'purchase+2') player.turnPurchaseBonus += 2;
  if (effect === 'combat+2') player.turnCombatBonus += 2;
}

function maybeCompleteBonds(state: GameState, player: PlayerState, ruleset: Ruleset, events: DomainEvent[], commandId: string): EngineError | undefined {
  for (const bond of player.bonds) {
    if (bond.completed) continue;
    const definition = ruleset.registry.bonds.find((candidate) => candidate.id === bond.bondId);
    const evaluation = evaluateBondCondition(state, ruleset, player.id, bond.bondId);
    if (evaluation.status !== 'ready') return { code: 'INVALID_COMMAND', message: evaluation.error };
    if (definition && evaluation.evaluation.satisfied) {
      bond.completed = true;
      event(state, events, 'BOND_COMPLETED', `${player.name} 完成羈絆：${definition.name}。`, commandId);
    }
  }
  return undefined;
}

function fixedCombatOutcome(events: readonly DomainEvent[]): 'defeat-target' | 'remove-target' | undefined {
  const payload = events.find((entry) => entry.type === 'COMBAT_EVALUATED')?.payload;
  return payload?.kind === 'combat-evaluation' ? payload.evaluation.outcome.kind : undefined;
}

function fixedAttackResolution(events: readonly DomainEvent[]): import('@guildmaster/game-protocol').AttackResolutionEvaluation | undefined {
  const payload = events.find((entry) => entry.type === 'ATTACK_RESOLUTION_EVALUATED')?.payload;
  return payload?.kind === 'attack-resolution' ? payload.evaluation : undefined;
}

function finalizeAttackTarget(state: GameState, ruleset: Ruleset, player: PlayerState, targetId: string, outcome: 'defeat-target' | 'remove-target', events: DomainEvent[], commandId: string): EngineError | undefined {
  const target = state.enemyTargets[targetId];
  if (!target || target.status !== 'available') return { code: 'INVALID_COMMAND', message: 'Combat target disappeared before final disposition.' };
  const definition = getDefinition(ruleset.registry, state, target.cardInstanceId);
  const encounter = target.parentEncounterId ? state.enemyEncounters.find(({ encounterId }) => encounterId === target.parentEncounterId) : undefined;
  const monsterContinuity = target.kind === 'monster' ? evaluateMonsterDefeatContinuity(state, ruleset, targetId, outcome) : undefined;
  if (monsterContinuity?.status === 'failed') return { code: 'INVALID_COMMAND', message: `${monsterContinuity.reason}: ${monsterContinuity.error}` };
  if (encounter?.resolutionPolicy) {
    const resolution = outcome === 'remove-target'
      ? removeEnemyTarget(state, ruleset, { kind: 'remove-enemy-target', targetId, policy: encounter.resolutionPolicy }, events)
      : defeatEnemyTarget(state, ruleset, { kind: 'defeat-enemy-target', targetId, policy: encounter.resolutionPolicy }, events);
    if (!resolution.ok) return { code: 'INVALID_COMMAND', message: resolution.error };
  } else {
    if (target.zoneId) removeFrom(getZone(state, target.zoneId).cardIds, target.cardInstanceId);
    if (outcome === 'remove-target') {
      target.status = 'removed';
      state.removedCards.push(target.cardInstanceId);
      event(state, events, 'ENEMY_REMOVED', `${definition.name} 的討伐結果被替代為移出遊戲。`, commandId);
    } else {
      target.status = 'defeated';
      if (monsterContinuity?.status === 'ready' && monsterContinuity.recycle) getZone(state, baseZoneIds.monsterDeck).cardIds.unshift(target.cardInstanceId);
      else player.discardPile.push(target.cardInstanceId);
    }
  }
  return undefined;
}

function refillAttackTargetSupply(state: GameState, ruleset: Ruleset, targetKind: string, events: DomainEvent[]): EngineError | undefined {
  if (targetKind === 'monster' || targetKind === 'boss') {
    try { refillSupply(state, ruleset, targetKind, events); attachTargets(state); }
    catch (error) { return { code: 'INVALID_COMMAND', message: error instanceof Error ? error.message : `${targetKind} supply refill failed.` }; }
  }
  if (targetKind === 'monster') { const continuityErrors = validateSupplyContinuityState(state, ruleset); if (continuityErrors.length) return { code: 'INVALID_COMMAND', message: continuityErrors.join(' ') }; }
  return undefined;
}

function finishAttackAfterRewards(state: GameState, ruleset: Ruleset, envelope: CommandEnvelope, events: DomainEvent[]): EngineError | undefined {
  const player = getPlayer(state, envelope.actorId); const targetId = (envelope.command as Extract<GameCommand, { type: 'ATTACK_TARGET' }>).targetId;
  const target = state.enemyTargets[targetId];
  if (!target) return { code: 'INVALID_COMMAND', message: 'Combat reward target disappeared.' };
  const outcome = fixedCombatOutcome(events);
  if (!outcome) return { code: 'INVALID_COMMAND', message: 'Committed combat evaluation is missing.' };
  const attackResolution = fixedAttackResolution(events);
  let terminalStatus: 'defeated' | 'removed';
  if (attackResolution) {
    const expectedStatus = attackResolution.damage.input.lethalOutcome ?? 'defeated';
    if (!attackResolution.damage.lethal || target.status !== expectedStatus || target.health?.current !== 0) return { code: 'INVALID_COMMAND', message: 'Committed health-target attack resolution is incomplete or inconsistent.' };
    terminalStatus = expectedStatus;
  } else {
    const dispositionError = finalizeAttackTarget(state, ruleset, player, targetId, outcome, events, envelope.commandId);
    if (dispositionError) return dispositionError;
    terminalStatus = outcome === 'remove-target' ? 'removed' : 'defeated';
  }
  const refillError = refillAttackTargetSupply(state, ruleset, target.kind, events);
  if (refillError) return refillError;
  if (terminalStatus === 'removed') return undefined;
  const definition = getDefinition(ruleset.registry, state, target.cardInstanceId);
  if (target.kind === 'boss') player.history.defeatedBosses += 1;
  else player.history.defeatedMonsters += 1;
  if (target.kind === 'boss') facts(state, player.id).bossesDefeated += 1;
  else facts(state, player.id).monstersDefeated += 1;
  facts(state, player.id).combatResolved = true;
  const bondError = maybeCompleteBonds(state, player, ruleset, events, envelope.commandId); if (bondError) return bondError;
  event(state, events, 'ENEMY_DEFEATED', `${player.name} 討伐了 ${definition.name}。`, envelope.commandId); checkEnd(state, ruleset, events, envelope.commandId); return undefined;
}

function checkEnd(state: GameState, ruleset: Ruleset, events: DomainEvent[], commandId: string): void {
  if (state.status !== 'playing') return;
  const conditionId = getEndCondition(ruleset, state);
  if (!conditionId) return;
  const finalRoundEndPlayerId = previousSeat(state.players, state.startingPlayerId).id;
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
  if (!removeFrom(player.hand, command.cardId)) return { code: 'INVALID_COMMAND', message: '該物資不在手牌中。' };
  const slot = player.party.find((candidate) => candidate.adventurerId === command.adventurerId);
  if (!slot) return { code: 'INVALID_COMMAND', message: '找不到指定的隊伍冒險者。' };
  if (slot.equipmentId) player.discardPile.push(slot.equipmentId);
  slot.equipmentId = command.cardId;
  event(state, events, 'EQUIPMENT_ATTACHED', `${player.name} 配戴了一件裝備。`, commandId);
  return undefined;
}

function applyItem(state: GameState, ruleset: Ruleset, player: PlayerState, envelope: CommandEnvelope, resolutionEnvelopes: readonly CommandEnvelope[], events: DomainEvent[], rollbackState: GameState, factStart: number): EngineError | undefined {
  const command = envelope.command as Extract<GameCommand, { type: 'USE_ITEM' }>;
  const phaseError = requirePhase(state, ['action1', 'action2']);
  if (phaseError) return phaseError;
  if (!removeFrom(player.hand, command.cardId)) return { code: 'INVALID_COMMAND', message: '該物資不在手牌中。' };
  const definition = getDefinition(ruleset.registry, state, command.cardId);
  if (definition.type !== 'item') return { code: 'INVALID_COMMAND', message: '只有道具可使用。' };
  player.playArea.push(command.cardId);
  facts(state, player.id).itemsUsed += 1;
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

function attackTarget(state: GameState, ruleset: Ruleset, player: PlayerState, command: Extract<GameCommand, { type: 'ATTACK_TARGET' }>, events: DomainEvent[], commandId: string): EngineError | undefined {
  const phaseError = requirePhase(state, ['combat']);
  if (phaseError) return phaseError;
  const target = state.enemyTargets[command.targetId];
  if (!target || target.status !== 'available') return { code: 'INVALID_COMMAND', message: '該敵方目標不可討伐。' };
  const encounter = target.parentEncounterId ? state.enemyEncounters.find(({ encounterId }) => encounterId === target.parentEncounterId) : undefined;
  if (encounter?.status === 'finished') return { code: 'INVALID_COMMAND', message: '該敵方 encounter 已完成。' };
  const attackResolution = target.health ? evaluateAttackResolution(state, ruleset, { schemaVersion: 1, playerId: player.id, targetId: command.targetId, registry: { rulesetVersion: state.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) } }) : undefined;
  if (attackResolution && attackResolution.status !== 'ready') return { code: 'INVALID_COMMAND', message: `${attackResolution.reason}: ${attackResolution.error}` };
  const combat = attackResolution?.status === 'ready' ? { status: 'ready' as const, evaluation: attackResolution.evaluation.combat } : evaluateCombat(state, ruleset, player.id, command.targetId);
  if (combat.status !== 'ready') return { code: 'INVALID_COMMAND', message: combat.error };
  if (!combat.evaluation.eligible) return { code: 'INVALID_COMMAND', message: `該敵方目標受到討伐限制：${combat.evaluation.restrictionReasonCodes.join(', ')}。` };
  if (!target.health && target.kind === 'monster') {
    const continuity = evaluateMonsterDefeatContinuity(state, ruleset, target.targetId, combat.evaluation.outcome.kind);
    if (continuity.status !== 'ready') return { code: 'INVALID_COMMAND', message: `${continuity.reason}: ${continuity.error}` };
  }
  const prefix = attackResolution?.status === 'ready' ? attackResolution.evaluation.partyPrefix : getCombatPrefix(state, ruleset, player.id, combat.evaluation.requiredCombat);
  if (!prefix) return { code: 'INVALID_COMMAND', message: '隊伍戰力不足以討伐該目標。' };
  const participants = player.party.splice(0, prefix.slotCount);
  for (const slot of participants) {
    player.discardPile.push(slot.adventurerId);
    if (slot.equipmentId) player.discardPile.push(slot.equipmentId);
  }
  event(state, events, 'COMBAT_EVALUATED', `討伐需求為 ${combat.evaluation.requiredCombat}；套用規則：${combat.evaluation.appliedRules.map(({ moduleId, ruleId }) => `${moduleId}/${ruleId}`).join(', ') || 'none'}。`, commandId, { schemaVersion: 1, kind: 'combat-evaluation', evaluation: structuredClone(combat.evaluation) });
  if (attackResolution?.status === 'ready') {
    event(state, events, 'ATTACK_RESOLUTION_EVALUATED', `Attack resolution policy ${attackResolution.evaluation.policy.moduleId}/${attackResolution.evaluation.policy.policyId} fixed ${attackResolution.evaluation.damage.actualDamage} damage.`, commandId, { schemaVersion: 1, kind: 'attack-resolution', evaluation: structuredClone(attackResolution.evaluation) });
    const applied = applyEnemyTargetDamageEvaluation(state, ruleset, attackResolution.evaluation.damage, events);
    if (!applied.ok) return { code: 'INVALID_COMMAND', message: applied.error };
    if (!attackResolution.evaluation.damage.lethal) return undefined;
  }
  if (combat.evaluation.outcome.kind === 'remove-target') {
    return finishAttackAfterRewards(state, ruleset, { protocolVersion: 1, gameId: state.gameId, commandId, actorId: player.id, expectedRevision: state.revision, command }, events);
  }
  const rewards = evaluateCombatRewards(state, ruleset, player.id, command.targetId);
  if (rewards.status !== 'ready') return { code: 'INVALID_COMMAND', message: rewards.error };
  const pipeline = beginCombatRewardPipeline(state, ruleset, { protocolVersion: 1, gameId: state.gameId, commandId, actorId: player.id, expectedRevision: state.revision, command }, structuredClone(state), events, 0, rewards.evaluation, { controllerId: player.id, playerRefs: { recipient: player.id, defeatedBy: player.id }, cardRefs: { target: target.cardInstanceId } });
  if (pipeline.status === 'suspended') return undefined;
  if (pipeline.status !== 'completed') return { code: 'INVALID_COMMAND', message: pipeline.error ?? 'Combat reward policy failed.' };
  return finishAttackAfterRewards(state, ruleset, { protocolVersion: 1, gameId: state.gameId, commandId, actorId: player.id, expectedRevision: state.revision, command }, events);
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
  facts(state, player.id).purchasePowerSpent += cost;
  if (definition.type === 'adventurer') facts(state, player.id).adventurersRecruited += 1;
  if (definition.type === 'equipment') facts(state, player.id).equipmentBought += 1;
  if (definition.type === 'item') facts(state, player.id).itemsBought += 1;
  player.discardPile.push(command.cardId);
  event(state, events, 'CARD_ACQUIRED', `${player.name} 取得了 ${definition.name}。`, commandId);
  return undefined;
}

function refreshMarket(state: GameState, ruleset: Ruleset, player: PlayerState, command: Extract<GameCommand, { type: 'REFRESH_MARKET' }>, events: DomainEvent[], commandId: string): EngineError | undefined {
  const phaseError = requirePhase(state, ['purchase']);
  if (phaseError) return phaseError;
  if (player.turnMarketRefreshed) return { code: 'INVALID_COMMAND', message: '本回合已使用市場刷新。' };
  if (!player.hand.includes(command.discardCardId)) return { code: 'INVALID_COMMAND', message: '市場刷新必須棄置目前手牌。' };
  if (!command.refreshCardIds.length || command.refreshCardIds.length > 3 || new Set(command.refreshCardIds).size !== command.refreshCardIds.length) return { code: 'INVALID_COMMAND', message: '市場刷新卡牌集合無效。' };
  const rowZoneId = command.row === 'adventurer' ? baseZoneIds.adventurerRow : baseZoneIds.itemRow;
  const deckZoneId = command.row === 'adventurer' ? baseZoneIds.adventurerDeck : baseZoneIds.itemDeck;
  const row = getZone(state, rowZoneId);
  if (command.refreshCardIds.some((cardId) => !row.cardIds.includes(cardId))) return { code: 'INVALID_COMMAND', message: '市場刷新只能選擇指定公開列中的卡牌。' };
  removeFrom(player.hand, command.discardCardId);
  player.discardPile.push(command.discardCardId);
  for (const cardId of command.refreshCardIds) removeFrom(row.cardIds, cardId);
  const deck = getZone(state, deckZoneId);
  deck.cardIds = shuffle(state, [...deck.cardIds, ...command.refreshCardIds]);
  refillSupply(state, ruleset, command.row, events);
  player.turnMarketRefreshed = true;
  facts(state, player.id).marketRefreshed = true;
  event(state, events, 'MARKET_REFRESHED', `${player.name} 刷新了 ${command.row} 公開列。`, commandId);
  return undefined;
}

function finishRest(state: GameState, ruleset: Ruleset, player: PlayerState, events: DomainEvent[], commandId: string): void {
  player.discardPile.push(...player.hand, ...player.playArea);
  player.hand = [];
  player.playArea = [];
  player.turnPurchaseBonus = 0;
  player.turnPurchaseSpent = 0;
  player.turnCombatBonus = 0;
  player.turnMarketRefreshed = false;
  refillConfiguredSupplyRows(state, ruleset, events);
  attachTargets(state);
  drawCards(state, player.id, 5, events);
  event(state, events, 'REST_FINISHED', `${player.name} 完成休息。`, commandId);
}

function lifecycleBoundary(state: GameState, ruleset: Ruleset, point: 'turn-start' | 'turn-end' | 'phase-start' | 'phase-end' | 'game-start' | 'game-end-evaluation', actorId: string, events: DomainEvent[]): EngineError | undefined {
  const result = dispatchLifecycle(state, ruleset, { schemaVersion: 1, point, actorId, phase: state.phase }, { controllerId: actorId });
  events.push(...result.events);
  if (result.status !== 'completed') return { code: 'INVALID_COMMAND', message: `${point} lifecycle must complete within the current transition; ${result.error ?? result.reason ?? 'a suspension is not yet supported at this boundary'}.` };
  return undefined;
}

function endPhase(state: GameState, ruleset: Ruleset, player: PlayerState, command: Extract<GameCommand, { type: 'END_PHASE' }>, events: DomainEvent[], commandId: string): EngineError | undefined {
  if (command.phase !== state.phase) return { code: 'INVALID_COMMAND', message: '指令階段與目前階段不一致。' };
  const phaseEndError = lifecycleBoundary(state, ruleset, 'phase-end', player.id, events); if (phaseEndError) return phaseEndError;
  const next: Record<Exclude<Phase, 'rest'>, Phase> = { action1: 'combat', combat: 'action2', action2: 'purchase', purchase: 'rest' };
  if (state.phase === 'rest') {
    finishRest(state, ruleset, player, events, commandId);
    const turnEndError = lifecycleBoundary(state, ruleset, 'turn-end', player.id, events); if (turnEndError) return turnEndError;
    const bondError = maybeCompleteBonds(state, player, ruleset, events, commandId); if (bondError) return bondError;
    checkEnd(state, ruleset, events, commandId);
    if (state.status === 'finalRound' && state.endState?.finalRoundEndPlayerId === player.id) {
      state.status = 'finished';
      event(state, events, 'GAME_FINISHED', '目前輪次已完成，遊戲結束。', commandId);
      return lifecycleBoundary(state, ruleset, 'game-end-evaluation', player.id, events);
    }
    const following = nextSeat(state.players, player.id);
    state.activePlayerId = following.id; state.phase = 'action1'; state.turnFacts = createTurnFactLedger(following.id);
    if (following.id === state.startingPlayerId) state.round += 1;
    const turnStartError = lifecycleBoundary(state, ruleset, 'turn-start', following.id, events); if (turnStartError) return turnStartError;
    return lifecycleBoundary(state, ruleset, 'phase-start', following.id, events);
  }
  else {
    if (state.phase === 'combat' && !facts(state, player.id).combatResolved) facts(state, player.id).combatSkipped = true;
    state.phase = next[state.phase];
    event(state, events, 'PHASE_ENDED', `${player.name} 結束階段。`, commandId);
    return lifecycleBoundary(state, ruleset, 'phase-start', player.id, events);
  }
}

function reduceCommand(state: GameState, ruleset: Ruleset, envelope: CommandEnvelope, resolutionEnvelopes: readonly CommandEnvelope[], events: DomainEvent[], rollbackState: GameState, factStart: number): EngineError | undefined {
  const player = getPlayer(state, envelope.actorId);
  switch (envelope.command.type) {
    case 'PLAY_ADVENTURER': return playAdventurer(state, ruleset, player, envelope.command, events, envelope.commandId);
    case 'EQUIP_ITEM': return equipItem(state, ruleset, player, envelope.command, events, envelope.commandId);
    case 'USE_ITEM': return applyItem(state, ruleset, player, envelope, resolutionEnvelopes, events, rollbackState, factStart);
    case 'ATTACK_TARGET': return attackTarget(state, ruleset, player, envelope.command, events, envelope.commandId);
    case 'BUY_CARD': return buyCard(state, ruleset, player, envelope.command, events, envelope.commandId);
    case 'REFRESH_MARKET': return refreshMarket(state, ruleset, player, envelope.command, events, envelope.commandId);
    case 'SELECT_BONDS': return { code: 'INVALID_COMMAND', message: 'Bond setup commands are only valid during setup.' };
    case 'END_PHASE': return endPhase(state, ruleset, player, envelope.command, events, envelope.commandId);
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

function dispatchBondSetup(state: GameState, ruleset: Ruleset, envelope: CommandEnvelope): EngineResult {
  if (envelope.command.type !== 'SELECT_BONDS') return fail(state, 'INVALID_COMMAND', '必須先完成羈絆保留選擇。');
  const setup = state.bondSetup;
  if (!setup || setup.currentActorId !== envelope.actorId || state.activePlayerId !== envelope.actorId) return fail(state, 'NOT_AUTHORIZED', '目前不是此玩家的羈絆選擇。');
  const command = envelope.command;
  const offer = setup.offers[envelope.actorId] ?? [];
  if (command.offerId !== setup.offerId || command.bondIds.length !== 5 || new Set(command.bondIds).size !== 5 || command.bondIds.some((bondId) => !offer.includes(bondId) || !ruleset.registry.bonds.some(({ id }) => id === bondId))) return fail(state, 'INVALID_COMMAND', '羈絆選擇必須是本玩家 offer 中不重複的五張。');
  const nextState = structuredClone(state);
  const nextSetup = nextState.bondSetup!;
  const player = getPlayer(nextState, envelope.actorId);
  player.bonds = command.bondIds.map((bondId) => ({ bondId, completed: false }));
  nextSetup.completedPlayerIds.push(player.id);
  const events: DomainEvent[] = [];
  event(nextState, events, 'BONDS_SELECTED', `${player.name} 已保留五張羈絆。`, envelope.commandId);
  if (nextSetup.completedPlayerIds.length === nextState.players.length) {
    nextState.status = 'playing';
    nextState.activePlayerId = nextState.startingPlayerId;
    nextState.turnFacts = createTurnFactLedger(nextState.activePlayerId);
    delete nextState.bondSetup;
    event(nextState, events, 'BOND_SETUP_FINISHED', '所有玩家已完成羈絆設置。', envelope.commandId);
  } else {
    const next = nextSeat(nextState.players, player.id);
    nextSetup.currentActorId = next.id;
    nextState.activePlayerId = next.id;
    nextState.turnFacts = createTurnFactLedger(next.id);
  }
  nextState.revision += 1;
  nextState.eventLogCursor += events.length;
  return { state: nextState, events };
}

function dispatchInternal(state: GameState, ruleset: Ruleset, envelope: CommandEnvelope): EngineResult {
  const parsedEnvelope = CommandEnvelopeSchema.safeParse(envelope);
  if (!parsedEnvelope.success) return fail(state, 'INVALID_COMMAND', `Malformed command envelope: ${parsedEnvelope.error.issues[0]?.message ?? 'invalid input'}.`);
  envelope = parsedEnvelope.data;
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
    const pending = nextState.effectState.pendingCommand; const resumed = envelope.command.type === 'RESOLVE_EFFECT_CHOICE' ? resumeCombatRewardPipeline(nextState, ruleset, envelope.actorId, envelope.command.executionId, envelope.command.choiceId, envelope.command.optionId) : resumeCombatRewardCounterConsent(nextState, ruleset, envelope.actorId, envelope.command.requestId, counterConsentAction(envelope.command));
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
      if (!nextContinuation || nextContinuation.kind === 'team-overflow' || nextContinuation.kind === 'card-use-effect' || nextContinuation.kind === 'combat-reward') return fail(state, 'INVALID_COMMAND', 'Command-before continuation changed kind while suspended.');
      nextContinuation.events = structuredClone(events);
      if (continuation.envelope.command.type === 'USE_ITEM') nextContinuation.resolutionEnvelopes = resolutionEnvelopes;
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
      nextState.effectState.pendingChoice = { schemaVersion: 1, executionId, choiceId, actorId: envelope.actorId, options: Object.keys(optionCandidates).map((id) => ({ id, effect: { kind: 'modify-value', target: { kind: 'turn-combat-bonus', player: { kind: 'controller' } }, amount: 0 } })), remaining: [], context: { controllerId: envelope.actorId } };
      nextState.effectState.pendingCommand = { schemaVersion: 1, kind: 'team-overflow', envelope: structuredClone(envelope), events: structuredClone(events), rollbackState: structuredClone(rollback), policy: { moduleId: overflow.evaluation.policy.moduleId, policyId: overflow.evaluation.policy.policyId }, candidateIds: structuredClone(candidateIds), requiredSelectionCount: count, optionCandidates: structuredClone(optionCandidates), registry: structuredClone(overflow.evaluation.registry) };
      return { state: nextState, events };
    }
  }
  const factStart = events.length;
  const error = reduceCommand(nextState, ruleset, envelope, [], events, rollback, factStart);
  if (error) return { state, events: [], error };
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
