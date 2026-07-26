import type { OfficialSourceKind, VerificationStatus } from '../audit/schema.js';

export type OfficialBaseSource = {
  sourceId: string;
  kind: OfficialSourceKind;
  title: string;
  url: string;
  versionOrUpdated: string;
  locator: string;
  accessedOn: string;
  extractionPolicy: 'text-only';
  availability: 'text-readable' | 'image-only';
};

export type AuditedOfficialField = 'name' | 'cardType' | 'copies' | 'cost' | 'combat' | 'honor' | 'effect';
export type OfficialFieldEvidence = { field: AuditedOfficialField; status: VerificationStatus; value?: string; sourceIds: readonly string[]; gapReason?: string };
export type OfficialBaseSourceRecord = { recordId: string; category: 'starter' | 'common-supply' | 'monster' | 'boss' | 'rules-errata'; fields: readonly OfficialFieldEvidence[] };
export type OfficialBaseSourceManifest = { manifestVersion: 1; sources: readonly OfficialBaseSource[]; records: readonly OfficialBaseSourceRecord[] };

const recordIdPattern = /^[a-z0-9-]+:[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;
export function validateOfficialBaseSourceManifest(manifest: OfficialBaseSourceManifest): string[] {
  const errors: string[] = []; const sourceIds = new Set(manifest.sources.map((source) => source.sourceId)); const recordIds = new Set<string>();
  for (const source of manifest.sources) {
    if (!source.url.startsWith('https://') || !source.title.trim() || !source.versionOrUpdated.trim() || !source.locator.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(source.accessedOn)) errors.push(`Source ${source.sourceId} requires an HTTPS URL, title, version/update value, locator, and ISO access date.`);
    if (source.extractionPolicy !== 'text-only') errors.push(`Source ${source.sourceId} must not allow image extraction.`);
  }
  for (const record of manifest.records) {
    if (!recordIdPattern.test(record.recordId)) errors.push(`Source record ID is not namespaced: ${record.recordId}.`); if (recordIds.has(record.recordId)) errors.push(`Duplicate source record: ${record.recordId}.`); recordIds.add(record.recordId);
    if (record.fields.length === 0) errors.push(`Source record ${record.recordId} requires field coverage.`);
    for (const field of record.fields) {
      for (const sourceId of field.sourceIds) if (!sourceIds.has(sourceId)) errors.push(`Unknown source ${sourceId} on ${record.recordId}.${field.field}.`);
      if (field.status === 'verified' && (!field.value?.trim() || field.sourceIds.length === 0)) errors.push(`Verified field ${record.recordId}.${field.field} requires a value and source.`);
      if (field.status !== 'verified' && !field.gapReason?.trim()) errors.push(`Unverified field ${record.recordId}.${field.field} requires a documented gap.`);
    }
  }
  return errors;
}
