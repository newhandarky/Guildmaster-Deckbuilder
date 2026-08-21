import { describe, expect, it } from 'vitest';
import {
  baseProvisionalOriginalFullCapabilityMatrix,
  baseProvisionalOriginalFullContentPack,
} from '@guildmaster/content-base';
import { baseProvisionalOriginalFullRulesModule } from '@guildmaster/content-base-rules';
import { createPresentationResolver } from '@guildmaster/presentation-core';
import {
  provisionalFoundationPresentationPack,
  provisionalOriginalFullPresentationPack,
} from '@guildmaster/presentation-demo';
import { buildCardVisualModel } from '../ui/cards/card-visual-model.js';

const unresolvedCopy = '尚未啟用';
const blockedEffectIds: string[] = [];

describe('original full-pack end-to-end completion audit', () => {
  const definitions = baseProvisionalOriginalFullContentPack.definitions;
  const enabledDefinitions = definitions.filter(({ tags }) => tags?.includes('playtest:effect-enabled'));
  const resolver = createPresentationResolver([
    provisionalFoundationPresentationPack,
    provisionalOriginalFullPresentationPack,
  ]);
  const rulesWithoutCapabilityDeclaration = {
    ...baseProvisionalOriginalFullRulesModule,
    config: undefined,
    getPartyLimit: undefined,
    onSupplyDepleted: undefined,
  };
  const serializedRules = JSON.stringify(rulesWithoutCapabilityDeclaration);

  it('keeps every enabled effect connected to JSON effects, triggers, or a generic Rules Module rule', () => {
    expect(enabledDefinitions).toHaveLength(83);
    for (const definition of enabledDefinitions) {
      const hasDefinitionEffect = definition.useEffect !== undefined
        || definition.equipmentEventTriggers !== undefined;
      expect(
        hasDefinitionEffect || serializedRules.includes(definition.id),
        `${definition.id} is enabled without an executable content or Rules Module path`,
      ).toBe(true);
    }
  });

  it('keeps capability status aligned with the remaining field-level evidence blockers', () => {
    const disabledDefinitions = definitions
      .filter(({ tags }) => tags?.includes('playtest:effects-disabled'))
      .map(({ id }) => id)
      .sort();
    const matrixBlockers = baseProvisionalOriginalFullCapabilityMatrix
      .filter(({ effectStatus }) => effectStatus === 'blocked')
      .map(({ contentId }) => contentId)
      .sort();

    expect(disabledDefinitions).toEqual(blockedEffectIds);
    expect(matrixBlockers).toEqual(blockedEffectIds);
  });

  it('carries resolved player copy through the Web card view model for every completed card', () => {
    const completedDefinitions = definitions.filter(
      ({ tags, id }) => tags?.includes('playtest:effect-enabled') || id.startsWith('base:starter/'),
    );
    expect(completedDefinitions).toHaveLength(90);

    for (const definition of completedDefinitions) {
      const presentation = resolver.resolve(definition.id);
      const visualModel = buildCardVisualModel({ definition, presentation });

      expect(presentation.source, `${definition.id} uses Presentation fallback copy`).toBe('pack');
      expect(presentation.shortDisplayText, `${definition.id} still has disabled short copy`).not.toContain(unresolvedCopy);
      expect(presentation.detailDisplayText, `${definition.id} still has disabled detail copy`).not.toContain(unresolvedCopy);
      expect(visualModel.displayName).toBe(presentation.displayName);
      expect(visualModel.shortDisplayText).toBe(presentation.shortDisplayText);
      expect(visualModel.detailDisplayText).toBe(presentation.detailDisplayText);
    }

    expect(buildCardVisualModel({
      definition: definitions.find(({ id }) => id === 'base:resource/resource-11')!,
      presentation: resolver.resolve('base:resource/resource-11'),
    }).shortDisplayText).toContain('其他冒險者戰力各 +1');
    expect(buildCardVisualModel({
      definition: definitions.find(({ id }) => id === 'base:resource/resource-22')!,
      presentation: resolver.resolve('base:resource/resource-22'),
    }).shortDisplayText).toContain('魔物戰力 −1');
  });
});
