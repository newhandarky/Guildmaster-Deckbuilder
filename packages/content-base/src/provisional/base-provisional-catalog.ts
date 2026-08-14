import type { ProvisionalBaseContentCatalog, ProvisionalCardCandidate, ProvisionalField } from './schema.js';

const url = 'https://www.paintcanfarm.com/aggboardgames/zh';
const sourceIds = { rulebook: 'local-visual:base-rulebook', starter: 'local-visual:base-starter-sheet', adventurer: 'local-visual:base-adventurer-sheet', resource: 'local-visual:base-resource-sheet', monster: 'local-visual:base-monster-sheet', boss: 'local-visual:base-boss-sheet', bond: 'local-visual:base-bond-sheet', helper: 'local-visual:base-helper-sheet', faq: 'official-text:base-faq-2025-09-01', projectPolicy: 'project-policy:base-supply-continuity-2026-07-31' } as const;
type Source = keyof typeof sourceIds;
const field = (name: ProvisionalField['field'], candidateValue: string | number | boolean | undefined, source: Source, sourceLocation: string, confidence: ProvisionalField['confidence'] = 'high', status: ProvisionalField['status'] = candidateValue === undefined ? 'exception' : 'provisional', exceptionReason?: string): ProvisionalField => ({ field: name, status, confidence, sourceIds: [sourceIds[source]], sourceLocation, ...(candidateValue === undefined ? {} : { candidateValue }), ...(status === 'exception' ? { exceptionReason: exceptionReason ?? 'Visual evidence does not establish this field clearly enough for provisional rules use.' } : {}) });
const card = (definitionId: string, category: ProvisionalCardCandidate['category'], sourceName: string, source: Source, region: string, values: readonly ProvisionalField[]): ProvisionalCardCandidate => ({ definitionId, category, runtimeLoadable: false, activation: 'disabled', fields: [field('sourceName', sourceName, source, region), ...values] });
const stats = (source: Source, region: string, cost?: number, combat?: number, purchasePower?: number, honor?: number) => [
  field('cost', cost, source, region), field('combat', combat, source, region), field('purchasePower', purchasePower, source, region), field('honor', honor, source, region)
];
const effect = (source: Source, region: string, summary?: string, confidence: ProvisionalField['confidence'] = 'medium') => field('effect', summary, source, region, confidence, summary ? 'provisional' : 'exception', summary ? undefined : 'Effect text requires a clearer field-level read before rules implementation.');

const starterAdventurerRows: readonly [string, string, number, 'melee' | 'tank' | 'ranged' | 'mage' | 'support', number][] = [
  ['adventurer-01', '麥娜', 1, 'support', 1],
  ['adventurer-02', '慕莎', 2, 'melee', 5],
  ['adventurer-03', '卡儂', 1, 'mage', 2],
  ['adventurer-04', '修爾蒂', 1, 'tank', 3],
  ['adventurer-05', '辛芙妮', 1, 'ranged', 4],
];
const starters: readonly ProvisionalCardCandidate[] = starterAdventurerRows.map(([suffix, name, combat, profession, visualIndex]) => {
  const region = `card-07.jpg；起始冒險者第 ${visualIndex} 張`;
  return card(`base:starter/${suffix}`, 'starter', name, 'starter', region, [field('cardType', 'adventurer', 'rulebook', 'page-05.jpg；印刷頁 3；玩家設置第 1 點'), field('profession', profession, 'starter', `${region}；左上職業圖示（圖例見 card-07.jpg；右下卡牌圖示）`, 'high'), field('copies', 1, 'rulebook', 'page-05.jpg；印刷頁 3；玩家設置第 1 點'), field('combat', combat, 'starter', region), field('setup', 'face-up random initial party', 'rulebook', 'page-05.jpg；印刷頁 3；玩家設置第 1 點'), effect('starter', region)]);
});

