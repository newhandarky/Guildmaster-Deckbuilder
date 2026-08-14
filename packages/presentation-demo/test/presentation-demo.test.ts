import {
  createPresentationAssetRegistry,
  validatePresentationAssetManifest,
  validatePresentationPack,
} from '@guildmaster/presentation-core';
import { describe, expect, it } from 'vitest';
import {
  demoPresentationAssetKeys,
  demoPresentationAssetManifest,
  demoPresentationPack,
  provisionalFoundationPresentationPack,
  provisionalHelpersPresentationPack,
  provisionalOriginalFullPresentationPack,
} from '../src/index.js';

describe('demo presentation package', () => {
  it('covers every full provisional runtime definition with neutral copy', () => {
    expect(validatePresentationPack(provisionalOriginalFullPresentationPack)).toEqual({ valid: true, errors: [] });
    const covered = new Set([...provisionalFoundationPresentationPack.entries, ...provisionalOriginalFullPresentationPack.entries].map(({ definitionId }) => definitionId));
    expect(covered.size).toBe(90);
    expect(provisionalOriginalFullPresentationPack.entries.every(({ displayName, detailDisplayText }) => displayName.startsWith('候選') && detailDisplayText.includes('Provisional'))).toBe(true);
  });
  it('provides a valid complete demo Presentation Pack with stable unique asset keys', () => {
    expect(validatePresentationPack(demoPresentationPack)).toEqual({ valid: true, errors: [] });
    expect(demoPresentationPack.entries).toHaveLength(18);
    expect(new Set(demoPresentationAssetKeys)).toHaveLength(18);
    expect(demoPresentationAssetKeys.every((key) => key.startsWith('demo:'))).toBe(true);
  });

  it('provides explicit neutral copy for enabled and disabled provisional resources', () => {
    expect(validatePresentationPack(provisionalFoundationPresentationPack)).toEqual({ valid: true, errors: [] });
    expect(provisionalFoundationPresentationPack.entries).toEqual([
      expect.objectContaining({ definitionId: 'base:resource/resource-01', shortDisplayText: expect.stringContaining('取回 1 張冒險者') }),
      expect.objectContaining({ definitionId: 'base:resource/resource-02', shortDisplayText: expect.stringContaining('額外 +1') }),
      expect.objectContaining({ definitionId: 'base:resource/resource-04', shortDisplayText: expect.stringContaining('棄 1 張魔王') }),
      expect.objectContaining({ definitionId: 'base:resource/resource-05', shortDisplayText: expect.stringContaining('取回 1 張裝備') }),
      expect.objectContaining({ definitionId: 'base:resource/resource-08', shortDisplayText: '使用：抽 2 張牌。' }),
      expect.objectContaining({ definitionId: 'base:resource/resource-10', shortDisplayText: expect.stringContaining('棄 1 張手牌') }),
      expect.objectContaining({ definitionId: 'base:resource/resource-13', shortDisplayText: expect.stringContaining('非同名道具卡') }),
      expect.objectContaining({ definitionId: 'base:resource/resource-15', shortDisplayText: expect.stringContaining('手牌、隊伍或棄牌堆') }),
      expect.objectContaining({ definitionId: 'base:resource/resource-17', shortDisplayText: expect.stringContaining('抽 3 張牌') }),
      expect.objectContaining({ definitionId: 'base:resource/resource-18', shortDisplayText: expect.stringContaining('擊敗目標後抽 1 張牌') }),
      expect.objectContaining({ definitionId: 'base:resource/resource-27', shortDisplayText: expect.stringContaining('職業種類數') }),
    ]);
  });

  it('shows the confirmed profession-matched +1 copy in the full presentation', () => {
    for (const id of ['03', '07', '25']) {
      expect(provisionalOriginalFullPresentationPack.entries).toContainEqual(expect.objectContaining({
        definitionId: `base:resource/resource-${id}`,
        shortDisplayText: expect.stringContaining('額外 +1'),
      }));
    }
  });

  it('shows authoritative copy only for the enabled first monster reward batch', () => {
    const monsters = provisionalOriginalFullPresentationPack.entries.filter(({ definitionId }) => definitionId.startsWith('base:monster/'));
    expect(monsters).toHaveLength(14);
    expect(monsters.filter(({ shortDisplayText }) => shortDisplayText.startsWith('擊敗獎勵')).map(({ definitionId }) => definitionId)).toEqual([
      'base:monster/monster-01',
      'base:monster/monster-02',
      'base:monster/monster-03',
      'base:monster/monster-06',
      'base:monster/monster-09',
      'base:monster/monster-10',
      'base:monster/monster-11',
      'base:monster/monster-14',
    ]);
    expect(monsters.filter(({ definitionId }) => !['01', '02', '03', '06', '09', '10', '11', '14'].some((id) => definitionId === `base:monster/monster-${id}`)).every(({ shortDisplayText }) => shortDisplayText.includes('尚未啟用'))).toBe(true);
  });

  it('shows the enabled adventurer equipment restriction instead of a placeholder', () => {
    expect(provisionalOriginalFullPresentationPack.entries.find(({ definitionId }) => definitionId === 'base:adventurer/adventurer-02')).toMatchObject({
      shortDisplayText: expect.stringContaining('不能配戴裝備'),
      detailDisplayText: expect.stringContaining('Legal Commands'),
    });
  });

  it('shows adventurer 09 as a mandatory equipped passive rather than an optional action', () => {
    expect(provisionalOriginalFullPresentationPack.entries.find(({ definitionId }) => definitionId === 'base:adventurer/adventurer-09')).toMatchObject({
      shortDisplayText: expect.stringContaining('配戴任一裝備時'),
      detailDisplayText: expect.stringContaining('持續效果'),
    });
  });

  it('allows an approved asset manifest to cover none or part of the presentation pack', () => {
    expect(validatePresentationAssetManifest(demoPresentationAssetManifest)).toEqual({ valid: true, errors: [] });
    const registry = createPresentationAssetRegistry(demoPresentationAssetManifest, {
      expectedAssetKeys: demoPresentationAssetKeys,
    });
    expect(registry.resolveAsset(demoPresentationAssetKeys[0]!)).toBeUndefined();
    expect(registry.diagnostics).toHaveLength(18);
    expect(registry.diagnostics).toEqual([...registry.diagnostics].sort());
  });

  it('provides neutral helper copy and marks only helper 08 as enabled', () => {
    expect(validatePresentationPack(provisionalHelpersPresentationPack)).toEqual({ valid: true, errors: [] });
    expect(provisionalHelpersPresentationPack.entries).toHaveLength(12);
    expect(provisionalHelpersPresentationPack.entries.find(({ definitionId }) => definitionId.endsWith('helper-08')))
      .toMatchObject({ displayName: '候選協助者 08', shortDisplayText: expect.stringContaining('隊伍上限 +1') });
    expect(provisionalHelpersPresentationPack.entries.filter(({ definitionId }) => !definitionId.endsWith('helper-08'))
      .every(({ shortDisplayText }) => shortDisplayText.includes('效果尚未啟用'))).toBe(true);
  });

  it('keeps the manifest JSON-only', () => {
    expect(JSON.parse(JSON.stringify(demoPresentationAssetManifest))).toEqual(demoPresentationAssetManifest);
  });
});
