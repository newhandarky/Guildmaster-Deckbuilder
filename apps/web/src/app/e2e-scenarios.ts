import { baseDemoContentPack } from '@guildmaster/content-base';
import type { ContentPack } from '@guildmaster/game-protocol';

const scenarioIds = ['all-bosses-endgame', 'all-bonds-endgame'] as const;

export type E2EScenario = (typeof scenarioIds)[number];

type ScenarioSetup = { bossCopies: number; bonds: NonNullable<ContentPack['bonds']> };

const scenarioSetups: Record<E2EScenario, ScenarioSetup> = {
  'all-bosses-endgame': { bossCopies: 1, bonds: baseDemoContentPack.bonds! },
  'all-bonds-endgame': {
    bossCopies: 2,
    bonds: [{ id: 'e2e:bond/final-victory', name: '終局驗證', honor: 2, requiredBosses: 1 }]
  }
};

/**
 * E2E mode uses small, original-demo ContentPacks so a legal UI attack can reach
 * an existing end condition quickly. The session still creates a fresh game and
 * all play continues through PlayerView, legal commands, and authoritative dispatch.
 */
function createEndgameScenarioPack(id: E2EScenario, setup: ScenarioSetup): ContentPack {
  return {
    ...baseDemoContentPack,
    manifest: { ...baseDemoContentPack.manifest, id: `base:e2e-${id}`, hash: `base-e2e-${id}-v1` },
    definitions: baseDemoContentPack.definitions.map((definition) => {
      if (definition.type !== 'boss') return definition;
      return definition.id === 'base:boss/ruin-warden'
        ? { ...definition, copies: setup.bossCopies, combat: 5 }
        : { ...definition, copies: 0 };
    }),
    bonds: setup.bonds
  };
}

const scenarioPacks: Record<E2EScenario, ContentPack> = Object.fromEntries(
  scenarioIds.map((id) => [id, createEndgameScenarioPack(id, scenarioSetups[id])])
) as Record<E2EScenario, ContentPack>;

export function resolveE2EScenario(search: string): E2EScenario | undefined {
  if (import.meta.env.MODE !== 'e2e') return undefined;
  const requested = new URLSearchParams(search).get('e2eScenario');
  if (requested === null) return undefined;
  if (!scenarioIds.includes(requested as E2EScenario)) throw new Error(`Unknown E2E scenario: ${requested}`);
  return requested as E2EScenario;
}

export function getE2EScenarioPack(scenario: E2EScenario): ContentPack {
  return scenarioPacks[scenario];
}
