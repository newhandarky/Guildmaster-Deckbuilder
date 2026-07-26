import type { CardType } from '@guildmaster/game-protocol';
import type { OfficialSource, VerificationStatus } from '../audit/schema.js';

export type DisplayNameKind = 'official' | 'original-placeholder';
export type InventoryPriority = 'starter' | 'common-supply' | 'remaining-base';
export type AuditedValue<T> = { value?: T; status: VerificationStatus; sourceIds: readonly string[]; todoReason?: string };
export type BaseCardInventoryEntry = { id: string; priority: InventoryPriority; displayName: { value: string; kind: DisplayNameKind; sourceIds: readonly string[] }; cardType: AuditedValue<CardType>; copies: AuditedValue<number>; activation: 'enabled' | 'disabled'; note?: string };
export type BaseCardInventory = { rosterStatus: 'incomplete' | 'complete'; sources: readonly OfficialSource[]; cards: readonly BaseCardInventoryEntry[] };

const idPattern = /^[a-z0-9-]+:[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;
export function validateBaseCardInventory(inventory: BaseCardInventory): string[] {
  const errors: string[] = []; const sources = new Set(inventory.sources.map((source) => source.sourceId)); const ids = new Set<string>();
  for (const source of inventory.sources) if (!source.url.startsWith('https://') || !source.locator.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(source.accessedOn)) errors.push(`Source ${source.sourceId} requires HTTPS URL, locator, and ISO access date.`);
  for (const card of inventory.cards) {
    if (!idPattern.test(card.id)) errors.push(`Inventory ID is not namespaced: ${card.id}.`); if (ids.has(card.id)) errors.push(`Duplicate inventory ID: ${card.id}.`); ids.add(card.id);
    const fields = [card.cardType, card.copies];
    for (const sourceId of [...card.displayName.sourceIds, ...fields.flatMap((field) => field.sourceIds)]) if (!sources.has(sourceId)) errors.push(`Unknown source ${sourceId} on ${card.id}.`);
    if (card.displayName.kind === 'official' && card.displayName.sourceIds.length === 0) errors.push(`Official display name ${card.id} requires a source.`);
    for (const field of fields) {
      if (field.status === 'verified' && (field.value === undefined || field.sourceIds.length === 0)) errors.push(`Verified field on ${card.id} requires value and source.`);
      if (field.status !== 'verified' && !field.todoReason?.trim()) errors.push(`Unverified field on ${card.id} requires a TODO reason.`);
    }
    if (card.activation === 'enabled') errors.push(`Inventory-only entry ${card.id} cannot enable runtime content.`);
  }
  return errors;
}
