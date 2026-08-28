const endConditionCopy: Readonly<Record<string, string>> = {
  'base:all-bonds-completed': '所有羈絆已完成',
  'base:all-bosses-defeated': '所有魔王已被討伐',
};

export function endConditionDisplayText(conditionIds: readonly string[]): string {
  const labels = [...new Set(conditionIds.map((conditionId) => endConditionCopy[conditionId] ?? '遠征目標已完成'))];
  return labels.length ? labels.join('、') : '遠征目標已完成';
}
