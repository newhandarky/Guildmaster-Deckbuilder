import type {
  PresentationAssetManifest,
  PresentationPack,
} from '@guildmaster/presentation-core';
import assetManifest from '../assets/manifest.json';

const entry = (definitionId: string, displayName: string, assetKey: string) => ({
  definitionId,
  displayName,
  portraitAssetKey: assetKey,
  portraitAltText: `${displayName}的原創示範插畫`,
  shortDisplayText: '原創文字 placeholder。',
  detailDisplayText: '目前只有中性文字版；核准插畫將由獨立素材 manifest 漸進載入。',
});

/** Demo-specific display data; mechanics remain owned by the Content Pack. */
export const demoPresentationPack: PresentationPack = {
  manifest: {
    id: 'presentation:demo-neutral',
    version: '2.0.0',
    theme: 'neutral-text',
    locale: 'zh-TW',
  },
  entries: [
    entry('base:starter/newcomer', '起始牌 A', 'demo:starter/newcomer'),
    entry('base:starter/guiding-stone', '起始石 A', 'demo:starter/guiding-stone'),
    entry('base:starter/moon-crystal', '起始結晶 A', 'demo:starter/moon-crystal'),
    entry('base:adventurer/shield-bearer', '冒險者 A', 'demo:adventurer/shield-bearer'),
    entry('base:adventurer/ranger', '冒險者 B', 'demo:adventurer/ranger'),
    entry('base:adventurer/ember-mage', '冒險者 C', 'demo:adventurer/ember-mage'),
    entry('base:adventurer/captain', '冒險者 D', 'demo:adventurer/captain'),
    entry('base:equipment/iron-spear', '裝備 A', 'demo:equipment/iron-spear'),
    entry('base:equipment/star-cloak', '裝備 B', 'demo:equipment/star-cloak'),
    entry('base:item/trail-rations', '道具 A', 'demo:item/trail-rations'),
    entry('base:item/trade-token', '道具 B', 'demo:item/trade-token'),
    entry('base:monster/mire-wolf', '魔物 A', 'demo:monster/mire-wolf'),
    entry('base:monster/cave-giant', '魔物 B', 'demo:monster/cave-giant'),
    entry('base:monster/ash-drake', '魔物 C', 'demo:monster/ash-drake'),
    entry('base:boss/ruin-warden', '目標 A', 'demo:boss/ruin-warden'),
    entry('base:boss/frost-regent', '目標 B', 'demo:boss/frost-regent'),
    entry('base:boss/void-duke', '目標 C', 'demo:boss/void-duke'),
    entry('base:boss/cinder-queen', '目標 D', 'demo:boss/cinder-queen'),
  ],
};