const starterResources: readonly ProvisionalCardCandidate[] = [
  card('base:starter/summoning-stone', 'starter', '召喚石', 'starter', 'card-07.jpg；下排中央', [field('cardType', 'starter-resource', 'rulebook', 'page-05.jpg；印刷頁 3；玩家設置第 4 點'), field('copies', 4, 'rulebook', 'page-05.jpg；印刷頁 3；玩家設置第 4 點'), field('purchasePower', 1, 'starter', 'card-07.jpg；下排中央'), field('setup', 'initial hand', 'rulebook', 'page-05.jpg；印刷頁 3；玩家設置第 4 點')]),
  card('base:starter/spirit-crystal', 'starter', '精靈結晶', 'starter', 'card-07.jpg；下排右側', [field('cardType', 'equipment', 'starter', 'card-07.jpg；下排右側；左上裝備圖示'), field('copies', 1, 'rulebook', 'page-05.jpg；印刷頁 3；玩家設置第 4 點'), field('combat', 1, 'starter', 'card-07.jpg；下排右側；左下戰力圖示'), field('setup', 'initial hand', 'rulebook', 'page-05.jpg；印刷頁 3；玩家設置第 4 點')])
];

const adventurerRows: readonly [string, string, number, number, number, string?][] = [
  ['adventurer-01','麥娜',4,2,2,'討伐階段結束後，若本回合擊敗目標，可從棄牌堆取回 1 張冒險者至手牌。'], ['adventurer-02','托妮卡',3,3,2,'不可配戴裝備。'], ['adventurer-03','卡儂',4,3,1,'討伐開始擲骰；單數時增加戰力。'], ['adventurer-04','修爾蒂',4,2,2,'隊伍第一位冒險者戰力 +2；自身不適用。'], ['adventurer-05','哈貝妮',3,1,1,'購買階段所有裝備費用 -1。'],
  ['adventurer-06','莉茲米',4,2,2], ['adventurer-07','辛芙妮',3,2,1,'進入隊伍時可將場上任意數量魔物放回其牌庫，翻出等量魔物。'], ['adventurer-08','旋律',3,2,1,'進入隊伍時指定場上 1 隻魔物；本回合其戰力 -2。'], ['adventurer-09','芙尼姆',3,1,1], ['adventurer-10','慕莎',4,2,2,'若在隊伍第一位，戰力 +2。'],
  ['adventurer-11','布蕾斯',4,1,1,'進入隊伍時查看牌庫頂 3 張，可移除其中 1 張，餘牌任意順序放回。'], ['adventurer-12','安比夏',3,2,2,'進入隊伍時可移動至隊伍第一位。'], ['adventurer-13','芭米爾',4,1,1,'進入隊伍時可移除棄牌堆 1 張牌。'], ['adventurer-14','席夢娜',4,0,1,'其他隊伍冒險者戰力 +1；若自己位於第一位則棄至棄牌堆。'], ['adventurer-15','阿爾可',3,2,1,'位於隊伍第四或第五位時，戰力 +1。'],
  ['adventurer-16','神樂',4,3,2,'進入隊伍時查看牌庫頂；若為道具或裝備，公開該牌以確認類型後置入手牌。'], ['adventurer-17','蕾普莉絲',3,1,1,'進入隊伍時抽 3 張，然後從手牌棄 1 張。'], ['adventurer-18','羅絲瑪莉',4,2,2,'討伐結束後，若本回合擊敗目標，獲得購買力 2。'], ['adventurer-19','賽席莉亞',4,2,2], ['adventurer-20','費歐娜',3,5,1,'戰力扣除隊伍中其他冒險者數量。'],
  ['adventurer-21','阿爾梅斯',4,3,2,'因戰鬥將棄至棄牌堆時，可改置於牌庫頂。'], ['adventurer-22','露希艾拉',3,1,1], ['adventurer-23','拉菲娜',3,1,1,'討伐開始擲骰；指定場上 1 隻魔物，本回合其戰力降低骰值的一半（向上取整）。'], ['adventurer-24','索娜莉亞',4,1,1,'討伐目標為魔物時，戰力 +3。'], ['adventurer-25','米莉安',4,2,2,'可作為裝備配戴給其他冒險者；配戴者戰力 +2。'],
  ['adventurer-26','莉莉西斯',4,3,2], ['adventurer-27','娜塔莉絲',3,1,1,'相鄰冒險者戰力 +1。'], ['adventurer-28','塔菲娜',3,1,1,'進入隊伍時抽 1；配戴裝備時抽 1。'], ['adventurer-29','莉迪亞',4,1,1], ['adventurer-30','尤伊爾',5,0,3,'討伐結束後，若本回合擊敗目標，可從手牌、隊伍或棄牌堆移除 1 張牌。']
];
const adventurerProfessions: Record<string, 'melee' | 'tank' | 'ranged' | 'mage' | 'support'> = {
  'adventurer-01': 'support', 'adventurer-02': 'melee', 'adventurer-03': 'mage', 'adventurer-04': 'tank', 'adventurer-05': 'support',
  'adventurer-06': 'melee', 'adventurer-07': 'ranged', 'adventurer-08': 'melee', 'adventurer-09': 'tank', 'adventurer-10': 'melee',
  'adventurer-11': 'mage', 'adventurer-12': 'tank', 'adventurer-13': 'support', 'adventurer-14': 'melee', 'adventurer-15': 'ranged',
  'adventurer-16': 'tank', 'adventurer-17': 'support', 'adventurer-18': 'melee', 'adventurer-19': 'mage', 'adventurer-20': 'mage',
  'adventurer-21': 'melee', 'adventurer-22': 'tank', 'adventurer-23': 'mage', 'adventurer-24': 'melee', 'adventurer-25': 'tank',
  'adventurer-26': 'ranged', 'adventurer-27': 'support', 'adventurer-28': 'support', 'adventurer-29': 'mage', 'adventurer-30': 'support'
};
const uncertainAdventurerEffects: Record<string, string> = {
  'adventurer-06': '討伐階段結束時，若本回合有擊敗魔王或魔物，從物資牌庫抽 1 張牌，並將其置入棄牌堆。',
  'adventurer-09': '當此冒險者有配戴裝備時，增加戰力 1。',
  'adventurer-19': '可以將魔王或魔物作為裝備，配戴在此冒險者上。當此冒險者因戰鬥或討伐棄至棄牌堆時，可以用裝備的魔王或魔物作為替代。',
  'adventurer-22': '可以將魔王或魔物作為裝備，配戴在此冒險者上；戰力增加所配戴魔王或魔物的購買力。',
  'adventurer-26': '進入隊伍的回合，購買階段時，魔王或魔物購買力增加 1。',
  'adventurer-29': '此冒險者可以配戴 3 張裝備。'
};
const adventurers = adventurerRows.map(([id, name, cost, combat, honor, text], i) => card(`base:adventurer/${id}`, 'adventurer', name, 'adventurer', `card-01.jpg；第 ${i + 1} 張`, [field('cardType', 'adventurer', 'rulebook', 'page-06.jpg；印刷頁 4；冒險者卡'), field('profession', adventurerProfessions[id], 'adventurer', `card-01.jpg；第 ${i + 1} 張；左上職業圖示（圖例見 page-06.jpg；印刷頁 4）`, 'high'), field('copies', 2, 'rulebook', 'page-04.jpg；印刷頁 2；冒險者卡共 60 張；card-01.jpg 共 30 種', 'high'), ...stats('adventurer', `card-01.jpg；第 ${i + 1} 張`, cost, combat, undefined, honor), effect('adventurer', `card-01.jpg；第 ${i + 1} 張`, text ?? uncertainAdventurerEffects[id], text ? 'high' : 'medium')]));

