import { describe, expect, it } from 'vitest';
import { baseProvisionalContentCatalog, baseProvisionalFoundationContentPack } from '../src/index.js';

describe('provisional foundation Content Pack', () => {
  it('publishes a deliberately gated foundation slice with one immediate item effect', () => {
    expect(baseProvisionalFoundationContentPack.manifest).toMatchObject({
      id: 'base:provisional-foundation',
      contentStatus: 'provisional-playtest',
      role: 'base',
    });
    expect(baseProvisionalFoundationContentPack.definitions).toHaveLength(27);
    expect(baseProvisionalFoundationContentPack.definitions.some(({ type }) => type === 'adventurer')).toBe(true);
    expect(baseProvisionalFoundationContentPack.definitions.some(({ type }) => type === 'monster')).toBe(true);
    expect(baseProvisionalFoundationContentPack.definitions.some(({ type }) => type === 'boss')).toBe(true);
    expect(baseProvisionalFoundationContentPack.definitions.some(({ type }) => type === 'equipment')).toBe(true);
    expect(baseProvisionalFoundationContentPack.definitions.some(({ type }) => type === 'item')).toBe(true);
    const enabled = baseProvisionalFoundationContentPack.definitions.filter(({ tags }) => tags?.includes('playtest:effect-enabled'));
    expect(enabled).toEqual([
      expect.objectContaining({ id: 'base:resource/resource-08', type: 'item', copies: 2, useEffect: expect.objectContaining({ body: { kind: 'draw', player: { kind: 'controller' }, count: 2 } }) }),
      expect.objectContaining({ id: 'base:resource/resource-10', type: 'item', copies: 2, useEffect: expect.objectContaining({ body: expect.objectContaining({ kind: 'sequence' }) }) }),
      expect.objectContaining({ id: 'base:resource/resource-17', type: 'item', copies: 2, useEffect: expect.objectContaining({ body: expect.objectContaining({ kind: 'sequence' }) }) }),
    ]);
    expect(baseProvisionalFoundationContentPack.definitions
      .filter((definition) => definition.type !== 'starter' && !enabled.some(({ id }) => id === definition.id))
      .every(({ tags }) => tags?.includes('playtest:effects-disabled'))).toBe(true);
  });

  it('takes numeric mechanics from auditable candidates without exposing source names', () => {
    const candidates = new Map(baseProvisionalContentCatalog.candidates.map((candidate) => [candidate.definitionId, candidate]));
    for (const definition of baseProvisionalFoundationContentPack.definitions) {
      const candidate = candidates.get(definition.id);
      expect(candidate).toBeDefined();
      expect(definition.name).toMatch(/^候選/);
      expect(definition.name).not.toBe(candidate?.fields.find(({ field }) => field === 'sourceName')?.candidateValue);
      for (const field of ['cost', 'combat', 'purchasePower', 'honor'] as const) {
        expect(definition[field]).toBe(candidate?.fields.find((entry) => entry.field === field)?.candidateValue);
      }
    }
  });

  it('uses only the approved three-copy cycle anchor', () => {
    const anchors = baseProvisionalFoundationContentPack.definitions.filter(({ tags }) => tags?.includes('base:supply-cycle-anchor'));
    expect(anchors).toEqual([expect.objectContaining({ id: 'base:monster/monster-01', copies: 3 })]);
  });

  it('keeps provisional resource multiplicities explicitly owned by the digital pack', () => {
    expect(baseProvisionalFoundationContentPack.definitions.filter(({ type }) => type === 'item' || type === 'equipment'))
      .toEqual([
        expect.objectContaining({ id: 'base:resource/resource-02', copies: 2, cost: 3 }),
        expect.objectContaining({ id: 'base:resource/resource-08', copies: 2, cost: 4 }),
        expect.objectContaining({ id: 'base:resource/resource-10', copies: 2, cost: 3 }),
        expect.objectContaining({ id: 'base:resource/resource-17', copies: 2, cost: 4 }),
      ]);
  });
});
