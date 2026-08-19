import { describe, expect, it } from 'vitest';
import type { GameCommand } from '@guildmaster/game-protocol';
import { buildLegalActionSummary, buildPhaseProgress } from './gameplay-feedback.js';

describe('desktop gameplay feedback view model', () => {
  it('marks completed, current, and upcoming phases in fixed turn order', () => {
    expect(buildPhaseProgress('action2')).toEqual([
      { phase: 'action1', label: '行動一', position: 1, state: 'completed' },
      { phase: 'combat', label: '討伐', position: 2, state: 'completed' },
      { phase: 'action2', label: '行動二', position: 3, state: 'current' },
      { phase: 'purchase', label: '購買', position: 4, state: 'upcoming' },
      { phase: 'rest', label: '休息', position: 5, state: 'upcoming' },
    ]);
  });

  it('summarizes authoritative card commands and deduplicates equipment targets', () => {
    const commands: GameCommand[] = [
      { type: 'EQUIP_ITEM', cardId: 'equipment-1', adventurerId: 'adventurer-1' },
      { type: 'EQUIP_ITEM', cardId: 'equipment-1', adventurerId: 'adventurer-2' },
      { type: 'ATTACK_TARGET', targetId: 'monster-1' },
      { type: 'END_PHASE', phase: 'combat' },
    ];
    expect(buildLegalActionSummary(commands)).toBe('目前有 1 張卡牌可選擇附著對象、1 個目標可討伐；也可以結束階段。');
  });

  it('keeps lifecycle choices and no-extra-action states explicit', () => {
    expect(buildLegalActionSummary([
      { type: 'RESOLVE_EFFECT_CHOICE', executionId: 'execution-1', choiceId: 'choice-1', optionId: 'first' },
      { type: 'RESOLVE_EFFECT_CHOICE', executionId: 'execution-1', choiceId: 'choice-1', optionId: 'second' },
    ])).toBe('目前有 2 個規則互動選項待處理。');
    expect(buildLegalActionSummary([{ type: 'END_PHASE', phase: 'action1' }])).toBe('目前沒有額外卡牌動作，可以結束階段。');
    expect(buildLegalActionSummary([])).toBe('目前沒有可送出的對局動作。');
  });
});