const resourceRows: readonly [string, string, 'item' | 'equipment', number, number | undefined, number, string][] = [
  ['resource-01','特大治癒藥水','item',3,undefined,1,'從棄牌堆取回 1 張冒險者至手牌。'], ['resource-02','火焰拳套','equipment',3,1,2,'若由近戰職業配戴，額外增加戰力 1。'], ['resource-03','邪魅法典','equipment',3,1,2,'若由輔助職業配戴，額外增加戰力 1。'], ['resource-04','驅邪聖水','item',2,undefined,1,'從手牌棄 1 張魔王後，抽 3 張。'], ['resource-05','維修道具包','item',3,undefined,1,'從棄牌堆取回 1 張裝備至手牌。'],
  ['resource-06','貓咪娃娃','item',1,undefined,-1,'沒有主動使用效果；購買後將這張牌置入右手邊玩家棄牌堆，且該卡被棄置時改置入目前持有者右手邊玩家棄牌堆。'], ['resource-07','透視眼鏡','equipment',3,1,2,'若由遠程職業配戴，額外增加戰力 1。'], ['resource-08','櫻花果子','item',4,undefined,1,'抽 2 張牌。'], ['resource-09','詛咒之槍','equipment',5,3,3,'若討伐的是魔物，增加戰力。'], ['resource-10','大號梳毛梳','item',3,undefined,1,'棄 1 張手牌後，抽 2 張。'],
  ['resource-11','寫滿的行程表','equipment',6,2,2,'其他隊友增加戰力。'], ['resource-12','真龍斧連枷','equipment',5,3,2,'裝備者因戰鬥棄牌時，移除此裝備。'], ['resource-13','賢者之石','item',3,undefined,1,'從棄牌堆取回 1 張「賢者之石」以外的道具卡至手牌。'], ['resource-14','絲綢緞帶','equipment',3,2,2,'限特定職業配戴；配戴者加戰力，且其因戰鬥棄牌時移除此裝備。'], ['resource-15','魔法除塵撢','item',4,undefined,1,'從手牌、隊伍或棄牌堆移除 1 張牌。'],
  ['resource-16','鬼哭太刀','equipment',6,2,2,'限坦克或近戰配戴；討伐時棄 1 張魔王或魔物手牌，戰力加該卡購買力。'], ['resource-17','金色水晶球','item',4,undefined,2,'抽 3 張後，從手牌棄 1 張。'], ['resource-18','名貴的首飾','equipment',4,2,1,'擊敗目標後，裝備者仍在隊伍時抽 1 張。'], ['resource-19','靈能法杖','equipment',4,1,1,'限法師或輔助配戴；討伐階段結束時，若本回合擊敗魔物或魔王，抽 2 張牌。'], ['resource-20','充能魔劍','equipment',5,2,2,'討伐階段開始時，棄置任意數量手牌，增加等同棄置牌數量的戰力。'],
  ['resource-21','精緻的耳環','equipment',4,1,1,'購買階段，本回合若擊敗目標獲得購買力。'], ['resource-22','調教手銬','item',3,undefined,1,'選擇場上 1 張魔物為目標；目標回合結束前減少戰力。'], ['resource-23','元素卷軸','item',4,undefined,2,'隊伍及手牌全部棄至棄牌堆後抽 5；每回合限一次。'], ['resource-24','聖龍護符','equipment',4,1,1,'裝備者因戰鬥棄至棄牌堆時抽 2。'], ['resource-25','騎士之盾','equipment',5,1,2,'限坦克配戴；額外增加戰力 1。'],
  ['resource-26','專用茶杯','item',4,undefined,1,'抽 3；本回合跳過討伐；若已擊敗目標則不可使用。'], ['resource-27','牛皮紙樂譜','item',5,undefined,2,'抽等同目前隊伍職業種類的牌。'], ['resource-28','特製高級紅酒','item',3,undefined,1,'從手牌棄 1 名冒險者後，抽等同該冒險者戰力數量的牌。']
];
const resourceProfessionAffinities: Partial<Record<string, readonly ('mage' | 'support')[]>> = {
  'resource-19': ['mage', 'support'],
};
const confirmedHighConfidenceResourceEffects = new Set(['resource-02', 'resource-03', 'resource-07', 'resource-25']);
const resources = resourceRows.map(([id, name, type, cost, combat, honor, text], i) => {
  const region = `card-03.jpg；第 ${i + 1} 張`;
  const effectField = effect('resource', region, text, confirmedHighConfidenceResourceEffects.has(id) ? 'high' : 'medium');
  const candidate = card(`base:resource/${id}`, 'resource', name, 'resource', region, [field('cardType', type, 'rulebook', 'page-06.jpg；印刷頁 4；物資卡介紹'), field('copies', undefined, 'rulebook', 'page-04.jpg；印刷頁 2；物資卡共 59 張；card-03.jpg 顯示 28 種', 'medium', 'exception', 'Per-card multiplicities cannot be derived safely from the total and one visual sheet.'), ...stats('resource', region, cost, combat, undefined, honor), effectField, field('effectTiming', type === 'item' ? 'action; discard at rest after use' : 'equip during action; remains until equipped adventurer leaves party', 'rulebook', 'page-06.jpg；印刷頁 4；物資卡介紹', 'high') ]);
  // A profession symbol printed in equipment text is a cross-card affinity,
  // not an adventurer profession. Resource 19 is the audited mage/support match.
  const affinities = resourceProfessionAffinities[id];
  return affinities ? { ...candidate, mechanicsTags: affinities.map((affinity) => `affinity:${affinity}`) } : candidate;
});

