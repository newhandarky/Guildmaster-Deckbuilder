import { describe, expect, it } from 'vitest';
import type { DomainEvent } from '@guildmaster/game-protocol';
import { diceRewardText } from './dice-feedback.js';

function dieEvent(diceId: string, face: number): DomainEvent {
  return {
    eventId: 'die-1', revision: 1, type: 'DIE_ROLLED', message: 'rolled',
    payload: {
      schemaVersion: 1, kind: 'dice-roll',
      evaluation: {
        schemaVersion: 1, face,
        input: { schemaVersion: 1, moduleId: 'base:provisional-original-full-rules', diceId, randomValue: 0.5, registry: { rulesetVersion: 'test', modules: [] } },
      },
    },
  };
}

describe('dice result feedback', () => {
  it.each([[1, 1], [2, 1], [3, 2], [4, 2], [5, 3], [6, 3]])('explains monster 02 face %i as purchase power +%i', (face, reward) => {
    expect(diceRewardText(dieEvent('monster-02-reward-d6', face), face)).toBe(`購買力 +${reward}`);
  });

  it('does not invent reward copy for an unrelated die', () => {
    expect(diceRewardText(dieEvent('adventurer-03-combat-d6', 6), 6)).toBeUndefined();
  });
});
