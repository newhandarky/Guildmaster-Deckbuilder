import type { PresentationPack } from './schema.js';

const entry = (definitionId: string, displayName: string, assetIndex: number) => ({ definitionId, displayName, portraitAssetKey: `placeholder:text-card-${assetIndex}`, shortDisplayText: '原創文字 placeholder。' });

/** Original text-only presentation for the current demo Content Pack. */
export const neutralPlaceholderPresentationPack: PresentationPack = {
  manifest: { id: 'presentation:neutral-placeholder', version: '1.0.0', theme: 'neutral-text', locale: 'zh-TW' },
  entries: [
    entry('base:starter/newcomer', '起始牌 A', 1), entry('base:starter/guiding-stone', '起始石 A', 2), entry('base:starter/moon-crystal', '起始結晶 A', 3),
    entry('base:adventurer/shield-bearer', '冒險者 A', 4), entry('base:adventurer/ranger', '冒險者 B', 5), entry('base:adventurer/ember-mage', '冒險者 C', 6), entry('base:adventurer/captain', '冒險者 D', 7),
    entry('base:equipment/iron-spear', '裝備 A', 8), entry('base:equipment/star-cloak', '裝備 B', 9), entry('base:item/trail-rations', '道具 A', 10), entry('base:item/trade-token', '道具 B', 11),
    entry('base:monster/mire-wolf', '魔物 A', 12), entry('base:monster/cave-giant', '魔物 B', 13), entry('base:monster/ash-drake', '魔物 C', 14),
    entry('base:boss/ruin-warden', '目標 A', 15), entry('base:boss/frost-regent', '目標 B', 16), entry('base:boss/void-duke', '目標 C', 17), entry('base:boss/cinder-queen', '目標 D', 18),
  ],
};