const monsterRows: readonly [string, string, number, number, number][] = [['monster-01','骷髏戰士',5,2,1],['monster-02','寶箱怪',5,2,5],['monster-03','蜥蜴人法師',6,2,5],['monster-04','奧術史萊姆',5,2,4],['monster-05','蛇妖',4,1,2],['monster-06','哥雷姆',7,2,5],['monster-07','哥布林盜賊',5,2,4],['monster-08','食人魔',6,2,4],['monster-09','兔妖',2,1,2],['monster-10','自動機械弓兵',4,2,5],['monster-11','自動機械戰士',4,2,5],['monster-12','石像鬼',6,2,4],['monster-13','火元素',4,1,2],['monster-14','史萊姆',5,1,2]];
const monsterRewards: Record<string, string> = {
  'monster-01': '獲得購買力 1；被打倒後不進入玩家棄牌堆，改置入魔物牌庫底。',
  'monster-02': '擲一顆骰子，獲得骰子點數一半的金錢（向上取整）。',
  'monster-03': '可從手牌、隊伍或棄牌堆移除 1 張牌。',
  'monster-04': '獲得招募區 1 張費用小於等於 3 的冒險者並置入棄牌堆。',
  'monster-05': '從物資牌庫翻出等同玩家數量的牌；從擊敗者開始順時針，每人選 1 張加入手牌，直到取完。',
  'monster-06': '可從手牌、隊伍或棄牌堆移除最多 2 張牌。',
  'monster-07': '獲得商店 1 張費用小於等於 3 的道具或裝備，置入棄牌堆。',
  'monster-08': '獲得商店 1 張費用小於等於 4 的道具或裝備，置入棄牌堆。',
  'monster-09': '抽 2 張牌。',
  'monster-10': '可從手牌移除 1 張牌。',
  'monster-11': '可從棄牌堆移除 1 張牌。',
  'monster-12': '獲得招募區 1 張費用小於等於 4 的冒險者，置入棄牌堆。',
  'monster-13': '可捨棄全部手牌，抽等量的牌。',
  'monster-14': '抽 1 張牌。'
};
const monsters = monsterRows.map(([id, name, combat, purchasePower, honor], i) => {
  const copies = id === 'monster-01'
    ? field('copies', 3, 'projectPolicy', '2026-07-31 專案負責人核准：骷髏戰士固定 3 張', 'high')
    : field('copies', undefined, 'rulebook', 'page-04.jpg；印刷頁 2；魔物卡共 32 張；card-05.jpg 顯示 14 種', 'medium', 'exception', 'Per-card multiplicities are not explicitly shown; this metadata is non-blocking.');
  const candidate = card(`base:monster/${id}`, 'monster', name, 'monster', `card-05.jpg；第 ${i + 1} 張`, [field('cardType', 'monster', 'rulebook', 'page-07.jpg；印刷頁 5；魔物卡'), copies, ...stats('monster', `card-05.jpg；第 ${i + 1} 張`, undefined, combat, purchasePower, honor), effect('monster', `card-05.jpg；第 ${i + 1} 張`, monsterRewards[id], 'high')]);
  return id === 'monster-01' ? { ...candidate, mechanicsTags: ['base:supply-cycle-anchor'] } : candidate;
});

