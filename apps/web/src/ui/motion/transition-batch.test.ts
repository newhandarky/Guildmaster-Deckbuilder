import { describe, expect, it } from 'vitest';
import type { DomainEvent, PlayerView } from '@guildmaster/game-protocol';
import type { SessionUpdate } from '../../adapters/game-session.js';
import { appendPresentationBatch, createPresentationTransitionBatch } from './transition-batch.js';

const minimalView = (gameId: string, revision: number): PlayerView => ({
  viewerId: 'p1', gameId, status: 'playing', phase: 'action1', round: 1, revision, activePlayerId: 'p1', partyLimit: 5,
  self: { id: 'p1', name: '你', kind: 'human', drawPileCount: 0, hand: [], discardPile: [], party: [], playArea: [], bonds: [], counters: [], moduleState: {}, turnPurchaseBonus: 0, turnPurchaseSpent: 0, turnCombatBonus: 0, history: { defeatedBosses: 0, defeatedMonsters: 0 } },
  opponents: [], bondEvaluations: [], zones: {}, enemyTargets: {}, cards: {},
});
const event = (id: string): DomainEvent => ({ eventId: id, revision: 1, type: 'PHASE_ENDED', message: 'phase' });
const update = (overrides: Partial<SessionUpdate> = {}): SessionUpdate => ({
  view: minimalView('g', 1), definitions: {}, bondDefinitions: [], events: [event('e1')], committedEvents: [event('e1')], legalCommands: [], actionPreviews: { schemaVersion: 2, gameId: 'g', revision: 1, actorId: 'p1', items: [] },
  entrySummary: { schemaVersion: 3, contentMode: 'demo', advancedRules: { helpers: false }, contentPackId: 'base:demo', canContinue: false, gameId: 'g', revision: 1, round: 1, phase: 'action1', status: 'playing', replayHistoryComplete: true },
  persistence: { schemaVersion: 2, state: 'saved', revision: 1, replayHistoryComplete: true }, replayHistoryComplete: true,
  cpu: { profileId: 'cpu', profileVersion: '1', status: 'idle', stepKey: 'idle', decisions: [] }, ...overrides,
});

describe('presentation transition batches', () => {
  it('creates accepted and same-revision batches but rejects errors and empty commits', () => {
    const before = minimalView('g', 0);
    expect(createPresentationTransitionBatch(before, update(), 'human', 'b1')).toMatchObject({ batchId: 'b1', fromRevision: 0, toRevision: 1, source: 'human' });
    expect(createPresentationTransitionBatch(minimalView('g', 1), update(), 'human', 'same')).toMatchObject({ fromRevision: 1, toRevision: 1 });
    expect(createPresentationTransitionBatch(before, update({ committedEvents: [] }), 'human', 'empty')).toBeUndefined();
    expect(createPresentationTransitionBatch(before, update({ error: { code: 'INVALID_COMMAND', message: 'no' } }), 'human', 'error')).toBeUndefined();
  });

  it('deduplicates, resets across games, and caps overflow', () => {
    const first = createPresentationTransitionBatch(minimalView('g', 0), update(), 'human', 'b0')!;
    expect(appendPresentationBatch([first], first)).toHaveLength(1);
    const queue = Array.from({ length: 8 }, (_, index) => ({ ...first, batchId: `b${index}` }))
      .reduce<readonly typeof first[]>((current, batch) => appendPresentationBatch(current, batch), []);
    expect(queue.map(({ batchId }) => batchId)).toEqual(['b6', 'b7']);
    expect(appendPresentationBatch(queue, { ...first, batchId: 'other', gameId: 'other' })).toHaveLength(1);
  });
});
