import type { CardDefinition } from '@guildmaster/game-protocol';

export type OfficialSourceKind = 'official-rulebook' | 'official-faq' | 'official-errata' | 'official-card-list';
export type OfficialSourceAvailability = 'text-readable' | 'image-only' | 'candidate-only' | 'ocr-derived';
export type OfficialSource = { sourceId: string; kind: OfficialSourceKind; title: string; url: string; locator: string; accessedOn: string; availability: OfficialSourceAvailability };
export type VerificationStatus = 'verified' | 'todo' | 'blocked';
export type ActivationStatus = 'enabled' | 'disabled';
export type FieldAudit = { field: keyof CardDefinition | 'rulesText'; status: VerificationStatus; sourceIds: readonly string[]; note?: string };
export type CardAuditEntry = { definitionId: string; status: VerificationStatus; activation: ActivationStatus; sourceIds: readonly string[]; fieldAudits: readonly FieldAudit[]; note?: string };
export type ContentAuditCatalog = { packId: string; sourceCatalog: readonly OfficialSource[]; cards: readonly CardAuditEntry[] };
const officialHosts = new Set(['paintcanfarm.com', 'www.paintcanfarm.com']);
function isOfficialUrl(url: string): boolean { try { const parsed = new URL(url); return parsed.protocol === 'https:' && officialHosts.has(parsed.hostname); } catch { return false; } }

export function validateContentAudit(catalog: ContentAuditCatalog, definitions: readonly CardDefinition[]): string[] {
  const errors: string[] = []; const sources = new Map<string, OfficialSource>(); const definitionById = new Map(definitions.map((definition) => [definition.id, definition])); const definitionIds = new Set(definitionById.keys()); const auditedIds = new Set<string>();
  for (const source of catalog.sourceCatalog) { if (sources.has(source.sourceId)) errors.push(`Duplicate official source ID: ${source.sourceId}.`); sources.set(source.sourceId, source); if (!isOfficialUrl(source.url) || !source.locator.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(source.accessedOn) || !['text-readable', 'image-only', 'candidate-only', 'ocr-derived'].includes(source.availability)) errors.push(`Source ${source.sourceId} requires an allowlisted official URL, locator, ISO access date, and evidence availability.`); }
  for (const entry of catalog.cards) {
    if (!definitionIds.has(entry.definitionId)) errors.push(`Audit entry references unknown definition ${entry.definitionId}.`);
    if (auditedIds.has(entry.definitionId)) errors.push(`Duplicate audit entry for ${entry.definitionId}.`); auditedIds.add(entry.definitionId);
    if (entry.sourceIds.length === 0) errors.push(`Audit entry ${entry.definitionId} requires at least one official source.`);
    for (const sourceId of entry.sourceIds) if (!sources.has(sourceId)) errors.push(`Unknown source ${sourceId} on ${entry.definitionId}.`);
    const auditedFields = new Set<string>();
    for (const field of entry.fieldAudits) {
      if (auditedFields.has(field.field)) errors.push(`Duplicate field audit ${field.field} on ${entry.definitionId}.`); auditedFields.add(field.field);
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
    if (entry.activation === 'enabled') {
      const definition = definitionById.get(entry.definitionId);
      const requiredFields = definition ? (['type', 'copies', 'cost', 'combat', 'purchasePower', 'honor', 'itemEffect', 'useEffect', 'tags'] as const).filter((field) => field === 'type' || field === 'copies' || definition[field] !== undefined) : [];
      for (const field of requiredFields) if (!auditedFields.has(field)) errors.push(`Enabled definition ${entry.definitionId} is missing audit coverage for ${field}.`);
    }
    if (entry.status !== 'verified' && entry.activation !== 'disabled') errors.push(`Non-verified definition ${entry.definitionId} must be disabled.`);
  }
  for (const definition of definitions) if (!auditedIds.has(definition.id)) errors.push(`Missing audit entry for ${definition.id}.`);
  return errors;
}
