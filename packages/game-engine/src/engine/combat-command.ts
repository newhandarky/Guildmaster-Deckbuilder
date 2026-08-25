import type { CommandEnvelope, DomainEvent, EngineError, GameCommand, GameState, PlayerState } from '@guildmaster/game-protocol';
import { attachedCardIds, setAttachedCardIds } from '../model/attachments.js';
import { getDefinition, getPlayer } from '../model/factories.js';
import { baseZoneIds, getZone } from '../model/zones.js';
import { getCombatPrefix } from '../queries/legal-commands.js';
import { evaluateAttackResolution } from '../rules/attack-resolution-evaluator.js';
import { evaluateCombatDepartureReplacements, legalCombatDepartureReplacementSelections } from '../rules/combat-departure-replacement-evaluator.js';
import { evaluateCombat } from '../rules/combat-evaluator.js';
import { evaluateCombatAssist } from '../rules/combat-assist-evaluator.js';
import { evaluateCombatParticipantDeparture } from '../rules/combat-participant-departure-evaluator.js';
import { evaluateCombatRewards } from '../rules/combat-reward-evaluator.js';
import { pushDiscard } from '../rules/discard-redirect-evaluator.js';
import { disposeEnemyAttachments } from '../rules/enemy-attachment-evaluator.js';
import { evaluateEquipmentDeparture } from '../rules/equipment-departure-evaluator.js';
import type { Ruleset } from '../rules/ruleset.js';
import { evaluateMonsterDefeatContinuity, validateSupplyContinuityState } from '../rules/supply-continuity-evaluator.js';
import { checkEndConditions } from './bond-completion.js';
import { beginCombatRewardPipeline } from './combat-reward-pipeline.js';
import { applyCombatParticipantDeparture } from './combat-participant-departure.js';
import { createTurnFactLedger } from './create-game.js';
import { drawCards } from './draw.js';
import { applyEnemyTargetDamageEvaluation, defeatEnemyTarget, removeEnemyTarget } from './encounter-resolution.js';
import { refillSupply } from './supply.js';
import { attachTargets } from './target-supply.js';

const removeFrom = <T>(items: T[], item: T): boolean => { const index = items.indexOf(item); if (index < 0) return false; items.splice(index, 1); return true; };
const facts = (state: GameState, playerId: string) => { if (!state.turnFacts || state.turnFacts.playerId !== playerId) state.turnFacts = createTurnFactLedger(playerId); return state.turnFacts; };
const event = (state: GameState, events: DomainEvent[], type: string, message: string, commandId?: string, payload?: DomainEvent['payload']): void => { events.push({ eventId: `event-${state.revision + 1}-${events.length + 1}`, revision: state.revision + 1, type, message, ...(commandId ? { causedByCommandId: commandId } : {}), ...(payload ? { payload } : {}) }); };
const fixedCombatOutcome = (events: readonly DomainEvent[]): 'defeat-target' | 'remove-target' | undefined => { const payload = events.find((entry) => entry.type === 'COMBAT_EVALUATED')?.payload; return payload?.kind === 'combat-evaluation' ? payload.evaluation.outcome.kind : undefined; };
const fixedAttackResolution = (events: readonly DomainEvent[]): import('@guildmaster/game-protocol').AttackResolutionEvaluation | undefined => { const payload = events.find((entry) => entry.type === 'ATTACK_RESOLUTION_EVALUATED')?.payload; return payload?.kind === 'attack-resolution' ? payload.evaluation : undefined; };

function finalizeAttackTarget(state: GameState, ruleset: Ruleset, player: PlayerState, targetId: string, outcome: 'defeat-target' | 'remove-target', events: DomainEvent[], commandId: string): EngineError | undefined {
  const target = state.enemyTargets[targetId];
  if (!target || target.status !== 'available') return { code: 'INVALID_COMMAND', message: 'Combat target disappeared before final disposition.' };
  const definition = getDefinition(ruleset.registry, state, target.cardInstanceId);
  const encounter = target.parentEncounterId ? state.enemyEncounters.find(({ encounterId }) => encounterId === target.parentEncounterId) : undefined;
  const monsterContinuity = target.kind === 'monster' ? evaluateMonsterDefeatContinuity(state, ruleset, targetId, outcome) : undefined;
  if (monsterContinuity?.status === 'failed') return { code: 'INVALID_COMMAND', message: `${monsterContinuity.reason}: ${monsterContinuity.error}` };
  if (encounter?.resolutionPolicy) {
    const resolution = outcome === 'remove-target' ? removeEnemyTarget(state, ruleset, { kind: 'remove-enemy-target', targetId, policy: encounter.resolutionPolicy }, events) : defeatEnemyTarget(state, ruleset, { kind: 'defeat-enemy-target', targetId, policy: encounter.resolutionPolicy }, events);
    if (!resolution.ok) return { code: 'INVALID_COMMAND', message: resolution.error };
  } else {
    if (target.zoneId) removeFrom(getZone(state, target.zoneId).cardIds, target.cardInstanceId);
    if (outcome === 'remove-target') { target.status = 'removed'; state.removedCards.push(target.cardInstanceId); event(state, events, 'ENEMY_REMOVED', `${definition.name} 的討伐結果被替代為移出遊戲。`, commandId); }
    else { target.status = 'defeated'; if (monsterContinuity?.status === 'ready' && monsterContinuity.recycle) getZone(state, baseZoneIds.monsterDeck).cardIds.unshift(target.cardInstanceId); else player.discardPile.push(target.cardInstanceId); }
  }
  return undefined;
}

