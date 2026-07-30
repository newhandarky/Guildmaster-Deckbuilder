import { describe, expect, it } from 'vitest';
import { projectPlayerView } from '../src/index.js';
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
});
