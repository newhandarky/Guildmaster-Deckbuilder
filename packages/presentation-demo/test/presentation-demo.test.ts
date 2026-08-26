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
    expect(covered.size).toBe(120);
    expect(provisionalOriginalFullPresentationPack.entries.every(({ displayName, detailDisplayText }) => displayName.startsWith('候選') && detailDisplayText.includes('Provisional'))).toBe(true);
  });
  it('provides one non-placeholder condition summary for every full provisional bond', () => {
    const bonds = provisionalOriginalFullPresentationPack.entries.filter(({ definitionId }) => definitionId.startsWith('base:bond/'));
    expect(bonds).toHaveLength(30);
    expect(new Set(bonds.map(({ definitionId }) => definitionId))).toHaveLength(30);
    expect(bonds.every(({ shortDisplayText, detailDisplayText }) => shortDisplayText.length > 8 && !shortDisplayText.includes('99') && detailDisplayText.includes('Rules Module'))).toBe(true);
    expect(bonds[12]?.shortDisplayText).toContain('一個行動階段');
    expect(bonds[17]?.shortDisplayText).toContain('非基礎冒險者');
    expect(bonds[29]?.shortDisplayText).toContain('非起始冒險者');
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

  it('shows resource 12 combat-only mandatory removal boundary', () => {
    expect(provisionalOriginalFullPresentationPack.entries.find(({ definitionId }) => definitionId === 'base:resource/resource-12')).toMatchObject({
      shortDisplayText: expect.stringContaining('戰鬥'),
      detailDisplayText: expect.stringContaining('隊伍超額、休息或卡牌效果造成的離場不觸發'),
    });
  });

  it('shows the confirmed exact values and target boundaries for resources 11 and 22', () => {
    expect(provisionalOriginalFullPresentationPack.entries.find(({ definitionId }) => definitionId === 'base:resource/resource-11')).toMatchObject({
      shortDisplayText: expect.stringContaining('其他冒險者戰力各 +1'),
      detailDisplayText: expect.not.stringContaining('尚未啟用'),
    });
    expect(provisionalOriginalFullPresentationPack.entries.find(({ definitionId }) => definitionId === 'base:resource/resource-22')).toMatchObject({
      shortDisplayText: expect.stringContaining('魔物戰力 −1'),
      detailDisplayText: expect.stringContaining('沒有可選魔物時不可使用'),
    });
  });

  it('shows authoritative player copy for all fourteen enabled monsters', () => {
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
    expect(monsters.every(({ shortDisplayText, detailDisplayText }) => !shortDisplayText.includes('尚未啟用') && !detailDisplayText.includes('尚未啟用'))).toBe(true);
    expect(monsters.filter(({ definitionId }) => ['04', '05', '07', '08', '12', '13'].some((id) => definitionId === `base:monster/monster-${id}`)).every(({ detailDisplayText }) => detailDisplayText.includes('權威效果流程'))).toBe(true);
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

  it('shows adventurer 05 as a controller-scoped equipment discount', () => {
    expect(provisionalOriginalFullPresentationPack.entries.find(({ definitionId }) => definitionId === 'base:adventurer/adventurer-05')).toMatchObject({
      shortDisplayText: expect.stringContaining('裝備費用 −1'),
      detailDisplayText: expect.stringContaining('不替其他玩家折價'),
    });
  });

  it('shows player-facing position and target combat copy for the enabled B batch', () => {
    const expected = new Map([
      ['04', '第一位'], ['10', '第一位'], ['15', '第四或第五位'], ['20', '其他冒險者'], ['24', '魔物'], ['27', '相鄰'],
    ]);
    for (const [id, copy] of expected) {
      expect(provisionalOriginalFullPresentationPack.entries.find(({ definitionId }) => definitionId === `base:adventurer/adventurer-${id}`)).toMatchObject({
        shortDisplayText: expect.stringContaining(copy),
        detailDisplayText: expect.not.stringContaining('尚未啟用'),
      });
    }
  });

  it('shows the complete enabled boss 05 combat and reward boundary', () => {
    expect(provisionalOriginalFullPresentationPack.entries.find(({ definitionId }) => definitionId === 'base:boss/boss-05')).toMatchObject({
      shortDisplayText: expect.stringContaining('所有裝備失效'),
      detailDisplayText: expect.stringContaining('商店不立即補牌'),
    });
  });

  it('shows public combat and reward boundaries for bosses 01, 08, and 11', () => {
    const expected = new Map([
      ['01', ['商店中的裝備數', '費用 4 以下']],
      ['08', ['最前方 3 名', '招募區不立即補牌']],
      ['11', ['最前方 1 名', '裝備不是合法候選']],
    ]);
    for (const [id, copy] of expected) {
      const entry = provisionalOriginalFullPresentationPack.entries.find(({ definitionId }) => definitionId === `base:boss/boss-${id}`);
      expect(entry?.shortDisplayText).toContain(copy[0]);
      expect(entry?.detailDisplayText).toContain(copy[1]);
      expect(entry?.detailDisplayText).not.toContain('尚未啟用');
    }
  });

  it('shows dynamic profession combat and deck reward boundaries for bosses 06, 09, and 10', () => {
    const expected = new Map([
      ['06', ['完整隊伍每有 1 種職業', '牌庫不足時只取得現存牌']],
      ['09', ['左手邊玩家完整隊伍', 'active player 改變時會重新計算']],
      ['10', ['戰力 −1', '最低戰力為 0']],
    ]);
    for (const [id, copy] of expected) {
      const entry = provisionalOriginalFullPresentationPack.entries.find(({ definitionId }) => definitionId === `base:boss/boss-${id}`);
      expect(entry?.shortDisplayText).toContain(copy[0]);
      expect(entry?.detailDisplayText).toContain(copy[1]);
      expect(entry?.detailDisplayText).not.toContain('尚未啟用');
    }
  });

  it('shows boss 03 non-rollback combat failure and optional removal boundary', () => {
    expect(provisionalOriginalFullPresentationPack.entries.find(({ definitionId }) => definitionId === 'base:boss/boss-03')).toMatchObject({
      shortDisplayText: expect.stringContaining('無法支付時討伐失敗'),
      detailDisplayText: expect.stringContaining('已離場隊伍不回復'),
    });
  });

  it('shows boss 02 participant, equipment, shortage, and reward ordering boundaries', () => {
    expect(provisionalOriginalFullPresentationPack.entries.find(({ definitionId }) => definitionId === 'base:boss/boss-02')).toMatchObject({
      shortDisplayText: expect.stringContaining('依參戰人數補抽'),
      detailDisplayText: expect.stringContaining('裝備依各自離場規則'),
    });
    const detail = provisionalOriginalFullPresentationPack.entries.find(({ definitionId }) => definitionId === 'base:boss/boss-02')?.detailDisplayText ?? '';
    expect(detail).toContain('牌庫不足時只取得現存牌');
    expect(detail.indexOf('依全部參戰者人數')).toBeLessThan(detail.indexOf('擊敗後再取得 5 點購買力'));
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

  it('assigns stable unique remote portrait keys to every starter, adventurer, resource, monster, Boss, and helper', () => {
    expect(provisionalOriginalFullPresentationPack.entries.filter(({ definitionId }) => definitionId.startsWith('base:starter/adventurer-')).map(({ portraitAssetKey }) => portraitAssetKey)).toEqual(
      Array.from({ length: 5 }, (_, index) => `base:portrait/starter-adventurer-${String(index + 1).padStart(2, '0')}`),
    );
    expect(provisionalOriginalFullPresentationPack.entries.find(({ definitionId }) => definitionId === 'base:starter/summoning-stone')?.portraitAssetKey)
      .toBe('base:portrait/starter-summoning-stone');
    expect(provisionalOriginalFullPresentationPack.entries.find(({ definitionId }) => definitionId === 'base:starter/spirit-crystal')?.portraitAssetKey)
      .toBe('base:portrait/starter-spirit-crystal');
    expect(provisionalOriginalFullPresentationPack.entries.filter(({ definitionId }) => definitionId.startsWith('base:adventurer/')).map(({ portraitAssetKey }) => portraitAssetKey)).toEqual(
      Array.from({ length: 30 }, (_, index) => `base:portrait/adventurer-${String(index + 1).padStart(2, '0')}`),
    );
    expect([
      ...provisionalFoundationPresentationPack.entries,
      ...provisionalOriginalFullPresentationPack.entries.filter(({ definitionId }) => definitionId.startsWith('base:resource/')),
    ].map(({ portraitAssetKey }) => portraitAssetKey).sort()).toEqual(
      Array.from({ length: 28 }, (_, index) => `base:portrait/resource-${String(index + 1).padStart(2, '0')}`).sort(),
    );
    expect(provisionalOriginalFullPresentationPack.entries.filter(({ definitionId }) => definitionId.startsWith('base:monster/')).map(({ portraitAssetKey }) => portraitAssetKey)).toEqual(
      Array.from({ length: 14 }, (_, index) => `base:portrait/monster-${String(index + 1).padStart(2, '0')}`),
    );
    expect(provisionalOriginalFullPresentationPack.entries.filter(({ definitionId }) => definitionId.startsWith('base:boss/')).map(({ portraitAssetKey }) => portraitAssetKey)).toEqual(
      Array.from({ length: 11 }, (_, index) => `base:portrait/boss-${String(index + 1).padStart(2, '0')}`),
    );
    expect(provisionalHelpersPresentationPack.entries.map(({ portraitAssetKey }) => portraitAssetKey)).toEqual(
      Array.from({ length: 12 }, (_, index) => `base:portrait/helper-${String(index + 1).padStart(2, '0')}`),
    );
  });

  it('provides neutral copy for the five enabled Batch A helpers', () => {
    expect(validatePresentationPack(provisionalHelpersPresentationPack)).toEqual({ valid: true, errors: [] });
    expect(provisionalHelpersPresentationPack.entries).toHaveLength(12);
    expect(provisionalHelpersPresentationPack.entries.find(({ definitionId }) => definitionId.endsWith('helper-08')))
      .toMatchObject({ displayName: '候選協助者 08', shortDisplayText: expect.stringContaining('隊伍上限 +1') });
    expect(provisionalHelpersPresentationPack.entries.find(({ definitionId }) => definitionId.endsWith('helper-01'))?.shortDisplayText).toContain('物資費用 −1');
    expect(provisionalHelpersPresentationPack.entries.find(({ definitionId }) => definitionId.endsWith('helper-06'))?.shortDisplayText).toContain('冒險者費用 −1');
    expect(provisionalHelpersPresentationPack.entries.find(({ definitionId }) => definitionId.endsWith('helper-07'))?.shortDisplayText).toContain('抽 6 張');
    expect(provisionalHelpersPresentationPack.entries.find(({ definitionId }) => definitionId.endsWith('helper-09'))?.shortDisplayText).toContain('裝備費用 −1');
    expect(provisionalHelpersPresentationPack.entries.filter(({ definitionId }) => !['01', '06', '07', '08', '09'].some((suffix) => definitionId.endsWith(`helper-${suffix}`)))
      .every(({ shortDisplayText }) => shortDisplayText.includes('效果尚未啟用'))).toBe(true);
  });

  it('keeps the manifest JSON-only', () => {
    expect(JSON.parse(JSON.stringify(demoPresentationAssetManifest))).toEqual(demoPresentationAssetManifest);
  });
});