const bossRows: readonly [string, string, number, number, number][] = [['boss-01','紅龍',9,3,10],['boss-02','巴風特',9,3,10],['boss-03','巫妖',10,3,10],['boss-04','奇美拉',5,3,10],['boss-05','究極機械獸EX',9,3,10],['boss-06','巨魔',8,3,10],['boss-07','魅魔',9,3,8],['boss-08','暗黑精靈',9,3,8],['boss-09','哈比',8,3,8],['boss-10','史萊姆娘',14,3,8],['boss-11','狼女',6,3,8]];
const bossEffects: Record<string, string> = {
  'boss-01': '戰力增加商店裡裝備的數量；獲得購買力 5，並獲得商店 2 張費用小於等於 4 的道具或裝備，置入棄牌堆。',
  'boss-02': '用於擊倒的冒險者洗入冒險者牌庫，之後抽取等量冒險者置入棄牌堆；起始冒險者改移出遊戲但抽取數量不變。獲得購買力 5，從冒險者牌庫抽 2 張置入棄牌堆。',
  'boss-03': '擊敗時必須從手牌捨棄 1 張冒險者；無法如此做時視同討伐失敗。獲得購買力 5，從棄牌堆移除 2 張牌。',
  'boss-04': '進場時從魔物牌庫抽 1 張配戴；戰力增加所配戴魔物戰力；擊敗後移除該魔物。獲得購買力 5，抽 4 張牌。',
  'boss-05': '討伐此魔王時所有裝備失效。獲得購買力 5，獲得商店 2 張費用小於等於 3 的道具或裝備，置入棄牌堆。',
  'boss-06': '隊伍中每有 1 種職業，戰力增加 1。獲得購買力 5，從冒險者牌庫抽 2 張置入棄牌堆。',
  'boss-07': '進場時從冒險者牌庫抽 1 張配戴；戰力增加所配戴冒險者戰力。獲得購買力 5，從冒險者牌庫抽 1 張，並將自己與其配戴的冒險者一同置入棄牌堆。',
  'boss-08': '僅能以最多 3 張冒險者卡進行討伐。獲得購買力 5，獲得招募區 2 張費用小於等於 3 的冒險者，置入棄牌堆。',
  'boss-09': '左手邊玩家隊伍中每有 1 種職業，此魔王戰力增加 1。獲得購買力 5，從物資牌庫抽 1 張置入棄牌堆。',
  'boss-10': '隊伍中每有 1 種職業，此魔王戰力減少 1。獲得購買力 5，抽 3 張牌。',
  'boss-11': '僅能用 1 張冒險者卡進行討伐。獲得購買力 5，獲得商店 2 張費用小於等於 3 的道具，置入棄牌堆。'
};
const bosses = bossRows.map(([id, name, combat, purchasePower, honor], i) => card(`base:boss/${id}`, 'boss', name, 'boss', `card-04.jpg；第 ${i + 1} 張`, [field('cardType', 'boss', 'rulebook', 'page-07.jpg；印刷頁 5；魔王卡'), field('copies', 1, 'rulebook', 'page-04.jpg；印刷頁 2；魔王卡共 11 張；card-04.jpg 共 11 種'), ...stats('boss', `card-04.jpg；第 ${i + 1} 張`, undefined, combat, purchasePower, honor), effect('boss', `card-04.jpg；第 ${i + 1} 張`, bossEffects[id], 'high'), ...(name === '巴風特' || name === '奇美拉' ? [field('effectTiming', 'official FAQ/errata clarification', 'faq', name === '巴風特' ? '網站 Q&A 2025/9/1；巴風特' : '網站 Q&A 2025/9/1；奇美拉', 'high', 'verified')] : [])]));

