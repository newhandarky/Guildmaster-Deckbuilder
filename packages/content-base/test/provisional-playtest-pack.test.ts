import { describe, expect, it } from 'vitest';
import { baseProvisionalContentCatalog, assembleProvisionalPlaytestPack } from '../src/index.js';

const starterIds = ['base:starter/adventurer-01', 'base:starter/adventurer-02', 'base:starter/adventurer-03', 'base:starter/adventurer-04', 'base:starter/adventurer-05', 'base:starter/summoning-stone', 'base:starter/spirit-crystal'];

describe('provisional playtest Content Pack assembly', () => {
  it('rejects selected candidates with unresolved exceptions', () => {
    const result = assembleProvisionalPlaytestPack(baseProvisionalContentCatalog, { definitionIds: starterIds });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures.some((failure) => failure.definitionId === 'base:starter/adventurer-01')).toBe(true);
  });

  it('rejects unsupported mechanics instead of silently discarding them', () => {
    const resolved = structuredClone(baseProvisionalContentCatalog);
    for (const candidate of resolved.candidates) if (starterIds.includes(candidate.definitionId)) {
      candidate.fields = candidate.fields.map((field) => {
        if (field.status !== 'exception') return field;
        const withoutException = { ...field };
        delete withoutException.exceptionReason;
        return { ...withoutException, status: 'provisional' as const, candidateValue: 'not-applicable' };
      });
    }
    const result = assembleProvisionalPlaytestPack(resolved, { definitionIds: starterIds });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures.some((failure) => failure.field === 'effect' && failure.reason.startsWith('Unsupported mechanics'))).toBe(true);
  });

  it('requires complete fields and emits a distinct-starter setup only for adapter-supported candidates', () => {
    const resolved = structuredClone(baseProvisionalContentCatalog);
    for (const candidate of resolved.candidates) if (starterIds.includes(candidate.definitionId)) candidate.fields = candidate.fields.filter((field) => field.status !== 'exception');
    const result = assembleProvisionalPlaytestPack(resolved, { definitionIds: starterIds });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pack.manifest.contentStatus).toBe('provisional-playtest');
      expect(result.pack.definitions.every((definition) => definition.name === `placeholder:${definition.id}`)).toBe(true);
      expect(result.pack.definitions.every((definition) => definition.source === 'provisional-playtest')).toBe(true);
      expect(result.pack.definitions.find(({ id }) => id === 'base:starter/spirit-crystal')).toMatchObject({ type: 'equipment', combat: 1 });
      expect('partyDefinitionIds' in result.pack.starter! && result.pack.starter.partyDefinitionIds).toEqual(starterIds.slice(0, 5));
    }
  });

  it('rejects incomplete catalog candidates before assembly', () => {
    const incomplete = structuredClone(baseProvisionalContentCatalog);
    const candidate = incomplete.candidates.find((entry) => entry.definitionId === 'base:starter/adventurer-01')!;
    candidate.fields = candidate.fields.filter((field) => field.field !== 'copies');
    const result = assembleProvisionalPlaytestPack(incomplete, { definitionIds: starterIds });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures.some((failure) => failure.definitionId === 'base:starter/adventurer-01' && failure.field === 'copies')).toBe(true);
  });

  it('never assembles a requested candidate with invalid numeric mechanics', () => {
    const invalid = structuredClone(baseProvisionalContentCatalog);
    const candidate = invalid.candidates.find((entry) => entry.definitionId === 'base:starter/adventurer-01')!;
    candidate.fields.find((field) => field.field === 'copies')!.candidateValue = Number.POSITIVE_INFINITY;
    const result = assembleProvisionalPlaytestPack(invalid, { definitionIds: starterIds });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures.some((failure) => failure.definitionId === '<catalog>' && failure.reason.includes('finite integer'))).toBe(true);
  });
});
