import { baseDemoContentPack, baseProvisionalFoundationContentPack, baseProvisionalOriginalFullContentPack } from '@guildmaster/content-base/runtime';
import { baseHelpersRulesModule, baseProvisionalHelpersContentPack } from '@guildmaster/content-base-helpers';
import { baseProvisionalOriginalFullRulesModule } from '@guildmaster/content-base-rules';
import { baseRulesModule, createRuleset, type RulesModule } from '@guildmaster/game-engine';
import type { ContentPack, EffectDefinition } from '@guildmaster/game-protocol';
import { getE2EScenarioPack, type E2EScenario } from './e2e-scenarios.js';

const modifyPurchase = (amount: number): EffectDefinition['body'] => ({
  kind: 'modify-value',
  target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } },
  amount,
});

const choiceModule: RulesModule = {
  id: 'e2e:lifecycle-choice',
  version: '1',
  getPartyLimit: (_state, _player, limit) => limit,
  onSupplyDepleted: () => 'handled',
  lifecycleHooks: [{
    schemaVersion: 1,
    moduleId: 'e2e:lifecycle-choice',
    hookId: 'choose-command-path',
    point: 'command-before',
    kind: 'trigger',
    priority: 1,
    effect: {
      schemaVersion: 1,
      effectId: 'e2e:lifecycle-choice/choose-command-path',
      body: {
        kind: 'choice',
        choiceId: 'e2e:command-path',
        decisionKind: 'choose-effect-option',
        actor: { kind: 'controller' },
        options: [
          { id: 'continue', effect: modifyPurchase(1) },
          { id: 'skip', effect: modifyPurchase(0) },
        ],
      },
    },
  }],
};

const consentModule: RulesModule = {
  id: 'e2e:lifecycle-consent',
  version: '1',
  getPartyLimit: (_state, _player, limit) => limit,
  onSupplyDepleted: () => 'handled',
  counterConsentPolicies: [{
    schemaVersion: 1,
    moduleId: 'e2e:lifecycle-consent',
    policyId: 'share-demo-counter',
    resourceId: 'e2e:private-counter',
    requester: 'counter-owner',
    requiredConsent: 'all-other-players',
    expiration: { kind: 'explicit-command', actor: 'any-player' },
  }],
  lifecycleHooks: [{
    schemaVersion: 1,
    moduleId: 'e2e:lifecycle-consent',
    hookId: 'request-demo-counter-consent',
    point: 'command-before',
    kind: 'trigger',
    priority: 1,
    effect: {
      schemaVersion: 1,
      effectId: 'e2e:lifecycle-consent/request-demo-counter-consent',
      body: {
        kind: 'request-counter-consent',
        requestId: 'e2e:share-demo-counter',
        policy: { moduleId: 'e2e:lifecycle-consent', policyId: 'share-demo-counter' },
        counterOwner: { kind: 'controller' },
        outcomes: {
          accepted: modifyPurchase(1),
          declined: modifyPurchase(0),
          cancelled: modifyPurchase(0),
          expired: modifyPurchase(0),
        },
      },
    },
  }],
};

export type WebContentMode = 'demo' | 'provisional-playtest' | 'provisional-original-full';
export type WebGameSetup = { contentMode: WebContentMode; advancedRules: { helpers: boolean } };
export const defaultWebGameSetup: WebGameSetup = { contentMode: 'demo', advancedRules: { helpers: false } };

/** Full four-player mode uses a distinct helper-pack identity so snapshots cannot be mistaken for foundation-helper games. */
const baseProvisionalOriginalFullHelpersContentPack: ContentPack = {
  ...baseProvisionalHelpersContentPack,
  manifest: { ...baseProvisionalHelpersContentPack.manifest, id: 'base:provisional-original-full-helpers', version: '1.0.0', hash: 'base-provisional-original-full-helpers-v1', dependencies: [baseProvisionalOriginalFullContentPack.manifest.id] },
};

export const webContentModeOptions: Readonly<Record<WebContentMode, {
  label: string;
  description: string;
  warning?: string;
}>> = {
  demo: {
    label: '原創示範牌組',
    description: '完整可玩、適合一般測試；使用原創文字內容與既有卡牌效果。',
  },
  'provisional-playtest': {
    label: '基礎候選數值測試',
    description: '載入候選起始卡、冒險者、首批十一種物資、魔物與魔王數值。',
    warning: '內部測試模式：卡牌名稱使用中性代號；已接入首批物資與十項卡牌效果，其餘個別效果尚未啟用。',
  },
  'provisional-original-full': {
    label: '基礎版原作衍生 Provisional 測試',
    description: '固定一名真人與三名 CPU，載入完整候選 roster、起始裝備與已驗證的首批卡牌效果。',
    warning: '內部測試模式：候選冒險者 02／09、魔物 01／02／03／06／09／10／11／14 與既有十四項物資效果已啟用；其餘未覆核效果保持停用，不得視為官方完整基礎版。',
  },
};

