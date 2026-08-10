import { createPresentationAssetRegistry, createPresentationResolver } from '@guildmaster/presentation-core';
import { createLifecycleCopyResolver } from '../ui/lifecycle/lifecycle-copy.js';
import {
  demoPresentationAssetKeys,
  demoPresentationAssetManifest,
  demoPresentationPack,
  provisionalFoundationPresentationPack,
  provisionalHelpersPresentationPack,
} from '@guildmaster/presentation-demo';

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
  return presentationAssetRegistry.resolveAsset(assetKey);
};

export const presentationResolver = createPresentationResolver(
  [demoPresentationPack, provisionalFoundationPresentationPack, provisionalHelpersPresentationPack],
  { resolveAsset },
);

export const lifecycleCopyResolver = createLifecycleCopyResolver({
  choices: [
    { choiceId: 'base:resource/resource-01-recover-adventurer', title: '選擇要取回的冒險者', description: '將選擇的冒險者從棄牌堆加入手牌。' },
    { choiceId: 'base:resource/resource-04-discard-boss', title: '選擇要棄置的魔王', description: '棄置選擇的魔王後，抽 3 張牌。' },
    { choiceId: 'base:resource/resource-05-recover-equipment', title: '選擇要取回的裝備', description: '將選擇的裝備從棄牌堆加入手牌。' },
    { choiceId: 'base:resource/resource-10-discard', title: '選擇要棄置的手牌', description: '棄置選擇的手牌後，抽 2 張牌。' },
    { choiceId: 'base:resource/resource-13-recover-mage-card', title: '選擇要取回的法師卡', description: '將選擇的非同名法師卡從棄牌堆加入手牌。' },
    { choiceId: 'base:resource/resource-15-remove', title: '選擇要移除的卡牌', description: '從自己的手牌、隊伍或棄牌堆選擇 1 張牌移出遊戲。' },
    { choiceId: 'base:resource/resource-17-discard', title: '選擇要棄置的手牌', description: '這張道具已抽牌；請選擇 1 張手牌棄置。' },
  ],
});
