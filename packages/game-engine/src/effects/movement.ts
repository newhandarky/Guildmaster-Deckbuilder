import type { ContentRegistry, EffectCardLocation, EffectConcreteCardLocation, EffectContext, GameState } from '@guildmaster/game-protocol';
import { getPlayer } from '../model/factories.js';
import { getZone } from '../model/zones.js';

export type MoveFailure = { ok: false; code: 'CARD_NOT_FOUND' | 'SOURCE_MISMATCH' | 'UNKNOWN_ZONE' | 'HIDDEN_INFORMATION' | 'OWNERSHIP_VIOLATION' | 'INVALID_DESTINATION' | 'EQUIPMENT_RELATIONSHIP' | 'CARD_TYPE_MISMATCH'; message: string };
export type EncounterCardLocation = { kind: 'enemy-target-card'; targetId: string } | { kind: 'enemy-target-attachment'; targetId: string };
export type EngineCardLocation = EffectCardLocation | EncounterCardLocation;
export type ResolvedEngineCardLocation = EffectConcreteCardLocation | EncounterCardLocation;
export type MoveSuccess = { ok: true; from: ResolvedEngineCardLocation; to: ResolvedEngineCardLocation };
export type MoveResult = MoveFailure | MoveSuccess;
export type MoveRequest = { cardInstanceId: string; from: EngineCardLocation; to: EngineCardLocation; actorId: string; context: EffectContext; registry: ContentRegistry; position?: 'top' | 'bottom' | number; permission?: 'controller-only' | 'system'; transferOwnership?: boolean; attachedEquipmentDisposition?: 'discard' };