/** Internal neutral copy for the first provisional resource slice. */
export const provisionalFoundationPresentationPack: PresentationPack = {
  manifest: {
    id: 'presentation:provisional-foundation-neutral',
    version: '7.0.0',
    theme: 'neutral-text',
    locale: 'zh-TW',
  },
  entries: [
    {
      definitionId: 'base:resource/resource-01',
      displayName: '候選物資 01',
      portraitAssetKey: 'placeholder:provisional-item',
      portraitAltText: '候選道具的中性圖像 placeholder',
      shortDisplayText: '使用：從棄牌堆取回 1 張冒險者。',
      detailDisplayText: '行動階段使用後，選擇自己棄牌堆中的 1 張冒險者加入手牌；此為 provisional 候選效果。',
    },
    {
      definitionId: 'base:resource/resource-02',
      displayName: '候選物資 02',
      portraitAssetKey: 'placeholder:provisional-equipment',
      portraitAltText: '候選裝備的中性圖像 placeholder',
      shortDisplayText: '候選裝備；加成數值待確認，效果尚未啟用。',
      detailDisplayText: '可測試購買與配戴流程；已具備依配戴者職業修正戰力的通用能力，但來源尚未確認此卡的確切加成數值，因此個別效果維持停用。',
    },
    {
      definitionId: 'base:resource/resource-04',
      displayName: '候選物資 04',
      portraitAssetKey: 'placeholder:provisional-item',
      portraitAltText: '候選道具的中性圖像 placeholder',
      shortDisplayText: '使用：棄 1 張魔王，然後抽 3 張牌。',
      detailDisplayText: '行動階段使用後，從手牌選擇並棄置 1 張魔王，再抽 3 張牌；此為 provisional 候選效果。',
    },
    {
      definitionId: 'base:resource/resource-05',
      displayName: '候選物資 05',
      portraitAssetKey: 'placeholder:provisional-item',
      portraitAltText: '候選道具的中性圖像 placeholder',
      shortDisplayText: '使用：從棄牌堆取回 1 張裝備。',
      detailDisplayText: '行動階段使用後，選擇自己棄牌堆中的 1 張裝備加入手牌；此為 provisional 候選效果。',
    },
    {
      definitionId: 'base:resource/resource-08',
      displayName: '候選物資 08',
      portraitAssetKey: 'placeholder:provisional-item',
      portraitAltText: '候選道具的中性圖像 placeholder',
      shortDisplayText: '使用：抽 2 張牌。',
      detailDisplayText: '行動階段使用後抽 2 張牌；此為 provisional 候選效果，尚不代表正式卡表。',
    },
    {
      definitionId: 'base:resource/resource-10',
      displayName: '候選物資 10',
      portraitAssetKey: 'placeholder:provisional-item',
      portraitAltText: '候選道具的中性圖像 placeholder',
      shortDisplayText: '使用：棄 1 張手牌，然後抽 2 張牌。',
      detailDisplayText: '行動階段使用後選擇並棄置 1 張手牌，再抽 2 張牌；此為 provisional 候選效果。',
    },
    {
      definitionId: 'base:resource/resource-13',
      displayName: '候選物資 13',
      portraitAssetKey: 'placeholder:provisional-item',
      portraitAltText: '候選道具的中性圖像 placeholder',
      shortDisplayText: '使用：從棄牌堆取回 1 張非同名法師卡。',
      detailDisplayText: '行動階段使用後，選擇自己棄牌堆中的 1 張法師關聯卡加入手牌；同名物資不能被選擇。此為 provisional 候選效果。',
    },
    {
      definitionId: 'base:resource/resource-15',
      displayName: '候選物資 15',
      portraitAssetKey: 'placeholder:provisional-item',
      portraitAltText: '候選道具的中性圖像 placeholder',
      shortDisplayText: '使用：從手牌、隊伍或棄牌堆移除 1 張牌。',
      detailDisplayText: '行動階段使用後，從自己的手牌、隊伍或棄牌堆選擇 1 張牌移出遊戲；若移除配戴裝備的隊員，其裝備置入棄牌堆。此為 provisional 候選效果。',
    },
    {
      definitionId: 'base:resource/resource-17',
      displayName: '候選物資 17',
      portraitAssetKey: 'placeholder:provisional-item',
      portraitAltText: '候選道具的中性圖像 placeholder',
      shortDisplayText: '使用：抽 3 張牌，然後棄 1 張手牌。',
      detailDisplayText: '行動階段使用後抽 3 張牌，再選擇並棄置 1 張手牌；此為 provisional 候選效果。',
    },
    {
      definitionId: 'base:resource/resource-18',
      displayName: '候選物資 18',
      portraitAssetKey: 'placeholder:provisional-equipment',
      portraitAltText: '候選裝備的中性圖像 placeholder',
      shortDisplayText: '配戴者仍在隊伍時，每次擊敗目標後抽 1 張牌。',
      detailDisplayText: '本次行動玩家擊敗目標後，若此裝備仍掛在自己的隊伍中，該裝備實例會觸發並抽 1 張牌；多個實例各自觸發。此為 provisional 候選效果。',
    },
    {
      definitionId: 'base:resource/resource-27',
      displayName: '候選物資 27',
      portraitAssetKey: 'placeholder:provisional-item',
      portraitAltText: '候選道具的中性圖像 placeholder',
      shortDisplayText: '使用：依目前隊伍中的職業種類數抽牌。',
      detailDisplayText: '行動階段使用後，計算目前隊伍中不同的冒險者職業種類，並抽取等量卡牌；同職業只計算一次。此為 provisional 候選效果。',
    },
  ],
};

