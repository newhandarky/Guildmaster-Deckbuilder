import type { ContentPack } from '@guildmaster/game-protocol';
import { createGame, createRuleset } from '../src/index.js';
import { baseRulesModule } from '../src/rules/base-rules.js';

export const testPack: ContentPack = {
  manifest: { id: 'test:content', version: '1.0.0', hash: 'test-hash' },
  definitions: [
    { id: 'test:starter/adventurer', name: '測試冒險者', type: 'starter', copies: 0, combat: 1, source: 'mvp-demo' },
    { id: 'test:starter/stone', name: '測試石', type: 'starter', copies: 0, purchasePower: 1, source: 'mvp-demo' },
    { id: 'test:starter/crystal', name: '測試晶體', type: 'starter', copies: 0, purchasePower: 1, source: 'mvp-demo' },
    { id: 'test:adventurer/a', name: '前鋒', type: 'adventurer', copies: 5, cost: 2, combat: 2, honor: 1, source: 'mvp-demo' },
    { id: 'test:item/spear', name: '短槍', type: 'equipment', copies: 3, cost: 2, combat: 1, source: 'mvp-demo' },
    { id: 'test:item/ration', name: '口糧', type: 'item', copies: 3, cost: 2, itemEffect: 'combat+2', source: 'mvp-demo' },
    { id: 'test:monster/wolf', name: '狼', type: 'monster', copies: 4, combat: 3, purchasePower: 1, honor: 1, source: 'mvp-demo' },
    { id: 'test:boss/a', name: '魔王 A', type: 'boss', copies: 1, combat: 4, honor: 2, source: 'mvp-demo' },
    { id: 'test:boss/b', name: '魔王 B', type: 'boss', copies: 1, combat: 4, honor: 2, source: 'mvp-demo' },
    { id: 'test:boss/c', name: '魔王 C', type: 'boss', copies: 1, combat: 4, honor: 2, source: 'mvp-demo' },
    { id: 'test:boss/d', name: '魔王 D', type: 'boss', copies: 1, combat: 4, honor: 2, source: 'mvp-demo' }
  ],
  starter: { adventurerDefinitionId: 'test:starter/adventurer', summonStoneDefinitionId: 'test:starter/stone', crystalDefinitionId: 'test:starter/crystal' },
  bonds: [{ id: 'test:bond/a', name: '起點', honor: 1, requiredBosses: 1 }]
};

export const testRuleset = createRuleset([testPack], [baseRulesModule]);
export function makeGame() { return createGame({ gameId: 'test-game', seed: 19, players: [{ id: 'p1', name: '玩家', kind: 'human' }, { id: 'p2', name: 'AI', kind: 'ai' }], startingPlayerId: 'p1' }, testRuleset); }
