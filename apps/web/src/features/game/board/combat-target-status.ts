import type { PublicEnemyTargetState } from '@guildmaster/game-protocol';

export function combatTargetStatusMessage(target: PublicEnemyTargetState | undefined): string | undefined {
  if (!target) return undefined;
  const messages = [
    ...(target.equipmentSuppressed ? ['討伐此目標時，所有裝備在本次戰鬥中失效。'] : []),
    ...(target.maximumPartySlots === 1
      ? ['本次討伐只能使用隊伍最前方 1 名冒險者。']
      : target.maximumPartySlots
        ? [`本次討伐最多使用隊伍最前方連續的 ${target.maximumPartySlots} 名冒險者。`]
        : []),
  ];
  return messages.length ? messages.join(' ') : undefined;
}
