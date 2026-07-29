import { describe, expect, it } from 'vitest';
import type { EffectDefinition, EquipmentEligibilityRule, LifecycleHook } from '@guildmaster/game-protocol';
import { createGame, createRuleset, dispatch, envelope, evaluateEquipmentEligibility, getLegalCommands, restoreSnapshot, serializeSnapshot } from '../src/index.js';
import { baseRulesModule } from '../src/rules/base-rules.js';
import type { RulesModule, Ruleset } from '../src/rules/ruleset.js';
import { testPack } from './fixtures.js';

const module = (id: string, equipmentEligibilityRules: readonly EquipmentEligibilityRule[], version = '1'): RulesModule => ({ id, version, equipmentEligibilityRules, getPartyLimit: (_state, _player, limit) => limit, onSupplyDepleted: () => 'handled' });
const rules = (...modules: RulesModule[]) => createRuleset([testPack], [baseRulesModule, ...modules]);
const game = (ruleset: Ruleset) => createGame({ gameId: 'equipment-eligibility', seed: 29, players: [{ id: 'p1', name: '玩家', kind: 'human' }, { id: 'p2', name: 'AI', kind: 'ai' }], startingPlayerId: 'p1' }, ruleset);
const restriction = (moduleId: string, ruleId: string, reasonCode: string, priority?: number): EquipmentEligibilityRule => ({ schemaVersion: 1, moduleId, ruleId, kind: 'restriction', reasonCode, when: { kind: 'equipment-definition-in', definitionIds: ['test:item/spear'] }, ...(priority === undefined ? {} : { priority }) });

function prepare(state: ReturnType<typeof game>): { equipmentId: string; adventurerId: string } {
  state.phase = 'action1';
  const player = state.players[0]!;
  const equipmentId = Object.values(state.cards).find((card) => card.definitionId === 'test:item/spear')!.id;
  const adventurerId = Object.values(state.cards).find((card) => card.definitionId === 'test:starter/adventurer')!.id;
  for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((id) => id !== equipmentId && id !== adventurerId);
  for (const candidate of state.players) { candidate.hand = candidate.hand.filter((id) => id !== equipmentId && id !== adventurerId); candidate.drawPile = candidate.drawPile.filter((id) => id !== equipmentId && id !== adventurerId); candidate.discardPile = candidate.discardPile.filter((id) => id !== equipmentId && id !== adventurerId); candidate.party = candidate.party.filter((slot) => slot.adventurerId !== adventurerId); }
  player.hand.push(equipmentId); player.party.push({ adventurerId });
  return { equipmentId, adventurerId };
}

