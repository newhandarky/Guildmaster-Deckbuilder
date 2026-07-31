import { createPresentationAssetRegistry, createPresentationResolver } from '@guildmaster/presentation-core';
import {
  demoPresentationAssetKeys,
  demoPresentationAssetManifest,
  demoPresentationPack,
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
  [demoPresentationPack],
  { resolveAsset },
);
