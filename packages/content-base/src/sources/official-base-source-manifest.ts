import type { OfficialBaseSourceManifest, OfficialFieldEvidence } from './schema.js';

const officialUrl = 'https://www.paintcanfarm.com/aggboardgames/zh';
const sourceIds = { cardList: 'official-base-card-list-web', rulebook: 'official-base-rulebook-web', faq: 'official-base-faq-2025-09-01-web', errata: 'official-base-errata-2025-09-01-web' } as const;
const todo = (field: OfficialFieldEvidence['field'], gapReason: string): OfficialFieldEvidence => ({ field, status: 'todo', sourceIds: [], gapReason });
const unavailableRosterGap = '官方頁面將完整卡片列表與規則書以圖片呈現；本專案僅採官方文字來源，不下載、辨識或提交官方圖片／掃描／卡面。尚未取得可定位的官方文字或合法持有規則書頁面。';
const valueGap = '官方可讀取的 Q&A／勘誤段落未列出此卡的份數、費用、戰力或榮譽；不得由圖片、示範資料或桌遊慣例推測。';

export const officialBaseSourceManifest: OfficialBaseSourceManifest = {
  manifestVersion: 1,
  sources: [
    { sourceId: sourceIds.cardList, kind: 'official-card-list', title: '冒險少女公會：卡片列表', url: officialUrl, versionOrUpdated: '頁面未標示版本或更新日期', locator: '卡片列表（網站區塊）', accessedOn: '2026-07-26', extractionPolicy: 'text-only', availability: 'image-only' },
    { sourceId: sourceIds.rulebook, kind: 'official-rulebook', title: '冒險少女公會：遊戲規則說明書', url: officialUrl, versionOrUpdated: '頁面未標示版本或更新日期；網站列出 13 張規則書圖檔', locator: '規則說明書、Q&A（網站區塊）', accessedOn: '2026-07-26', extractionPolicy: 'text-only', availability: 'image-only' },
    { sourceId: sourceIds.faq, kind: 'official-faq', title: '冒險少女公會：Q&A', url: officialUrl, versionOrUpdated: '2025/9/1 更新', locator: '規則說明書、Q&A > Q&A 2025/9/1更新 > 效果敘述微調與補充說明', accessedOn: '2026-07-26', extractionPolicy: 'text-only', availability: 'text-readable' },
    { sourceId: sourceIds.errata, kind: 'official-errata', title: '冒險少女公會：初版實體說明書勘誤', url: officialUrl, versionOrUpdated: '2025/9/1 更新（Q&A 區塊標示）', locator: '規則說明書、Q&A > Q&A 2025/9/1更新 > 初版實體說明書勘誤 > 第四頁最下方物資卡簡介', accessedOn: '2026-07-26', extractionPolicy: 'text-only', availability: 'text-readable' }
  ],
  records: [
    { recordId: 'base:starter/roster', category: 'starter', fields: [todo('name', unavailableRosterGap), todo('copies', unavailableRosterGap), todo('cost', unavailableRosterGap), todo('combat', unavailableRosterGap), todo('honor', unavailableRosterGap), todo('effect', unavailableRosterGap)] },
    { recordId: 'base:official/kagura', category: 'common-supply', fields: [{ field: 'name', status: 'verified', value: '神樂', sourceIds: [sourceIds.faq] }, { field: 'cardType', status: 'verified', value: '冒險者', sourceIds: [sourceIds.faq] }, todo('copies', valueGap), todo('cost', valueGap), todo('combat', valueGap), todo('honor', valueGap), { field: 'effect', status: 'verified', value: '官方勘誤將效果中的「查看」改為「展示」。', sourceIds: [sourceIds.faq] }] },
    { recordId: 'base:official/shuruti', category: 'common-supply', fields: [{ field: 'name', status: 'verified', value: '修爾蒂', sourceIds: [sourceIds.faq] }, { field: 'cardType', status: 'verified', value: '冒險者', sourceIds: [sourceIds.faq] }, todo('copies', valueGap), todo('cost', valueGap), todo('combat', valueGap), todo('honor', valueGap), { field: 'effect', status: 'verified', value: '官方補充：隊伍第一位冒險者戰力增加 2；修爾蒂自身不適用，其他同名卡可適用。', sourceIds: [sourceIds.faq] }] },
    { recordId: 'base:monster/roster', category: 'monster', fields: [todo('name', unavailableRosterGap), todo('cardType', unavailableRosterGap), todo('copies', unavailableRosterGap), todo('cost', unavailableRosterGap), todo('combat', unavailableRosterGap), todo('honor', unavailableRosterGap), todo('effect', unavailableRosterGap)] },
    { recordId: 'base:official/baphomet', category: 'boss', fields: [{ field: 'name', status: 'verified', value: '巴風特', sourceIds: [sourceIds.faq] }, { field: 'cardType', status: 'verified', value: '魔王', sourceIds: [sourceIds.faq] }, todo('copies', valueGap), todo('cost', valueGap), todo('combat', valueGap), todo('honor', valueGap), { field: 'effect', status: 'verified', value: '官方補充：用於擊倒的基礎冒險者改為移除遊戲，抽取數量不變。', sourceIds: [sourceIds.faq] }] },
    { recordId: 'base:official/chimera', category: 'boss', fields: [{ field: 'name', status: 'verified', value: '奇美拉', sourceIds: [sourceIds.faq] }, { field: 'cardType', status: 'verified', value: '魔王', sourceIds: [sourceIds.faq] }, todo('copies', valueGap), todo('cost', valueGap), todo('combat', valueGap), todo('honor', valueGap), { field: 'effect', status: 'verified', value: '官方補充：進場時從魔物牌庫抽 1 張配戴，戰力增加其戰力；擊敗後移除所配戴魔物。', sourceIds: [sourceIds.faq] }] },
    { recordId: 'base:rules/item-discard-timing', category: 'rules-errata', fields: [{ field: 'effect', status: 'verified', value: '道具結算後暫時留在遊戲區域，於休息階段才棄至棄牌堆。', sourceIds: [sourceIds.errata] }] }
  ]
};
