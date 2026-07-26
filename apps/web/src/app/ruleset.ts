import { baseDemoContentPack } from '@guildmaster/content-base';
import { baseRulesModule, createRuleset } from '@guildmaster/game-engine';

export const ruleset = createRuleset([baseDemoContentPack], [baseRulesModule]);
