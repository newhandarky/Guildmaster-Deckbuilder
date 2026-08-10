import { describe, expect, it } from 'vitest';
import {
  createGame,
  createRuleset,
  dispatchLifecycle,
  evaluateBondPredicate,
  evaluateContinuousEffects,
  getLegalCommands,
  getPartyLimit,
  getPurchasePower,
  getScoreboard,
  inspectLifecyclePreviewUncertainty,
  inspectPendingLifecyclePreviewUncertainty,
  projectPlayerView,
  replayRegistryFingerprint,
  restoreSnapshot,
  rulesModuleCompositionFingerprint,
  serializeSnapshot,
  validateReplayBundleAgainstRuleset,
  type RulesModule,
} from '../src/index.js';
import { baseRulesModule } from '../src/rules/base-rules.js';
import { baseZoneIds } from '../src/model/zones.js';
import { testPack } from './fixtures.js';

const config = {
  gameId: 'optional-module-composition',
  seed: 41,
  players: [
    { id: 'p1', name: 'P1', kind: 'human' as const },
    { id: 'p2', name: 'P2', kind: 'ai' as const },
  ],
  startingPlayerId: 'p1',
};

function optionalModule(
  id: string,
  priority: number,
  overrides: Partial<RulesModule> = {},
): RulesModule {
  return {
    id,
    version: '1.0.0',
    composition: { schemaVersion: 1, kind: 'optional', priority },
    getPartyLimit: (_state, _player, current) => current,
    onSupplyDepleted: () => 'handled',
    ...overrides,
  };
}

function neutralHelper(priority = 10): RulesModule {
  return optionalModule('demo:helper/expanded-party', priority, {
    config: { helperDefinitionId: 'demo:helper/expanded-party' },
    createInitialState: () => ({ active: true, helperDefinitionId: 'demo:helper/expanded-party' }),
    zoneDefinitions: [{
      zoneId: 'demo:helper/active',
      kind: 'singleSlot',
      visibility: 'public',
      rulesModuleId: 'demo:helper/expanded-party',
    }],
    getPartyLimit: (_state, _player, current) => current + 1,
  });
}

