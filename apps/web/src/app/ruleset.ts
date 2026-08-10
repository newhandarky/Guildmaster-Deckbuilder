import { baseDemoContentPack, baseProvisionalFoundationContentPack } from '@guildmaster/content-base';
import { baseRulesModule, createRuleset, type RulesModule } from '@guildmaster/game-engine';
import type { EffectDefinition } from '@guildmaster/game-protocol';
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

export type WebContentMode = 'demo' | 'provisional-playtest';

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
    description: '載入候選起始卡、冒險者、首批七種物資、魔物與魔王數值。',
    warning: '內部測試模式：卡牌名稱使用中性代號；已接入首批物資與六項道具效果，其餘個別效果尚未啟用。',
  },
};

export function webContentModeFromPackIds(packIds: readonly string[]): WebContentMode {
  return packIds.includes(baseProvisionalFoundationContentPack.manifest.id) ? 'provisional-playtest' : 'demo';
}

export function createWebRuleset(scenario?: E2EScenario, contentMode: WebContentMode = 'demo') {
  const scenarioModule = scenario === 'lifecycle-choice'
    ? choiceModule
    : scenario === 'lifecycle-consent'
      ? consentModule
      : undefined;
  return createRuleset(
    [scenario
      ? getE2EScenarioPack(scenario)
      : contentMode === 'provisional-playtest'
        ? baseProvisionalFoundationContentPack
        : baseDemoContentPack],
    [baseRulesModule, ...(scenarioModule ? [scenarioModule] : [])],
    { allowProvisionalPlaytest: !scenario && contentMode === 'provisional-playtest' },
  );
}
