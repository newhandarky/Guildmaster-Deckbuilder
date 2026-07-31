import type { GameStatus, Phase } from '@guildmaster/game-protocol';

const phaseNames: Record<Phase, string> = {
  action1: '行動一',
  combat: '討伐',
  action2: '行動二',
  purchase: '購買',
  rest: '休息',
};

export function phaseDisplayName(phase: Phase): string {
  return phaseNames[phase];
}

type InteractionHintInput = {
  lifecyclePending: boolean;
  status: GameStatus;
  viewerActive: boolean;
  phase: Phase;
};

export function buildInteractionHint({
  lifecyclePending,
  status,
  viewerActive,
  phase,
}: InteractionHintInput): string {
  if (lifecyclePending) return '請先完成目前待處理的規則互動。';
  if (status !== 'playing' && status !== 'finalRound') return '此對局目前不可操作。';
  if (!viewerActive) return 'AI 正在行動，請等待你的回合。';
  if (phase === 'action1' || phase === 'action2') return '可操作手牌會以可點擊狀態顯示。';
  return `目前是${phaseDisplayName(phase)}階段，行動手牌暫不可用。`;
}
