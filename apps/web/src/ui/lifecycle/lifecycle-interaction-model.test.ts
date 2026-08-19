import { describe, expect, it } from 'vitest';
import type { DomainEvent, GameCommand, PlayerView } from '@guildmaster/game-protocol';
import { createLifecycleCopyResolver, defaultLifecycleCopyResolver } from './lifecycle-copy.js';
import { buildLifecycleInteractionModel } from './lifecycle-interaction-model.js';

function view(overrides: Partial<PlayerView> = {}): PlayerView {
  return {
    viewerId: 'p1',
    gameId: 'game',
    status: 'playing',
    phase: 'action1',
    round: 1,
    revision: 4,
    activePlayerId: 'p1',
    self: {
      id: 'p1',
      name: '你',
      kind: 'human',
      drawPileCount: 0,
      hand: [],
      discardPile: [],
      party: [],
      playArea: [],
      bonds: [],
      counters: [],
      moduleState: {},
      turnPurchaseBonus: 0,
      turnPurchaseSpent: 0,
      turnCombatBonus: 0,
      history: { defeatedBosses: 0, defeatedMonsters: 0 },
    },
    partyLimit: 5,
    opponents: [{ id: 'p2', name: '同伴', kind: 'human', seatIndex: 1, isActive: false, handCount: 0, partyCount: 0, discardCount: 0, partyCombat: 0, party: [], defeatedBosses: 0, defeatedMonsters: 0, bonds: [], counters: [] }],
    zones: {},
    enemyTargets: {},
    cards: {},
    ...overrides,
  };
}

const choiceCommands: GameCommand[] = [
  { type: 'RESOLVE_EFFECT_CHOICE', executionId: 'execution', choiceId: 'route', optionId: 'continue' },
  { type: 'RESOLVE_EFFECT_CHOICE', executionId: 'execution', choiceId: 'route', optionId: 'unknown-route' },
];

const pendingConsent: NonNullable<PlayerView['pendingCounterConsent']> = {
  requestId: 'request',
  policy: { moduleId: 'test:module', policyId: 'share' },
  counterOwnerId: 'p2',
  requesterId: 'p2',
  requiredActorIds: ['p1'],
  acceptedActorIds: [],
  status: 'pending',
};

