import { describe, expect, it } from 'vitest';
import type { DomainEvent, PlayerView } from '@guildmaster/game-protocol';
import { diffPublicCardZones, orderTransitionsByCommittedEvents, projectPublicCardZones } from './card-zone-projection.js';

function view(overrides: Partial<PlayerView> = {}): PlayerView {
  return {
    viewerId: 'p1', gameId: 'g', status: 'playing', phase: 'action1', round: 1, revision: 1, activePlayerId: 'p1', partyLimit: 5,
    self: { id: 'p1', name: '你', kind: 'human', drawPileCount: 4, hand: ['a'], discardPile: [], party: [], playArea: [], bonds: [], counters: [], moduleState: {}, turnPurchaseBonus: 0, turnPurchaseSpent: 0, turnCombatBonus: 0, history: { defeatedBosses: 0, defeatedMonsters: 0 } },
    opponents: [{ id: 'p2', name: 'CPU', kind: 'ai', seatIndex: 1, isActive: false, handCount: 3, partyCount: 0, discardCount: 0, partyCombat: 0, party: [], defeatedBosses: 0, defeatedMonsters: 0, bonds: [], counters: [] }],
    bondEvaluations: [], zones: {}, enemyTargets: {}, cards: { a: { id: 'a', definitionId: 'starter' } }, ...overrides,
  };
}

describe('public card zone projection', () => {
  it('reports a visible card move without exposing hidden opponent hands', () => {
    const before = view();
    const after = view({ revision: 2, self: { ...before.self, hand: [], party: [{ adventurerId: 'a' }] } });
    expect(diffPublicCardZones(before, after)).toEqual([{ cardId: 'a', from: 'self:hand', to: 'self:party', kind: 'move' }]);
    expect([...projectPublicCardZones(after).keys()]).toEqual(['a']);
  });

  it('distinguishes public supply entry and removal', () => {
    const beforeBase = view();
    const before = view({ self: { ...beforeBase.self, hand: [] }, zones: { market: { zoneId: 'market', kind: 'faceUpRow', visibility: 'public', cardIds: ['a'] } } });
    const after = view({ revision: 2, self: { ...before.self, hand: [] }, cards: { ...before.cards, b: { id: 'b', definitionId: 'item' } }, zones: { market: { zoneId: 'market', kind: 'faceUpRow', visibility: 'public', cardIds: ['b'] } } });
    expect(diffPublicCardZones(before, after)).toEqual([
      { cardId: 'a', from: 'market', kind: 'leave' },
      { cardId: 'b', to: 'market', kind: 'enter' },
    ]);
  });

  it('uses structured committed payload order without parsing messages', () => {
    const transitions = [
      { cardId: 'a', from: 'hand', kind: 'leave' as const },
      { cardId: 'b', from: 'hand', kind: 'leave' as const },
    ];
    const events: DomainEvent[] = [
      { eventId: 'first', revision: 1, type: 'CARD_MOVED', message: 'mentions a but is not parsed', payload: { schemaVersion: 1, kind: 'team-overflow', candidateIds: ['b'] } },
      { eventId: 'second', revision: 1, type: 'CARD_MOVED', message: 'b', payload: { schemaVersion: 1, kind: 'team-overflow', candidateIds: ['a'] } },
    ];
    expect(orderTransitionsByCommittedEvents(transitions, events).map(({ cardId }) => cardId)).toEqual(['b', 'a']);
  });
});
