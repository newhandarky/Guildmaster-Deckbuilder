import { demoCards } from '../cards/demo-cards.js';
import type { BaseCardInventory, BaseCardInventoryEntry, InventoryPriority } from './schema.js';

const officialWebsite = { sourceId: 'official-base-qa-2025-09-01', kind: 'official-faq' as const, title: '冒險少女公會：規則說明書、Q&A', url: 'https://www.paintcanfarm.com/aggboardgames/zh', locator: '規則說明書、Q&A > Q&A 2025/9/1更新 > 效果敘述微調與補充說明', accessedOn: '2026-07-26' };
const todo = (reason: string) => ({ status: 'todo' as const, sourceIds: [] as const, todoReason: reason });
const priorityFor = (id: string): InventoryPriority => id.includes(':starter/') ? 'starter' : id.includes(':adventurer/') || id.includes(':equipment/') || id.includes(':item/') ? 'common-supply' : 'remaining-base';

const confirmedEntries: readonly BaseCardInventoryEntry[] = [
  { id: 'base:official/kagura', priority: 'common-supply', displayName: { value: '神樂', kind: 'official', sourceIds: [officialWebsite.sourceId] }, cardType: { value: 'adventurer', status: 'verified', sourceIds: [officialWebsite.sourceId] }, copies: todo('官方公開 Q&A 未列出份數。'), activation: 'disabled', note: '效果文字另有「查看」改為「展示」勘誤；完整 effect schema 尚未建立。' },
  { id: 'base:official/baphomet', priority: 'remaining-base', displayName: { value: '巴風特', kind: 'official', sourceIds: [officialWebsite.sourceId] }, cardType: { value: 'boss', status: 'verified', sourceIds: [officialWebsite.sourceId] }, copies: todo('官方公開 Q&A 未列出份數。'), activation: 'disabled', note: '僅盤點 Q&A 明示的名稱與卡種；完整效果待結構化。' },
  { id: 'base:official/chimera', priority: 'remaining-base', displayName: { value: '奇美拉', kind: 'official', sourceIds: [officialWebsite.sourceId] }, cardType: { value: 'boss', status: 'verified', sourceIds: [officialWebsite.sourceId] }, copies: todo('官方公開 Q&A 未列出份數。'), activation: 'disabled', note: '完整進場／附屬效果待結構化。' },
  { id: 'base:official/shuruti', priority: 'common-supply', displayName: { value: '修爾蒂', kind: 'official', sourceIds: [officialWebsite.sourceId] }, cardType: { value: 'adventurer', status: 'verified', sourceIds: [officialWebsite.sourceId] }, copies: todo('官方公開 Q&A 未列出份數。'), activation: 'disabled', note: '完整效果與數值待規則書逐張核對。' }
];

const placeholderEntries: readonly BaseCardInventoryEntry[] = demoCards.map((card) => ({ id: card.id, priority: priorityFor(card.id), displayName: { value: card.name, kind: 'original-placeholder', sourceIds: [] }, cardType: todo('原創 MVP 示範卡，非官方卡表。'), copies: todo('原創 MVP 示範數值，非官方份數。'), activation: 'disabled', note: 'TODO: 以官方規則書、FAQ 或勘誤建立對應的正式盤點；不得據此推測。' }));

export const baseCardInventory: BaseCardInventory = { rosterStatus: 'incomplete', sources: [officialWebsite], cards: [...confirmedEntries, ...placeholderEntries] };
