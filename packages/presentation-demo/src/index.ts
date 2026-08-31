import type {
  PresentationAssetManifest,
  PresentationPack,
} from '@guildmaster/presentation-core';
import assetManifest from '../assets/manifest.json';

const entry = (definitionId: string, displayName: string, assetKey: string) => ({
  definitionId,
  displayName,
  portraitAssetKey: assetKey,
  portraitAltText: `${displayName}的原創示範插畫`,
  shortDisplayText: '原創卡牌文字。',
  detailDisplayText: '目前使用中性文字與替代插畫；核准插畫會隨素材更新逐步加入。',
});

const provisionalResourceNames = [
  '特大治癒藥水', '火焰拳套', '邪魅法典', '驅邪聖水', '維修道具包', '貓咪娃娃', '透視眼鏡',
  '櫻花果子', '詛咒之槍', '大號梳毛梳', '寫滿的行程表', '真龍斧連枷', '賢者之石', '絲綢緞帶',
  '魔法除塵撢', '鬼哭太刀', '金色水晶球', '名貴的首飾', '靈能法杖', '充能魔劍', '精緻的耳環',
  '調教手銬', '元素卷軸', '聖龍護符', '騎士之盾', '專用茶杯', '牛皮紙樂譜', '特製高級紅酒',
] as const;
const resourceName = (id: string) => provisionalResourceNames[Number(id) - 1] ?? `物資 ${id}`;

const provisionalBondNames = [
  '提振士氣', '獨挑大樑', '魅惑時間', '卸甲逃跑', '設備改造', '順手牽羊', '援護射擊', '颯爽登場',
  '恐懼凝視', '野性狂化', '急速施法', '肉身強化', '全力以赴', '情熱舞蹈', '天馬行空', '精明交涉',
  '預知未來', '出其不意', '魔力爆發', '勇氣吶喊', '靈光一閃', '精神陶亂', '冒冒失失', '全場鎮壓',
  '母性感化', '魔性誘惑', '悠悠哉哉', '鎮魂演奏', '神聖祈禱', '洗腦操縱',
] as const;

/** Demo-specific display data; mechanics remain owned by the Content Pack. */
export const demoPresentationPack: PresentationPack = {
  manifest: {
    id: 'presentation:demo-neutral',
    version: '2.0.0',
    theme: 'neutral-text',
    locale: 'zh-TW',
  },
  entries: [
    entry('base:starter/newcomer', '起始牌 A', 'demo:starter/newcomer'),
    entry('base:starter/guiding-stone', '起始石 A', 'demo:starter/guiding-stone'),
    entry('base:starter/moon-crystal', '起始結晶 A', 'demo:starter/moon-crystal'),
    entry('base:adventurer/shield-bearer', '冒險者 A', 'demo:adventurer/shield-bearer'),
    entry('base:adventurer/ranger', '冒險者 B', 'demo:adventurer/ranger'),
    entry('base:adventurer/ember-mage', '冒險者 C', 'demo:adventurer/ember-mage'),
    entry('base:adventurer/captain', '冒險者 D', 'demo:adventurer/captain'),
    entry('base:equipment/iron-spear', '裝備 A', 'demo:equipment/iron-spear'),
    entry('base:equipment/star-cloak', '裝備 B', 'demo:equipment/star-cloak'),
    entry('base:item/trail-rations', '道具 A', 'demo:item/trail-rations'),
    entry('base:item/trade-token', '道具 B', 'demo:item/trade-token'),
    entry('base:monster/mire-wolf', '魔物 A', 'demo:monster/mire-wolf'),
    entry('base:monster/cave-giant', '魔物 B', 'demo:monster/cave-giant'),
    entry('base:monster/ash-drake', '魔物 C', 'demo:monster/ash-drake'),
    entry('base:boss/ruin-warden', '目標 A', 'demo:boss/ruin-warden'),
    entry('base:boss/frost-regent', '目標 B', 'demo:boss/frost-regent'),
    entry('base:boss/void-duke', '目標 C', 'demo:boss/void-duke'),
    entry('base:boss/cinder-queen', '目標 D', 'demo:boss/cinder-queen'),
  ],
};

