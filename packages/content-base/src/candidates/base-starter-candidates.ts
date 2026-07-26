import type { BaseStarterCandidateCatalog, StarterCandidateFieldEvidence } from './schema.js';

const officialUrl = 'https://www.paintcanfarm.com/aggboardgames/zh';
const evidenceIds = { setup: 'user-visual:base-rulebook-page-05-setup', cards: 'user-visual:base-card-07-starter-sheet' } as const;
const candidate = (field: StarterCandidateFieldEvidence['field'], candidateValue: string | number, source: keyof typeof evidenceIds): StarterCandidateFieldEvidence => ({ field, status: 'needs-human-confirmation', candidateValue, evidenceIds: [evidenceIds[source]] });
const todo = (field: StarterCandidateFieldEvidence['field'], gapReason: string): StarterCandidateFieldEvidence => ({ field, status: 'todo', evidenceIds: [], gapReason });
const missingCardField = '使用者提供的視覺證據不足以建立可啟用的完整卡牌欄位；需欄位級人工覆核與後續 content audit。';
const adventurer = (id: string, name: string, combat: number, cardRegion: string) => ({ candidateId: id, category: 'adventurer' as const, activation: 'disabled' as const, runtimeLoadable: false as const, fields: [candidate('name', name, 'cards'), candidate('cardType', '冒險者', 'setup'), candidate('copies', 1, 'setup'), { ...candidate('combat', combat, 'cards'), evidenceIds: [evidenceIds.cards], gapReason: cardRegion }, todo('cost', missingCardField), todo('honor', missingCardField), todo('effect', missingCardField)] });

export const baseStarterCandidateCatalog: BaseStarterCandidateCatalog = {
  catalogVersion: 1,
  evidence: [
    { evidenceId: evidenceIds.setup, officialUrl, documentName: '冒險少女公會 基礎規則書', providedFileName: 'page-05.jpg', printedPage: '3', region: '〈玩家設置〉第 1、2、4 點', reviewedOn: '2026-07-26', repositoryAsset: 'not-committed' },
    { evidenceId: evidenceIds.cards, officialUrl, documentName: '冒險少女公會 起始卡候選合成視覺頁', providedFileName: 'card-07.jpg', region: '上排第 1–4 張、下排左側冒險者、下排中央召喚石、下排右側精靈結晶', reviewedOn: '2026-07-26', repositoryAsset: 'not-committed' }
  ],
  candidates: [
    adventurer('base:starter-candidate/maina', '麥娜', 1, 'card-07.jpg 上排第 1 張'),
    adventurer('base:starter-candidate/musa', '慕莎', 2, 'card-07.jpg 下排左側'),
    adventurer('base:starter-candidate/kanon', '卡儂', 1, 'card-07.jpg 上排第 2 張'),
    adventurer('base:starter-candidate/shuruti', '修爾蒂', 1, 'card-07.jpg 上排第 3 張'),
    adventurer('base:starter-candidate/symphony', '辛芙妮', 1, 'card-07.jpg 上排第 4 張'),
    { candidateId: 'base:starter-candidate/summon-stone', category: 'starter-resource', activation: 'disabled', runtimeLoadable: false, fields: [candidate('name', '召喚石', 'cards'), candidate('copies', 4, 'setup'), candidate('purchasePower', 1, 'cards'), todo('effect', missingCardField)] },
    { candidateId: 'base:starter-candidate/spirit-crystal', category: 'starter-resource', activation: 'disabled', runtimeLoadable: false, fields: [candidate('name', '精靈結晶', 'cards'), candidate('copies', 1, 'setup'), candidate('purchasePower', 1, 'cards'), todo('effect', missingCardField)] }
  ]
};