const bondRows: readonly [string, number, string][] = [
  ['提振士氣',4,'討伐階段開始時，隊伍中有 3 位冒險者且皆為輔助或法師。'], ['獨挑大樑',4,'僅使用 1 位冒險者擊敗魔物。'], ['魅惑時間',3,'討伐階段開始時，隊伍最後有 2 位法師。'], ['卸甲逃跑',3,'擊敗魔物或魔王後，隊伍中僅剩 1 位冒險者。'], ['設備改造',3,'一回合內從商店購買 2 張以上裝備。'],
  ['順手牽羊',3,'一回合內招募冒險者，並購買道具或裝備。'], ['援護射擊',4,'討伐階段開始時，隊伍最後有 2 位遠程。'], ['颯爽登場',4,'一回合內把 3 位非基礎冒險者加入隊伍。'], ['恐懼凝視',4,'討伐階段開始時，隊伍中至少有 3 位坦克或近戰。'], ['野性狂化',4,'討伐階段開始時，隊伍最前端有 2 位近戰。'],
  ['急速施法',5,'擊敗魔物或魔王後，隊伍內有 2 位以上法師。'], ['肉身強化',5,'擊敗魔物或魔王後，隊伍內有 2 位以上坦克。'], ['全力以赴',4,'一個行動階段中使用 3 張以上道具。'], ['情熱舞蹈',6,'討伐階段開始時，隊伍中有 5 種不同職業的冒險者各一位，其中至少 3 位為非基礎冒險者。'], ['天馬行空',5,'擊敗魔物或魔王後，隊伍內有 2 位以上遠程。'],
  ['精明交涉',5,'一回合內招募 2 位以上冒險者。'], ['預知未來',7,'一回合內額外抽取 3 張以上的牌。'], ['出其不意',5,'討伐魔物或魔王時，有 3 種以上職業的非基礎冒險者被一同棄至棄牌堆。'], ['魔力爆發',5,'擊敗魔物或魔王後，隊伍內有 2 位以上輔助。'], ['勇氣呐喊',5,'擊敗魔物或魔王後，隊伍內有 2 位以上近戰。'],
  ['靈光一閃',5,'隊伍中有 3 位以上同職業的冒險者。'], ['精神陶亂',4,'討伐階段開始時，隊伍最前端有 2 位坦克。'], ['冒冒失失',6,'一回合內有 3 張以上裝備隨冒險者一同棄至棄牌堆。'], ['全場鎮壓',3,'擊敗 1 隻魔物。'], ['母性感化',4,'一回合內使用 3 張以上魔物進行購買。'],
  ['魔性誘惑',4,'一回合擊敗 2 隻以上的魔物。'], ['悠悠哉哉',4,'一回合內花費購買力 7 以上。'], ['鎮魂演奏',4,'擊敗魔物或魔王後，隊伍中剩餘 2 位以上冒險者皆為同一職業。'], ['神聖祈禱',4,'討伐階段開始時，隊伍最後有 2 位輔助。'], ['洗腦操縱',4,'隊伍中有 3 種以上不同職業的非起始冒險者。']
];
const bonds = bondRows.map(([name, honor, condition], i) => card(`base:bond/bond-${String(i + 1).padStart(2, '0')}`, 'bond', name, 'bond', `card-02.jpg；第 ${i + 1} 張`, [field('cardType', 'bond', 'rulebook', 'page-07.jpg；印刷頁 5；羈絆卡'), field('copies', 1, 'rulebook', 'page-04.jpg；印刷頁 2；羈絆卡共 30 張；card-02.jpg 共 30 種'), field('honor', honor, 'bond', `card-02.jpg；第 ${i + 1} 張`, 'high'), effect('bond', `card-02.jpg；第 ${i + 1} 張`, condition, 'high')]));

