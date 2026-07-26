import type { CardDefinition } from '@guildmaster/game-protocol';

export type OfficialSourceKind = 'official-rulebook' | 'official-faq' | 'official-errata' | 'official-card-list';
export type OfficialSource = { sourceId: string; kind: OfficialSourceKind; title: string; url: string; locator: string; accessedOn: string };
export type VerificationStatus = 'verified' | 'todo' | 'blocked';
export type ActivationStatus = 'enabled' | 'disabled';
export type FieldAudit = { field: keyof CardDefinition | 'rulesText'; status: VerificationStatus; sourceIds: readonly string[]; note?: string };
export type CardAuditEntry = { definitionId: string; status: VerificationStatus; activation: ActivationStatus; sourceIds: readonly string[]; fieldAudits: readonly FieldAudit[]; note?: string };
export type ContentAuditCatalog = { packId: string; sourceCatalog: readonly OfficialSource[]; cards: readonly CardAuditEntry[] };

export function validateContentAudit(catalog: ContentAuditCatalog, definitions: readonly CardDefinition[]): string[] {
  const errors: string[] = []; const sources = new Set(catalog.sourceCatalog.map((source) => source.sourceId)); const definitionIds = new Set(definitions.map((definition) => definition.id)); const auditedIds = new Set<string>();
  for (const source of catalog.sourceCatalog) if (!source.url.startsWith('https://') || !source.locator.trim()) errors.push(`Source ${source.sourceId} requires an HTTPS URL and locator.`);
  for (const entry of catalog.cards) {
    if (!definitionIds.has(entry.definitionId)) errors.push(`Audit entry references unknown definition ${entry.definitionId}.`);
    if (auditedIds.has(entry.definitionId)) errors.push(`Duplicate audit entry for ${entry.definitionId}.`); auditedIds.add(entry.definitionId);
    for (const sourceId of entry.sourceIds) if (!sources.has(sourceId)) errors.push(`Unknown source ${sourceId} on ${entry.definitionId}.`);
    for (const field of entry.fieldAudits) for (const sourceId of field.sourceIds) if (!sources.has(sourceId)) errors.push(`Unknown field source ${sourceId} on ${entry.definitionId}.`);
    if (entry.activation === 'enabled' && entry.status !== 'verified') errors.push(`Unverified definition ${entry.definitionId} must remain disabled.`);
    if (entry.activation === 'enabled' && entry.fieldAudits.some((field) => field.status !== 'verified' || field.sourceIds.length === 0)) errors.push(`Enabled definition ${entry.definitionId} has unverified fields.`);
    if (entry.status !== 'verified' && entry.activation !== 'disabled') errors.push(`Non-verified definition ${entry.definitionId} must be disabled.`);
  }
  for (const definition of definitions) if (!auditedIds.has(definition.id)) errors.push(`Missing audit entry for ${definition.id}.`);
  return errors;
}
