import type { ContentRegistry, EffectCardLocation, EffectContext, GameState } from '@guildmaster/game-protocol';
import { getPlayer } from '../model/factories.js';
import { getZone } from '../model/zones.js';

export type MoveFailure = { ok: false; code: 'CARD_NOT_FOUND' | 'SOURCE_MISMATCH' | 'UNKNOWN_ZONE' | 'HIDDEN_INFORMATION' | 'OWNERSHIP_VIOLATION' | 'INVALID_DESTINATION' | 'EQUIPMENT_RELATIONSHIP' | 'CARD_TYPE_MISMATCH'; message: string };
export type MoveSuccess = { ok: true; from: EffectCardLocation; to: EffectCardLocation };
export type MoveResult = MoveFailure | MoveSuccess;
export type MoveRequest = { cardInstanceId: string; from: EffectCardLocation; to: EffectCardLocation; actorId: string; context: EffectContext; registry: ContentRegistry; position?: 'top' | 'bottom' | number; permission?: 'controller-only' | 'system'; transferOwnership?: boolean };

function resolvePlayerId(ref: EffectCardLocation extends never ? never : import('@guildmaster/game-protocol').EffectPlayerRef, context: EffectContext): string | undefined {
  if (ref.kind === 'controller') return context.controllerId;
  if (ref.kind === 'player-id') return ref.playerId;
  return context.playerRefs?.[ref.key];
}
export function resolveCardId(ref: import('@guildmaster/game-protocol').EffectCardRef, context: EffectContext): string | undefined { return ref.kind === 'card-instance' ? ref.cardInstanceId : context.cardRefs?.[ref.key]; }
export function resolveLocation(location: EffectCardLocation, context: EffectContext): EffectCardLocation | undefined {
  if (location.kind === 'player-zone') { const playerId = resolvePlayerId(location.player, context); return playerId ? { ...location, player: { kind: 'player-id', playerId } } : undefined; }
  if (location.kind === 'party') { const playerId = resolvePlayerId(location.player, context); return playerId ? { ...location, player: { kind: 'player-id', playerId } } : undefined; }
  if (location.kind === 'equipment') { const playerId = resolvePlayerId(location.player, context); return playerId ? { ...location, player: { kind: 'player-id', playerId } } : undefined; }
  return location;
}
function sameLocation(left: EffectCardLocation, right: EffectCardLocation): boolean { return JSON.stringify(left) === JSON.stringify(right); }
export function isCardAtLocation(state: GameState, location: EffectCardLocation, cardId: string): boolean {
  if (location.kind === 'removed') return state.removedCards.includes(cardId);
  if (location.kind === 'shared-zone') return getZone(state, location.zoneId).cardIds.includes(cardId);
  const player = getPlayer(state, (location.player as { playerId: string }).playerId);
  if (location.kind === 'player-zone') return player[location.zone].includes(cardId);
  if (location.kind === 'party') return player.party[location.position]?.adventurerId === cardId;
  return player.party[location.partyPosition]?.equipmentId === cardId;
}
function remove(state: GameState, location: EffectCardLocation, cardId: string): void {
  if (location.kind === 'removed') { state.removedCards.splice(state.removedCards.indexOf(cardId), 1); return; }
  if (location.kind === 'shared-zone') { const cards = getZone(state, location.zoneId).cardIds; cards.splice(cards.indexOf(cardId), 1); return; }
  const player = getPlayer(state, (location.player as { playerId: string }).playerId);
  if (location.kind === 'player-zone') { const cards = player[location.zone]; cards.splice(cards.indexOf(cardId), 1); return; }
  if (location.kind === 'party') { player.party.splice(location.position, 1); return; }
  delete player.party[location.partyPosition]!.equipmentId;
}
function insert(state: GameState, location: EffectCardLocation, cardId: string, position: MoveRequest['position']): void {
  if (location.kind === 'removed') { state.removedCards.push(cardId); return; }
  if (location.kind === 'shared-zone') { const cards = getZone(state, location.zoneId).cardIds; if (position === 'top') cards.push(cardId); else if (typeof position === 'number') cards.splice(position, 0, cardId); else cards.unshift(cardId); return; }
  const player = getPlayer(state, (location.player as { playerId: string }).playerId);
  if (location.kind === 'player-zone') { const cards = player[location.zone]; if (position === 'top') cards.push(cardId); else if (typeof position === 'number') cards.splice(position, 0, cardId); else cards.unshift(cardId); return; }
  if (location.kind === 'party') { player.party.splice(location.position, 0, { adventurerId: cardId }); return; }
  player.party[location.partyPosition]!.equipmentId = cardId;
}
function ownerOf(location: EffectCardLocation): string | undefined { return location.kind === 'player-zone' || location.kind === 'party' || location.kind === 'equipment' ? (location.player as { playerId: string }).playerId : undefined; }

