import { baseDemoContentPack } from '@guildmaster/content-base';
import { baseRulesModule, createRuleset } from '@guildmaster/game-engine';
import { getE2EScenarioPack, type E2EScenario } from './e2e-scenarios.js';

export function createWebRuleset(scenario?: E2EScenario) {
  return createRuleset([scenario ? getE2EScenarioPack(scenario) : baseDemoContentPack], [baseRulesModule]);
}