const helperNames = ['流浪道具商人-01','流浪道具商人-02','公會櫃台小姐-01','公會櫃台小姐-02','酒吧老闆-01','酒吧老闆-02','謎之少女-01','謎之少女-02','武器舖店主-01','武器舖店主-02','情報商-01','情報商-02'];
const helperEffects: readonly string[] = [
  '物資費用減少 1。',
  '休息階段時，可選擇棄牌堆中 1 張道具放回牌庫頂。',
  '購買階段開始時，從牌庫頂展示牌；若是魔物或魔王則加入手牌，直到展示非魔物／魔王為止，將該牌放回牌庫頂。',
  '購買階段開始時，若本回合有擊敗魔物或魔王，隊伍中每有一位冒險者，獲得購買力 1。',
  '回合開始時，將棄牌區 1 張冒險者加入手牌；此效果一回合發動一次。',
  '冒險者費用減少 1。',
  '回合結束時，改為抽 6 張牌。',
  '隊伍上限改為 6 位冒險者；此協助者離場時，若玩家有 6 位冒險者在隊伍中，將第 6 位冒險者棄至棄牌堆。',
  '裝備費用減少 1。',
  '休息階段時，可選擇棄牌堆中 1 張裝備放回牌庫頂。',
  '回合開始時，選擇 1 張手牌給予左手邊玩家。',
  '此協助者進場、離場時，該回合玩家選擇冒險者牌庫或道具／裝備共用牌庫，從該牌庫翻開等同玩家數量的牌；從當回合玩家開始往左，每位玩家從中選擇 1 張加入手牌。'
];
const helpers = helperNames.map((name, i) => card(`base:helper/helper-${String(i + 1).padStart(2, '0')}`, 'helper', name, 'helper', `card-06.jpg；第 ${i + 1} 張`, [field('cardType', 'helper', 'rulebook', 'page-13.jpg；印刷頁 11；進階規則：協助者'), field('copies', 1, 'rulebook', 'page-04.jpg；印刷頁 2；協助者卡共 12 張；card-06.jpg 共 12 張'), effect('helper', `card-06.jpg；第 ${i + 1} 張`, helperEffects[i], 'high')]));