/** Internal neutral copy for the first provisional resource slice. */
export const provisionalFoundationPresentationPack: PresentationPack = {
  manifest: {
    id: 'presentation:provisional-foundation-neutral',
    version: '9.2.0',
    theme: 'neutral-text',
    locale: 'zh-TW',
  },
  entries: [
    {
      definitionId: 'base:resource/resource-01',
      displayName: resourceName('01'),
      portraitAssetKey: 'base:portrait/resource-01',
      portraitAltText: `${resourceName('01')}的卡牌插畫`,
      shortDisplayText: '使用：從棄牌堆取回 1 張冒險者。',
      detailDisplayText: '行動階段使用後，選擇自己棄牌堆中的 1 張冒險者加入手牌。',
    },
    {
      definitionId: 'base:resource/resource-02',
      displayName: resourceName('02'),
      portraitAssetKey: 'base:portrait/resource-02',
      portraitAltText: `${resourceName('02')}的卡牌插畫`,
      shortDisplayText: '印刷戰力 1；完整四人模式由近戰配戴時額外 +1。',
      detailDisplayText: '火焰拳套的印刷戰力為 1；由近戰冒險者配戴時額外增加戰力 1，合計提供 2。',
    },
    {
      definitionId: 'base:resource/resource-04',
      displayName: resourceName('04'),
      portraitAssetKey: 'base:portrait/resource-04',
      portraitAltText: `${resourceName('04')}的卡牌插畫`,
      shortDisplayText: '使用：棄 1 張魔王，然後抽 3 張牌。',
      detailDisplayText: '行動階段使用後，從手牌選擇並棄置 1 張魔王，再抽 3 張牌。',
    },
    {
      definitionId: 'base:resource/resource-05',
      displayName: resourceName('05'),
      portraitAssetKey: 'base:portrait/resource-05',
      portraitAltText: `${resourceName('05')}的卡牌插畫`,
      shortDisplayText: '使用：從棄牌堆取回 1 張裝備。',
      detailDisplayText: '行動階段使用後，選擇自己棄牌堆中的 1 張裝備加入手牌。',
    },
    {
      definitionId: 'base:resource/resource-08',
      displayName: resourceName('08'),
      portraitAssetKey: 'base:portrait/resource-08',
      portraitAltText: `${resourceName('08')}的卡牌插畫`,
      shortDisplayText: '使用：抽 2 張牌。',
      detailDisplayText: '行動階段使用後抽 2 張牌。',
    },
    {
      definitionId: 'base:resource/resource-10',
      displayName: resourceName('10'),
      portraitAssetKey: 'base:portrait/resource-10',
      portraitAltText: `${resourceName('10')}的卡牌插畫`,
      shortDisplayText: '使用：棄 1 張手牌，然後抽 2 張牌。',
      detailDisplayText: '行動階段使用後選擇並棄置 1 張手牌，再抽 2 張牌。',
    },
    {
      definitionId: 'base:resource/resource-13',
      displayName: resourceName('13'),
      portraitAssetKey: 'base:portrait/resource-13',
      portraitAltText: `${resourceName('13')}的卡牌插畫`,
      shortDisplayText: '使用：從棄牌堆取回 1 張非同名道具卡。',
      detailDisplayText: '行動階段使用後，選擇自己棄牌堆中的 1 張道具卡加入手牌；賢者之石不能被選擇。',
    },
    {
      definitionId: 'base:resource/resource-15',
      displayName: resourceName('15'),
      portraitAssetKey: 'base:portrait/resource-15',
      portraitAltText: `${resourceName('15')}的卡牌插畫`,
      shortDisplayText: '使用：從手牌、隊伍或棄牌堆移除 1 張牌。',
      detailDisplayText: '行動階段使用後，從自己的手牌、隊伍或棄牌堆選擇 1 張牌移出遊戲；若移除配戴裝備的隊員，其裝備置入棄牌堆。',
    },
    {
      definitionId: 'base:resource/resource-17',
      displayName: resourceName('17'),
      portraitAssetKey: 'base:portrait/resource-17',
      portraitAltText: `${resourceName('17')}的卡牌插畫`,
      shortDisplayText: '使用：抽 3 張牌，然後棄 1 張手牌。',
      detailDisplayText: '行動階段使用後抽 3 張牌，再選擇並棄置 1 張手牌。',
    },
    {
      definitionId: 'base:resource/resource-18',
      displayName: resourceName('18'),
      portraitAssetKey: 'base:portrait/resource-18',
      portraitAltText: `${resourceName('18')}的卡牌插畫`,
      shortDisplayText: '配戴者仍在隊伍時，每次擊敗目標後抽 1 張牌。',
      detailDisplayText: '本次行動玩家擊敗目標後，若此裝備仍掛在自己的隊伍中，該裝備實例會觸發並抽 1 張牌；多個實例各自觸發。',
    },
    {
      definitionId: 'base:resource/resource-27',
      displayName: resourceName('27'),
      portraitAssetKey: 'base:portrait/resource-27',
      portraitAltText: `${resourceName('27')}的卡牌插畫`,
      shortDisplayText: '使用：依目前隊伍中的職業種類數抽牌。',
      detailDisplayText: '行動階段使用後，計算目前隊伍中不同的冒險者職業種類，並抽取等量卡牌；同職業只計算一次。',
    },
  ],
};

