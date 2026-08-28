import { baseProvisionalOriginalFullCapabilityMatrix } from '@guildmaster/content-base';
import { baseDemoContentPack, baseProvisionalFoundationContentPack, baseProvisionalOriginalFullContentPack } from '@guildmaster/content-base/runtime';
import { baseHelpersRulesModule, baseProvisionalHelpersContentPack } from '@guildmaster/content-base-helpers';
import { baseProvisionalOriginalFullRulesModule } from '@guildmaster/content-base-rules';
import { customAdventurerCapabilityMatrix, customAdventurerContentPack, customAdventurerContentPackId } from '@guildmaster/content-custom-adventurers';
import { customAdventurerHelperRulesModule, customAdventurerHelperRulesModuleId, customAdventurerRulesModule } from '@guildmaster/content-custom-adventurers-rules';
import { baseRulesModule, createRuleset, type RulesModule } from '@guildmaster/game-engine';
import type { ContentPack, EffectDefinition } from '@guildmaster/game-protocol';
import { webContentModeFromPackIds, type WebContentMode } from './content-mode.js';
import { getE2EScenarioPack, type E2EScenario } from './e2e-scenarios.js';

export { webContentModeFromPackIds, type WebContentMode } from './content-mode.js';

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

export type WebGameSetup = { contentMode: WebContentMode; advancedRules: { helpers: boolean } };
export const defaultWebGameSetup: WebGameSetup = { contentMode: 'demo', advancedRules: { helpers: false } };

const enabledFoundationEffects = baseProvisionalFoundationContentPack.definitions
  .filter(({ tags }) => tags?.includes('playtest:effect-enabled')).length;
const enabledHelpers = baseProvisionalHelpersContentPack.definitions
  .filter(({ tags }) => tags?.includes('playtest:effect-enabled')).length;
const fullCapabilityByPrefix = (prefix: string) => baseProvisionalOriginalFullCapabilityMatrix
  .filter(({ contentKind, contentId, effectStatus }) => contentKind === 'definition' && contentId.startsWith(prefix) && effectStatus === 'enabled').length;
const definitionCountByPrefix = (prefix: string) => baseProvisionalOriginalFullContentPack.definitions
  .filter(({ id }) => id.startsWith(prefix)).length;
const enabledCustomEffects = customAdventurerCapabilityMatrix.filter(({ effectStatus }) => effectStatus === 'enabled').length;
const blockedCustomEffects = customAdventurerCapabilityMatrix.filter(({ effectStatus }) => effectStatus === 'blocked').length;

/** User-facing counts are derived from machine-readable content gates, never duplicated literals. */
export const webModeEffectSummary = {
  foundation: `${enabledFoundationEffects} 項已驗證卡牌效果`,
  helpers: `${enabledHelpers}/${baseProvisionalHelpersContentPack.definitions.length} 張協助者`,
  full: [
    `冒險者 ${fullCapabilityByPrefix('base:adventurer/')}/${definitionCountByPrefix('base:adventurer/')}`,
    `物資 ${fullCapabilityByPrefix('base:resource/')}/${definitionCountByPrefix('base:resource/')}`,
    `魔物 ${fullCapabilityByPrefix('base:monster/')}/${definitionCountByPrefix('base:monster/')}`,
    `魔王 ${fullCapabilityByPrefix('base:boss/')}/${definitionCountByPrefix('base:boss/')}`,
    `協助者 ${enabledHelpers}/${baseProvisionalHelpersContentPack.definitions.length}`,
  ].join('、'),
  custom: `自定義特殊效果已啟用 ${enabledCustomEffects} 張，語意待確認 ${blockedCustomEffects} 張`,
} as const;

/** Full four-player mode uses a distinct helper-pack identity so snapshots cannot be mistaken for foundation-helper games. */
const baseProvisionalOriginalFullHelpersContentPack: ContentPack = {
  ...baseProvisionalHelpersContentPack,
  manifest: { ...baseProvisionalHelpersContentPack.manifest, id: 'base:provisional-original-full-helpers', version: '1.0.0', hash: 'base-provisional-original-full-helpers-v1', dependencies: [baseProvisionalOriginalFullContentPack.manifest.id] },
};

