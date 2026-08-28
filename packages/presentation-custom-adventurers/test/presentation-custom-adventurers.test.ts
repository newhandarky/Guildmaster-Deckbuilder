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
  it('contains all forty-five display entries and forty-one allowlisted remote images', () => {
    expect(validatePresentationPack(customAdventurerPresentationPack)).toEqual({ valid: true, errors: [] });
    expect(customAdventurerPresentationPack.entries).toHaveLength(45);
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

  it('allowlists all base starter, Boss, helper, monster, resource, and adventurer remote images on the same HTTPS host', () => {
    expect(baseRemoteAssetKeys).toEqual([
      ...Array.from({ length: 12 }, (_, index) => `base:portrait/helper-${String(index + 1).padStart(2, '0')}`),
      ...Array.from({ length: 11 }, (_, index) => `base:portrait/boss-${String(index + 1).padStart(2, '0')}`),
      ...Array.from({ length: 14 }, (_, index) => `base:portrait/monster-${String(index + 1).padStart(2, '0')}`),
      ...Array.from({ length: 28 }, (_, index) => `base:portrait/resource-${String(index + 1).padStart(2, '0')}`),
      ...Array.from({ length: 30 }, (_, index) => `base:portrait/adventurer-${String(index + 1).padStart(2, '0')}`),
      ...Array.from({ length: 5 }, (_, index) => `base:portrait/starter-adventurer-${String(index + 1).padStart(2, '0')}`),
      'base:portrait/starter-summoning-stone',
      'base:portrait/starter-spirit-crystal',
    ]);
    for (const key of baseRemoteAssetKeys) {
      const asset = resolveCustomRemoteAsset(key);
      expect(asset).toBeDefined();
      expect(new URL(asset!.src).hostname).toBe(customRemoteAssetHost);
      expect(new URL(asset!.src).protocol).toBe('https:');
      expect(decodeURIComponent(new URL(asset!.src).pathname)).toContain(key.replace('base:portrait/', ''));
    }
  });

  it('resolves artwork for every custom adventurer, including replacements that reuse base portraits', () => {
    expect(customAdventurerPresentationPack.entries.map(({ definitionId, portraitAssetKey }) => [definitionId, portraitAssetKey]).filter(([, portraitAssetKey]) => portraitAssetKey?.startsWith('base:'))).toEqual([
      ['custom:adventurer/melee-08', 'base:portrait/adventurer-21'],
      ['custom:adventurer/melee-09', 'base:portrait/adventurer-24'],
      ['custom:adventurer/mage-08', 'base:portrait/adventurer-29'],
      ['custom:adventurer/ranged-04', 'base:portrait/adventurer-26'],
    ]);
    for (const { definitionId, portraitAssetKey } of customAdventurerPresentationPack.entries) {
      expect(resolveCustomRemoteAsset(portraitAssetKey), definitionId).toBeDefined();
    }
  });

  it('keeps unknown artwork on the presentation fallback path', () => {
    expect(resolveCustomRemoteAsset('placeholder:custom-adventurer')).toBeUndefined();
    expect(resolveCustomRemoteAsset('custom:portrait/not-registered')).toBeUndefined();
    const resolver = createPresentationResolver([customAdventurerPresentationPack], { resolveAsset: resolveCustomRemoteAsset });
    const missing = resolver.resolve('custom:adventurer/not-registered');
    expect(missing.portraitAsset.src).toBeUndefined();
  });

  it('has no remaining ambiguous custom effects after the four confirmed skills were enabled', () => {
    expect(customAmbiguousEffectDefinitionIds).toEqual([]);
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