function resolvePlayerId(ref: EffectCardLocation extends never ? never : import('@guildmaster/game-protocol').EffectPlayerRef, context: EffectContext): string | undefined {
  if (ref.kind === 'controller') return context.controllerId;
  if (ref.kind === 'player-id') return ref.playerId;
  return context.playerRefs?.[ref.key];
}
export function resolveCardId(ref: import('@guildmaster/game-protocol').EffectCardRef, context: EffectContext): string | undefined { return ref.kind === 'card-instance' ? ref.cardInstanceId : context.cardRefs?.[ref.key]; }
export function resolveLocation(location: EngineCardLocation, context: EffectContext): ResolvedEngineCardLocation | undefined {
  if (location.kind === 'context-location') {
    const referenced = context.locationRefs?.[location.key];
    return referenced ? resolveLocation(referenced, context) : undefined;
  }
  if (location.kind === 'player-zone') { const playerId = resolvePlayerId(location.player, context); return playerId ? { ...location, player: { kind: 'player-id', playerId } } : undefined; }
  if (location.kind === 'party') { const playerId = resolvePlayerId(location.player, context); return playerId ? { ...location, player: { kind: 'player-id', playerId } } : undefined; }
  if (location.kind === 'equipment') { const playerId = resolvePlayerId(location.player, context); return playerId ? { ...location, player: { kind: 'player-id', playerId } } : undefined; }
  return location;
}
function sameLocation(left: ResolvedEngineCardLocation, right: ResolvedEngineCardLocation): boolean { return JSON.stringify(left) === JSON.stringify(right); }
export function isCardAtLocation(state: GameState, location: ResolvedEngineCardLocation, cardId: string): boolean {
  if (location.kind === 'enemy-target-card') { const target = state.enemyTargets[location.targetId]; return Boolean(target && target.status !== 'defeated' && target.status !== 'removed' && target.cardInstanceId === cardId); }
  if (location.kind === 'enemy-target-attachment') { const target = state.enemyTargets[location.targetId]; return Boolean(target && target.status !== 'defeated' && target.status !== 'removed' && target.attachments.includes(cardId)); }
  if (location.kind === 'removed') return state.removedCards.includes(cardId);
  if (location.kind === 'shared-zone') return getZone(state, location.zoneId).cardIds.includes(cardId);
  const player = getPlayer(state, (location.player as { playerId: string }).playerId);
  if (location.kind === 'player-zone') return player[location.zone].includes(cardId);
  if (location.kind === 'party') return player.party[location.position]?.adventurerId === cardId;
  return player.party[location.partyPosition]?.equipmentId === cardId;
}
function remove(state: GameState, location: ResolvedEngineCardLocation, cardId: string): void {
  if (location.kind === 'enemy-target-card') return;
  if (location.kind === 'enemy-target-attachment') { const attachments = state.enemyTargets[location.targetId]!.attachments; attachments.splice(attachments.indexOf(cardId), 1); return; }
  if (location.kind === 'removed') { state.removedCards.splice(state.removedCards.indexOf(cardId), 1); return; }
  if (location.kind === 'shared-zone') { const cards = getZone(state, location.zoneId).cardIds; cards.splice(cards.indexOf(cardId), 1); return; }
  const player = getPlayer(state, (location.player as { playerId: string }).playerId);
  if (location.kind === 'player-zone') { const cards = player[location.zone]; cards.splice(cards.indexOf(cardId), 1); return; }
  if (location.kind === 'party') { player.party.splice(location.position, 1); return; }
  delete player.party[location.partyPosition]!.equipmentId;
}
function insert(state: GameState, location: ResolvedEngineCardLocation, cardId: string, position: MoveRequest['position']): void {
  if (location.kind === 'enemy-target-card') { state.enemyTargets[location.targetId]!.cardInstanceId = cardId; return; }
  if (location.kind === 'enemy-target-attachment') { const attachments = state.enemyTargets[location.targetId]!.attachments; if (position === 'top') attachments.push(cardId); else if (typeof position === 'number') attachments.splice(position, 0, cardId); else attachments.unshift(cardId); return; }
  if (location.kind === 'removed') { state.removedCards.push(cardId); return; }
  if (location.kind === 'shared-zone') { const cards = getZone(state, location.zoneId).cardIds; if (position === 'top') cards.push(cardId); else if (typeof position === 'number') cards.splice(position, 0, cardId); else cards.unshift(cardId); return; }
  const player = getPlayer(state, (location.player as { playerId: string }).playerId);
  if (location.kind === 'player-zone') { const cards = player[location.zone]; if (position === 'top') cards.push(cardId); else if (typeof position === 'number') cards.splice(position, 0, cardId); else cards.unshift(cardId); return; }
  if (location.kind === 'party') { player.party.splice(location.position, 0, { adventurerId: cardId }); return; }
  player.party[location.partyPosition]!.equipmentId = cardId;
}
function ownerOf(location: ResolvedEngineCardLocation): string | undefined { return location.kind === 'player-zone' || location.kind === 'party' || location.kind === 'equipment' ? (location.player as { playerId: string }).playerId : undefined; }
function cardLocationCount(state: GameState, cardId: string, stagedTargetId?: string): number { let count = 0; for (const zone of Object.values(state.zones)) count += zone.cardIds.filter((id) => id === cardId).length; count += state.removedCards.filter((id) => id === cardId).length; for (const player of state.players) { for (const zone of ['drawPile', 'hand', 'discardPile', 'playArea'] as const) count += player[zone].filter((id) => id === cardId).length; for (const slot of player.party) { if (slot.adventurerId === cardId) count += 1; if (slot.equipmentId === cardId) count += 1; } } for (const target of Object.values(state.enemyTargets)) { if (target.status === 'defeated' || target.status === 'removed') continue; if (!target.zoneId && target.targetId !== stagedTargetId && target.cardInstanceId === cardId) count += 1; count += target.attachments.filter((id) => id === cardId).length; } return count; }