const fullExistingResourceEntries = new Set(['01','02','04','05','08','10','13','15','17','18','27']);
const fullNeutralEntry = (definitionId: string, displayName: string, kind: 'starter' | 'adventurer' | 'item' | 'equipment' | 'monster' | 'boss') => ({
  definitionId, displayName,
  portraitAssetKey: `placeholder:provisional-${kind}`,
  portraitAltText: `${displayName} 的中性替代插畫`,
  shortDisplayText: '候選數值已載入；個別效果尚未啟用。',
  detailDisplayText: '這張卡目前使用測試數值；尚未完成確認的個別效果不會啟用。',
});
const enabledMonsterRewardCopy: Readonly<Record<string, { shortDisplayText: string; detailDisplayText: string }>> = {
  '01': {
    shortDisplayText: '擊敗獎勵：可使本回合購買力 +1；此牌回到魔物牌庫底。',
    detailDisplayText: '擊敗後，當回合玩家可選擇獲得 1 點購買力或略過；此魔物不進入玩家棄牌堆，依既有供應循環規則回到魔物牌庫底。',
  },
  '02': {
    shortDisplayText: '擊敗獎勵：可擲六面骰，獲得骰面一半（無條件進位）的購買力。',
    detailDisplayText: '擊敗後，當回合玩家可選擇略過，或擲 1 顆六面骰並獲得骰面數值一半、無條件進位的購買力；擲骰結果會隨本局進度保存。',
  },
  '03': {
    shortDisplayText: '擊敗獎勵：可從手牌、隊伍或棄牌堆移除 0 或 1 張牌。',
    detailDisplayText: '擊敗後可選擇略過，或從自己的手牌、隊伍或棄牌堆選擇 1 張牌移出遊戲；移除配戴裝備的隊員時，其裝備置入棄牌堆。',
  },
  '06': {
    shortDisplayText: '擊敗獎勵：可從手牌、隊伍或棄牌堆移除最多 2 張牌。',
    detailDisplayText: '擊敗後分兩次選擇；每次都可略過或移除 1 張自己手牌、隊伍或棄牌堆中的牌，因此可移除 0、1 或 2 張。每次選擇後都會重新計算可選卡牌。',
  },
  '09': {
    shortDisplayText: '擊敗獎勵：可抽 2 張牌。',
    detailDisplayText: '擊敗後，當回合玩家可選擇抽 2 張牌或略過；牌庫不足時依一般規則重洗棄牌堆。',
  },
  '10': {
    shortDisplayText: '擊敗獎勵：可從手牌移除 0 或 1 張牌。',
    detailDisplayText: '擊敗後可選擇略過，或從自己的手牌移除 1 張牌；手牌沒有可選卡牌時可以略過。',
  },
  '11': {
    shortDisplayText: '擊敗獎勵：可從棄牌堆移除 0 或 1 張牌。',
    detailDisplayText: '擊敗後可選擇略過，或從自己的棄牌堆移除 1 張牌；可選卡牌會依目前棄牌堆內容更新。',
  },
  '14': {
    shortDisplayText: '擊敗獎勵：可抽 1 張牌。',
    detailDisplayText: '擊敗後，當回合玩家可選擇抽 1 張牌或略過；抽牌與討伐結果會一併儲存及重播。',
  },
};
const enabledAdditionalMonsterCopy: Readonly<Record<string, string>> = {
  '04': '擊敗後可選擇取得招募區 1 張費用 3 以下的冒險者，置入棄牌堆。',
  '05': '擊敗後由所有玩家依座位順序輪流從公開物資集合選 1 張，置入各自棄牌堆。',
  '07': '擊敗後可選擇取得商店 1 張費用 3 以下的道具或裝備，置入棄牌堆。',
  '08': '擊敗後可選擇取得商店 1 張費用 4 以下的道具或裝備，置入棄牌堆。',
  '12': '擊敗後可選擇取得招募區 1 張費用 4 以下的冒險者，置入棄牌堆。',
  '13': '擊敗後可選擇棄掉全部手牌，再抽 5 張牌。',
};
const enabledAdditionalAdventurerCopy: Readonly<Record<string, string>> = {
  '01': '討伐階段結束時，若本回合擊敗目標，可從棄牌堆取回 1 張冒險者至手牌。',
  '03': '討伐階段開始時擲 1 顆六面骰；擲出單數時，本回合戰力 +1。',
  '06': '討伐階段結束時，若本回合擊敗目標，從公共物資牌庫取得 1 張牌置入棄牌堆。',
  '07': '進入隊伍時，可選擇任意數量公開魔物放回牌庫底，再翻出等量魔物。',
  '08': '進入隊伍時指定 1 隻公開魔物；本回合其戰力 −2。',
  '11': '進入隊伍時查看自己牌庫頂 3 張，可移除其中 1 張，再任意排序其餘卡牌。',
  '12': '進入隊伍時，可移動到隊伍第一位。',
  '13': '進入隊伍時，可從自己的棄牌堆移除 1 張牌。',
  '14': '其他隊伍冒險者戰力 +1；若自己位於第一位，立即棄至棄牌堆。',
  '16': '進入隊伍時查看牌庫頂；若為道具或裝備，公開後加入手牌。',
  '17': '進入隊伍時抽 3 張牌，然後從手牌棄 1 張牌。',
  '18': '討伐階段結束時，若本回合擊敗目標，獲得購買力 2。',
  '19': '因戰鬥將棄至棄牌堆時，可改為棄置所配戴的敵人卡並留在隊伍。',
  '21': '因戰鬥將棄至棄牌堆時，可改置於自己的牌庫頂。',
  '22': '可以將魔物或魔王作為附件配戴在此冒險者上；此冒險者增加該附件的印刷購買力作為戰力。',
  '23': '討伐階段開始時擲骰，指定 1 隻魔物；本回合其戰力降低骰值的一半（向上取整）。',
  '25': '可作為裝備配戴給其他冒險者；配戴者戰力 +2。',
  '26': '進入隊伍時，從敵人區取得 1 張魔物作為手牌資源。',
  '28': '進入隊伍時抽 1 張牌；配戴裝備時再抽 1 張牌。',
  '29': '此冒險者最多可以配戴 3 張裝備。',
  '30': '討伐階段結束時，若本回合擊敗目標，可從手牌、隊伍或棄牌堆移除 1 張牌。',
};
const enabledAdditionalResourceCopy: Readonly<Record<string, string>> = {
  '06': '購買後置入右手邊玩家棄牌堆；之後每次將棄置時，改傳給目前持有者右手邊玩家。',
  '09': '討伐魔王時，這張裝備額外提供戰力 2；討伐魔物時不套用。',
  '11': '配戴後，隊伍中除配戴者以外的其他冒險者戰力各 +1。',
  '14': '僅近戰或輔助可配戴；提供戰力 2，配戴者因戰鬥棄置時此裝備移出遊戲。',
  '16': '僅坦克或近戰可配戴；討伐開始可棄 1 張敵人手牌，增加等同其購買力的戰力。',
  '19': '僅法師或輔助可配戴；討伐階段結束時若本回合擊敗目標，抽 2 張牌。',
  '20': '討伐階段開始時，可棄置任意數量手牌並增加等量戰力。',
  '21': '購買階段開始時，若本回合擊敗目標，獲得購買力 2。',
  '22': '使用時指定場上 1 張魔物；該魔物戰力 −1，直到本回合結束。沒有可選魔物時不可使用。',
  '23': '使用時棄置全部隊伍與手牌，再抽 5 張牌；每回合限一次。',
  '24': '配戴者因戰鬥棄至棄牌堆時，抽 2 張牌。',
  '26': '使用時抽 3 張牌並跳過本回合討伐；本回合已擊敗目標時不能使用。',
  '28': '使用時從手牌棄 1 名冒險者，再依其印刷戰力抽等量卡牌。',
};
const enabledProfessionEquipmentCopy: Readonly<Record<string, { profession: string; name: string }>> = {
  '03': { profession: '輔助', name: '邪魅法典' },
  '07': { profession: '遠程', name: '透視眼鏡' },
  '25': { profession: '坦克', name: '騎士之盾' },
};
const enabledPartyCombatCopy: Readonly<Record<string, { shortDisplayText: string; detailDisplayText: string }>> = {
  '04': { shortDisplayText: '隊伍第一位的其他冒險者戰力 +2。', detailDisplayText: '只要此冒險者在隊伍中，隊伍第一位的另一名冒險者有效戰力增加 2；若此卡自己位於第一位則不套用。位置變動後會立即重算。' },
  '10': { shortDisplayText: '位於隊伍第一位時，自身戰力 +2。', detailDisplayText: '此冒險者只有在隊伍第一位時，自身有效戰力增加 2；離開第一位後立即失去此加成。' },
  '15': { shortDisplayText: '位於隊伍第四或第五位時，自身戰力 +1。', detailDisplayText: '此冒險者位於隊伍第 4 或第 5 位時，自身有效戰力增加 1；其他位置不套用。' },
  '20': { shortDisplayText: '自身戰力減少隊伍中其他冒險者的數量。', detailDisplayText: '計算有效戰力時，每有 1 名其他隊伍冒險者，自身戰力便減少 1；單張卡的有效戰力最低為 0。' },
  '24': { shortDisplayText: '討伐魔物時，自身戰力 +3。', detailDisplayText: '本次討伐目標為魔物時，此冒險者有效戰力增加 3；討伐魔王或沒有指定目標的公開隊伍摘要不套用。' },
  '27': { shortDisplayText: '相鄰的其他冒險者戰力各 +1。', detailDisplayText: '此冒險者前後直接相鄰的隊伍冒險者有效戰力各增加 1；隊伍位置改變後立即重算。' },
};
const enabledBossCopy: Readonly<Record<string, { shortDisplayText: string; detailDisplayText: string }>> = {
  '01': {
    shortDisplayText: '戰力增加商店中的裝備數；擊敗後購買力 +5，並取得商店最多 2 張費用 4 以下的牌。',
    detailDisplayText: '此魔王的有效戰力等於印刷戰力 9，加上當下商店公開列中的裝備張數；商店變動後會重新計算。擊敗後先取得 5 點購買力，再依序取得最多 2 張費用 4 以下的道具或裝備置入棄牌堆；沒有候選時自動略過，商店不立即補牌。',
  },
  '02': {
    shortDisplayText: '參戰起始冒險者移出遊戲，其他冒險者洗回公共牌庫，再依參戰人數補抽；擊敗後購買力 +5 並再取得 2 張冒險者。',
    detailDisplayText: '只處理實際提供戰力的最短隊伍前綴：其中起始冒險者移出遊戲，非起始冒險者洗回公共冒險者牌庫，裝備依各自離場規則進入棄牌堆或移出遊戲。完成洗牌後，依全部參戰者人數從該牌庫頂取得等量冒險者置入棄牌堆；牌庫不足時只取得現存牌。擊敗後再取得 5 點購買力與最多 2 張公共冒險者。',
  },
  '03': {
    shortDisplayText: '戰鬥後必須從手牌棄 1 張冒險者；無法支付時討伐失敗。成功後購買力 +5，並可從棄牌堆移除最多 2 張牌。',
    detailDisplayText: '隊伍戰力足夠時，即使手牌沒有冒險者仍可發起討伐。實際參戰的最短隊伍前綴與裝備會先依戰鬥規則離場；接著必須從手牌選擇並棄置 1 張帶有職業的冒險者。零候選時巫妖留在公共區域、沒有任何報酬，已離場隊伍不回復。支付成功後取得 5 點購買力，再分兩次選擇從自己的棄牌堆移除 0、1 或 2 張牌。',
  },
  '04': {
    shortDisplayText: '進場時配戴 1 張魔物牌庫頂卡並增加其戰力；擊敗後移除附件、購買力 +5 並抽 4 張牌。',
    detailDisplayText: '進場時從公共魔物牌庫取得頂牌作為公開附件，此魔王增加該魔物的印刷戰力。擊敗後所配戴的魔物移出遊戲，不會與魔王一同取得；獲得 5 點購買力並抽 4 張牌。',
  },
  '05': {
    shortDisplayText: '本次討伐所有裝備失效；擊敗後購買力 +5，並取得商店最多 2 張費用 3 以下的牌。',
    detailDisplayText: '討伐此魔王的整次戰鬥中，裝備的戰力、修正、觸發與離場替代全部失效，但仍保持配戴並隨實際參戰者依核心規則棄置。擊敗後先取得 5 點購買力，再依序從當下商店取得最多 2 張費用 3 以下的道具或裝備置入棄牌堆；沒有候選時自動略過，商店不立即補牌。',
  },
  '06': {
    shortDisplayText: '完整隊伍每有 1 種職業，戰力 +1；擊敗後購買力 +5，並從冒險者牌庫取得 2 張牌。',
    detailDisplayText: '此魔王的有效戰力等於印刷戰力 8，加上當回合玩家完整公開隊伍中的不同職業種類數；重複職業只計一次，裝備不提供職業。擊敗後先取得 5 點購買力，再從公共冒險者牌庫頂取得最多 2 張牌置入自己的棄牌堆；牌庫不足時只取得現存牌。',
  },
  '07': {
    shortDisplayText: '進場時配戴 1 張冒險者牌庫頂卡並增加其戰力；擊敗後購買力 +5 並取得 1 張冒險者。',
    detailDisplayText: '進場時從公共冒險者牌庫取得頂牌作為公開附件，此魔王增加該附件的印刷戰力。擊敗後先取得 5 點購買力，再從冒險者牌庫取得 1 張牌；魔王與附件一同置入棄牌堆。',
  },
  '08': {
    shortDisplayText: '最多使用隊伍最前方 3 名冒險者；擊敗後購買力 +5，並取得招募區最多 2 張費用 3 以下的冒險者。',
    detailDisplayText: '討伐時只能使用隊伍最前方連續的 1 至 3 名冒險者及其裝備，不能跳過前方成員；未參戰的後方成員保留。擊敗後先取得 5 點購買力，再依序取得招募區最多 2 張費用 3 以下的冒險者置入棄牌堆；沒有候選時自動略過，招募區不立即補牌。',
  },
  '09': {
    shortDisplayText: '左手邊玩家完整隊伍每有 1 種職業，戰力 +1；擊敗後購買力 +5，並從物資牌庫取得 1 張牌。',
    detailDisplayText: '此魔王的有效戰力等於印刷戰力 8，加上當回合玩家左手邊玩家完整公開隊伍中的不同職業種類數；輪到不同玩家行動時會重新計算。擊敗後先取得 5 點購買力，再從公共物資牌庫頂取得最多 1 張牌置入自己的棄牌堆；牌庫為空時略過取牌。',
  },
  '10': {
    shortDisplayText: '完整隊伍每有 1 種職業，戰力 −1；擊敗後購買力 +5，並抽 3 張牌。',
    detailDisplayText: '此魔王的有效戰力等於印刷戰力 14，減去當回合玩家完整公開隊伍中的不同職業種類數；重複職業只計一次，最低戰力為 0。擊敗後先取得 5 點購買力，再從自己的牌庫抽 3 張，必要時依一般規則重洗棄牌堆。',
  },
  '11': {
    shortDisplayText: '只能使用隊伍最前方 1 名冒險者；擊敗後購買力 +5，並取得商店最多 2 張費用 3 以下的道具。',
    detailDisplayText: '討伐時只能使用隊伍最前方第 1 名冒險者及其裝備，不能改選後方成員；所有未參戰成員保留。擊敗後先取得 5 點購買力，再依序取得商店最多 2 張費用 3 以下的道具置入棄牌堆，裝備不是合法候選；沒有候選時自動略過，商店不立即補牌。',
  },
};
const provisionalBondConditionSummaries = [
  '討伐階段開始時，隊伍中有 3 位冒險者且皆為輔助或法師。',
  '僅使用 1 位冒險者擊敗魔物。',
  '討伐階段開始時，隊伍最後有 2 位法師。',
  '擊敗魔物或魔王後，隊伍中僅剩 1 位冒險者。',
  '一回合內從商店購買 2 張以上裝備。',
  '一回合內招募冒險者，並購買道具或裝備。',
  '討伐階段開始時，隊伍最後有 2 位遠程。',
  '一回合內把 3 位非基礎冒險者加入隊伍。',
  '討伐階段開始時，隊伍中至少有 3 位坦克或近戰。',
  '討伐階段開始時，隊伍最前端有 2 位近戰。',
  '擊敗魔物或魔王後，隊伍內有 2 位以上法師。',
  '擊敗魔物或魔王後，隊伍內有 2 位以上坦克。',
  '一個行動階段中使用 3 張以上道具。',
  '討伐階段開始時，隊伍中有 5 種不同職業的冒險者各一位，其中至少 3 位為非基礎冒險者。',
  '擊敗魔物或魔王後，隊伍內有 2 位以上遠程。',
  '一回合內招募 2 位以上冒險者。',
  '一回合內額外抽取 3 張以上的牌。',
  '討伐魔物或魔王時，有 3 種以上職業的非基礎冒險者被一同棄至棄牌堆。',
  '擊敗魔物或魔王後，隊伍內有 2 位以上輔助。',
  '擊敗魔物或魔王後，隊伍內有 2 位以上近戰。',
  '隊伍中有 3 位以上同職業的冒險者。',
  '討伐階段開始時，隊伍最前端有 2 位坦克。',
  '一回合內有 3 張以上裝備隨冒險者一同棄至棄牌堆。',
  '擊敗 1 隻魔物。',
  '一回合內使用 3 張以上魔物進行購買。',
  '一回合擊敗 2 隻以上的魔物。',
  '一回合內花費購買力 7 以上。',
  '擊敗魔物或魔王後，隊伍中剩餘 2 位以上冒險者皆為同一職業。',
  '討伐階段開始時，隊伍最後有 2 位輔助。',
  '隊伍中有 3 種以上不同職業的非起始冒險者。',
] as const;
export const provisionalOriginalFullPresentationPack: PresentationPack = {
  manifest: { id: 'presentation:provisional-original-full-neutral', version: '2.9.0', theme: 'neutral-text', locale: 'zh-TW' },
  entries: [
    ...Array.from({ length: 5 }, (_, index) => {
      const id = String(index + 1).padStart(2, '0');
      return {
        ...fullNeutralEntry(`base:starter/adventurer-${id}`, `候選起始冒險者 ${id}`, 'starter'),
        portraitAssetKey: `base:portrait/starter-adventurer-${id}`,
        portraitAltText: `候選起始冒險者 ${id} 的卡牌插畫`,
        shortDisplayText: '起始冒險者；沒有個別文字效果。',
        detailDisplayText: '這張起始冒險者依印刷戰力與職業參與隊伍規則，本身沒有需要另行啟用的個別文字效果。',
      };
    }),
    {
      ...fullNeutralEntry('base:starter/summoning-stone', '候選起始資源 A', 'starter'),
      portraitAssetKey: 'base:portrait/starter-summoning-stone',
      portraitAltText: '候選起始資源 A 的卡牌插畫',
      shortDisplayText: '起始資源；提供購買力 1，沒有個別文字效果。',
      detailDisplayText: '這張起始資源依印刷數值提供購買力 1，本身沒有需要另行啟用的個別文字效果。',
    },
    {
      ...fullNeutralEntry('base:starter/spirit-crystal', '候選起始裝備 B', 'equipment'),
      portraitAssetKey: 'base:portrait/starter-spirit-crystal',
      portraitAltText: '候選起始裝備 B 的卡牌插畫',
      shortDisplayText: '起始裝備；印刷戰力 1。',
      detailDisplayText: '這張牌是起始手牌中的裝備，可在行動階段配戴給隊伍中的冒險者，提供印刷戰力 1。',
    },
    ...Array.from({ length: 30 }, (_, index) => {
      const id = String(index + 1).padStart(2, '0');
      return {
        ...fullNeutralEntry(`base:adventurer/adventurer-${id}`, `候選冒險者 ${id}`, 'adventurer'),
        portraitAssetKey: `base:portrait/adventurer-${id}`,
        portraitAltText: `候選冒險者 ${id} 的卡牌插畫`,
        ...(id === '02' ? {
          shortDisplayText: '此冒險者不能配戴裝備。',
          detailDisplayText: '此冒險者在隊伍中時，不能配戴任何裝備。',
        } : id === '05' ? {
          shortDisplayText: '在自己的隊伍中時，購買所有裝備費用 −1。',
          detailDisplayText: '此冒險者位於自己的隊伍時，自己從商店購買的每張裝備費用減少 1，最低為 0；不影響道具，也不替其他玩家折價。',
        } : id === '09' ? {
          shortDisplayText: '配戴任一裝備時，額外增加戰力 1。',
          detailDisplayText: '此冒險者實際配戴裝備時，除裝備本身與其他合法修正外，再增加戰力 1；未配戴裝備時不套用。',
        } : enabledPartyCombatCopy[id] ?? (enabledAdditionalAdventurerCopy[id] ? {
          shortDisplayText: enabledAdditionalAdventurerCopy[id],
          detailDisplayText: enabledAdditionalAdventurerCopy[id],
        } : {})),
      };
    }),
    ...Array.from({ length: 28 }, (_, index) => String(index + 1).padStart(2, '0')).filter((id) => !fullExistingResourceEntries.has(id)).map((id) => {
      const professionEquipment = enabledProfessionEquipmentCopy[id];
      return {
        ...fullNeutralEntry(`base:resource/resource-${id}`, resourceName(id), [2,3,7,9,11,12,14,16,18,19,20,21,24,25].includes(Number(id)) ? 'equipment' : 'item'),
        portraitAssetKey: `base:portrait/resource-${id}`,
        portraitAltText: `${resourceName(id)}的卡牌插畫`,
        ...(id === '12' ? {
          shortDisplayText: '配戴者因戰鬥進入棄牌堆時，此裝備改為移出遊戲。',
          detailDisplayText: '配戴者實際作為討伐參戰者進入棄牌堆時，冒險者照常棄置，但真龍斧連枷會強制永久移出本局；隊伍超額、休息或卡牌效果造成的離場不觸發。',
        } : professionEquipment ? {
          shortDisplayText: `印刷戰力 1；由${professionEquipment.profession}配戴時額外 +1。`,
          detailDisplayText: `${professionEquipment.name}的印刷戰力為 1；由${professionEquipment.profession}冒險者配戴時額外增加戰力 1，合計提供 2。`,
        } : enabledAdditionalResourceCopy[id] ? {
          shortDisplayText: enabledAdditionalResourceCopy[id],
          detailDisplayText: enabledAdditionalResourceCopy[id],
        } : {}),
      };
    }),
    ...Array.from({ length: 14 }, (_, index) => {
      const id = String(index + 1).padStart(2, '0');
      return {
        ...fullNeutralEntry(`base:monster/monster-${id}`, `候選魔物 ${id}`, 'monster'),
        portraitAssetKey: `base:portrait/monster-${id}`,
        portraitAltText: `候選魔物 ${id} 的卡牌插畫`,
        ...(enabledMonsterRewardCopy[id] ?? (enabledAdditionalMonsterCopy[id] ? {
          shortDisplayText: enabledAdditionalMonsterCopy[id],
          detailDisplayText: `${enabledAdditionalMonsterCopy[id]} 每次選擇後會重新計算可選卡牌；沒有可選卡牌時可以略過。`,
        } : {})),
      };
    }),
    ...Array.from({ length: 11 }, (_, index) => {
      const id = String(index + 1).padStart(2, '0');
      return { ...fullNeutralEntry(`base:boss/boss-${id}`, `候選魔王 ${id}`, 'boss'), portraitAssetKey: `base:portrait/boss-${id}`, portraitAltText: `候選魔王 ${id} 的卡牌插畫`, ...(enabledBossCopy[id] ?? {}) };
    }),
    ...provisionalBondConditionSummaries.map((condition, index) => {
      const id = String(index + 1).padStart(2, '0');
      return {
        definitionId: `base:bond/bond-${id}`,
        displayName: provisionalBondNames[index] ?? `羈絆 ${id}`,
        portraitAssetKey: 'placeholder:provisional-bond',
        portraitAltText: `${provisionalBondNames[index] ?? `羈絆 ${id}`}的中性替代插畫`,
        shortDisplayText: condition,
        detailDisplayText: `${condition} 達成條件後，玩家可以選擇完成或暫不完成。`,
      };
    }),
  ],
};

