import { describe, expect, it } from 'vitest';
import type { BondConditionRule } from '@guildmaster/game-protocol';
import { createGame, createRuleset, evaluateBondCondition } from '../src/index.js';
import { baseRulesModule } from '../src/rules/base-rules.js';
import type { RulesModule } from '../src/rules/ruleset.js';
import { testPack } from './fixtures.js';
const rule = (condition: BondConditionRule['condition']): BondConditionRule => ({ schemaVersion: 1, moduleId: 'test:bonds', ruleId: 'test', bondId: 'test:bond/a', priority: 1, condition });
describe('generic bond condition evaluation', () => {
  it('evaluates nested history/counter conditions deterministically without mutation', () => { const module: RulesModule = { id:'test:bonds', version:'1', getPartyLimit:(_s,_p,l)=>l, onSupplyDepleted:()=> 'handled', bondConditionRules:[rule({kind:'all',conditions:[{kind:'defeated-bosses-at-least',amount:1},{kind:'counter-at-least',resourceId:'token',amount:2}]})] }; const ruleset=createRuleset([testPack],[baseRulesModule,module]); const state=createGame({gameId:'bonds',seed:2,players:[{id:'p1',name:'P1',kind:'human'},{id:'p2',name:'P2',kind:'ai'}]},ruleset); state.players[0]!.history.defeatedBosses=1; state.players[0]!.counters.push({resourceId:'token',amount:2,visibility:'ownerOnly'}); const before=structuredClone(state); expect(evaluateBondCondition(state,ruleset,'p1','test:bond/a')).toMatchObject({status:'ready',evaluation:{satisfied:true,appliedRules:[{ruleId:'test'}]}}); expect(state).toEqual(before); });
});
