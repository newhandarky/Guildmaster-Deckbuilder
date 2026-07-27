export type StarterCandidateStatus = 'needs-human-confirmation' | 'todo';
export type StarterCandidateField = 'name' | 'cardType' | 'copies' | 'purchasePower' | 'combat' | 'cost' | 'honor' | 'effect';
export type UserProvidedVisualEvidence = {
  evidenceId: string;
  officialUrl: string;
  documentName: string;
  providedFileName: string;
  printedPage?: string;
  region: string;
  reviewedOn: string;
  repositoryAsset: 'not-committed';
};
export type StarterCandidateFieldEvidence = { field: StarterCandidateField; status: StarterCandidateStatus; candidateValue?: string | number; evidenceIds: readonly string[]; gapReason?: string };
export type StarterCandidate = { candidateId: string; category: 'adventurer' | 'starter-resource'; activation: 'disabled'; runtimeLoadable: false; fields: readonly StarterCandidateFieldEvidence[] };
export type BaseStarterCandidateCatalog = { catalogVersion: 1; evidence: readonly UserProvidedVisualEvidence[]; candidates: readonly StarterCandidate[] };

const candidateIdPattern = /^[a-z0-9-]+:[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;
const officialHosts = new Set(['paintcanfarm.com', 'www.paintcanfarm.com']);
const isOfficialUrl = (url: string): boolean => { try { const parsed = new URL(url); return parsed.protocol === 'https:' && officialHosts.has(parsed.hostname); } catch { return false; } };

export function validateBaseStarterCandidateCatalog(catalog: BaseStarterCandidateCatalog): string[] {
  const errors: string[] = []; const evidenceIds = new Set<string>(); const candidateIds = new Set<string>();
  for (const evidence of catalog.evidence) {
    if (evidenceIds.has(evidence.evidenceId)) errors.push(`Duplicate candidate evidence ID: ${evidence.evidenceId}.`); evidenceIds.add(evidence.evidenceId);
    if (!isOfficialUrl(evidence.officialUrl) || !evidence.documentName.trim() || !evidence.providedFileName.trim() || !evidence.region.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(evidence.reviewedOn)) errors.push(`Candidate evidence ${evidence.evidenceId} requires an allowlisted official URL, document name, file reference, region, and ISO review date.`);
    if (evidence.repositoryAsset !== 'not-committed') errors.push(`Candidate evidence ${evidence.evidenceId} must not be a repository asset.`);
  }
  for (const candidate of catalog.candidates) {
    if (!candidateIdPattern.test(candidate.candidateId)) errors.push(`Candidate ID is not namespaced: ${candidate.candidateId}.`); if (candidateIds.has(candidate.candidateId)) errors.push(`Duplicate starter candidate: ${candidate.candidateId}.`); candidateIds.add(candidate.candidateId);
    if (candidate.activation !== 'disabled' || candidate.runtimeLoadable) errors.push(`Starter candidate ${candidate.candidateId} must remain disabled and outside runtime.`);
    if (candidate.fields.length === 0) errors.push(`Starter candidate ${candidate.candidateId} requires field evidence.`);
    for (const field of candidate.fields) {
      for (const evidenceId of field.evidenceIds) if (!evidenceIds.has(evidenceId)) errors.push(`Unknown candidate evidence ${evidenceId} on ${candidate.candidateId}.${field.field}.`);
      if (field.status !== 'needs-human-confirmation' && field.status !== 'todo') errors.push(`Starter candidate field ${candidate.candidateId}.${field.field} has an invalid non-candidate status.`);
      if (field.status === 'needs-human-confirmation' && (field.candidateValue === undefined || field.evidenceIds.length === 0)) errors.push(`Candidate field ${candidate.candidateId}.${field.field} requires a value and visual evidence.`);
      if (field.status === 'todo' && !field.gapReason?.trim()) errors.push(`TODO candidate field ${candidate.candidateId}.${field.field} requires a gap reason.`);
    }
  }
  return errors;
}