const customAdventurersFullHelpersContentPack: ContentPack = {
  ...baseProvisionalHelpersContentPack,
  manifest: {
    ...baseProvisionalHelpersContentPack.manifest,
    id: 'custom:adventurers-full-helpers',
    version: '1.0.0',
    hash: 'custom-adventurers-full-helpers-v1',
    dependencies: [baseProvisionalOriginalFullContentPack.manifest.id, customAdventurerContentPackId],
  },
  rulesModuleIds: [baseHelpersRulesModule.id, customAdventurerHelperRulesModuleId],
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
    label: '基礎數值測試',
    description: '使用精簡的基礎卡牌組合，適合快速檢查核心流程。',
    warning: '這是測試版本，部分卡牌只使用基礎數值，內容可能調整。',
  },
  'provisional-original-full': {
    label: '基礎完整牌組',
    description: '一名玩家與三名電腦對手，使用完整基礎牌組、羈絆與協助者。',
    warning: '這是測試版本，卡牌內容與張數可能調整，請勿視為正式卡表。',
  },
  'custom-adventurers-full': {
    label: '自訂冒險者完整牌組',
    description: '一名玩家與三名電腦對手，使用自訂起始角色與冒險者供應。',
    warning: '這是私人測試版本，部分角色技能仍只套用卡面數值。',
  },
};

export function webGameSetupFromSnapshot(packIds: readonly string[], moduleIds: readonly string[]): WebGameSetup {
  const contentMode = webContentModeFromPackIds(packIds);
  const helperPack = packIds.includes(baseProvisionalHelpersContentPack.manifest.id)
    || packIds.includes(baseProvisionalOriginalFullHelpersContentPack.manifest.id)
    || packIds.includes(customAdventurersFullHelpersContentPack.manifest.id);
  const helperModule = moduleIds.includes(baseHelpersRulesModule.id);
  if (helperPack !== helperModule) throw new Error('Saved helper setup has an inconsistent Content Pack or Rules Module identity.');
  return { contentMode, advancedRules: { helpers: helperModule } };
}

function normalizeSetup(setup: WebGameSetup | WebContentMode): WebGameSetup {
  const normalized = typeof setup === 'string' ? { contentMode: setup, advancedRules: { helpers: false } } : structuredClone(setup);
  return normalized.contentMode === 'provisional-original-full' || normalized.contentMode === 'custom-adventurers-full'
    ? { ...normalized, advancedRules: { helpers: true } }
    : normalized;
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
  const rotateHook = structuredClone(baseHelpersRulesModule.lifecycleHooks?.find(({ hookId }) => hookId === 'rotate-after-boss-defeat'));
  if (!rotateHook || rotateHook.effect.body.kind !== 'sequence') throw new Error('Base helper rotation hook is unavailable.');
  rotateHook.effect.body.effects = rotateHook.effect.body.effects.filter((effect) => effect.kind !== 'conditional'
    || effect.condition.kind !== 'definition-in-zone'
    || fixtureIds.has(effect.condition.definitionId));
  return {
    ...baseHelpersRulesModule,
    config: { fixtureDefinitionIds: [...fixtureIds] },
    lifecycleHooks: [rotateHook],
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
    : setup.contentMode === 'custom-adventurers-full'
      ? [baseProvisionalOriginalFullContentPack, customAdventurerContentPack, customAdventurersFullHelpersContentPack]
    : setup.contentMode === 'provisional-original-full'
      ? [baseProvisionalOriginalFullContentPack, baseProvisionalOriginalFullHelpersContentPack]
    : setup.contentMode === 'provisional-playtest'
      ? [baseProvisionalFoundationContentPack, ...(setup.advancedRules.helpers ? [baseProvisionalHelpersContentPack] : [])]
      : [baseDemoContentPack];
  return createRuleset(
    packs,
    [
      baseRulesModule,
      ...(!scenario && setup.contentMode === 'custom-adventurers-full' ? [customAdventurerRulesModule, baseHelpersRulesModule, customAdventurerHelperRulesModule] : []),
      ...(!scenario && setup.contentMode === 'provisional-original-full' ? [baseProvisionalOriginalFullRulesModule, baseHelpersRulesModule] : []),
      ...(scenarioModule ? [scenarioModule] : []),
      ...(helperScenario ? [e2eHelperModule(scenario)] : !scenario && setup.advancedRules.helpers && setup.contentMode !== 'provisional-original-full' && setup.contentMode !== 'custom-adventurers-full' ? [baseHelpersRulesModule] : []),
    ],
    { allowProvisionalPlaytest: !scenario && setup.contentMode !== 'demo' },
  );
}
