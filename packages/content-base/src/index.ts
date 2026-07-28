import type { ContentPack } from '@guildmaster/game-protocol';
import { demoCards } from './cards/demo-cards.js';
export * from './audit/index.js';
export * from './candidates/index.js';
export * from './inventory/index.js';
export * from './sources/index.js';
export * from './provisional/index.js';
export * from './playtest/index.js';
export * from './capabilities/index.js';

export const baseDemoContentPack: ContentPack = {
  manifest: { id: 'base:demo', version: '0.1.0', hash: 'base-demo-v1', role: 'base', contentStatus: 'demo' },
  definitions: demoCards,
  starter: {
    adventurerDefinitionId: 'base:starter/newcomer',
    summonStoneDefinitionId: 'base:starter/guiding-stone',
    crystalDefinitionId: 'base:starter/moon-crystal'
  },
  bonds: [
    { id: 'base:bond/first-victory', name: '初次凱旋', honor: 2, requiredBosses: 1 },
    { id: 'base:bond/seasoned', name: '久經戰陣', honor: 3, requiredBosses: 2 },
    { id: 'base:bond/vanguard', name: '先鋒之誓', honor: 3, requiredBosses: 3 },
    { id: 'base:bond/keeper', name: '守望者之約', honor: 4, requiredBosses: 4 },
    { id: 'base:bond/legend', name: '傳奇遠征', honor: 5, requiredBosses: 4 }
  ]
};
