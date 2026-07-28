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
    expect(baseStarterCandidateCatalog.candidates.flatMap((candidate) => candidate.fields).every((field) => field.sourceLocation && typeof field.requiresContentOwnerConfirmation === 'boolean')).toBe(true);
  });
  it('audits every requested mechanical field without inferring values absent from the card page', () => {
    const required = ['cardType', 'cost', 'combat', 'purchasePower', 'honor', 'effect', 'effectTiming', 'equipmentEligibility', 'restrictions'];
    for (const candidate of baseStarterCandidateCatalog.candidates) expect(candidate.fields.map((field) => field.field)).toEqual(expect.arrayContaining(required));
    const valueFor = (candidateId: string, field: string) => baseStarterCandidateCatalog.candidates.find((candidate) => candidate.candidateId === candidateId)!.fields.find((entry) => entry.field === field);
    expect(valueFor('base:starter/adventurer-01', 'combat')).toMatchObject({ candidateValue: 1, status: 'needs-human-confirmation', requiresContentOwnerConfirmation: true });
    expect(valueFor('base:starter/adventurer-02', 'combat')).toMatchObject({ candidateValue: 2, status: 'needs-human-confirmation', requiresContentOwnerConfirmation: true });
    expect(valueFor('base:starter/summoning-stone', 'purchasePower')).toMatchObject({ candidateValue: 1, status: 'needs-human-confirmation' });
    expect(valueFor('base:starter/spirit-crystal', 'honor')).toMatchObject({ candidateValue: 1, status: 'needs-human-confirmation' });
    expect(valueFor('base:starter/adventurer-01', 'effect')).toMatchObject({ status: 'todo', requiresContentOwnerConfirmation: false });
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
  it('rejects a mechanical field with missing location or confirmation declaration', () => {
    const broken = { ...baseStarterCandidateCatalog, candidates: baseStarterCandidateCatalog.candidates.map((candidate) => candidate.candidateId === 'base:starter/adventurer-01' ? { ...candidate, fields: candidate.fields.map((field) => field.field === 'combat' ? { ...field, sourceLocation: undefined as unknown as string, requiresContentOwnerConfirmation: undefined as unknown as boolean } : field) } : candidate) };
    const errors = validateBaseStarterCandidateCatalog(broken);
    expect(errors).toContain('Candidate field base:starter/adventurer-01.combat requires a source location.');
    expect(errors).toContain('Candidate field base:starter/adventurer-01.combat must declare whether content-owner confirmation is required.');
  });
  it('uses neutral mechanism IDs with no source name or presentation identity', () => {
    expect(baseStarterCandidateCatalog.candidates.map((candidate) => candidate.candidateId)).toEqual([
      'base:starter/adventurer-01', 'base:starter/adventurer-02', 'base:starter/adventurer-03', 'base:starter/adventurer-04', 'base:starter/adventurer-05', 'base:starter/summoning-stone', 'base:starter/spirit-crystal'
    ]);
  });
});
