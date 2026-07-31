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

/**
 * Only approved runtime assets belong here. Empty/partial coverage is valid and
 * deliberately leaves the Web client on its neutral CSS placeholder.
 */
export const demoPresentationAssetManifest: PresentationAssetManifest = assetManifest;

export const demoPresentationAssetKeys = demoPresentationPack.entries
  .map((presentationEntry) => presentationEntry.portraitAssetKey)
  .sort();