/** Neutral client-only copy for the provisional helper rotation slice. */
export const provisionalHelpersPresentationPack: PresentationPack = {
  manifest: {
    id: 'presentation:provisional-helpers-neutral',
    version: '1.2.0',
    theme: 'neutral-text',
    locale: 'zh-TW',
  },
  entries: Array.from({ length: 12 }, (_, index) => {
    const sequence = String(index + 1).padStart(2, '0');
    const copy = ({
      '01': ['流浪商人・物資折扣', '所有物資費用 −1，最低為 0。', '此協助者在場時，所有道具與裝備的購買費用減少 1，最低為 0。卡面仍顯示原費用。'],
      '02': ['流浪商人・回收服務', '休息時可將棄牌堆 1 張道具放到牌庫頂。', '休息階段結算時，可選擇自己棄牌堆中的 1 張道具放到牌庫頂；裝備不在選擇範圍內，也可以略過。'],
      '03': ['公會櫃台・敵情整理', '購買階段開始時，翻牌直到非敵人牌；敵人加入手牌，該牌留在牌庫頂。', '購買階段開始時依序揭示自己的牌庫。揭示到的魔物與魔王加入手牌；第一張非敵人牌留在牌庫頂，接著停止。這項效果已啟用。'],
      '04': ['公會櫃台・討伐獎金', '本回合擊敗敵人後，購買力依隊伍人數增加。', '進入購買階段時，若本回合曾擊敗魔物或魔王，依目前隊伍中的冒險者人數增加購買力。'],
      '05': ['酒吧老闆・舊友召回', '回合開始時可從棄牌堆取回 1 位冒險者。', '回合開始時可選擇自己棄牌堆中的 1 張冒險者加入手牌；每次觸發只能取回 1 張，也可以略過。'],
      '06': ['酒吧老闆・招募折扣', '所有冒險者費用 −1，最低為 0。', '此協助者在場時，所有冒險者的購買費用減少 1，最低為 0。卡面仍顯示原費用。'],
      '07': ['謎之少女・靈感補充', '休息結算時抽 6 張牌。', '此協助者在場時，主動玩家完成休息結算會抽取 6 張牌；離場或未啟用時恢復抽 5 張。'],
      '08': ['謎之少女・擴編許可', '所有玩家隊伍上限 +1；離場時棄置最右側的超額隊員。', '此協助者在場時，所有玩家的隊伍上限為 6。離場後若隊伍超過 5 人，立即將最右側隊員及其裝備放入該玩家棄牌堆。'],
      '09': ['武器舖主・裝備折扣', '所有裝備費用 −1，最低為 0。', '此協助者在場時，所有裝備的購買費用減少 1，最低為 0。卡面仍顯示原費用。'],
      '10': ['武器舖主・裝備整備', '休息時可將棄牌堆 1 張裝備放到牌庫頂。', '休息階段結算時，可選擇自己棄牌堆中的 1 張裝備放到牌庫頂；也可以略過。'],
      '11': ['情報商・秘密交易', '回合開始時將 1 張手牌交給左側玩家。', '回合開始時依規則選擇自己手牌中的 1 張牌，交給左手邊玩家；選擇完成前會暫停其他遊戲操作。'],
      '12': ['情報商・公開徵選', '進場與離場時進行四人公開選牌。', '此協助者進場或離場時，會依四人模式規則從冒險者或物資牌庫建立公開選牌並依序處理。'],
    } as const)[sequence as '01'];
    return {
      definitionId: `base:helper/helper-${sequence}`,
      displayName: copy[0],
      portraitAssetKey: `base:portrait/helper-${sequence}`,
      portraitAltText: `${copy[0]}的替代插畫`,
      shortDisplayText: copy[1],
      detailDisplayText: copy[2],
    };
  }),
};

/**
 * Only approved runtime assets belong here. Empty/partial coverage is valid and
 * deliberately leaves the Web client on its neutral CSS placeholder.
 */
export const demoPresentationAssetManifest: PresentationAssetManifest = assetManifest;

export const demoPresentationAssetKeys = demoPresentationPack.entries
  .map((presentationEntry) => presentationEntry.portraitAssetKey)
  .sort();
