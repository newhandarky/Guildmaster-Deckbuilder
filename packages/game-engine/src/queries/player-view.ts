import type { GameState, PlayerView } from '@guildmaster/game-protocol';
import { getPlayer } from '../model/factories.js';
import { getPartyLimit, validateRulesetStateCompatibility, type Ruleset } from '../rules/ruleset.js';
import { validateSupplyContinuityState } from '../rules/supply-continuity-evaluator.js';
import { evaluatePartyCombat } from '../rules/party-combat-modifier-evaluator.js';
import { evaluateCombat } from '../rules/combat-evaluator.js';
import { inspectContinuousPreviewUncertainty } from '../rules/continuous-evaluator.js';
import { attachedCardIds } from '../model/attachments.js';

function projectPublicParty(state: GameState, ruleset: Ruleset, player: GameState['players'][number]) {
  const combat = evaluatePartyCombat(state, ruleset, { schemaVersion: 1, playerId: player.id });
  if (combat.status !== 'ready') throw new Error(`Cannot project public party combat: ${combat.error}`);
  return combat.evaluation.members.map(({ adventurerId, equipmentId, equipmentIds, effectiveCombat }) => ({ adventurerId, ...(equipmentId ? { equipmentId } : {}), ...(equipmentIds?.length ? { equipmentIds: [...equipmentIds] } : {}), effectiveCombat }));
}

