import { describe, expect, it } from 'vitest';
import { createPresentationResolver, validatePresentationPack } from '@guildmaster/presentation-core';
import {
  baseRemoteAssetKeys,
  customAdventurerPresentationPack,
  customAmbiguousEffectDefinitionIds,
  customRemoteAssetHost,
  customRemoteAssetKeys,
  customRemoteAssetPolicy,
  resolveCustomRemoteAsset,
} from '../src/index.js';

describe('custom adventurer presentation', () => {
  it('contains all forty-eight display entries and forty-one allowlisted remote images', () => {
    expect(validatePresentationPack(customAdventurerPresentationPack)).toEqual({ valid: true, errors: [] });
    expect(customAdventurerPresentationPack.entries).toHaveLength(48);
    expect(customRemoteAssetKeys).toHaveLength(41);
    expect(customRemoteAssetPolicy).toEqual({
      sourceDocument: 'docs/card-data/自定義冒險者格式化資料.md',
      allowedHost: customRemoteAssetHost,
      transport: 'https-only',
      storage: 'client-presentation-only',
      rightsResponsibility: 'user-confirmation-required-before-public-release',
    });
    for (const key of customRemoteAssetKeys) {
      const asset = resolveCustomRemoteAsset(key);
      expect(new URL(asset!.src).hostname).toBe(customRemoteAssetHost);
      expect(new URL(asset!.src).protocol).toBe('https:');
    }
  });

  it('allowlists all base Boss and helper remote images on the same HTTPS host', () => {
    expect(baseRemoteAssetKeys).toEqual([
      ...Array.from({ length: 12 }, (_, index) => `base:portrait/helper-${String(index + 1).padStart(2, '0')}`),
      ...Array.from({ length: 11 }, (_, index) => `base:portrait/boss-${String(index + 1).padStart(2, '0')}`),
    ]);
    for (const key of baseRemoteAssetKeys) {
      const asset = resolveCustomRemoteAsset(key);
      expect(asset).toBeDefined();
      expect(new URL(asset!.src).hostname).toBe(customRemoteAssetHost);
      expect(new URL(asset!.src).protocol).toBe('https:');
      expect(decodeURIComponent(new URL(asset!.src).pathname)).toContain(key.replace('base:portrait/', ''));
    }
  });

  it('keeps missing and unknown artwork on the presentation fallback path', () => {
    expect(customAdventurerPresentationPack.entries.filter(({ portraitAssetKey }) => portraitAssetKey === 'placeholder:custom-adventurer').map(({ definitionId }) => definitionId)).toEqual([
      'custom:adventurer/melee-08',
      'custom:adventurer/melee-09',
      'custom:adventurer/mage-08',
      'custom:adventurer/tank-10',
      'custom:adventurer/support-10',
      'custom:adventurer/ranged-04',
      'custom:adventurer/ranged-06',
    ]);
    expect(resolveCustomRemoteAsset('placeholder:custom-adventurer')).toBeUndefined();
    expect(resolveCustomRemoteAsset('custom:portrait/not-registered')).toBeUndefined();
    const resolver = createPresentationResolver([customAdventurerPresentationPack], { resolveAsset: resolveCustomRemoteAsset });
    const missing = resolver.resolve('custom:adventurer/melee-08');
    expect(missing.displayName).toBe('阿爾梅斯');
    expect(missing.portraitAsset.src).toBeUndefined();
  });

  it('marks every ambiguous custom effect as numeric-only instead of implying that it is active', () => {
    for (const definitionId of customAmbiguousEffectDefinitionIds) {
      const entry = customAdventurerPresentationPack.entries.find((candidate) => candidate.definitionId === definitionId)!;
      expect(entry.shortDisplayText).toContain('技能尚未啟用');
      expect(entry.detailDisplayText).toContain('本模式僅套用卡牌數值');
    }
  });

  it('presents the confirmed mage and tank profession-threshold auras', () => {
    const resolver = createPresentationResolver([customAdventurerPresentationPack], { resolveAsset: resolveCustomRemoteAsset });
    expect(resolver.resolve('custom:adventurer/mage-07')).toMatchObject({
      displayName: 'ロキシー・ミグルディア',
      shortDisplayText: '隊伍中至少有 3 位法師時，每位法師戰力 +2。',
    });
    expect(resolver.resolve('custom:adventurer/tank-09')).toMatchObject({
      displayName: 'ヨル・フォージャー',
      shortDisplayText: '隊伍中至少有 3 位坦克時，每位坦克戰力 +2。',
    });
  });
});
