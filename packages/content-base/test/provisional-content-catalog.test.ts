import { describe, expect, it } from 'vitest';
import { baseProvisionalContentCatalog, validateProvisionalBaseContentCatalog } from '../src/provisional/index.js';

describe('base provisional content catalog', () => {
  it('keeps visual-evidence candidates non-runtime and auditable', () => {
    expect(validateProvisionalBaseContentCatalog(baseProvisionalContentCatalog)).toEqual([]);
    expect(baseProvisionalContentCatalog.candidates).toHaveLength(7 + 30 + 28 + 14 + 11 + 30 + 12);
    expect(baseProvisionalContentCatalog.candidates.every((candidate) => candidate.activation === 'disabled' && !candidate.runtimeLoadable)).toBe(true);
    expect(baseProvisionalContentCatalog.evidence.every((source) => source.repositoryAsset === 'not-committed')).toBe(true);
  });

  it('uses neutral mechanics IDs and retains official names only as source metadata', () => {
    const ids = baseProvisionalContentCatalog.candidates.map((candidate) => candidate.definitionId);
    expect(ids).toContain('base:starter/adventurer-01');
    expect(ids).toContain('base:starter/summoning-stone');
    expect(ids.some((id) => /麥娜|慕莎|卡儂|修爾蒂|辛芙妮/.test(id))).toBe(false);
  });

  it('requires a reason for every exception and does not promote provisional data to verified', () => {
    const fields = baseProvisionalContentCatalog.candidates.flatMap((candidate) => candidate.fields);
    expect(fields.filter((field) => field.status === 'exception').every((field) => Boolean(field.exceptionReason))).toBe(true);
    expect(fields.some((field) => field.status === 'provisional')).toBe(true);
    expect(fields.some((field) => field.status === 'verified')).toBe(true); // FAQ-confirmed errata only
  });

  it('maps adventurer professions, resource affinities, and the six previously incomplete effects', () => {
    const find = (id: string) => baseProvisionalContentCatalog.candidates.find((candidate) => candidate.definitionId === id)!;
    const value = (id: string, field: string) => find(id).fields.find((entry) => entry.field === field)!;
    expect(value('base:adventurer/adventurer-01', 'profession').candidateValue).toBe('support');
    expect(value('base:adventurer/adventurer-02', 'profession').candidateValue).toBe('melee');
    expect(value('base:adventurer/adventurer-03', 'profession').candidateValue).toBe('mage');
    expect(value('base:adventurer/adventurer-04', 'profession').candidateValue).toBe('tank');
    expect(value('base:adventurer/adventurer-07', 'profession').candidateValue).toBe('ranged');
    expect(value('base:starter/adventurer-01', 'profession')).toMatchObject({ candidateValue: 'support', sourceLocation: expect.stringContaining('第 1 張') });
    expect(value('base:starter/adventurer-02', 'profession')).toMatchObject({ candidateValue: 'melee', sourceLocation: expect.stringContaining('第 5 張') });
    expect(value('base:starter/adventurer-03', 'profession')).toMatchObject({ candidateValue: 'mage', sourceLocation: expect.stringContaining('第 2 張') });
    expect(value('base:starter/adventurer-04', 'profession')).toMatchObject({ candidateValue: 'tank', sourceLocation: expect.stringContaining('第 3 張') });
    expect(value('base:starter/adventurer-05', 'profession')).toMatchObject({ candidateValue: 'ranged', sourceLocation: expect.stringContaining('第 4 張') });
    expect(find('base:resource/resource-13').mechanicsTags).toBeUndefined();
    expect(find('base:resource/resource-19').mechanicsTags).toEqual(['affinity:mage', 'affinity:support']);
    for (const id of ['adventurer-06', 'adventurer-09', 'adventurer-19', 'adventurer-22', 'adventurer-26', 'adventurer-29']) {
      expect(value(`base:adventurer/${id}`, 'effect')).toMatchObject({ status: 'provisional', confidence: 'medium' });
    }
  });

  it('records the approved cycle anchor as project policy without enabling provisional content', () => {
    const anchor = baseProvisionalContentCatalog.candidates.find(({ definitionId }) => definitionId === 'base:monster/monster-01')!;
    expect(anchor.fields.find(({ field }) => field === 'copies')).toMatchObject({ candidateValue: 3, sourceIds: ['project-policy:base-supply-continuity-2026-07-31'] });
    expect(anchor.mechanicsTags).toEqual(['base:supply-cycle-anchor']);
    expect(anchor).toMatchObject({ activation: 'disabled', runtimeLoadable: false });
    expect(baseProvisionalContentCatalog.evidence.find(({ sourceId }) => sourceId === 'project-policy:base-supply-continuity-2026-07-31')).toMatchObject({ evidenceKind: 'project-policy' });
  });

  it('records the four profession-matched equipment bonuses as confirmed +1 values', () => {
    for (const id of ['02', '03', '07', '25']) {
      const resource = baseProvisionalContentCatalog.candidates.find(({ definitionId }) => definitionId === `base:resource/resource-${id}`)!;
      expect(resource.fields.find(({ field }) => field === 'effect')).toMatchObject({
        status: 'provisional',
        confidence: 'high',
        candidateValue: expect.stringContaining('戰力 1'),
      });
    }
  });

  it('keeps corrected card-kind icons and resource 19/20 text from regressing', () => {
    const effect = (id: string) => baseProvisionalContentCatalog.candidates.find(({ definitionId }) => definitionId === id)!.fields.find(({ field }) => field === 'effect')!.candidateValue;
    expect(effect('base:resource/resource-19')).toContain('討伐階段結束時');
    expect(effect('base:resource/resource-19')).toContain('抽 2 張牌');
    expect(effect('base:resource/resource-20')).toContain('棄置任意數量手牌');
    expect(effect('base:adventurer/adventurer-16')).toContain('查看牌庫頂');
    expect(effect('base:adventurer/adventurer-16')).toContain('公開該牌以確認類型');
    expect(effect('base:bond/bond-06')).toContain('道具或裝備');
    expect(effect('base:bond/bond-13')).toContain('3 張以上道具');
    expect(effect('base:bond/bond-25')).toContain('3 張以上魔物');
    expect(effect('base:monster/monster-07')).toContain('道具或裝備');
    expect(effect('base:boss/boss-11')).toContain('道具');
  });

  it('rejects non-finite, fractional, negative, and duplicate mechanics fields', () => {
    const invalid = structuredClone(baseProvisionalContentCatalog);
    const candidate = invalid.candidates[0]!; const copies = candidate.fields.find((field) => field.field === 'copies')!;
    copies.candidateValue = Number.POSITIVE_INFINITY;
    candidate.fields = [...candidate.fields, { ...copies }];
    const errors = validateProvisionalBaseContentCatalog(invalid);
    expect(errors.some((error) => error.includes('finite integer'))).toBe(true);
    expect(errors.some((error) => error.includes('Duplicate field'))).toBe(true);
  });
});
