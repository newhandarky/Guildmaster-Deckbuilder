import { describe, expect, it } from 'vitest';
import type { BondConditionRule, EffectDefinition, LifecycleHook } from '@guildmaster/game-protocol';
import { createGame, createRuleset, dispatch, envelope, evaluateBondCondition, getLegalCommands, restoreSnapshot, serializeSnapshot } from '../src/index.js';
import { baseRulesModule } from '../src/rules/base-rules.js';
import type { RulesModule } from '../src/rules/ruleset.js';
import { testPack } from './fixtures.js';
const rule = (condition: BondConditionRule['condition']): BondConditionRule => ({ schemaVersion: 1, moduleId: 'test:bonds', ruleId: 'test', bondId: 'test:bond/a', priority: 1, condition });
describe('generic bond condition evaluation', () => {
  it('evaluates nested history/counter conditions deterministically without mutation', () => { const module: RulesModule = { id:'test:bonds', version:'1', getPartyLimit:(_s,_p,l)=>l, onSupplyDepleted:()=> 'handled', bondConditionRules:[rule({kind:'all',conditions:[{kind:'defeated-bosses-at-least',amount:1},{kind:'counter-at-least',resourceId:'token',amount:2}]})] }; const ruleset=createRuleset([testPack],[baseRulesModule,module]); const state=createGame({gameId:'bonds',seed:2,players:[{id:'p1',name:'P1',kind:'human'},{id:'p2',name:'P2',kind:'ai'}]},ruleset); state.players[0]!.history.defeatedBosses=1; state.players[0]!.counters.push({resourceId:'token',amount:2,visibility:'ownerOnly'}); const before=structuredClone(state); expect(evaluateBondCondition(state,ruleset,'p1','test:bond/a')).toMatchObject({status:'ready',evaluation:{satisfied:true,appliedRules:[{ruleId:'test'}]}}); expect(state).toEqual(before); });

  it('evaluates zone, party, equipment, all/any/not and completed-bond predicates', () => {
    const module: RulesModule = { id: 'test:zones', version: '1', getPartyLimit: (_s, _p, limit) => limit, onSupplyDepleted: () => 'handled', bondConditionRules: [{ ...rule({ kind: 'all', conditions: [
      { kind: 'card-definition-present', definitionId: 'test:starter/stone', zones: ['hand'] },
      { kind: 'card-type-present', cardType: 'starter', zones: ['drawPile', 'hand', 'discardPile', 'playArea', 'party', 'equipment'] },
      { kind: 'party-member-present' }, { kind: 'equipment-present' },
      { kind: 'any', conditions: [{ kind: 'defeated-monsters-at-least', amount: 1 }, { kind: 'not', condition: { kind: 'defeated-bosses-at-least', amount: 99 } }] },
      { kind: 'completed-bonds-at-least', amount: 1 }
    ] }), moduleId: 'test:zones' }] };
    const ruleset = createRuleset([testPack], [baseRulesModule, module]);
    const state = createGame({ gameId: 'zones', seed: 3, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, ruleset);
    const player = state.players[0]!; const stone = player.drawPile.find((id) => state.cards[id]!.definitionId === 'test:starter/stone')!;
    player.drawPile.splice(player.drawPile.indexOf(stone), 1); player.hand.push(stone);
    player.party[0]!.equipmentId = Object.values(state.cards).find((card) => card.definitionId === 'test:item/spear')!.id;
    player.bonds[0]!.completed = true;
    expect(evaluateBondCondition(state, ruleset, 'p1', 'test:bond/a')).toMatchObject({ status: 'ready', evaluation: { satisfied: true } });
  });

  it('uses explicit priority, rejects ambiguity, and retains requiredBosses compatibility when no rule exists', () => {
    const first: RulesModule = { id: 'test:first', version: '1', getPartyLimit: (_s, _p, limit) => limit, onSupplyDepleted: () => 'handled', bondConditionRules: [{ ...rule({ kind: 'defeated-bosses-at-least', amount: 1 }), moduleId: 'test:first', ruleId: 'first', priority: 1 }] };
    const second: RulesModule = { id: 'test:second', version: '1', getPartyLimit: (_s, _p, limit) => limit, onSupplyDepleted: () => 'handled', bondConditionRules: [{ ...rule({ kind: 'defeated-monsters-at-least', amount: 1 }), moduleId: 'test:second', ruleId: 'second', priority: 2 }] };
    const ruleset = createRuleset([testPack], [baseRulesModule, first, second]); const state = createGame({ gameId: 'ordered', seed: 4, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, ruleset);
    state.players[0]!.history.defeatedBosses = 1; state.players[0]!.history.defeatedMonsters = 1;
    expect(evaluateBondCondition(state, ruleset, 'p1', 'test:bond/a')).toMatchObject({ status: 'ready', evaluation: { appliedRules: [{ ruleId: 'first' }, { ruleId: 'second' }] } });
    const ambiguous = createRuleset([testPack], [baseRulesModule, { ...first, bondConditionRules: [{ ...first.bondConditionRules![0]!, priority: 1 }] }, { ...second, bondConditionRules: [{ ...second.bondConditionRules![0]!, priority: 1 }] }]);
    expect(evaluateBondCondition(state, ambiguous, 'p1', 'test:bond/a')).toMatchObject({ status: 'unsupported', reason: 'ORDER_POLICY_REQUIRED' });
    const compatibility = createRuleset([testPack], [baseRulesModule]);
    const compatibleState = createGame({ gameId: 'compatibility', seed: 4, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, compatibility);
    compatibleState.players[0]!.history.defeatedBosses = 1;
    expect(evaluateBondCondition(compatibleState, compatibility, 'p1', 'test:bond/a')).toMatchObject({ status: 'ready', evaluation: { satisfied: true, appliedRules: [] } });
  });

  it('rejects malformed registration and mismatched snapshot registry without changing state', () => {
    const invalid: RulesModule = { id: 'test:invalid', version: '1', getPartyLimit: (_s, _p, limit) => limit, onSupplyDepleted: () => 'handled', bondConditionRules: [{ ...rule({ kind: 'all', conditions: [] }), moduleId: 'test:invalid' }] };
    expect(() => createRuleset([testPack], [baseRulesModule, invalid])).toThrow('Bond condition rule invalid');
    const ownedElsewhere: RulesModule = { ...invalid, id: 'test:owner', bondConditionRules: [{ ...rule({ kind: 'defeated-bosses-at-least', amount: 1 }), moduleId: 'wrong:owner' }] };
    expect(() => createRuleset([testPack], [baseRulesModule, ownedElsewhere])).toThrow('must belong to module');
    const ruleset = createRuleset([testPack], [baseRulesModule]); const state = createGame({ gameId: 'mismatch', seed: 5, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, ruleset); const before = structuredClone(state);
    state.rulesModules[0]!.version = 'tampered';
    expect(evaluateBondCondition(state, ruleset, 'p1', 'test:bond/a')).toMatchObject({ status: 'failed', reason: 'REGISTRY_VERSION_MISMATCH' });
    expect(state).not.toEqual(before); expect(state.rngState).toBe(before.rngState);
  });

  it('rejects function and cyclic rule data before schema parsing', () => {
    const functionRule = { ...rule({ kind: 'defeated-bosses-at-least', amount: 1 }), callback: () => undefined } as unknown as BondConditionRule;
    const cyclicRule = { ...rule({ kind: 'defeated-bosses-at-least', amount: 1 }) } as BondConditionRule & { cycle?: unknown };
    cyclicRule.cycle = cyclicRule;
    const module = (conditionRule: BondConditionRule): RulesModule => ({ id: 'test:json', version: '1', getPartyLimit: (_s, _p, limit) => limit, onSupplyDepleted: () => 'handled', bondConditionRules: [{ ...conditionRule, moduleId: 'test:json' }] });
    expect(() => createRuleset([testPack], [baseRulesModule, module(functionRule)])).toThrow('acyclic JSON-serializable');
    expect(() => createRuleset([testPack], [baseRulesModule, module(cyclicRule)])).toThrow('acyclic JSON-serializable');
  });

  it('keeps a BOND_COMPLETED fact transactional across an event-before choice Snapshot resume', () => {
    const bondModule: RulesModule = { id: 'test:completion', version: '1', getPartyLimit: (_s, _p, limit) => limit, onSupplyDepleted: () => 'handled', bondConditionRules: [{ ...rule({ kind: 'defeated-monsters-at-least', amount: 1 }), moduleId: 'test:completion' }] };
    const choice: EffectDefinition['body'] = { kind: 'choice', choiceId: 'bond-choice', actor: { kind: 'controller' }, options: [{ id: 'accept', effect: { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 2 } }] };
    const hook: LifecycleHook = { schemaVersion: 1, moduleId: 'test:bond-hook', hookId: 'pause-bond', point: 'event-before', eventType: 'BOND_COMPLETED', kind: 'replacement', priority: 1, effect: { schemaVersion: 1, effectId: 'test:bond-hook:pause-bond', body: choice } };
    const lifecycleModule: RulesModule = { id: 'test:bond-hook', version: '1', getPartyLimit: (_s, _p, limit) => limit, onSupplyDepleted: () => 'handled', lifecycleHooks: [hook] };
    const ruleset = createRuleset([testPack], [baseRulesModule, bondModule, lifecycleModule]);
    const state = createGame({ gameId: 'bond-choice', seed: 8, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, ruleset); state.phase = 'combat';
    const targetId = Object.values(state.enemyTargets).find((target) => target.kind === 'monster')!.targetId;
    const suspended = dispatch(state, ruleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }));
    expect(suspended.state.revision).toBe(0); expect(suspended.state.effectState.pendingPostCommand?.facts.some((fact) => fact.type === 'BOND_COMPLETED')).toBe(true);
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(suspended.state))));
    const command = getLegalCommands(restored, ruleset, 'p1').find((candidate) => candidate.type === 'RESOLVE_EFFECT_CHOICE')!;
    const complete = dispatch(restored, ruleset, envelope(restored, 'p1', command));
    expect(complete.error).toBeUndefined(); expect(complete.state.players[0]!.bonds[0]!.completed).toBe(true); expect(complete.events.filter((entry) => entry.type === 'BOND_COMPLETED')).toHaveLength(1); expect(complete.state.revision).toBe(1);
  });
});
