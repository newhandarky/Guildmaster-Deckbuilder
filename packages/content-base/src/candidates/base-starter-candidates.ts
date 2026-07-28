import type { BaseStarterCandidateCatalog, StarterCandidateFieldEvidence } from './schema.js';

const officialUrl = 'https://www.paintcanfarm.com/aggboardgames/zh';
const evidenceIds = { setup: 'user-visual:base-rulebook-page-05-setup', cards: 'user-visual:base-card-07-starter-sheet' } as const;
const candidate = (field: StarterCandidateFieldEvidence['field'], candidateValue: string | number | boolean, source: keyof typeof evidenceIds, sourceLocation: string): StarterCandidateFieldEvidence => ({ field, status: 'needs-human-confirmation', candidateValue, evidenceIds: [evidenceIds[source]], sourceLocation, requiresContentOwnerConfirmation: true });
const todo = (field: StarterCandidateFieldEvidence['field'], sourceLocation: string, gapReason: string): StarterCandidateFieldEvidence => ({ field, status: 'todo', evidenceIds: [evidenceIds.cards], sourceLocation, requiresContentOwnerConfirmation: false, gapReason });
const notShown = (field: StarterCandidateFieldEvidence['field'], cardRegion: string) => todo(field, `card-07.jpg；${cardRegion}`, '使用者提供的卡表頁未明示此欄位；不可將未顯示推論為 0、無效果、不可配戴或無限制。需補充可定位的官方文字或卡面欄位。');

const adventurer = (id: string, name: string, combat: number, cardRegion: string) => ({ candidateId: id, category: 'adventurer' as const, activation: 'disabled' as const, runtimeLoadable: false as const, fields: [
  candidate('name', name, 'cards', `card-07.jpg；${cardRegion}`),
  candidate('cardType', '冒險者', 'setup', 'page-05.jpg；印刷頁 3；〈玩家設置〉第 1 點（列為 5 張起始冒險者）'),
  candidate('copies', 1, 'setup', 'page-05.jpg；印刷頁 3；〈玩家設置〉第 1 點（5 張具名起始冒險者）'),
  candidate('combat', combat, 'cards', `card-07.jpg；${cardRegion}；卡底戰力圖示與數值`),
  notShown('cost', cardRegion), notShown('purchasePower', cardRegion), notShown('honor', cardRegion), notShown('effect', cardRegion), notShown('effectTiming', cardRegion), notShown('equipmentEligibility', cardRegion), notShown('restrictions', cardRegion)
] });

const starterResource = (id: string, name: string, copies: number, statField: 'purchasePower' | 'honor', statValue: number, cardRegion: string) => ({ candidateId: id, category: 'starter-resource' as const, activation: 'disabled' as const, runtimeLoadable: false as const, fields: [
  candidate('name', name, 'cards', `card-07.jpg；${cardRegion}`),
  todo('cardType', `card-07.jpg；${cardRegion}`, '卡表頁顯示名稱與數值，但未以文字明示卡牌種類；不可由圖示或起始手牌位置推論正式種類。'),
  candidate('copies', copies, 'setup', 'page-05.jpg；印刷頁 3；〈玩家設置〉第 1、4 點'),
  candidate(statField, statValue, 'cards', `card-07.jpg；${cardRegion}；卡底${statField === 'purchasePower' ? '購買力' : '榮譽'}圖示與數值`),
  ...(['cost', 'combat', 'purchasePower', 'honor'] as const).filter((field) => field !== statField).map((field) => notShown(field, cardRegion)),
  notShown('effect', cardRegion), notShown('effectTiming', cardRegion), notShown('equipmentEligibility', cardRegion), notShown('restrictions', cardRegion)
] });

export const baseStarterCandidateCatalog: BaseStarterCandidateCatalog = {
  catalogVersion: 1,
  evidence: [
    { evidenceId: evidenceIds.setup, officialUrl, documentName: '冒險少女公會 基礎規則書', providedFileName: 'page-05.jpg', printedPage: '3', region: '〈玩家設置〉第 1、2、4 點', reviewedOn: '2026-07-28', repositoryAsset: 'not-committed' },
    { evidenceId: evidenceIds.cards, officialUrl, documentName: '冒險少女公會 起始卡候選合成視覺頁', providedFileName: 'card-07.jpg', region: '上排第 1–4 張、下排左側冒險者、下排中央召喚石、下排右側精靈結晶', reviewedOn: '2026-07-28', repositoryAsset: 'not-committed' }
  ],
  candidates: [
    adventurer('base:starter/adventurer-01', '麥娜', 1, '上排第 1 張'),
    adventurer('base:starter/adventurer-02', '慕莎', 2, '下排左側'),
    adventurer('base:starter/adventurer-03', '卡儂', 1, '上排第 2 張'),
    adventurer('base:starter/adventurer-04', '修爾蒂', 1, '上排第 3 張'),
    adventurer('base:starter/adventurer-05', '辛芙妮', 1, '上排第 4 張'),
    starterResource('base:starter/summoning-stone', '召喚石', 4, 'purchasePower', 1, '下排中央'),
    starterResource('base:starter/spirit-crystal', '精靈結晶', 1, 'honor', 1, '下排右側')
  ]
};
