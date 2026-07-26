import type { CardDefinition } from '@guildmaster/game-protocol';

/**
 * 原創 MVP 示範牌：只用於驗證引擎與介面，不代表未完成核對的官方卡表。
 * 日後以同一 ContentPack 介面載入經雙人覆核的完整資料。
 */
export const demoCards: readonly CardDefinition[] = [
  { id: 'base:starter/newcomer', name: '新手探險者', type: 'starter', copies: 0, combat: 1, honor: 0, source: 'mvp-demo' },
  { id: 'base:starter/guiding-stone', name: '引導石', type: 'starter', copies: 0, purchasePower: 1, honor: 0, source: 'mvp-demo' },
  { id: 'base:starter/moon-crystal', name: '月晶', type: 'starter', copies: 0, purchasePower: 1, honor: 0, source: 'mvp-demo' },
  { id: 'base:adventurer/shield-bearer', name: '盾衛', type: 'adventurer', copies: 4, cost: 2, combat: 2, honor: 1, source: 'mvp-demo' },
  { id: 'base:adventurer/ranger', name: '巡林者', type: 'adventurer', copies: 4, cost: 3, combat: 3, honor: 1, source: 'mvp-demo' },
  { id: 'base:adventurer/ember-mage', name: '燼火法師', type: 'adventurer', copies: 3, cost: 4, combat: 4, honor: 2, source: 'mvp-demo' },
  { id: 'base:adventurer/captain', name: '遠征隊長', type: 'adventurer', copies: 2, cost: 5, combat: 5, honor: 3, source: 'mvp-demo' },
  { id: 'base:equipment/iron-spear', name: '鐵槍', type: 'equipment', copies: 3, cost: 2, combat: 1, honor: 1, source: 'mvp-demo' },
  { id: 'base:equipment/star-cloak', name: '星紋披風', type: 'equipment', copies: 2, cost: 3, combat: 2, honor: 2, source: 'mvp-demo' },
  { id: 'base:item/trail-rations', name: '遠行口糧', type: 'item', copies: 3, cost: 2, honor: 0, itemEffect: 'combat+2', source: 'mvp-demo' },
  { id: 'base:item/trade-token', name: '商會代幣', type: 'item', copies: 3, cost: 2, honor: 0, itemEffect: 'purchase+2', source: 'mvp-demo' },
  { id: 'base:monster/mire-wolf', name: '沼地狼', type: 'monster', copies: 3, combat: 3, purchasePower: 1, honor: 1, source: 'mvp-demo' },
  { id: 'base:monster/cave-giant', name: '洞穴巨人', type: 'monster', copies: 3, combat: 5, purchasePower: 2, honor: 2, source: 'mvp-demo' },
  { id: 'base:monster/ash-drake', name: '灰燼飛龍', type: 'monster', copies: 2, combat: 7, purchasePower: 3, honor: 3, source: 'mvp-demo' },
  { id: 'base:boss/ruin-warden', name: '遺跡守望者', type: 'boss', copies: 1, combat: 6, purchasePower: 2, honor: 3, source: 'mvp-demo' },
  { id: 'base:boss/frost-regent', name: '霜境領主', type: 'boss', copies: 1, combat: 8, purchasePower: 3, honor: 4, source: 'mvp-demo' },
  { id: 'base:boss/void-duke', name: '虛空公爵', type: 'boss', copies: 1, combat: 10, purchasePower: 4, honor: 5, source: 'mvp-demo' },
  { id: 'base:boss/cinder-queen', name: '灰燼女王', type: 'boss', copies: 1, combat: 12, purchasePower: 5, honor: 6, source: 'mvp-demo' }
];