const fullExistingResourceEntries = new Set(['01','02','04','05','08','10','13','15','17','18','27']);
const fullNeutralEntry = (definitionId: string, displayName: string, kind: 'starter' | 'adventurer' | 'item' | 'equipment' | 'monster' | 'boss') => ({
  definitionId, displayName,
  portraitAssetKey: `placeholder:provisional-${kind}`,
  portraitAltText: `${displayName} 的中性圖像 placeholder`,
  shortDisplayText: '候選數值已載入；個別效果尚未啟用。',
  detailDisplayText: '此卡屬於基礎版原作衍生 Provisional 測試。數值與非官方數位張數可供完整流程測試；未完成第二人覆核的個別效果保持停用。',
});
export const provisionalOriginalFullPresentationPack: PresentationPack = {
  manifest: { id: 'presentation:provisional-original-full-neutral', version: '1.0.0', theme: 'neutral-text', locale: 'zh-TW' },
  entries: [
    ...Array.from({ length: 5 }, (_, index) => fullNeutralEntry(`base:starter/adventurer-${String(index + 1).padStart(2, '0')}`, `候選起始冒險者 ${String(index + 1).padStart(2, '0')}`, 'starter')),
    fullNeutralEntry('base:starter/summoning-stone', '候選起始資源 A', 'starter'), fullNeutralEntry('base:starter/spirit-crystal', '候選起始資源 B', 'starter'),
    ...Array.from({ length: 30 }, (_, index) => fullNeutralEntry(`base:adventurer/adventurer-${String(index + 1).padStart(2, '0')}`, `候選冒險者 ${String(index + 1).padStart(2, '0')}`, 'adventurer')),
    ...Array.from({ length: 28 }, (_, index) => String(index + 1).padStart(2, '0')).filter((id) => !fullExistingResourceEntries.has(id)).map((id) => fullNeutralEntry(`base:resource/resource-${id}`, `候選物資 ${id}`, [2,3,7,9,11,12,14,16,18,19,20,21,24,25].includes(Number(id)) ? 'equipment' : 'item')),
    ...Array.from({ length: 14 }, (_, index) => fullNeutralEntry(`base:monster/monster-${String(index + 1).padStart(2, '0')}`, `候選魔物 ${String(index + 1).padStart(2, '0')}`, 'monster')),
    ...Array.from({ length: 11 }, (_, index) => fullNeutralEntry(`base:boss/boss-${String(index + 1).padStart(2, '0')}`, `候選魔王 ${String(index + 1).padStart(2, '0')}`, 'boss')),
  ],
};

/** Neutral client-only copy for the provisional helper rotation slice. */
export const provisionalHelpersPresentationPack: PresentationPack = {
  manifest: {
    id: 'presentation:provisional-helpers-neutral',
    version: '1.0.0',
    theme: 'neutral-text',
    locale: 'zh-TW',
  },
  entries: Array.from({ length: 12 }, (_, index) => {
    const sequence = String(index + 1).padStart(2, '0');
    const enabled = sequence === '08';
    return {
      definitionId: `base:helper/helper-${sequence}`,
      displayName: `候選協助者 ${sequence}`,
      portraitAssetKey: 'placeholder:provisional-helper',
      portraitAltText: `候選協助者 ${sequence} 的中性圖像 placeholder`,
      shortDisplayText: enabled
        ? '所有玩家隊伍上限 +1；離場時棄置最右側的超額隊員。'
        : '目前僅測試揭示與輪替，卡牌效果尚未啟用。',
      detailDisplayText: enabled
        ? '此協助者在場時，所有玩家的隊伍上限為 6。離場後若隊伍超過 5 人，立即將最右側隊員及其裝備放入該玩家棄牌堆。'
        : '此 provisional 協助者會參與本局抽選、揭示、離場與輪替；第一階段尚未啟用其個別卡牌效果。',
    };
  }),
};

/**
 * Only approved runtime assets belong here. Empty/partial coverage is valid and
 * deliberately leaves the Web client on its neutral CSS placeholder.
 */
export const demoPresentationAssetManifest: PresentationAssetManifest = assetManifest;

export const demoPresentationAssetKeys = demoPresentationPack.entries
  .map((presentationEntry) => presentationEntry.portraitAssetKey)
  .sort();