export function moveCard(state: GameState, request: MoveRequest): MoveResult {
  const card = state.cards[request.cardInstanceId]; if (!card) return { ok: false, code: 'CARD_NOT_FOUND', message: 'Unknown card instance.' };
  let from: ResolvedEngineCardLocation; let to: ResolvedEngineCardLocation;
  try { from = resolveLocation(request.from, request.context)!; to = resolveLocation(request.to, request.context)!; if (!from || !to) return { ok: false, code: 'INVALID_DESTINATION', message: 'Unresolved effect location.' }; if (from.kind === 'shared-zone') getZone(state, from.zoneId); if (to.kind === 'shared-zone') getZone(state, to.zoneId); if ((from.kind === 'enemy-target-card' || from.kind === 'enemy-target-attachment') && !state.enemyTargets[from.targetId]) return { ok: false, code: 'INVALID_DESTINATION', message: 'Unknown enemy target source.' }; if ((to.kind === 'enemy-target-card' || to.kind === 'enemy-target-attachment') && !state.enemyTargets[to.targetId]) return { ok: false, code: 'INVALID_DESTINATION', message: 'Unknown enemy target destination.' }; } catch { return { ok: false, code: 'UNKNOWN_ZONE', message: 'Effect refers to an unknown shared zone.' }; }
  if (cardLocationCount(state, request.cardInstanceId, to.kind === 'enemy-target-card' ? to.targetId : undefined) !== 1) return { ok: false, code: 'SOURCE_MISMATCH', message: 'Card must have exactly one canonical source location.' };
  if (!isCardAtLocation(state, from, request.cardInstanceId)) return { ok: false, code: 'SOURCE_MISMATCH', message: 'Card is not in the declared source location.' };
  const sourceOwner = ownerOf(from); if (request.permission !== 'system' && sourceOwner && sourceOwner !== request.actorId) return { ok: false, code: 'OWNERSHIP_VIOLATION', message: 'Controller-only effect cannot move another player card.' };
  if (from.kind === 'shared-zone') {
    const zone = getZone(state, from.zoneId);
    const inaccessible = zone.visibility === 'hidden'
      || (zone.visibility === 'ownerOnly' && zone.ownerId !== request.actorId);
    if (inaccessible && request.permission !== 'system') {
      return { ok: false, code: 'HIDDEN_INFORMATION', message: 'Actor cannot select a hidden shared-zone card.' };
    }
  }
  const definition = request.registry.definitions[card.definitionId]; if (!definition) return { ok: false, code: 'CARD_NOT_FOUND', message: 'Card definition is unavailable.' };
  const attachedEquipmentId = from.kind === 'party' ? getPlayer(state, sourceOwner!).party[from.position]?.equipmentId : undefined;
  if (attachedEquipmentId && request.attachedEquipmentDisposition !== 'discard') return { ok: false, code: 'EQUIPMENT_RELATIONSHIP', message: 'Move attached equipment first to avoid a dangling relationship.' };
  if (request.attachedEquipmentDisposition && (from.kind !== 'party' || to.kind !== 'removed')) return { ok: false, code: 'INVALID_DESTINATION', message: 'Attached equipment disposition is only valid when removing a party member from the game.' };
  if (to.kind === 'party' && !['adventurer', 'starter'].includes(definition.type)) return { ok: false, code: 'CARD_TYPE_MISMATCH', message: 'Only adventurer cards may enter a party slot.' };
  if (to.kind === 'equipment') { const target = getPlayer(state, ownerOf(to)!).party[to.partyPosition]; if (!target || target.equipmentId || definition.type !== 'equipment') return { ok: false, code: 'INVALID_DESTINATION', message: 'Equipment destination requires an empty existing party slot and equipment card.' }; }
  if (to.kind === 'enemy-target-card' && state.enemyTargets[to.targetId]!.cardInstanceId !== request.cardInstanceId) return { ok: false, code: 'INVALID_DESTINATION', message: 'Enemy target card destination is already occupied.' };
  if (to.kind === 'enemy-target-attachment' && state.enemyTargets[to.targetId]!.attachments.includes(request.cardInstanceId)) return { ok: false, code: 'INVALID_DESTINATION', message: 'Enemy target already contains this attachment.' };
  if (to.kind === 'player-zone' && to.zone === 'playArea' && definition.type !== 'item') return { ok: false, code: 'CARD_TYPE_MISMATCH', message: 'Only items may enter the item play area.' };
  if (to.kind === 'shared-zone') { const zone = getZone(state, to.zoneId); if (zone.kind === 'singleSlot' && !zone.cardIds.includes(request.cardInstanceId) && zone.cardIds.length > 0) return { ok: false, code: 'INVALID_DESTINATION', message: 'Single-slot destination is occupied.' }; }
  if (sameLocation(from, to)) return { ok: true, from, to };
  remove(state, from, request.cardInstanceId); insert(state, to, request.cardInstanceId, request.position);
  if (attachedEquipmentId && request.attachedEquipmentDisposition === 'discard') getPlayer(state, sourceOwner!).discardPile.push(attachedEquipmentId);
  const destinationOwner = ownerOf(to); if (request.transferOwnership && destinationOwner) card.ownerId = destinationOwner;
  return { ok: true, from, to };
}