describe('optional Rules Module composition', () => {
  it('canonicalizes selected optional modules after core modules and executes a neutral helper slice', () => {
    const helper = neutralHelper();
    const dependent = optionalModule('demo:helper/audit', 20, {
      composition: {
        schemaVersion: 1,
        kind: 'optional',
        priority: 20,
        dependencies: [{ moduleId: helper.id, version: helper.version }],
      },
    });
    const ruleset = createRuleset([testPack], [dependent, baseRulesModule, helper]);
    const reversed = createRuleset([testPack], [helper, dependent, baseRulesModule]);

    expect(ruleset.modules.map(({ id }) => id)).toEqual([
      'base:rules',
      'demo:helper/expanded-party',
      'demo:helper/audit',
    ]);
    expect(replayRegistryFingerprint(ruleset)).toEqual(replayRegistryFingerprint(reversed));

    const state = createGame(config, ruleset);
    expect(state.moduleState['demo:helper/expanded-party']).toEqual({
      active: true,
      helperDefinitionId: 'demo:helper/expanded-party',
    });
    expect(state.zones['demo:helper/active']).toMatchObject({
      kind: 'singleSlot',
      rulesModuleId: 'demo:helper/expanded-party',
      cardIds: [],
    });
    expect(getPartyLimit(ruleset, state, state.players[0]!)).toBe(6);
    expect(state.rulesModules[1]?.compositionFingerprint).toBe(
      rulesModuleCompositionFingerprint(helper.composition!),
    );
  });

  it('fails closed for ambiguous order, missing or incompatible dependencies, and conflicts', () => {
    expect(() => createRuleset([testPack], [
      baseRulesModule,
      optionalModule('test:optional/a', 10),
      optionalModule('test:optional/b', 10),
    ])).toThrow(/ORDER_POLICY_REQUIRED/);

    expect(() => createRuleset([testPack], [
      baseRulesModule,
      optionalModule('test:optional/missing', 10, {
        composition: { schemaVersion: 1, kind: 'optional', priority: 10, dependencies: [{ moduleId: 'test:absent', version: '1.0.0' }] },
      }),
    ])).toThrow(/Missing Rules Module dependency/);

    expect(() => createRuleset([testPack], [
      baseRulesModule,
      optionalModule('test:optional/versioned', 10, {
        composition: { schemaVersion: 1, kind: 'optional', priority: 10, dependencies: [{ moduleId: baseRulesModule.id, version: 'wrong' }] },
      }),
    ])).toThrow(/dependency version mismatch/);

    const lateDependency = optionalModule('test:optional/late', 20);
    expect(() => createRuleset([testPack], [
      baseRulesModule,
      lateDependency,
      optionalModule('test:optional/early-consumer', 10, {
        composition: { schemaVersion: 1, kind: 'optional', priority: 10, dependencies: [{ moduleId: lateDependency.id, version: lateDependency.version }] },
      }),
    ])).toThrow(/dependency order mismatch/);

    expect(() => createRuleset([testPack], [
      baseRulesModule,
      optionalModule('test:optional/a', 10, {
        composition: { schemaVersion: 1, kind: 'optional', priority: 10, conflicts: ['test:optional/b'] },
      }),
      optionalModule('test:optional/b', 20),
    ])).toThrow(/Conflicting Rules Modules/);
  });

  it('rejects malformed self-referential metadata without normalizing whitespace', () => {
    expect(() => createRuleset([testPack], [
      baseRulesModule,
      optionalModule('test:optional/self', 10, {
        composition: { schemaVersion: 1, kind: 'optional', priority: 10, dependencies: [{ moduleId: 'test:optional/self', version: '1.0.0' }] },
      }),
    ])).toThrow(/cannot depend on itself/);

    expect(() => createRuleset([testPack], [
      baseRulesModule,
      optionalModule('test:optional/space', 10, {
        composition: { schemaVersion: 1, kind: 'optional', priority: 10, conflicts: [' base:rules '] },
      }),
    ])).toThrow(/surrounding whitespace/);

    expect(() => createRuleset([testPack], [
      baseRulesModule,
      optionalModule('test:optional/duplicate', 10, {
        composition: {
          schemaVersion: 1,
          kind: 'optional',
          priority: 10,
          dependencies: [{ moduleId: 'base:rules', version: baseRulesModule.version }, { moduleId: 'base:rules', version: baseRulesModule.version }],
        },
      }),
    ])).toThrow(/dependencies must have unique module IDs/);

    expect(() => createRuleset([testPack], [
      baseRulesModule,
      optionalModule('test:optional/unversioned', 10, {
        composition: {
          schemaVersion: 1,
          kind: 'optional',
          priority: 10,
          dependencies: [{ moduleId: 'base:rules' }],
        } as never,
      }),
    ])).toThrow(/version/);
  });

  it('detaches and freezes the validated composition identity after construction', () => {
    const source = neutralHelper(10);
    source.lifecycleHooks = [{
      schemaVersion: 1,
      moduleId: source.id,
      hookId: 'immutable-hook',
      point: 'turn-start',
      kind: 'trigger',
      priority: 1,
      effect: {
        schemaVersion: 1,
        effectId: 'demo:helper/immutable-hook',
        body: { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 1 },
      },
    }];
    const ruleset = createRuleset([testPack], [baseRulesModule, source]);
    const sourceComposition = source.composition as unknown as {
      priority: number;
      dependencies?: { moduleId: string; version: string }[];
    };
    const sourceConfig = source.config as { helperDefinitionId: string };
    sourceComposition.priority = 99;
    sourceComposition.dependencies = [{ moduleId: 'test:missing', version: '1.0.0' }];
    sourceConfig.helperDefinitionId = 'test:mutated';
    (source.zoneDefinitions as unknown as { zoneId: string }[])[0]!.zoneId = baseZoneIds.itemRow;
    const sourceHookBody = source.lifecycleHooks![0]!.effect.body as { amount: number };
    sourceHookBody.amount = 99;

    expect(ruleset.modules.map(({ id }) => id)).toEqual(['base:rules', 'demo:helper/expanded-party']);
    expect(ruleset.modules[1]!.composition).toMatchObject({ priority: 10 });
    expect(Object.isFrozen(ruleset.modules)).toBe(true);
    expect(Object.isFrozen(ruleset.modules[1])).toBe(true);
    expect(Object.isFrozen(ruleset.modules[1]!.composition)).toBe(true);
    expect(Object.isFrozen(ruleset.modules[1]!.config)).toBe(true);
    expect(Object.isFrozen(ruleset.modules[1]!.zoneDefinitions)).toBe(true);
    expect(Object.isFrozen(ruleset.modules[1]!.zoneDefinitions![0])).toBe(true);
    expect(Object.isFrozen(ruleset.modules[1]!.lifecycleHooks![0]!.effect.body)).toBe(true);
    expect(ruleset.modules[1]!.config).toEqual({ helperDefinitionId: 'demo:helper/expanded-party' });
    expect(ruleset.modules[1]!.zoneDefinitions![0]!.zoneId).toBe('demo:helper/active');
    expect((ruleset.modules[1]!.lifecycleHooks![0]!.effect.body as { amount: number }).amount).toBe(1);
    expect(() => {
      (ruleset.modules[1]!.composition as unknown as { priority: number }).priority = 30;
    }).toThrow();
    const state = createGame(config, ruleset);
    expect(state.zones[baseZoneIds.itemRow]!.kind).toBe('faceUpRow');
    expect(dispatchLifecycle(state, ruleset, { schemaVersion: 1, point: 'turn-start' }, { controllerId: 'p1' }).status).toBe('completed');
    expect(state.players[0]!.turnPurchaseBonus).toBe(1);
  });

  it('rejects duplicate zones and mismatched zone ownership before optional modules can overwrite state', () => {
    expect(() => createRuleset([testPack], [
      baseRulesModule,
      optionalModule('test:optional/core-zone-collision', 10, {
        zoneDefinitions: [{ zoneId: baseZoneIds.itemRow, kind: 'moduleArea', visibility: 'ownerOnly', rulesModuleId: 'test:optional/core-zone-collision' }],
      }),
    ])).toThrow(/Conflicting Rules Module zone/);

    const first = optionalModule('test:optional/first-zone', 10, {
      zoneDefinitions: [{ zoneId: 'test:shared-zone', kind: 'moduleArea', visibility: 'public', rulesModuleId: 'test:optional/first-zone' }],
    });
    const second = optionalModule('test:optional/second-zone', 20, {
      zoneDefinitions: [{ zoneId: 'test:shared-zone', kind: 'moduleArea', visibility: 'public', rulesModuleId: 'test:optional/second-zone' }],
    });
    expect(() => createRuleset([testPack], [baseRulesModule, first, second])).toThrow(/Conflicting Rules Module zone/);

    expect(() => createRuleset([testPack], [
      baseRulesModule,
      optionalModule('test:optional/wrong-owner', 10, {
        zoneDefinitions: [{ zoneId: 'test:wrong-owner', kind: 'moduleArea', visibility: 'public', rulesModuleId: 'test:someone-else' }],
      }),
    ])).toThrow(/zone ownership mismatch/);
  });

  it('binds composition metadata to Snapshot and Replay identity even when module order is unchanged', () => {
    const original = createRuleset([testPack], [baseRulesModule, neutralHelper(10)]);
    const changed = createRuleset([testPack], [baseRulesModule, neutralHelper(11)]);
    const state = createGame(config, original);
    const snapshot = serializeSnapshot(state);

    expect(() => restoreSnapshot(snapshot, changed)).toThrow(/active ruleset/);
    expect(getLegalCommands(state, changed, 'p1')).toEqual([]);
    expect(() => projectPlayerView(state, changed, 'p1')).toThrow(/registry fingerprint mismatch/);
    expect(() => getScoreboard(state, changed)).toThrow(/registry fingerprint mismatch/);
    expect(() => getPartyLimit(changed, state, state.players[0]!)).toThrow(/registry fingerprint mismatch/);
    expect(() => getPurchasePower(state, changed, 'p1')).toThrow(/registry fingerprint mismatch/);
    expect(() => inspectLifecyclePreviewUncertainty(state, changed, { schemaVersion: 1, point: 'turn-start' }, { controllerId: 'p1' }, 'p1')).toThrow(/registry fingerprint mismatch/);
    expect(() => inspectPendingLifecyclePreviewUncertainty(state, changed, 'p1')).toThrow(/registry fingerprint mismatch/);
    expect(() => evaluateBondPredicate({ kind: 'defeated-bosses-at-least', amount: 0 }, state, changed, state.players[0]!)).toThrow(/registry fingerprint mismatch/);
    expect(evaluateContinuousEffects(state, changed)).toMatchObject({ status: 'failed', reason: 'REGISTRY_VERSION_MISMATCH' });
    expect(validateReplayBundleAgainstRuleset({
      schemaVersion: 1,
      protocolVersion: 1,
      registry: replayRegistryFingerprint(original),
      initialConfig: config,
      commands: [],
    }, changed).diagnostic?.reasonCode).toBe('REGISTRY_MISMATCH');
    expect(restoreSnapshot(snapshot, original)).toEqual(state);
  });
});
