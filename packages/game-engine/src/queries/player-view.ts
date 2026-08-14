import type { GameState, PlayerView } from '@guildmaster/game-protocol';
import { getPlayer } from '../model/factories.js';
import { getPartyLimit, validateRulesetStateCompatibility, type Ruleset } from '../rules/ruleset.js';
import { validateSupplyContinuityState } from '../rules/supply-continuity-evaluator.js';

export function projectPlayerView(state: GameState, ruleset: Ruleset, viewerId: string): PlayerView {
  const compatibility = validateRulesetStateCompatibility(state, ruleset);
  if (compatibility) throw new Error(compatibility);
  const continuityErrors = validateSupplyContinuityState(state, ruleset);
  if (continuityErrors.length) throw new Error(continuityErrors.join(' '));
  const player = getPlayer(state, viewerId);
  const { drawPile, ...visibleSelf } = structuredClone(player);
  const visibleZones = Object.fromEntries(Object.entries(state.zones).filter(([, zone]) => zone.visibility === 'public'));
  const visibleTargetIds = Object.values(state.enemyTargets).flatMap((target) => [target.cardInstanceId, ...target.attachments]);
  const visibleIds = new Set([...visibleSelf.hand, ...visibleSelf.discardPile, ...visibleSelf.playArea, ...visibleSelf.party.flatMap((slot) => [slot.adventurerId, ...(slot.equipmentId ? [slot.equipmentId] : [])]), ...Object.values(visibleZones).flatMap((zone) => zone.cardIds), ...visibleTargetIds]);
  const cards = Object.fromEntries(Object.entries(state.cards).filter(([id]) => visibleIds.has(id)));
  const choice = state.effectState.pendingChoice;
  const kind = choice?.actorId === viewerId ? choice.decisionKind : undefined;
  return {
    viewerId, gameId: state.gameId, status: state.status, phase: state.phase, round: state.round, revision: state.revision, activePlayerId: state.activePlayerId,
    self: { ...visibleSelf, drawPileCount: drawPile.length }, partyLimit: getPartyLimit(ruleset, state, player),
    opponents: state.players.filter((candidate) => candidate.id !== viewerId).map((candidate) => ({ id: candidate.id, name: candidate.name, kind: candidate.kind, seatIndex: state.players.findIndex(({ id }) => id === candidate.id), isActive: candidate.id === state.activePlayerId, handCount: candidate.hand.length, partyCount: candidate.party.length, discardCount: candidate.discardPile.length, defeatedBosses: candidate.history.defeatedBosses, defeatedMonsters: candidate.history.defeatedMonsters, bonds: structuredClone(candidate.bonds), counters: structuredClone(candidate.counters.filter(({ visibility }) => visibility === 'public')) })),
    ...(state.bondSetup ? { bondSetup: { schemaVersion: 1 as const, offerId: state.bondSetup.offerId, currentActorId: state.bondSetup.currentActorId, ...(state.bondSetup.currentActorId === viewerId ? { offeredBondIds: [...state.bondSetup.offers[viewerId]!] } : {}), completedPlayerIds: [...state.bondSetup.completedPlayerIds] } } : {}),
    ...(choice?.actorId === viewerId && kind ? { decisionPrompt: { schemaVersion: 1 as const, decisionKind: kind, choiceId: choice.choiceId, minSelections: 1, maxSelections: 1, options: choice.options.map(({ id }) => ({ id, ...(state.cards[id] ? { cardId: id, definitionId: state.cards[id]!.definitionId } : {}) })) } } : {}),
    ...(state.effectState.pendingCounterConsent ? { pendingCounterConsent: { requestId: state.effectState.pendingCounterConsent.requestId, policy: structuredClone(state.effectState.pendingCounterConsent.policy), counterOwnerId: state.effectState.pendingCounterConsent.counterOwnerId, requesterId: state.effectState.pendingCounterConsent.requesterId, requiredActorIds: [...state.effectState.pendingCounterConsent.requiredActorIds], acceptedActorIds: [...state.effectState.pendingCounterConsent.acceptedActorIds], status: 'pending' as const } } : {}),
    zones: structuredClone(visibleZones), enemyTargets: structuredClone(state.enemyTargets), cards, ...(state.endState ? { endState: structuredClone(state.endState) } : {})
  };
}