describe('lifecycle interaction model', () => {
  it('groups one choice and preserves the authoritative commands', () => {
    const source = structuredClone(choiceCommands);
    const resolver = createLifecycleCopyResolver({
      choices: [{ choiceId: 'route', title: '選擇路線', optionLabels: { continue: '向前' } }],
    });
    const model = buildLifecycleInteractionModel(view(), choiceCommands, [], resolver);
    expect(model).toMatchObject({
      kind: 'choice',
      title: '選擇路線',
      actions: [
        { label: '向前', command: choiceCommands[0] },
        { label: '選項 2（unknown-route）', command: choiceCommands[1] },
      ],
    });
    expect(choiceCommands).toEqual(source);
  });

  it('uses a visible-card label without changing the authoritative option ID', () => {
    const model = buildLifecycleInteractionModel(
      view(),
      choiceCommands,
      [],
      defaultLifecycleCopyResolver,
      (_choiceId, optionId) => optionId === 'continue' ? '起始牌 A' : undefined,
    );
    expect(model).toMatchObject({
      kind: 'choice',
      actions: [
        { label: '起始牌 A', command: choiceCommands[0] },
        { label: '選項 2（unknown-route）', command: choiceCommands[1] },
      ],
    });
  });

  it('refuses to guess between multiple choice groups', () => {
    const model = buildLifecycleInteractionModel(view(), [
      choiceCommands[0]!,
      { type: 'RESOLVE_EFFECT_CHOICE', executionId: 'other', choiceId: 'other', optionId: 'continue' },
    ], [], defaultLifecycleCopyResolver);
    expect(model).toMatchObject({ kind: 'waiting', reason: 'diagnostic' });
  });

  it('renders private deck-order commands with visible card names and preserves the authoritative permutation', () => {
    const orderCommands: GameCommand[] = [
      { type: 'RESOLVE_EFFECT_ORDER', executionId: 'order-execution', orderId: 'top-three', orderedCardIds: ['card-b', 'card-c'], removeCardId: 'card-a' },
      { type: 'RESOLVE_EFFECT_ORDER', executionId: 'order-execution', orderId: 'top-three', orderedCardIds: ['card-a', 'card-b', 'card-c'] },
    ];
    const model = buildLifecycleInteractionModel(view({
      decisionPrompt: { schemaVersion: 1, decisionKind: 'choose-order', choiceId: 'top-three', minSelections: 1, maxSelections: 1, options: [], order: { kind: 'player-deck-top', cardIds: ['card-a', 'card-b', 'card-c'], mayRemove: true } },
    }), orderCommands, [], createLifecycleCopyResolver({ choices: [{ choiceId: 'top-three', title: '整理牌庫', description: '由底至頂放回。' }] }), (_choiceId, cardId) => ({ 'card-a': '甲', 'card-b': '乙', 'card-c': '丙' })[cardId]);
    expect(model).toMatchObject({ kind: 'choice', title: '整理牌庫', actions: [
      { label: '移除「甲」；由底至頂：乙 → 丙', command: orderCommands[0] },
      { label: '由底至頂：甲 → 乙 → 丙', command: orderCommands[1] },
    ] });
  });

  it('labels party ordering as party positions rather than a deck-top operation', () => {
    const orderCommands: GameCommand[] = [
      { type: 'RESOLVE_EFFECT_ORDER', executionId: 'party-execution', orderId: 'party-order', orderedCardIds: ['card-b', 'card-a'] },
      { type: 'RESOLVE_EFFECT_ORDER', executionId: 'party-execution', orderId: 'party-order', orderedCardIds: ['card-a', 'card-b'] },
    ];
    const model = buildLifecycleInteractionModel(view({
      decisionPrompt: { schemaVersion: 1, decisionKind: 'choose-order', choiceId: 'party-order', minSelections: 1, maxSelections: 1, options: [], order: { kind: 'party', cardIds: ['card-a', 'card-b'], mayRemove: false } },
    }), orderCommands, [], createLifecycleCopyResolver({ choices: [{ choiceId: 'party-order', title: '調整隊伍', description: '選擇新的位置。' }] }), (_choiceId, cardId) => ({ 'card-a': '甲', 'card-b': '乙' })[cardId]);
    expect(model).toMatchObject({ kind: 'choice', actions: [
      { label: '隊伍順序：乙 → 甲', command: orderCommands[0] },
      { label: '隊伍順序：甲 → 乙', command: orderCommands[1] },
    ] });
  });

  it('maps only exact consent commands in the stable action order', () => {
    const commands: GameCommand[] = [
      { type: 'EXPIRE_COUNTER_CONSENT', requestId: 'request' },
      { type: 'CANCEL_COUNTER_CONSENT', requestId: 'request' },
      { type: 'RESPOND_COUNTER_CONSENT', requestId: 'request', response: 'decline' },
      { type: 'RESPOND_COUNTER_CONSENT', requestId: 'request', response: 'accept' },
    ];
    const model = buildLifecycleInteractionModel(view({ pendingCounterConsent: pendingConsent }), commands, [], defaultLifecycleCopyResolver);
    expect(model).toMatchObject({
      kind: 'counter-consent',
      requesterName: '同伴',
      progress: [{ actorId: 'p1', name: '你', status: 'waiting' }],
      actions: [
        { kind: 'accept', requiresConfirmation: false },
        { kind: 'decline', requiresConfirmation: true },
        { kind: 'cancel', requiresConfirmation: true },
        { kind: 'expire', requiresConfirmation: true },
      ],
    });
    if (model.kind !== 'counter-consent') throw new Error('Expected consent model.');
    expect(model.actions.map(({ command }) => command)).toEqual([commands[3], commands[2], commands[1], commands[0]]);
  });

  it('renders waiting progress without inventing actions', () => {
    const model = buildLifecycleInteractionModel(view({
      pendingCounterConsent: { ...pendingConsent, requiredActorIds: ['p1', 'p3'], acceptedActorIds: ['p1'] },
      opponents: [
        { id: 'p2', name: '同伴', kind: 'human', seatIndex: 1, isActive: false, handCount: 0, partyCount: 0, discardCount: 0, partyCombat: 0, party: [], defeatedBosses: 0, defeatedMonsters: 0, bonds: [], counters: [] },
        { id: 'p3', name: '第三位玩家', kind: 'human', seatIndex: 2, isActive: false, handCount: 0, partyCount: 0, discardCount: 0, partyCombat: 0, party: [], defeatedBosses: 0, defeatedMonsters: 0, bonds: [], counters: [] },
      ],
    }), [], [], defaultLifecycleCopyResolver);
    expect(model).toMatchObject({
      kind: 'waiting',
      reason: 'other-actor',
      progress: [
        { actorId: 'p1', status: 'accepted' },
        { actorId: 'p3', status: 'waiting' },
      ],
    });
    expect('actions' in model).toBe(false);
  });

  it('rejects mismatched or malformed consent data', () => {
    const mismatched = buildLifecycleInteractionModel(
      view({ pendingCounterConsent: pendingConsent }),
      [{ type: 'RESPOND_COUNTER_CONSENT', requestId: 'stale', response: 'accept' }],
      [],
      defaultLifecycleCopyResolver,
    );
    expect(mismatched).toMatchObject({ kind: 'waiting', reason: 'diagnostic' });

    const malformed = buildLifecycleInteractionModel(
      view({ pendingCounterConsent: { ...pendingConsent, acceptedActorIds: ['not-required'] } }),
      [],
      [],
      defaultLifecycleCopyResolver,
    );
    expect(malformed).toMatchObject({ kind: 'waiting', reason: 'diagnostic' });
  });

  it('shows only terminal reason codes from the current revision', () => {
    const event = (revision: number, reasonCode: 'ALL_REQUIRED_ACTORS_ACCEPTED' | 'REQUEST_EXPIRED'): DomainEvent => ({
      eventId: `event-${revision}-${reasonCode}`,
      revision,
      type: reasonCode === 'REQUEST_EXPIRED' ? 'COUNTER_CONSENT_EXPIRED' : 'COUNTER_CONSENT_ACCEPTED',
      message: 'structured consent event',
      payload: {
        schemaVersion: 1,
        kind: 'counter-consent',
        evaluation: {
          schemaVersion: 1,
          input: {
            schemaVersion: 1,
            action: reasonCode === 'REQUEST_EXPIRED' ? 'expire' : 'accept',
            actorId: 'p1',
            requestId: 'request',
            registry: { rulesetVersion: '1', modules: [] },
          },
          policy: { moduleId: 'test:module', policyId: 'share' },
          counterOwnerId: 'p2',
          requesterId: 'p2',
          requiredActorIds: ['p1'],
          acceptedActorIds: reasonCode === 'REQUEST_EXPIRED' ? [] : ['p1'],
          status: reasonCode === 'REQUEST_EXPIRED' ? 'expired' : 'accepted',
          reasonCode,
        },
      },
    });
    expect(buildLifecycleInteractionModel(view(), [], [event(3, 'REQUEST_EXPIRED')], defaultLifecycleCopyResolver)).toEqual({ kind: 'none', key: 'none' });
    expect(buildLifecycleInteractionModel(view(), [], [event(4, 'ALL_REQUIRED_ACTORS_ACCEPTED')], defaultLifecycleCopyResolver)).toMatchObject({
      kind: 'terminal-result',
      reasonCode: 'ALL_REQUIRED_ACTORS_ACCEPTED',
      tone: 'success',
    });
    expect(buildLifecycleInteractionModel(view(), [], [{ ...event(4, 'ALL_REQUIRED_ACTORS_ACCEPTED'), type: 'COUNTER_CONSENT_EXPIRED' }], defaultLifecycleCopyResolver)).toEqual({ kind: 'none', key: 'none' });
  });
});
