export type ProvisionalAuditStatus = 'verified' | 'provisional' | 'exception' | 'disabled';
export type ProvisionalFieldName = 'sourceName' | 'cardType' | 'profession' | 'copies' | 'cost' | 'combat' | 'purchasePower' | 'honor' | 'effect' | 'effectTiming' | 'equipmentEligibility' | 'restrictions' | 'setup';

export type VisualSource = {
  evidenceKind?: 'official-visual';
  sourceId: string;
  officialUrl: string;
  documentName: string;
  providedFileName: string;
  printedPage?: string;
  region: string;
  reviewedOn: string;
  repositoryAsset: 'not-committed';
} | {
  evidenceKind: 'project-policy';
  sourceId: string;
  title: string;
  locator: string;
  decidedOn: string;
  recordedOn: string;
  repositoryAsset: 'not-committed';
};

/** Names and text in this catalog are source metadata, never player-facing presentation. */
export type ProvisionalField = {
  field: ProvisionalFieldName;
  candidateValue?: string | number | boolean;
  status: ProvisionalAuditStatus;
  confidence: 'high' | 'medium' | 'low';
  sourceIds: readonly string[];
  sourceLocation: string;
  exceptionReason?: string;
};

export type ProvisionalCardCandidate = {
  definitionId: string;
  category: 'starter' | 'adventurer' | 'resource' | 'monster' | 'boss' | 'bond' | 'helper';
  runtimeLoadable: false;
  activation: 'disabled';
  mechanicsTags?: readonly string[];
  fields: readonly ProvisionalField[];
};

export type ProvisionalBaseContentCatalog = {
  catalogVersion: 1;
  evidence: readonly VisualSource[];
  candidates: readonly ProvisionalCardCandidate[];
};

const idPattern = /^[a-z0-9-]+:[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;
const allowedHosts = new Set(['paintcanfarm.com', 'www.paintcanfarm.com']);
const officialUrl = (url: string) => { try { const parsed = new URL(url); return parsed.protocol === 'https:' && allowedHosts.has(parsed.hostname); } catch { return false; } };

export function validateProvisionalBaseContentCatalog(catalog: ProvisionalBaseContentCatalog): string[] {
  const errors: string[] = []; const sourceIds = new Set<string>(); const definitionIds = new Set<string>();
  for (const source of catalog.evidence) {
    if (sourceIds.has(source.sourceId)) errors.push(`Duplicate visual source: ${source.sourceId}.`);
    sourceIds.add(source.sourceId);
    if (source.evidenceKind === 'project-policy') {
      if (!source.title.trim() || !source.locator.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(source.decidedOn) || !/^\d{4}-\d{2}-\d{2}$/.test(source.recordedOn)) errors.push(`Project policy ${source.sourceId} requires a title, locator, and ISO decision/record dates.`);
      if (source.repositoryAsset !== 'not-committed') errors.push(`Source ${source.sourceId} must not be committed as an asset.`);
      continue;
    }
    if (!officialUrl(source.officialUrl) || !source.documentName.trim() || !source.providedFileName.trim() || !source.region.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(source.reviewedOn)) errors.push(`Source ${source.sourceId} requires official URL, document, local filename, locator, and date.`);
    if (source.repositoryAsset !== 'not-committed') errors.push(`Source ${source.sourceId} must not be committed as an asset.`);
  }
  for (const candidate of catalog.candidates) {
    if (!idPattern.test(candidate.definitionId) || definitionIds.has(candidate.definitionId)) errors.push(`Candidate has invalid or duplicate neutral mechanics ID: ${candidate.definitionId}.`);
    definitionIds.add(candidate.definitionId);
    if (candidate.runtimeLoadable || candidate.activation !== 'disabled') errors.push(`Provisional candidate ${candidate.definitionId} must remain disabled outside runtime.`);
    if (candidate.mechanicsTags?.some((tag) => !idPattern.test(tag))) errors.push(`Provisional candidate ${candidate.definitionId} has an invalid mechanics tag.`);
    if (!candidate.fields.length) errors.push(`Provisional candidate ${candidate.definitionId} requires fields.`);
    const fieldNames = new Set<ProvisionalFieldName>();
    for (const field of candidate.fields) {
      if (fieldNames.has(field.field)) errors.push(`Duplicate field ${candidate.definitionId}.${field.field}.`); fieldNames.add(field.field);
      if (!field.sourceIds.length || !field.sourceLocation.trim()) errors.push(`Field ${candidate.definitionId}.${field.field} requires source IDs and an exact locator.`);
      for (const sourceId of field.sourceIds) if (!sourceIds.has(sourceId)) errors.push(`Unknown source ${sourceId} on ${candidate.definitionId}.${field.field}.`);
      if (field.status === 'exception' && !field.exceptionReason?.trim()) errors.push(`Exception ${candidate.definitionId}.${field.field} requires a reason.`);
      if (field.status === 'provisional' && field.candidateValue === undefined) errors.push(`Provisional ${candidate.definitionId}.${field.field} requires a candidate value.`);
      if (field.status === 'verified' && field.candidateValue === undefined) errors.push(`Verified ${candidate.definitionId}.${field.field} requires a value.`);
      if (['copies', 'cost', 'combat', 'purchasePower', 'honor'].includes(field.field) && field.candidateValue !== undefined && (typeof field.candidateValue !== 'number' || !Number.isFinite(field.candidateValue) || !Number.isInteger(field.candidateValue) || (field.field !== 'honor' && field.candidateValue < 0) || (field.field === 'copies' && field.candidateValue < 1))) errors.push(`Field ${candidate.definitionId}.${field.field} requires a finite integer${field.field === 'honor' ? '' : ' that is non-negative'}${field.field === 'copies' ? ' and greater than zero' : ''}.`);
      if (['sourceName', 'cardType', 'effect', 'effectTiming', 'equipmentEligibility', 'restrictions', 'setup', 'profession'].includes(field.field) && field.candidateValue !== undefined && (typeof field.candidateValue !== 'string' || !field.candidateValue.trim())) errors.push(`Field ${candidate.definitionId}.${field.field} requires a non-empty string value.`);
    }
  }
  return errors;
}
