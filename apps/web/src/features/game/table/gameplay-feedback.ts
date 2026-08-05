import type { GameCommand, Phase } from '@guildmaster/game-protocol';
import { phaseDisplayName } from './phase-copy.js';

export const phaseOrder = ['action1', 'combat', 'action2', 'purchase', 'rest'] as const satisfies readonly Phase[];

export type PhaseProgressItem = {
  phase: Phase;
  label: string;
  position: number;
  state: 'completed' | 'current' | 'upcoming';
};

export function buildPhaseProgress(currentPhase: Phase): readonly PhaseProgressItem[] {
  const currentIndex = phaseOrder.indexOf(currentPhase);
  return phaseOrder.map((phase, index) => ({
    phase,
    label: phaseDisplayName(phase),
    position: index + 1,
    state: index < currentIndex ? 'completed' : index === currentIndex ? 'current' : 'upcoming',
  }));
}

const lifecycleCommandTypes = new Set<GameCommand['type']>([
  'RESOLVE_EFFECT_CHOICE',
  'RESPOND_COUNTER_CONSENT',
  'CANCEL_COUNTER_CONSENT',
  'EXPIRE_COUNTER_CONSENT',
]);

function uniqueCommandCount<T>(values: readonly T[]): number {
  return new Set(values).size;
}

export function buildLegalActionSummary(commands: readonly GameCommand[]): string {
  const lifecycleCount = commands.filter((command) => lifecycleCommandTypes.has(command.type)).length;
  if (lifecycleCount > 0) return `目前有 ${lifecycleCount} 個規則互動選項待處理。`;

  const summaries = [
    [commands.filter((command) => command.type === 'PLAY_ADVENTURER').length, '張冒險者可加入隊伍'],
    [commands.filter((command) => command.type === 'USE_ITEM').length, '張道具可使用'],
    [uniqueCommandCount(commands.flatMap((command) => command.type === 'EQUIP_ITEM' ? [command.cardId] : [])), '張裝備可選擇配戴對象'],
    [commands.filter((command) => command.type === 'ATTACK_TARGET').length, '個目標可討伐'],
    [commands.filter((command) => command.type === 'BUY_CARD').length, '張卡牌可購買'],
  ] as const;
  const available = summaries
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${count} ${label}`);
  const canEndPhase = commands.some((command) => command.type === 'END_PHASE');

  if (available.length === 0) {
    return canEndPhase
      ? '目前沒有額外卡牌動作，可以結束階段。'
      : '目前沒有可送出的對局動作。';
  }
  return `目前有 ${available.join('、')}${canEndPhase ? '；也可以結束階段。' : '。'}`;
}
