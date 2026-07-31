import type { GameState, PlayerView } from '@guildmaster/game-protocol';
import { getPlayer } from '../model/factories.js';
import { getPartyLimit, type Ruleset } from '../rules/ruleset.js';
import { validateSupplyContinuityState } from '../rules/supply-continuity-evaluator.js';

export function projectPlayerView(state: GameState, ruleset: Ruleset, viewerId: string): PlayerView {
  const continuityErrors = validateSupplyContinuityState(state, ruleset);
  if (continuityErrors.length) throw new Error(continuityErrors.join(' '));
  const player = getPlayer(state, viewerId);
  const { drawPile, ...visibleSelf } = structuredClone(player);
  const visibleZones = Object.fromEntries(Object.entries(state.zones).filter(([, zone]) => zone.visibility === 'public'));
  const visibleTargetIds = Object.values(state.enemyTargets).flatMap((target) => [target.cardInstanceId, ...target.attachments]);
  const visibleIds = new Set([...visibleSelf.hand, ...visibleSelf.discardPile, ...visibleSelf.playArea, ...visibleSelf.party.flatMap((slot) => [slot.adventurerId, ...(slot.equipmentId ? [slot.equipmentId] : [])]), ...Object.values(visibleZones).flatMap((zone) => zone.cardIds), ...visibleTargetIds]);
  const cards = Object.fromEntries(Object.entries(state.cards).filter(([id]) => visibleIds.has(id)));
  return {
    viewerId, gameId: state.gameId, status: state.status, phase: state.phase, round: state.round, revision: state.revision, activePlayerId: state.activePlayerId,
    self: { ...visibleSelf, drawPileCount: drawPile.length }, partyLimit: getPartyLimit(ruleset, state, player),
    opponents: state.players.filter((player) => player.id !== viewerId).map((player) => ({ id: player.id, name: player.name, handCount: player.hand.length, partyCount: player.party.length, discardCount: player.discardPile.length, defeatedBosses: player.history.defeatedBosses, counters: structuredClone(player.counters.filter(({ visibility }) => visibility === 'public')) })),
    ...(state.effectState.pendingCounterConsent ? { pendingCounterConsent: { requestId: state.effectState.pendingCounterConsent.requestId, policy: structuredClone(state.effectState.pendingCounterConsent.policy), counterOwnerId: state.effectState.pendingCounterConsent.counterOwnerId, requesterId: state.effectState.pendingCounterConsent.requesterId, requiredActorIds: [...state.effectState.pendingCounterConsent.requiredActorIds], acceptedActorIds: [...state.effectState.pendingCounterConsent.acceptedActorIds], status: 'pending' as const } } : {}),
    zones: structuredClone(visibleZones), enemyTargets: structuredClone(state.enemyTargets), cards, ...(state.endState ? { endState: structuredClone(state.endState) } : {})
  };
}
