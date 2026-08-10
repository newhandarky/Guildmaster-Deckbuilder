import { createPresentationAssetRegistry, createPresentationResolver } from '@guildmaster/presentation-core';
import { createLifecycleCopyResolver } from '../ui/lifecycle/lifecycle-copy.js';
import {
  demoPresentationAssetKeys,
  demoPresentationAssetManifest,
  demoPresentationPack,
  provisionalFoundationPresentationPack,
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
  [demoPresentationPack, provisionalFoundationPresentationPack],
  { resolveAsset },
);

export const lifecycleCopyResolver = createLifecycleCopyResolver({
  choices: [
    { choiceId: 'base:resource/resource-10-discard', title: '選擇要棄置的手牌', description: '棄置選擇的手牌後，抽 2 張牌。' },
    { choiceId: 'base:resource/resource-17-discard', title: '選擇要棄置的手牌', description: '這張道具已抽牌；請選擇 1 張手牌棄置。' },
  ],
});