export function moveCard(state: GameState, request: MoveRequest): MoveResult {
  const card = state.cards[request.cardInstanceId]; if (!card) return { ok: false, code: 'CARD_NOT_FOUND', message: 'Unknown card instance.' };
  let from: EffectCardLocation; let to: EffectCardLocation;
  try { from = resolveLocation(request.from, request.context)!; to = resolveLocation(request.to, request.context)!; if (!from || !to) return { ok: false, code: 'INVALID_DESTINATION', message: 'Unresolved effect location.' }; if (from.kind === 'shared-zone') getZone(state, from.zoneId); if (to.kind === 'shared-zone') getZone(state, to.zoneId); } catch { return { ok: false, code: 'UNKNOWN_ZONE', message: 'Effect refers to an unknown shared zone.' }; }
  if (!isCardAtLocation(state, from, request.cardInstanceId)) return { ok: false, code: 'SOURCE_MISMATCH', message: 'Card is not in the declared source location.' };
  const sourceOwner = ownerOf(from); if (request.permission !== 'system' && sourceOwner && sourceOwner !== request.actorId) return { ok: false, code: 'OWNERSHIP_VIOLATION', message: 'Controller-only effect cannot move another player card.' };
  if (from.kind === 'shared-zone') { const zone = getZone(state, from.zoneId); if (zone.visibility === 'ownerOnly' && zone.ownerId !== request.actorId && request.permission !== 'system') return { ok: false, code: 'HIDDEN_INFORMATION', message: 'Actor cannot select a hidden shared-zone card.' }; }
  const definition = request.registry.definitions[card.definitionId]; if (!definition) return { ok: false, code: 'CARD_NOT_FOUND', message: 'Card definition is unavailable.' };
  if (from.kind === 'party' && getPlayer(state, sourceOwner!).party[from.position]?.equipmentId) return { ok: false, code: 'EQUIPMENT_RELATIONSHIP', message: 'Move attached equipment first to avoid a dangling relationship.' };
  if (to.kind === 'party' && !['adventurer', 'starter'].includes(definition.type)) return { ok: false, code: 'CARD_TYPE_MISMATCH', message: 'Only adventurer cards may enter a party slot.' };
  if (to.kind === 'equipment') { const target = getPlayer(state, ownerOf(to)!).party[to.partyPosition]; if (!target || target.equipmentId || definition.type !== 'equipment') return { ok: false, code: 'INVALID_DESTINATION', message: 'Equipment destination requires an empty existing party slot and equipment card.' }; }
  if (to.kind === 'player-zone' && to.zone === 'playArea' && definition.type !== 'item') return { ok: false, code: 'CARD_TYPE_MISMATCH', message: 'Only items may enter the item play area.' };
  if (sameLocation(from, to)) return { ok: true, from, to };
  remove(state, from, request.cardInstanceId); insert(state, to, request.cardInstanceId, request.position);
  const destinationOwner = ownerOf(to); if (request.transferOwnership && destinationOwner) card.ownerId = destinationOwner;
  return { ok: true, from, to };
}
