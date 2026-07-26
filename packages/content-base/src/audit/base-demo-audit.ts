import type { ContentAuditCatalog } from './schema.js';
import { demoCards } from '../cards/demo-cards.js';

/**
 * This catalog deliberately keeps every demo definition disabled. It records
 * the audit boundary, not an inferred official card list.
 */
export const baseDemoAudit: ContentAuditCatalog = {
  packId: 'base:demo',
  sourceCatalog: [{ sourceId: 'official-base-site', kind: 'official-rulebook', title: '冒險少女公會 官方規則與 FAQ', url: 'https://www.paintcanfarm.com/aggboardgames/zh', locator: '基礎版規則書與 FAQ 入口；逐張卡片定位待人工覆核', accessedOn: '2026-07-26' }],
  cards: demoCards.map((definition) => ({ definitionId: definition.id, status: 'todo', activation: 'disabled', sourceIds: ['official-base-site'], fieldAudits: [{ field: 'rulesText', status: 'todo', sourceIds: ['official-base-site'], note: 'MVP 示範資料，未完成官方逐張核對；不可啟用為正式基礎卡。' }], note: 'TODO: 需以官方規則書、FAQ 或勘誤逐欄覆核。' }))
};
