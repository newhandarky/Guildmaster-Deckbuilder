import { createPresentationAssetRegistry, createPresentationResolver } from '@guildmaster/presentation-core';
import { createLifecycleCopyResolver } from '../ui/lifecycle/lifecycle-copy.js';
import {
  demoPresentationAssetKeys,
  demoPresentationAssetManifest,
  demoPresentationPack,
  provisionalFoundationPresentationPack,
  provisionalOriginalFullPresentationPack,
  provisionalHelpersPresentationPack,
} from '@guildmaster/presentation-demo';
import {
  customAdventurerPresentationPack,
  resolveCustomRemoteAsset,
} from '@guildmaster/presentation-custom-adventurers';

/** Client-only composition. Nothing in this module is authoritative game state. */
export const presentationAssetRegistry = createPresentationAssetRegistry(
  demoPresentationAssetManifest,
  { expectedAssetKeys: demoPresentationAssetKeys },
);

const e2eAssetMode = import.meta.env.MODE === 'e2e'
  ? new URLSearchParams(window.location.search).get('e2ePresentationAsset')
  : null;
const resolveAsset = (assetKey: string) => {
  if (e2eAssetMode && assetKey === 'demo:starter/newcomer') {
    const src = e2eAssetMode === 'broken' ? '/__e2e__/missing-card.webp' : '/__e2e__/card-art.svg';
    return {
      src,
      srcSet: `${src}?width=384 384w, ${src}?width=768 768w`,
      width: 768,
      height: 1024,
      objectPosition: '35% 25%',
    };
  }
  return resolveCustomRemoteAsset(assetKey) ?? presentationAssetRegistry.resolveAsset(assetKey);
};

export const presentationResolver = createPresentationResolver(
  [
    demoPresentationPack,
    provisionalFoundationPresentationPack,
    provisionalOriginalFullPresentationPack,
    provisionalHelpersPresentationPack,
    customAdventurerPresentationPack,
  ],
  { resolveAsset },
);

export const lifecycleCopyResolver = createLifecycleCopyResolver({
  choices: [
    { choiceId: 'base:adventurer/adventurer-11-order-top-three', title: '整理牌庫頂三張牌', description: '可移除至多一張，並選擇其餘卡牌由底至頂的放回順序。' },
    { choiceId: 'base:resource/resource-01-recover-adventurer', title: '選擇要取回的冒險者', description: '將選擇的冒險者從棄牌堆加入手牌。' },
    { choiceId: 'base:resource/resource-04-discard-boss', title: '選擇要棄置的魔王', description: '棄置選擇的魔王後，抽 3 張牌。' },
    { choiceId: 'base:resource/resource-05-recover-equipment', title: '選擇要取回的裝備', description: '將選擇的裝備從棄牌堆加入手牌。' },
    { choiceId: 'base:resource/resource-10-discard', title: '選擇要棄置的手牌', description: '棄置選擇的手牌後，抽 2 張牌。' },
    { choiceId: 'base:resource/resource-13-recover-item-card', title: '選擇要取回的道具卡', description: '將選擇的非同名道具卡從棄牌堆加入手牌。' },
    { choiceId: 'base:resource/resource-15-remove', title: '選擇要移除的卡牌', description: '從自己的手牌、隊伍或棄牌堆選擇 1 張牌移出遊戲。' },
    { choiceId: 'base:resource/resource-17-discard', title: '選擇要棄置的手牌', description: '這張道具已抽牌；請選擇 1 張手牌棄置。' },
    { choiceId: 'base:adventurer/adventurer-13-remove-discard', title: '選擇要移除的棄牌', description: '可以從自己的棄牌堆移除 1 張牌，或略過這個效果。' },
    { choiceId: 'base:adventurer/adventurer-30-remove', title: '選擇要移除的卡牌', description: '可以從自己的手牌、隊伍或棄牌堆移除 1 張牌，或略過這個效果。' },
    { choiceId: 'base:monster/monster-03-remove-one', title: '選擇要移除的卡牌', description: '可以從自己的手牌、隊伍或棄牌堆移除 1 張牌，或略過這個獎勵。' },
    { choiceId: 'base:monster/monster-06-remove-first', title: '選擇第一張要移除的卡牌', description: '可以移除第一張卡牌，或略過並繼續結算獎勵。' },
    { choiceId: 'base:monster/monster-06-remove-second', title: '選擇第二張要移除的卡牌', description: '可以再移除一張卡牌，或略過並完成獎勵。' },
    { choiceId: 'base:monster/monster-10-remove-hand', title: '選擇要移除的手牌', description: '可以從手牌移除 1 張牌；若沒有合適卡牌可略過。' },
    { choiceId: 'base:monster/monster-11-remove-discard', title: '選擇要移除的棄牌', description: '可以從棄牌堆移除 1 張牌，或略過這個獎勵。' },
    { choiceId: 'base:boss/boss-03-remove-first', title: '選擇第一張要移除的棄牌', description: '可以從棄牌堆移除第一張牌，或略過。' },
    { choiceId: 'base:boss/boss-03-remove-second', title: '選擇第二張要移除的棄牌', description: '可以再從棄牌堆移除一張牌，或略過。' },
    { choiceId: 'base:helper/helper-11-pass-card', title: '選擇要交給左側玩家的手牌', description: '所選卡牌會離開你的手牌、轉交給左側玩家並改由對方持有；不會移出遊戲。' },
    { choiceId: 'combat-departure:optional-replacements', title: '選擇離場替代效果', description: '選擇本次討伐要套用哪些可選離場替代；列出的冒險者會依其技能處理。' },
    { choiceId: 'custom:adventurer/support-09-rotate-helper', title: '是否更換公會小姐？', description: '可以將目前公會小姐放到牌庫底並換上下一張。', optionLabels: { rotate: '更換公會小姐', skip: '略過' } },
  ],
});
