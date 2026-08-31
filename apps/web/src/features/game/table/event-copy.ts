import type { DomainEvent } from '@guildmaster/game-protocol';

const fallbackByType: Readonly<Record<string, string>> = {
  EFFECT_STARTED: '卡牌效果開始結算。',
  EFFECT_SUSPENDED: '卡牌效果正在等待玩家完成畫面中的選擇。',
  EFFECT_COMPLETED: '卡牌效果已完成。',
  CARD_MOVED: '卡牌已依效果文字移動到指定區域。',
  CARD_REMOVED: '已將查看的卡牌移出遊戲；這不是棄牌，也不會加入手牌。',
  PLAYER_DECK_REORDERED: '玩家已完成查看牌庫卡牌的排序；順序不公開。',
  PLAYER_PARTY_REORDERED: '玩家已重新排列隊伍。',
  COMBAT_REWARD_POLICY_EXECUTED: '討伐獎勵已完成結算。',
  ATTACK_RESOLUTION_EVALUATED: '討伐結果已完成計算。',
};

export function eventDisplayMessage(event: DomainEvent): string {
  if (/\p{Script=Han}/u.test(event.message)) return event.message;
  if (event.message.includes('helper-11-pass-card')) return event.type === 'EFFECT_COMPLETED'
    ? '已將所選手牌交給左側玩家。'
    : '公會情報商效果：請選擇一張手牌交給左側玩家。';
  return fallbackByType[event.type] ?? '遊戲狀態已依規則更新。';
}