export const baseProvisionalContentCatalog: ProvisionalBaseContentCatalog = {
  catalogVersion: 1,
  evidence: [
    { sourceId: sourceIds.rulebook, officialUrl: url, documentName: '冒險少女公會 基礎規則書（使用者合法提供的本機視覺副本）', providedFileName: 'page-04.jpg 至 page-13.jpg', region: '印刷頁 2–11', reviewedOn: '2026-07-28', repositoryAsset: 'not-committed' },
    { sourceId: sourceIds.starter, officialUrl: url, documentName: '冒險少女公會 起始卡表（使用者合法提供的本機視覺副本）', providedFileName: 'card-07.jpg', region: '全部起始卡區域', reviewedOn: '2026-07-28', repositoryAsset: 'not-committed' },
    ...(['adventurer','resource','monster','boss','bond','helper'] as const).map((kind) => ({ sourceId: sourceIds[kind], officialUrl: url, documentName: `冒險少女公會 ${kind} 卡表（使用者合法提供的本機視覺副本）`, providedFileName: `card-${({adventurer:'01',resource:'03',monster:'05',boss:'04',bond:'02',helper:'06'} as Record<string,string>)[kind]}.jpg`, region: '全部卡牌格', reviewedOn: '2026-07-28', repositoryAsset: 'not-committed' as const })),
    { sourceId: sourceIds.faq, officialUrl: url, documentName: '官方網站 Q&A 2025/9/1 更新', providedFileName: 'not-a-local-asset', region: '初版實體說明書勘誤、效果敘述微調與補充說明', reviewedOn: '2026-07-28', repositoryAsset: 'not-committed' },
    { evidenceKind: 'project-policy', sourceId: sourceIds.projectPolicy, title: '基礎版供應連續性核准政策', locator: '專案負責人確認：骷髏戰士固定 3 張並在討伐獎勵後回魔物牌庫底', decidedOn: '2026-07-31', recordedOn: '2026-07-31', repositoryAsset: 'not-committed' }
  ],
  candidates: [...starters, ...starterResources, ...adventurers, ...resources, ...monsters, ...bosses, ...bonds, ...helpers]
};
