import type { CardDefinition } from '@guildmaster/game-protocol';

export type OfficialSourceKind = 'official-rulebook' | 'official-faq' | 'official-errata' | 'official-card-list';
export type OfficialSourceAvailability = 'text-readable' | 'image-only' | 'candidate-only' | 'ocr-derived';
export type OfficialSource = { sourceId: string; kind: OfficialSourceKind; title: string; url: string; locator: string; accessedOn: string; availability: OfficialSourceAvailability };
export type VerificationStatus = 'verified' | 'todo' | 'blocked';
export type ActivationStatus = 'enabled' | 'disabled';
export type FieldAudit = { field: keyof CardDefinition | 'rulesText'; status: VerificationStatus; sourceIds: readonly string[]; note?: string };
export type CardAuditEntry = { definitionId: string; status: VerificationStatus; activation: ActivationStatus; sourceIds: readonly string[]; fieldAudits: readonly FieldAudit[]; note?: string };
export type ContentAuditCatalog = { packId: string; sourceCatalog: readonly OfficialSource[]; cards: readonly CardAuditEntry[] };

export function validateContentAudit(catalog: ContentAuditCatalog, definitions: readonly CardDefinition[]): string[] {
  const errors: string[] = []; const sources = new Map(catalog.sourceCatalog.map((source) => [source.sourceId, source])); const definitionIds = new Set(definitions.map((definition) => definition.id)); const auditedIds = new Set<string>();
  for (const source of catalog.sourceCatalog) if (!source.url.startsWith('https://') || !source.locator.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(source.accessedOn) || !['text-readable', 'image-only', 'candidate-only', 'ocr-derived'].includes(source.availability)) errors.push(`Source ${source.sourceId} requires an HTTPS URL, locator, ISO access date, and evidence availability.`);
  for (const entry of catalog.cards) {
    if (!definitionIds.has(entry.definitionId)) errors.push(`Audit entry references unknown definition ${entry.definitionId}.`);
    if (auditedIds.has(entry.definitionId)) errors.push(`Duplicate audit entry for ${entry.definitionId}.`); auditedIds.add(entry.definitionId);
    if (entry.sourceIds.length === 0) errors.push(`Audit entry ${entry.definitionId} requires at least one official source.`);
    for (const sourceId of entry.sourceIds) if (!sources.has(sourceId)) errors.push(`Unknown source ${sourceId} on ${entry.definitionId}.`);
    for (const field of entry.fieldAudits) {
      if (field.status === 'verified' && field.sourceIds.length === 0) errors.push(`Verified field ${field.field} on ${entry.definitionId} requires a source.`);
      for (const sourceId of field.sourceIds) {
        const source = sources.get(sourceId);
        if (!source) errors.push(`Unknown field source ${sourceId} on ${entry.definitionId}.`);
        if (field.status === 'verified' && source?.availability !== 'text-readable') errors.push(`Verified field ${field.field} on ${entry.definitionId} cannot cite non-text-readable source ${sourceId}.`);
      }
    }
    if (entry.activation === 'enabled' && entry.status !== 'verified') errors.push(`Unverified definition ${entry.definitionId} must remain disabled.`);
    if (entry.activation === 'enabled' && entry.fieldAudits.length === 0) errors.push(`Enabled definition ${entry.definitionId} requires field audits.`);
    if (entry.activation === 'enabled' && entry.fieldAudits.some((field) => field.status !== 'verified' || field.sourceIds.length === 0)) errors.push(`Enabled definition ${entry.definitionId} has unverified fields.`);
    if (entry.status !== 'verified' && entry.activation !== 'disabled') errors.push(`Non-verified definition ${entry.definitionId} must be disabled.`);
  }
  for (const definition of definitions) if (!auditedIds.has(definition.id)) errors.push(`Missing audit entry for ${definition.id}.`);
  return errors;
}
