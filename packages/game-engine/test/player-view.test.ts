import { describe, expect, it } from 'vitest';
import { projectPlayerView, restoreSnapshot, serializeSnapshot } from '../src/index.js';
import { makeGame, testRuleset } from './fixtures.js';

describe('PlayerView visibility boundary', () => {
  it('does not disclose the viewer draw pile identities or order', () => {
    const state = makeGame();
    const viewer = state.players[0]!;
    const hiddenCardIds = [...viewer.drawPile];

    const view = projectPlayerView(state, testRuleset, viewer.id);

    expect(view.self.drawPileCount).toBe(hiddenCardIds.length);
    expect('drawPile' in view.self).toBe(false);
    for (const cardId of hiddenCardIds) expect(view.cards[cardId]).toBeUndefined();
  });

  it('exposes the effective party limit through the rules boundary', () => {
    const state = makeGame();
    expect(projectPlayerView(state, testRuleset, 'p1').partyLimit).toBe(5);
  });

  it('projects each private bond evaluation without exposing it to opponents and preserves it through Snapshot', () => {
    const state = makeGame();
    const player = state.players[0]!;
    const view = projectPlayerView(state, testRuleset, player.id);
    expect(view.bondEvaluations).toEqual(player.bonds.map(({ bondId }) => ({ bondId, satisfied: false, appliedRules: [] })));
    expect(view.opponents.every((opponent) => !('bondEvaluations' in opponent))).toBe(true);
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(state))), testRuleset);
    expect(projectPlayerView(restored, testRuleset, player.id).bondEvaluations).toEqual(view.bondEvaluations);
  });

  it('exposes enemy target cards and attachments without revealing unrelated private cards', () => {
    const state = makeGame();
    const target = Object.values(state.enemyTargets).find(({ kind }) => kind === 'monster')!;
    const attachmentId = state.players[0]!.hand.pop()!;
    target.attachments.push(attachmentId);

    const view = projectPlayerView(state, testRuleset, 'p2');

    expect(view.cards[target.cardInstanceId]).toBeDefined();
    expect(view.cards[attachmentId]).toBeDefined();
    expect(view.cards[state.players[0]!.hand[0]!]).toBeUndefined();
  });

  it('projects opponents’ public party and equipment without exposing their hands or draw piles', () => {
    const state = makeGame();
    const opponent = state.players[1]!;
    const adventurerId = 'public-opponent-adventurer';
    const equipmentId = 'public-opponent-equipment';
    state.cards[adventurerId] = { id: adventurerId, definitionId: 'test:adventurer/a' };
    state.cards[equipmentId] = { id: equipmentId, definitionId: 'test:item/spear' };
    opponent.party.push({ adventurerId, equipmentId });
    const view = projectPlayerView(state, testRuleset, 'p1');
    const projected = view.opponents.find(({ id }) => id === opponent.id)!;

    expect(projected.party).toContainEqual({ adventurerId, equipmentId, effectiveCombat: 3 });
    expect(view.cards[adventurerId]).toBeDefined();
    expect(view.cards[equipmentId]).toBeDefined();
    expect(view.cards[opponent.hand[0]!]).toBeUndefined();
    for (const cardId of opponent.drawPile) expect(view.cards[cardId]).toBeUndefined();
  });
});
