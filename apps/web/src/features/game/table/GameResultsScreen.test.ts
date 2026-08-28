import { describe, expect, it } from 'vitest';
import { endConditionDisplayText } from './GameResultsScreen.js';

describe('endConditionDisplayText', () => {
  it('maps known engine IDs to player-facing Traditional Chinese', () => {
    expect(endConditionDisplayText(['base:all-bonds-completed'])).toBe('所有羈絆已完成');
    expect(endConditionDisplayText(['base:all-bosses-defeated'])).toBe('所有魔王已被討伐');
  });

  it('does not expose an unknown internal ID', () => {
    expect(endConditionDisplayText(['private:future-condition'])).toBe('遠征目標已完成');
    expect(endConditionDisplayText([])).toBe('遠征目標已完成');
  });

  it('preserves every simultaneously satisfied end condition without duplicates', () => {
    expect(endConditionDisplayText([
      'base:all-bosses-defeated',
      'base:all-bonds-completed',
      'base:all-bosses-defeated',
    ])).toBe('所有魔王已被討伐、所有羈絆已完成');
  });
});