export function projectPlayerView(state: GameState, ruleset: Ruleset, viewerId: string): PlayerView {
  const compatibility = validateRulesetStateCompatibility(state, ruleset);
  if (compatibility) throw new Error(compatibility);
  const continuityErrors = validateSupplyContinuityState(state, ruleset);
  if (continuityErrors.length) throw new Error(continuityErrors.join(' '));
  const player = getPlayer(state, viewerId);
  const { drawPile, ...visibleSelf } = structuredClone(player);
  const visibleZones = Object.fromEntries(Object.entries(state.zones).filter(([, zone]) => zone.visibility === 'public'));
  const visibleTargetIds = Object.values(state.enemyTargets).flatMap((target) => [target.cardInstanceId, ...target.attachments]);
  const opponentParties = new Map(state.players.filter((candidate) => candidate.id !== viewerId).map((candidate) => [candidate.id, projectPublicParty(state, ruleset, candidate)]));
  const privateOrderCardIds = state.effectState.pendingChoice?.actorId === viewerId ? state.effectState.pendingChoice.order?.cardIds ?? [] : [];
  const visibleIds = new Set([...visibleSelf.hand, ...visibleSelf.discardPile, ...visibleSelf.playArea, ...visibleSelf.party.flatMap((slot) => [slot.adventurerId, ...attachedCardIds(slot)]), ...[...opponentParties.values()].flatMap((party) => party.flatMap((slot) => [slot.adventurerId, ...(slot.equipmentIds ?? (slot.equipmentId ? [slot.equipmentId] : []))])), ...Object.values(visibleZones).flatMap((zone) => zone.cardIds), ...visibleTargetIds, ...privateOrderCardIds]);
  const cards = Object.fromEntries(Object.entries(state.cards).filter(([id]) => visibleIds.has(id)).map(([id, card]) => [id, { id: card.id, definitionId: card.definitionId }]));
  const choice = state.effectState.pendingChoice;
  const kind = choice?.actorId === viewerId ? choice.decisionKind : undefined;
  const combatObservesHiddenInformation = inspectContinuousPreviewUncertainty(state, ruleset, viewerId).observesHiddenInformation;
  const publicTargets = Object.fromEntries(Object.entries(state.enemyTargets).map(([targetId, target]) => {
    const definition = ruleset.registry.definitions[state.cards[target.cardInstanceId]?.definitionId ?? ''];
    if (definition?.combat === undefined || combatObservesHiddenInformation) return [targetId, structuredClone(target)];
    const combat = evaluateCombat(state, ruleset, state.activePlayerId, targetId);
    if (combat.status !== 'ready') throw new Error(`Cannot project public enemy combat: ${combat.reason}: ${combat.error}`);
    return [targetId, { ...structuredClone(target), effectiveCombat: combat.evaluation.requiredCombat, combatEligible: combat.evaluation.eligible, combatRestrictionReasonCodes: [...combat.evaluation.restrictionReasonCodes], equipmentSuppressed: combat.evaluation.equipmentSuppressed, equipmentSuppressionReasonCodes: [...combat.evaluation.equipmentSuppressionReasonCodes], ...(combat.evaluation.maximumPartySlots ? { maximumPartySlots: combat.evaluation.maximumPartySlots } : {}), ...(combat.evaluation.participantLimitReasonCode ? { participantLimitReasonCode: combat.evaluation.participantLimitReasonCode } : {}) }];
  }));
  return {
    viewerId, gameId: state.gameId, status: state.status, phase: state.phase, round: state.round, revision: state.revision, activePlayerId: state.activePlayerId,
    self: { ...visibleSelf, drawPileCount: drawPile.length }, partyLimit: getPartyLimit(ruleset, state, player),
    opponents: state.players.filter((candidate) => candidate.id !== viewerId).map((candidate) => {
      const party = opponentParties.get(candidate.id)!;
      return { id: candidate.id, name: candidate.name, kind: candidate.kind, seatIndex: state.players.findIndex(({ id }) => id === candidate.id), isActive: candidate.id === state.activePlayerId, handCount: candidate.hand.length, partyCount: candidate.party.length, discardCount: candidate.discardPile.length, partyCombat: party.reduce((sum, member) => sum + member.effectiveCombat, 0), party, defeatedBosses: candidate.history.defeatedBosses, defeatedMonsters: candidate.history.defeatedMonsters, bonds: structuredClone(candidate.bonds.filter(({ completed }) => completed)), counters: structuredClone(candidate.counters.filter(({ visibility }) => visibility === 'public')) };
    }),
    ...(state.bondSetup ? { bondSetup: { schemaVersion: 1 as const, offerId: state.bondSetup.offerId, currentActorId: state.bondSetup.currentActorId, ...(state.bondSetup.currentActorId === viewerId ? { offeredBondIds: [...state.bondSetup.offers[viewerId]!] } : {}), completedPlayerIds: [...state.bondSetup.completedPlayerIds] } } : {}),
    ...(choice?.actorId === viewerId && kind ? { decisionPrompt: { schemaVersion: 1 as const, decisionKind: kind, choiceId: choice.choiceId, minSelections: 1, maxSelections: 1, options: choice.order ? choice.order.cardIds.map((id) => ({ id, cardId: id, definitionId: state.cards[id]!.definitionId })) : choice.options.map(({ id }) => ({ id, ...(state.cards[id] ? { cardId: id, definitionId: state.cards[id]!.definitionId } : {}) })), ...(choice.order ? { order: { kind: choice.order.kind ?? 'player-deck-top' as const, cardIds: [...choice.order.cardIds], mayRemove: choice.order.mayRemove } } : {}) } } : {}),
    ...(state.effectState.pendingCounterConsent ? { pendingCounterConsent: { requestId: state.effectState.pendingCounterConsent.requestId, policy: structuredClone(state.effectState.pendingCounterConsent.policy), counterOwnerId: state.effectState.pendingCounterConsent.counterOwnerId, requesterId: state.effectState.pendingCounterConsent.requesterId, requiredActorIds: [...state.effectState.pendingCounterConsent.requiredActorIds], acceptedActorIds: [...state.effectState.pendingCounterConsent.acceptedActorIds], status: 'pending' as const } } : {}),
    zones: structuredClone(visibleZones), enemyTargets: publicTargets, cards, ...(state.endState ? { endState: structuredClone(state.endState) } : {})
  };
}