export function webContentModeFromPackIds(packIds: readonly string[]): WebContentMode {
  if (packIds.includes(baseProvisionalOriginalFullContentPack.manifest.id)) return 'provisional-original-full';
  return packIds.includes(baseProvisionalFoundationContentPack.manifest.id) ? 'provisional-playtest' : 'demo';
}

export function webGameSetupFromSnapshot(packIds: readonly string[], moduleIds: readonly string[]): WebGameSetup {
  const contentMode = webContentModeFromPackIds(packIds);
  const helperPack = packIds.includes(baseProvisionalHelpersContentPack.manifest.id) || packIds.includes(baseProvisionalOriginalFullHelpersContentPack.manifest.id);
  const helperModule = moduleIds.includes(baseHelpersRulesModule.id);
  if (helperPack !== helperModule) throw new Error('Saved helper setup has an inconsistent Content Pack or Rules Module identity.');
  return { contentMode, advancedRules: { helpers: helperModule } };
}

function normalizeSetup(setup: WebGameSetup | WebContentMode): WebGameSetup {
  const normalized = typeof setup === 'string' ? { contentMode: setup, advancedRules: { helpers: false } } : structuredClone(setup);
  return normalized.contentMode === 'provisional-original-full' ? { ...normalized, advancedRules: { helpers: true } } : normalized;
}

function e2eHelperDefinitionIds(scenario: E2EScenario): Set<string> {
  return new Set(scenario === 'helper-batch-a'
    ? ['base:helper/helper-01', 'base:helper/helper-07']
    : ['base:helper/helper-01', 'base:helper/helper-08']);
}

function e2eHelperPack(basePack: ContentPack, scenario: E2EScenario): ContentPack {
  const fixtureIds = e2eHelperDefinitionIds(scenario);
  return {
    ...baseProvisionalHelpersContentPack,
    manifest: {
      ...baseProvisionalHelpersContentPack.manifest,
      id: 'e2e:helper-content',
      hash: `e2e-helper-content-${scenario}-v2`,
      contentStatus: 'demo',
      dependencies: [basePack.manifest.id],
    },
    definitions: baseProvisionalHelpersContentPack.definitions
      .filter(({ id }) => fixtureIds.has(id))
      .sort((left, right) => scenario === 'helper-batch-a' ? right.id.localeCompare(left.id) : left.id.localeCompare(right.id)),
  };
}

function e2eHelperModule(scenario: E2EScenario): RulesModule {
  const fixtureIds = e2eHelperDefinitionIds(scenario);
  return {
    ...baseHelpersRulesModule,
    config: { fixtureDefinitionIds: [...fixtureIds] },
    purchaseCostModifierRules: baseHelpersRulesModule.purchaseCostModifierRules!.filter(({ activation }) => fixtureIds.has(activation.definitionId)),
    restHandSizePolicies: baseHelpersRulesModule.restHandSizePolicies!.filter(({ activation }) => fixtureIds.has(activation.definitionId)),
  };
}

export function createWebRuleset(scenario?: E2EScenario, setupInput: WebGameSetup | WebContentMode = defaultWebGameSetup) {
  const setup = normalizeSetup(setupInput);
  if (!scenario && setup.contentMode === 'demo' && setup.advancedRules.helpers) throw new Error('Helper advanced rules require provisional playtest content.');
  const scenarioModule = scenario === 'lifecycle-choice'
    ? choiceModule
    : scenario === 'lifecycle-consent'
      ? consentModule
      : undefined;
  const scenarioPack = scenario ? getE2EScenarioPack(scenario) : undefined;
  const helperScenario = scenario === 'optional-helper' || scenario === 'helper-batch-a';
  const packs = scenarioPack
    ? [scenarioPack, ...(helperScenario ? [e2eHelperPack(scenarioPack, scenario)] : [])]
    : setup.contentMode === 'provisional-original-full'
      ? [baseProvisionalOriginalFullContentPack, baseProvisionalOriginalFullHelpersContentPack]
    : setup.contentMode === 'provisional-playtest'
      ? [baseProvisionalFoundationContentPack, ...(setup.advancedRules.helpers ? [baseProvisionalHelpersContentPack] : [])]
      : [baseDemoContentPack];
  return createRuleset(
    packs,
    [
      baseRulesModule,
      ...(!scenario && setup.contentMode === 'provisional-original-full' ? [baseProvisionalOriginalFullRulesModule, baseHelpersRulesModule] : []),
      ...(scenarioModule ? [scenarioModule] : []),
      ...(helperScenario ? [e2eHelperModule(scenario)] : !scenario && setup.advancedRules.helpers && setup.contentMode !== 'provisional-original-full' ? [baseHelpersRulesModule] : []),
    ],
    { allowProvisionalPlaytest: !scenario && setup.contentMode !== 'demo' },
  );
}