function refillAttackTargetSupply(state: GameState, ruleset: Ruleset, targetKind: string, events: DomainEvent[]): EngineError | undefined {
  if (targetKind === 'monster' || targetKind === 'boss') { try { refillSupply(state, ruleset, targetKind, events); attachTargets(state, ruleset); } catch (error) { return { code: 'INVALID_COMMAND', message: error instanceof Error ? error.message : `${targetKind} supply refill failed.` }; } }
  if (targetKind === 'monster') { const continuityErrors = validateSupplyContinuityState(state, ruleset); if (continuityErrors.length) return { code: 'INVALID_COMMAND', message: continuityErrors.join(' ') }; }
  return undefined;
}

export function finishAttackAfterRewards(state: GameState, ruleset: Ruleset, envelope: CommandEnvelope, events: DomainEvent[]): EngineError | undefined {
  const player = getPlayer(state, envelope.actorId); const targetId = (envelope.command as Extract<GameCommand, { type: 'ATTACK_TARGET' }>).targetId; const target = state.enemyTargets[targetId];
  if (!target) return { code: 'INVALID_COMMAND', message: 'Combat reward target disappeared.' };
  if (events.some(({ type }) => type === 'COMBAT_FAILED')) { if (target.status !== 'available') return { code: 'INVALID_COMMAND', message: 'Failed combat target must remain available.' }; return undefined; }
  const outcome = fixedCombatOutcome(events);
  if (!outcome) return { code: 'INVALID_COMMAND', message: 'Committed combat evaluation is missing.' };
  const attackResolution = fixedAttackResolution(events); let terminalStatus: 'defeated' | 'removed';
  if (attackResolution) { const expectedStatus = attackResolution.damage.input.lethalOutcome ?? 'defeated'; if (!attackResolution.damage.lethal || target.status !== expectedStatus || target.health?.current !== 0) return { code: 'INVALID_COMMAND', message: 'Committed health-target attack resolution is incomplete or inconsistent.' }; terminalStatus = expectedStatus; }
  else { const error = finalizeAttackTarget(state, ruleset, player, targetId, outcome, events, envelope.commandId); if (error) return error; terminalStatus = outcome === 'remove-target' ? 'removed' : 'defeated'; }
  if (terminalStatus === 'defeated') disposeEnemyAttachments(state, ruleset, target, player); else for (const cardId of target.attachments.splice(0)) { delete state.cards[cardId]!.ownerId; state.removedCards.push(cardId); }
  const refillError = refillAttackTargetSupply(state, ruleset, target.kind, events); if (refillError) return refillError;
  if (terminalStatus === 'removed') return undefined;
  const definition = getDefinition(ruleset.registry, state, target.cardInstanceId);
  if (target.kind === 'boss') { player.history.defeatedBosses += 1; facts(state, player.id).bossesDefeated += 1; } else { player.history.defeatedMonsters += 1; facts(state, player.id).monstersDefeated += 1; }
  facts(state, player.id).combatResolved = true; event(state, events, 'ENEMY_DEFEATED', `${player.name} 討伐了 ${definition.name}。`, envelope.commandId); checkEndConditions(state, ruleset, events, envelope.commandId); return undefined;
}

