import { describe, expect, it } from 'vitest';
import type { EffectDefinition } from '@guildmaster/game-protocol';
import { dispatch, envelope, executeEffect, getLegalCommands, moveCard, resolveEffectOrder, restoreSnapshot, serializeSnapshot } from '../src/index.js';
import { baseZoneIds } from '../src/model/zones.js';
import { makeGame, testRuleset } from './fixtures.js';

const hand = { kind: 'player-zone', player: { kind: 'controller' }, zone: 'hand' } as const;
const discard = { kind: 'player-zone', player: { kind: 'controller' }, zone: 'discardPile' } as const;

describe('serializable effect primitives', () => {
  it('round-trips a suspended choice through Snapshot and resumes only through a legal command', () => {
    const state = makeGame(); const cardId = state.players[0]!.hand[0]!;
    const effect: EffectDefinition = { schemaVersion: 1, effectId: 'test:effect/choice', body: { kind: 'choice', choiceId: 'discard-or-hold', actor: { kind: 'controller' }, options: [{ id: 'discard', effect: { kind: 'discard-card', card: { kind: 'context-card', key: 'card' }, from: hand } }, { id: 'hold', effect: { kind: 'modify-value', target: { kind: 'turn-combat-bonus', player: { kind: 'controller' } }, amount: 0 } }] } };
    expect(executeEffect(state, testRuleset, effect, { controllerId: 'p1', cardRefs: { card: cardId } }, 'execution-1').status).toBe('suspended');
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(state))));
    const commands = getLegalCommands(restored, testRuleset, 'p1'); expect(commands).toEqual([{ type: 'RESOLVE_EFFECT_CHOICE', executionId: 'execution-1', choiceId: 'discard-or-hold', optionId: 'discard' }, { type: 'RESOLVE_EFFECT_CHOICE', executionId: 'execution-1', choiceId: 'discard-or-hold', optionId: 'hold' }]);
    const result = dispatch(restored, testRuleset, envelope(restored, 'p1', commands[0]!));
    expect(result.error).toBeUndefined(); expect(result.state.players[0]!.discardPile).toContain(cardId); expect(result.state.effectState.pendingChoice).toBeUndefined();
  });

  it('is deterministic for random outcomes and records no hidden UI state', () => {
    const effect: EffectDefinition = { schemaVersion: 1, effectId: 'test:effect/random', body: { kind: 'random', randomId: 'coin', outcomes: [{ id: 'purchase', effect: { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 2 } }, { id: 'combat', effect: { kind: 'modify-value', target: { kind: 'turn-combat-bonus', player: { kind: 'controller' } }, amount: 2 } }] } };
    const left = makeGame(); const right = makeGame();
    expect(executeEffect(left, testRuleset, effect, { controllerId: 'p1' }, 'random-1')).toMatchObject({ status: 'completed' });
    expect(executeEffect(right, testRuleset, effect, { controllerId: 'p1' }, 'random-1')).toMatchObject({ status: 'completed' });
    expect(left.rngState).toBe(right.rngState); expect(left.players[0]!.turnPurchaseBonus).toBe(right.players[0]!.turnPurchaseBonus); expect(left.players[0]!.turnCombatBonus).toBe(right.players[0]!.turnCombatBonus);
  });

  it('moves cards atomically across player, party, equipment, removed, and module zones', () => {
    const state = makeGame(); state.zones['test:module-zone'] = { zoneId: 'test:module-zone', kind: 'moduleArea', cardIds: [], visibility: 'public', rulesModuleId: 'test:rules' };
    const cardId = state.players[0]!.hand.find((id) => testRuleset.registry.definitions[state.cards[id]!.definitionId]!.type === 'starter')!;
    const effect: EffectDefinition = { schemaVersion: 1, effectId: 'test:effect/move', body: { kind: 'sequence', effects: [{ kind: 'move-card', card: { kind: 'context-card', key: 'card' }, from: hand, to: { kind: 'shared-zone', zoneId: 'test:module-zone' }, transferOwnership: false }, { kind: 'move-card', card: { kind: 'context-card', key: 'card' }, from: { kind: 'shared-zone', zoneId: 'test:module-zone' }, to: discard }] } };
    expect(executeEffect(state, testRuleset, effect, { controllerId: 'p1', cardRefs: { card: cardId } }, 'move-1').status).toBe('completed');
    expect(state.players[0]!.discardPile).toContain(cardId); expect(state.zones['test:module-zone']!.cardIds).not.toContain(cardId);
  });

  it('rejects invalid, stale, hidden, and equipment-breaking moves without changing state', () => {
    const state = makeGame(); const before = structuredClone(state); const partyCard = state.players[0]!.party[0]!.adventurerId; const equipment = state.zones[baseZoneIds.itemRow]!.cardIds.find((id) => testRuleset.registry.definitions[state.cards[id]!.definitionId]!.type === 'equipment')!;
    state.zones[baseZoneIds.itemRow]!.cardIds.splice(state.zones[baseZoneIds.itemRow]!.cardIds.indexOf(equipment), 1); state.players[0]!.hand.push(equipment); const equip = dispatch(state, testRuleset, envelope(state, 'p1', { type: 'EQUIP_ITEM', cardId: equipment, adventurerId: partyCard })).state;
    const effect: EffectDefinition = { schemaVersion: 1, effectId: 'test:effect/bad-move', body: { kind: 'move-card', card: { kind: 'context-card', key: 'party' }, from: { kind: 'party', player: { kind: 'controller' }, position: 0 }, to: discard } };
    expect(executeEffect(equip, testRuleset, effect, { controllerId: 'p1', cardRefs: { party: partyCard } }, 'bad-1')).toMatchObject({ status: 'failed' });
    expect(equip.players[0]!.party[0]!.adventurerId).toBe(partyCard); expect(equip.players[0]!.party[0]!.equipmentId).toBe(equipment);
    const stale = dispatch(equip, testRuleset, { ...envelope(equip, 'p1', { type: 'END_PHASE', phase: 'action1' }), expectedRevision: equip.revision + 1 }); expect(stale.error?.code).toBe('STALE_REVISION'); expect(before.gameId).toBe(state.gameId);
  });

  it('does not invent trigger or replacement ordering when policy is absent or tied', () => {
    expect(resolveEffectOrder([{ id: 'a' }, { id: 'b' }])).toEqual({ status: 'unsupported', reason: 'ORDER_POLICY_REQUIRED' });
    expect(resolveEffectOrder([{ id: 'a', priority: 1 }, { id: 'b', priority: 1 }], 'explicit-priority')).toEqual({ status: 'unsupported', reason: 'ORDER_POLICY_REQUIRED' });
    expect(resolveEffectOrder([{ id: 'b', priority: 2 }, { id: 'a', priority: 1 }], 'explicit-priority')).toEqual({ status: 'ready', orderedIds: ['a', 'b'] });
  });

  it('rejects selecting a card from another player owner-only module zone without mutation', () => {
    const state = makeGame(); const cardId = state.players[1]!.hand[0]!; state.players[1]!.hand.splice(0, 1);
    state.zones['test:hidden'] = { zoneId: 'test:hidden', kind: 'moduleArea', cardIds: [cardId], visibility: 'ownerOnly', ownerId: 'p2', rulesModuleId: 'test:rules' };
    const result = moveCard(state, { cardInstanceId: cardId, from: { kind: 'shared-zone', zoneId: 'test:hidden' }, to: discard, actorId: 'p1', context: { controllerId: 'p1' }, registry: testRuleset.registry });
    expect(result).toMatchObject({ ok: false, code: 'HIDDEN_INFORMATION' }); expect(state.zones['test:hidden']!.cardIds).toEqual([cardId]);
  });

  it('rolls back an entire effect sequence when a later movement is illegal', () => {
    const state = makeGame(); const cardId = state.players[0]!.hand[0]!; const before = structuredClone(state);
    const effect: EffectDefinition = { schemaVersion: 1, effectId: 'test:effect/rollback', body: { kind: 'sequence', effects: [{ kind: 'move-card', card: { kind: 'context-card', key: 'card' }, from: hand, to: discard }, { kind: 'move-card', card: { kind: 'context-card', key: 'card' }, from: hand, to: { kind: 'removed' } }] } };
    expect(executeEffect(state, testRuleset, effect, { controllerId: 'p1', cardRefs: { card: cardId } }, 'rollback-1')).toMatchObject({ status: 'failed' });
    expect(state).toEqual(before);
  });
});
