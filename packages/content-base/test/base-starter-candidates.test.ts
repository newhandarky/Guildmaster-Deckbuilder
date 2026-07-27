import { describe, expect, it } from 'vitest';
import { baseStarterCandidateCatalog, validateBaseStarterCandidateCatalog } from '../src/index.js';

describe('base starter candidates', () => {
  it('records all seven candidates as non-runtime evidence only', () => {
    expect(validateBaseStarterCandidateCatalog(baseStarterCandidateCatalog)).toEqual([]);
    expect(baseStarterCandidateCatalog.candidates).toHaveLength(7);
    expect(baseStarterCandidateCatalog.candidates.every((candidate) => candidate.activation === 'disabled' && !candidate.runtimeLoadable)).toBe(true);
    expect(baseStarterCandidateCatalog.evidence.every((source) => source.repositoryAsset === 'not-committed')).toBe(true);
  });
  it('keeps candidate values distinguishable from verified card content', () => {
    expect(baseStarterCandidateCatalog.candidates.flatMap((candidate) => candidate.fields).every((field) => field.status === 'needs-human-confirmation' || field.status === 'todo')).toBe(true);
    expect(baseStarterCandidateCatalog.candidates.flatMap((candidate) => candidate.fields).filter((field) => field.status === 'todo').every((field) => field.gapReason)).toBe(true);
  });
  it('rejects an attempt to load a candidate into runtime', () => {
    const broken = { ...baseStarterCandidateCatalog, candidates: baseStarterCandidateCatalog.candidates.map((candidate) => candidate.candidateId === 'base:starter/adventurer-01' ? { ...candidate, runtimeLoadable: true as false } : candidate) };
    expect(validateBaseStarterCandidateCatalog(broken)).toContain('Starter candidate base:starter/adventurer-01 must remain disabled and outside runtime.');
  });
  it('rejects forged enabled and verified values in deserialized candidate data', () => {
    const broken = { ...baseStarterCandidateCatalog, candidates: baseStarterCandidateCatalog.candidates.map((candidate) => candidate.candidateId === 'base:starter/adventurer-01' ? { ...candidate, activation: 'enabled' as 'disabled', fields: candidate.fields.map((field) => field.field === 'name' ? { ...field, status: 'verified' as 'needs-human-confirmation' } : field) } : candidate) };
    const errors = validateBaseStarterCandidateCatalog(broken);
    expect(errors).toContain('Starter candidate base:starter/adventurer-01 must remain disabled and outside runtime.');
    expect(errors).toContain('Starter candidate field base:starter/adventurer-01.name has an invalid non-candidate status.');
  });
  it('uses neutral mechanism IDs with no source name or presentation identity', () => {
    expect(baseStarterCandidateCatalog.candidates.map((candidate) => candidate.candidateId)).toEqual([
      'base:starter/adventurer-01', 'base:starter/adventurer-02', 'base:starter/adventurer-03', 'base:starter/adventurer-04', 'base:starter/adventurer-05', 'base:starter/summoning-stone', 'base:starter/spirit-crystal'
    ]);
  });
});
