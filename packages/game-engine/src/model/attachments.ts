import type { PartySlot } from '@guildmaster/game-protocol';

/** Reads both current and legacy Snapshot shapes without mutating them. */
export function attachedCardIds(slot: PartySlot): string[] {
  return slot.equipmentIds ? [...slot.equipmentIds] : slot.equipmentId ? [slot.equipmentId] : [];
}

/** Keeps one-card v2 snapshots stable; multi-card slots use the ordered representation. */
export function setAttachedCardIds(slot: PartySlot, cardIds: readonly string[]): void {
  if (cardIds.length <= 1) {
    delete slot.equipmentIds;
    if (cardIds[0]) slot.equipmentId = cardIds[0];
    else delete slot.equipmentId;
    return;
  }
  delete slot.equipmentId;
  slot.equipmentIds = [...cardIds];
}