describe('generic equipment eligibility evaluation', () => {
  it('allows unrestricted equipment, and shares the same result between query and dispatch', () => {
    const ruleset = rules(); const state = game(ruleset); const { equipmentId, adventurerId } = prepare(state);
    const input = { schemaVersion: 1 as const, playerId: 'p1', equipmentCardId: equipmentId, adventurerId };
    expect(evaluateEquipmentEligibility(state, ruleset, input)).toMatchObject({ status: 'ready', evaluation: { eligible: true, rejectionReasonCodes: [] } });
    const command = { type: 'EQUIP_ITEM' as const, cardId: equipmentId, adventurerId };
    expect(getLegalCommands(state, ruleset, 'p1')).toContainEqual(command);
    const result = dispatch(state, ruleset, envelope(state, 'p1', command));
    expect(result.error).toBeUndefined(); expect(result.state.players[0]!.party.find((slot) => slot.adventurerId === adventurerId)!.equipmentId).toBe(equipmentId); expect(result.state.revision).toBe(1);
  });

  it('returns structured rejection reasons and rejects before any reducer mutation', () => {
    const ruleset = rules(module('test:sealed', [restriction('test:sealed', 'sealed', 'EQUIPMENT_SEALED')])); const state = game(ruleset); const { equipmentId, adventurerId } = prepare(state); const input = { schemaVersion: 1 as const, playerId: 'p1', equipmentCardId: equipmentId, adventurerId };
    expect(evaluateEquipmentEligibility(state, ruleset, input)).toMatchObject({ status: 'ready', evaluation: { eligible: false, rejectionReasonCodes: ['EQUIPMENT_SEALED'], appliedRules: [{ moduleId: 'test:sealed', ruleId: 'sealed' }] } });
    const command = { type: 'EQUIP_ITEM' as const, cardId: equipmentId, adventurerId }; expect(getLegalCommands(state, ruleset, 'p1')).not.toContainEqual(command);
    const before = structuredClone(state); const result = dispatch(state, ruleset, envelope(state, 'p1', command));
    expect(result.error?.code).toBe('INVALID_COMMAND'); expect(result.error?.message).toContain('EQUIPMENT_SEALED'); expect(result.state).toEqual(before); expect(result.events).toEqual([]);
  });

  it('orders multi-module rules deterministically and rejects ambiguous active priority', () => {
    const ordered = rules(module('test:first', [restriction('test:first', 'first', 'FIRST', 1)]), module('test:last', [restriction('test:last', 'last', 'LAST', 2)])); const state = game(ordered); const ids = prepare(state);
    expect(evaluateEquipmentEligibility(state, ordered, { schemaVersion: 1, playerId: 'p1', equipmentCardId: ids.equipmentId, adventurerId: ids.adventurerId })).toMatchObject({ status: 'ready', evaluation: { rejectionReasonCodes: ['FIRST', 'LAST'], appliedRules: [{ moduleId: 'test:first' }, { moduleId: 'test:last' }] } });
    const ambiguous = rules(module('test:a', [restriction('test:a', 'a', 'A', 1)]), module('test:b', [restriction('test:b', 'b', 'B', 1)])); const ambiguousState = game(ambiguous); const ambiguousIds = prepare(ambiguousState); const before = structuredClone(ambiguousState);
    expect(evaluateEquipmentEligibility(ambiguousState, ambiguous, { schemaVersion: 1, playerId: 'p1', equipmentCardId: ambiguousIds.equipmentId, adventurerId: ambiguousIds.adventurerId })).toMatchObject({ status: 'unsupported', reason: 'ORDER_POLICY_REQUIRED' });
    expect(dispatch(ambiguousState, ambiguous, envelope(ambiguousState, 'p1', { type: 'EQUIP_ITEM', cardId: ambiguousIds.equipmentId, adventurerId: ambiguousIds.adventurerId })).state).toEqual(before);
  });

  it('is deterministic across Snapshot round-trips and rejects stale, wrong actor, and registry mismatch without mutation', () => {
    const ruleset = rules(module('test:counter', [{ schemaVersion: 1, moduleId: 'test:counter', ruleId: 'counter', kind: 'restriction', reasonCode: 'COUNTER', priority: 1, when: { kind: 'player-counter-at-least', resourceId: 'test:lock', amount: 1 } }])); const state = game(ruleset); const ids = prepare(state); const input = { schemaVersion: 1 as const, playerId: 'p1', equipmentCardId: ids.equipmentId, adventurerId: ids.adventurerId };
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(state)))); expect(evaluateEquipmentEligibility(restored, ruleset, input)).toEqual(evaluateEquipmentEligibility(state, ruleset, input));
    for (const command of [envelope(state, 'p1', { type: 'EQUIP_ITEM', cardId: ids.equipmentId, adventurerId: ids.adventurerId }, 'stale'), { ...envelope(state, 'p1', { type: 'EQUIP_ITEM', cardId: ids.equipmentId, adventurerId: ids.adventurerId }), actorId: 'p2' }, { ...envelope(state, 'p1', { type: 'EQUIP_ITEM', cardId: ids.equipmentId, adventurerId: ids.adventurerId }), gameId: 'wrong-game' }]) { const before = structuredClone(state); if (command.commandId === 'stale') command.expectedRevision += 1; expect(dispatch(state, ruleset, command).state).toEqual(before); }
    const mismatched = structuredClone(state); mismatched.rulesModules[1]!.version = 'wrong'; const beforeMismatch = structuredClone(mismatched); expect(dispatch(mismatched, ruleset, envelope(mismatched, 'p1', { type: 'EQUIP_ITEM', cardId: ids.equipmentId, adventurerId: ids.adventurerId })).state).toEqual(beforeMismatch);
    expect(evaluateEquipmentEligibility(state, ruleset, { ...input, schemaVersion: 2 } as unknown as typeof input)).toMatchObject({ status: 'failed', reason: 'INVALID_INPUT' });
  });

  it('remains compatible with post-command choice continuation without reevaluating mutations', () => {
    const body: EffectDefinition['body'] = { kind: 'choice', choiceId: 'audit-equipment', actor: { kind: 'controller' }, options: [{ id: 'confirm', effect: { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 2 } }] };
    const hook: LifecycleHook = { schemaVersion: 1, moduleId: 'test:choice', hookId: 'after-attach', point: 'event-after', eventType: 'EQUIPMENT_ATTACHED', kind: 'trigger', priority: 1, effect: { schemaVersion: 1, effectId: 'test:choice/audit', body } };
    const ruleset = rules({ ...module('test:choice', []), lifecycleHooks: [hook] }); const state = game(ruleset); const ids = prepare(state); const command = { type: 'EQUIP_ITEM' as const, cardId: ids.equipmentId, adventurerId: ids.adventurerId };
    const suspended = dispatch(state, ruleset, envelope(state, 'p1', command)); expect(suspended.error).toBeUndefined(); expect(suspended.state.revision).toBe(0); expect(suspended.state.effectState.pendingPostCommand).toMatchObject({ boundary: 'event-after' });
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(suspended.state)))); const choice = getLegalCommands(restored, ruleset, 'p1')[0]!; const completed = dispatch(restored, ruleset, envelope(restored, 'p1', choice));
    expect(completed.error).toBeUndefined(); expect(completed.state.revision).toBe(1); expect(completed.state.players[0]!.party.find((slot) => slot.adventurerId === ids.adventurerId)!.equipmentId).toBe(ids.equipmentId); expect(completed.state.players[0]!.turnPurchaseBonus).toBe(2); expect(completed.events.filter(({ type }) => type === 'EQUIPMENT_ATTACHED')).toHaveLength(1);
  });

  it('validates schema versions, ownership, duplicate IDs, JSON-only data, and unknown discriminants at registration', () => {
    expect(() => rules(module('test:wrong', [{ ...restriction('wrong', 'bad', 'BAD'), moduleId: 'wrong' }]))).toThrow();
    expect(() => rules(module('test:duplicate', [restriction('test:duplicate', 'same', 'A'), restriction('test:duplicate', 'same', 'B')]))).toThrow('Duplicate equipment eligibility rule');
    const callback = restriction('test:function', 'function', 'BAD') as EquipmentEligibilityRule & { callback: () => void }; callback.callback = () => undefined; expect(() => rules(module('test:function', [callback]))).toThrow('JSON-serializable');
    expect(() => rules(module('test:unknown', [{ ...restriction('test:unknown', 'unknown', 'BAD'), kind: 'mystery' } as unknown as EquipmentEligibilityRule]))).toThrow('invalid runtime data');
    expect(() => rules(module('test:version', [{ ...restriction('test:version', 'version', 'BAD'), schemaVersion: 2 } as unknown as EquipmentEligibilityRule]))).toThrow('invalid runtime data');
  });
});