export function attackTarget(state: GameState, ruleset: Ruleset, player: PlayerState, envelope: CommandEnvelope & { command: Extract<GameCommand, { type: 'ATTACK_TARGET' }> }, events: DomainEvent[], rollbackState: GameState, selectedReplacementIds?: readonly string[]): EngineError | undefined {
  const command = envelope.command; const commandId = envelope.commandId;
  if (state.phase !== 'combat') return { code: 'INVALID_COMMAND', message: `目前是 ${state.phase}，無法執行此操作。` };
  const target = state.enemyTargets[command.targetId];
  if (!target || target.status !== 'available') return { code: 'INVALID_COMMAND', message: '該敵方目標不可討伐。' };
  const encounter = target.parentEncounterId ? state.enemyEncounters.find(({ encounterId }) => encounterId === target.parentEncounterId) : undefined;
  if (encounter?.status === 'finished') return { code: 'INVALID_COMMAND', message: '該敵方 encounter 已完成。' };
  const assist = command.combatAssistCardId ? evaluateCombatAssist(state, ruleset, player.id, command.targetId, command.combatAssistCardId) : undefined;
  if (command.combatAssistCardId && !assist) return { code: 'INVALID_COMMAND', message: '該戰鬥支援目前無法用於此目標。' };
  const attackResolution = target.health ? evaluateAttackResolution(state, ruleset, { schemaVersion: 1, playerId: player.id, targetId: command.targetId, registry: { rulesetVersion: state.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) } }) : undefined;
  if (attackResolution && attackResolution.status !== 'ready') return { code: 'INVALID_COMMAND', message: `${attackResolution.reason}: ${attackResolution.error}` };
  const combat = assist ? { status: 'ready' as const, evaluation: assist.combat } : attackResolution?.status === 'ready' ? { status: 'ready' as const, evaluation: attackResolution.evaluation.combat } : evaluateCombat(state, ruleset, player.id, command.targetId);
  if (combat.status !== 'ready') return { code: 'INVALID_COMMAND', message: combat.error };
  if (!combat.evaluation.eligible) return { code: 'INVALID_COMMAND', message: `該敵方目標受到討伐限制：${combat.evaluation.restrictionReasonCodes.join(', ')}。` };
  if (!target.health && target.kind === 'monster') { const continuity = evaluateMonsterDefeatContinuity(state, ruleset, target.targetId, combat.evaluation.outcome.kind); if (continuity.status !== 'ready') return { code: 'INVALID_COMMAND', message: `${continuity.reason}: ${continuity.error}` }; }
  const prefix = assist?.partyPrefix ?? (attackResolution?.status === 'ready' ? attackResolution.evaluation.partyPrefix : getCombatPrefix(state, ruleset, player.id, combat.evaluation.requiredCombat, command.targetId, combat.evaluation.maximumPartySlots, combat.evaluation.equipmentSuppressed));
  if (!prefix) return { code: 'INVALID_COMMAND', message: '隊伍戰力不足以討伐該目標。' };
  const participantPreview = player.party.slice(0, prefix.slotCount);
  const participantDeparture = evaluateCombatParticipantDeparture(state, ruleset, { schemaVersion: 1, playerId: player.id, targetId: command.targetId, participantCardIds: participantPreview.map(({ adventurerId }) => adventurerId) });
  if (participantDeparture.status !== 'ready') return { code: 'INVALID_COMMAND', message: `${participantDeparture.reason}: ${participantDeparture.error}` };
  const equipmentDepartures = new Map<string, ReturnType<typeof evaluateEquipmentDeparture>>();
  for (const slot of participantPreview) {
    if (combat.evaluation.equipmentSuppressed) continue;
    for (const attachmentId of attachedCardIds(slot)) { const departure = evaluateEquipmentDeparture(state, ruleset, { schemaVersion: 1, playerId: player.id, adventurerId: slot.adventurerId, equipmentCardId: attachmentId, cause: 'combat-discard' }); if (departure.status !== 'ready') return { code: 'INVALID_COMMAND', message: `${departure.reason}: ${departure.error}` }; equipmentDepartures.set(attachmentId, departure); }
  }
  const replacements = evaluateCombatDepartureReplacements(state, ruleset, player.id, participantDeparture.evaluation);
  if (replacements.status !== 'ready') return { code: 'INVALID_COMMAND', message: replacements.error };
  if (selectedReplacementIds === undefined && replacements.candidates.length) {
    if (replacements.candidates.length > 8) return { code: 'INVALID_COMMAND', message: 'Combat departure replacement choice exceeds the supported option budget.' };
    const optionCandidateIds = Object.fromEntries(legalCombatDepartureReplacementSelections(state, player.id, replacements.candidates).map((ids, index) => [`departure-${index}`, ids])); const executionId = `combat-departure:${commandId}`; const choiceId = 'combat-departure:optional-replacements';
    state.effectState.pendingChoice = { schemaVersion: 1, executionId, choiceId, decisionKind: 'choose-party-member', actorId: player.id, options: Object.keys(optionCandidateIds).map((id) => ({ id, effect: { kind: 'modify-value', target: { kind: 'turn-combat-bonus', player: { kind: 'controller' } }, amount: 0 } })), remaining: [], context: { controllerId: player.id } };
    state.effectState.pendingCommand = { schemaVersion: 1, kind: 'combat-departure-choice', envelope: structuredClone(envelope), events: structuredClone(events), rollbackState: structuredClone(rollbackState), candidates: structuredClone(replacements.candidates), optionCandidateIds: structuredClone(optionCandidateIds), registry: structuredClone(replacements.registry) }; return undefined;
  }
  const selectedIds = new Set(selectedReplacementIds ?? []);
  if ([...selectedIds].some((id) => !replacements.candidates.some(({ candidateId }) => candidateId === id))) return { code: 'INVALID_COMMAND', message: 'Combat departure replacement selection is no longer valid.' };
  if (!legalCombatDepartureReplacementSelections(state, player.id, replacements.candidates).some((ids) => ids.length === selectedIds.size && ids.every((id) => selectedIds.has(id)))) return { code: 'INVALID_COMMAND', message: 'Combat departure replacement selection exceeds its shared usage limit.' };
  const selectedCandidates = replacements.candidates.filter(({ candidateId }) => selectedIds.has(candidateId)); const participants = player.party.splice(0, prefix.slotCount); const turnFacts = facts(state, player.id);
  turnFacts.lastCombatParticipantCount = participants.length;
  const preservedSlots: typeof participants = []; const preservedAdventurerIds = new Set<string>(); const normalParticipantIds: string[] = [];
  for (const slot of participants) {
    const replacement = selectedCandidates.find(({ adventurerId }) => adventurerId === slot.adventurerId);
    if (!replacement) { normalParticipantIds.push(slot.adventurerId); continue; }
    if (replacement.usage) {
      const uses = turnFacts.effectUses ?? (turnFacts.effectUses = {});
      const current = uses[replacement.usage.usageId] ?? 0;
      if (current >= replacement.usage.maxUses) return { code: 'INVALID_COMMAND', message: `Combat departure replacement use limit reached: ${replacement.usage.usageId}.` };
      uses[replacement.usage.usageId] = current + 1;
    }
    if (replacement.replacement.kind === 'self-to-player-draw-top') { player.drawPile.push(slot.adventurerId); event(state, events, 'COMBAT_DEPARTURE_REPLACED', `${getDefinition(ruleset.registry, state, slot.adventurerId).name} 改置於玩家牌庫頂（${replacement.reasonCode}）。`, commandId); continue; }
    if (replacement.replacement.kind === 'keep-self-in-party') {
      preservedAdventurerIds.add(slot.adventurerId); preservedSlots.push(slot);
      event(state, events, 'COMBAT_DEPARTURE_REPLACED', `${getDefinition(ruleset.registry, state, slot.adventurerId).name} 保留在隊伍中（${replacement.reasonCode}）。`, commandId);
      continue;
    }
    const attachmentCardId = replacement.attachmentCardId;
    if (!attachmentCardId || !attachedCardIds(slot).includes(attachmentCardId)) return { code: 'INVALID_COMMAND', message: 'Combat departure substitute attachment disappeared.' };
    preservedAdventurerIds.add(slot.adventurerId); setAttachedCardIds(slot, attachedCardIds(slot).filter((cardId) => cardId !== attachmentCardId)); preservedSlots.push(slot); pushDiscard(state, ruleset, player.id, attachmentCardId);
    event(state, events, 'COMBAT_DEPARTURE_REPLACED', `${getDefinition(ruleset.registry, state, attachmentCardId).name} 代替參戰冒險者棄置（${replacement.reasonCode}）。`, commandId);
  }
  const normallyDepartingSlots = participants.filter(({ adventurerId }) => normalParticipantIds.includes(adventurerId));
  turnFacts.lastCombatDiscardedEquipment = normallyDepartingSlots.flatMap(attachedCardIds).filter((cardId) => getDefinition(ruleset.registry, state, cardId).type === 'equipment').length;
  turnFacts.lastCombatDiscardedNonStarterProfessions = [...new Set(normallyDepartingSlots.flatMap(({ adventurerId }) => { const definition = getDefinition(ruleset.registry, state, adventurerId); return definition.type === 'starter' ? [] : (definition.tags ?? []).filter((tag) => tag.startsWith('profession:')); }))];
  player.party.unshift(...preservedSlots); applyCombatParticipantDeparture(state, player, normalParticipantIds, participantDeparture.evaluation, events, commandId);
  if (assist) {
    const sourceIndex = player.party.findIndex(({ adventurerId }) => adventurerId === assist.sourceCardId);
    if (sourceIndex < 0) return { code: 'INVALID_COMMAND', message: '戰鬥支援者在結算前已離開隊伍。' };
    const [source] = player.party.splice(sourceIndex, 1);
    for (const cardId of attachedCardIds(source!)) pushDiscard(state, ruleset, player.id, cardId);
    state.removedCards.push(assist.sourceCardId);
    event(state, events, 'COMBAT_ASSIST_APPLIED', `${getDefinition(ruleset.registry, state, assist.sourceCardId).name} 將討伐需求減半後移出遊戲（${assist.policy.reasonCode}）。`, commandId);
  }
  for (const slot of participants) {
    if (preservedAdventurerIds.has(slot.adventurerId)) continue;
    for (const attachmentId of attachedCardIds(slot)) {
      const departure = equipmentDepartures.get(attachmentId);
      if (departure?.status === 'ready' && departure.evaluation.disposition === 'remove-from-game') { state.removedCards.push(attachmentId); event(state, events, 'EQUIPMENT_REMOVED_FROM_GAME', `${getDefinition(ruleset.registry, state, attachmentId).name} 因配戴者在戰鬥中棄置而移出遊戲（${departure.evaluation.reasonCode}）。`, commandId); } else player.discardPile.push(attachmentId);
      if (departure?.status === 'ready') for (const reward of departure.evaluation.rewards) { if (reward.kind === 'draw') drawCards(state, player.id, reward.count, events); event(state, events, 'EQUIPMENT_DEPARTURE_REWARD_GRANTED', `裝備離場效果已執行（${departure.evaluation.reasonCode}）。`, commandId); }
    }
  }
  event(state, events, 'COMBAT_EVALUATED', `討伐需求為 ${combat.evaluation.requiredCombat}；套用規則：${combat.evaluation.appliedRules.map(({ moduleId, ruleId }) => `${moduleId}/${ruleId}`).join(', ') || 'none'}。`, commandId, { schemaVersion: 1, kind: 'combat-evaluation', evaluation: structuredClone(combat.evaluation) });
  if (attackResolution?.status === 'ready') { event(state, events, 'ATTACK_RESOLUTION_EVALUATED', `Attack resolution policy ${attackResolution.evaluation.policy.moduleId}/${attackResolution.evaluation.policy.policyId} fixed ${attackResolution.evaluation.damage.actualDamage} damage.`, commandId, { schemaVersion: 1, kind: 'attack-resolution', evaluation: structuredClone(attackResolution.evaluation) }); const applied = applyEnemyTargetDamageEvaluation(state, ruleset, attackResolution.evaluation.damage, events); if (!applied.ok) return { code: 'INVALID_COMMAND', message: applied.error }; if (!attackResolution.evaluation.damage.lethal) return undefined; }
  if (combat.evaluation.outcome.kind === 'remove-target') return finishAttackAfterRewards(state, ruleset, { protocolVersion: 1, gameId: state.gameId, commandId, actorId: player.id, expectedRevision: state.revision, command }, events);
  const rewards = evaluateCombatRewards(state, ruleset, player.id, command.targetId); if (rewards.status !== 'ready') return { code: 'INVALID_COMMAND', message: rewards.error };
  const attackerIndex = state.players.findIndex(({ id }) => id === player.id); const seatOrder = Array.from({ length: state.players.length }, (_, offset) => state.players[(attackerIndex + offset) % state.players.length]!.id);
  const pipeline = beginCombatRewardPipeline(state, ruleset, { protocolVersion: 1, gameId: state.gameId, commandId, actorId: player.id, expectedRevision: state.revision, command }, structuredClone(state), events, 0, rewards.evaluation, { controllerId: player.id, playerRefs: { recipient: player.id, defeatedBy: player.id, leftPlayer: seatOrder[1] ?? player.id, ...Object.fromEntries(Array.from({ length: 4 }, (_, index) => [`draftPlayer${index}`, seatOrder[index] ?? seatOrder.at(-1)!])) }, cardRefs: { target: target.cardInstanceId } });
  if (pipeline.status === 'suspended') return undefined;
  if (pipeline.status !== 'completed') return { code: 'INVALID_COMMAND', message: pipeline.error ?? 'Combat reward policy failed.' };
  return finishAttackAfterRewards(state, ruleset, { protocolVersion: 1, gameId: state.gameId, commandId, actorId: player.id, expectedRevision: state.revision, command }, events);
}
