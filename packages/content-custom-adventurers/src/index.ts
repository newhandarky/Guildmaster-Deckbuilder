import { baseProvisionalOriginalFullCapabilityMatrix } from '@guildmaster/content-base/runtime';
import type { CardDefinition, ContentPack, ReplacementDeclaration } from '@guildmaster/game-protocol';

export const customAdventurerContentPackId = 'custom:adventurers-full';
export const customAdventurerRulesModuleId = 'custom:adventurers-full-rules';
const source = 'custom-adventurers-public-playtest';

type CustomEffectStatus = 'enabled' | 'ready' | 'blocked' | 'none';
type CustomCardRow = readonly [
  id: string,
  profession: 'melee' | 'mage' | 'tank' | 'support' | 'ranged',
  copies: number,
  cost: number | undefined,
  combat: number,
  honor: number | undefined,
  effectStatus: CustomEffectStatus,
  inheritsMechanicFrom: string | undefined,
];

/**
 * Generated from docs/card-data/自定義冒險者格式化資料.md.
 * Display names, rules copy, and remote artwork deliberately live in the
 * Presentation Pack rather than authoritative mechanics.
 */
const provisionalCustomCardRows: readonly CustomCardRow[] = [
  ["custom:starter/melee", "melee", 1, undefined, 2, undefined, "none", undefined],
  ["custom:adventurer/melee-01", "melee", 2, 4, 2, 2, "enabled", "base:adventurer/adventurer-06"],
  ["custom:adventurer/melee-02", "melee", 2, 3, 3, 2, "enabled", "base:adventurer/adventurer-02"],
  ["custom:adventurer/melee-03", "melee", 2, 3, 2, 1, "enabled", "base:adventurer/adventurer-08"],
  ["custom:adventurer/melee-04", "melee", 2, 4, 2, 2, "enabled", "base:adventurer/adventurer-10"],
  ["custom:adventurer/melee-05", "melee", 2, 4, 0, 1, "enabled", "base:adventurer/adventurer-14"],
  ["custom:adventurer/melee-06", "melee", 2, 4, 2, 2, "enabled", "base:adventurer/adventurer-18"],
  ["custom:adventurer/melee-07", "melee", 2, 5, 1, 1, "enabled", undefined],
  ["custom:adventurer/melee-08", "melee", 2, 4, 2, 1, "enabled", "base:adventurer/adventurer-21"],
  ["custom:adventurer/melee-09", "melee", 2, 4, 1, 1, "enabled", "base:adventurer/adventurer-24"],
  ["custom:starter/mage", "mage", 1, undefined, 1, undefined, "none", undefined],
  ["custom:adventurer/mage-01", "mage", 2, 4, 1, 1, "enabled", "base:adventurer/adventurer-11"],
  ["custom:adventurer/mage-02", "mage", 2, 4, 3, 1, "enabled", "base:adventurer/adventurer-03"],
  ["custom:adventurer/mage-03", "mage", 2, 4, 2, 2, "enabled", "base:adventurer/adventurer-19"],
  ["custom:adventurer/mage-04", "mage", 2, 3, 5, 1, "enabled", "base:adventurer/adventurer-20"],
  ["custom:adventurer/mage-05", "mage", 2, 3, 1, 1, "enabled", "base:adventurer/adventurer-23"],
  ["custom:adventurer/mage-06", "mage", 2, 5, 0, 1, "enabled", undefined],
  ["custom:adventurer/mage-07", "mage", 2, 4, 1, 1, "enabled", undefined],
  ["custom:adventurer/mage-08", "mage", 2, 5, 1, 1, "enabled", "base:adventurer/adventurer-29"],
  ["custom:starter/tank", "tank", 1, undefined, 2, undefined, "none", undefined],
  ["custom:adventurer/tank-01", "tank", 2, 4, 2, 2, "enabled", "base:adventurer/adventurer-04"],
  ["custom:adventurer/tank-02", "tank", 2, 3, 1, 1, "enabled", "base:adventurer/adventurer-09"],
  ["custom:adventurer/tank-03", "tank", 2, 3, 2, 2, "enabled", "base:adventurer/adventurer-12"],
  ["custom:adventurer/tank-04", "tank", 2, 4, 3, 2, "enabled", "base:adventurer/adventurer-16"],
  ["custom:adventurer/tank-05", "tank", 2, 3, 1, 1, "enabled", "base:adventurer/adventurer-22"],
  ["custom:adventurer/tank-06", "tank", 2, 4, 1, 1, "enabled", undefined],
  ["custom:adventurer/tank-07", "tank", 2, 5, 1, 1, "enabled", undefined],
  ["custom:adventurer/tank-08", "tank", 2, 4, 2, 1, "enabled", "base:adventurer/adventurer-25"],
  ["custom:adventurer/tank-09", "tank", 2, 4, 2, 2, "enabled", undefined],
  ["custom:adventurer/tank-10", "tank", 2, 4, 2, 2, "none", undefined],
  ["custom:starter/support", "support", 1, undefined, 1, undefined, "none", undefined],
  ["custom:adventurer/support-01", "support", 2, 4, 1, 1, "enabled", "base:adventurer/adventurer-13"],
  ["custom:adventurer/support-02", "support", 2, 3, 1, 1, "enabled", "base:adventurer/adventurer-05"],
  ["custom:adventurer/support-03", "support", 2, 3, 1, 1, "enabled", "base:adventurer/adventurer-17"],
  ["custom:adventurer/support-04", "support", 2, 3, 1, 1, "enabled", "base:adventurer/adventurer-27"],
  ["custom:adventurer/support-05", "support", 2, 4, 2, 2, "enabled", "base:adventurer/adventurer-01"],
  ["custom:adventurer/support-06", "support", 2, 3, 1, 1, "enabled", undefined],
  ["custom:adventurer/support-07", "support", 2, 3, 1, 1, "enabled", "base:adventurer/adventurer-28"],
  ["custom:adventurer/support-08", "support", 2, 5, 0, 3, "enabled", "base:adventurer/adventurer-30"],
  ["custom:adventurer/support-09", "support", 2, 5, 0, 3, "enabled", undefined],
  ["custom:adventurer/support-10", "support", 2, 5, 0, 3, "none", undefined],
  ["custom:starter/ranged", "ranged", 1, undefined, 1, undefined, "none", undefined],
  ["custom:adventurer/ranged-01", "ranged", 2, 3, 2, 1, "enabled", "base:adventurer/adventurer-15"],
  ["custom:adventurer/ranged-02", "ranged", 2, 3, 2, 1, "enabled", "base:adventurer/adventurer-07"],
  ["custom:adventurer/ranged-03", "ranged", 2, 5, 1, 1, "enabled", undefined],
  ["custom:adventurer/ranged-04", "ranged", 2, 4, 2, 1, "enabled", "base:adventurer/adventurer-26"],
  ["custom:adventurer/ranged-05", "ranged", 2, 5, 1, 1, "enabled", undefined],
  ["custom:adventurer/ranged-06", "ranged", 2, 5, 0, 3, "none", undefined]
];

/** Custom mode uses one physical copy of every custom adventurer and starter. */
export const customCardRows: readonly CustomCardRow[] = provisionalCustomCardRows.map(([
  id, profession, , cost, combat, honor, effectStatus, inheritsMechanicFrom,
]) => [id, profession, 1, cost, combat, honor, effectStatus, inheritsMechanicFrom]);

export const customAdventurerMechanicBindings: Readonly<Record<string, string>> = {
  'base:adventurer/adventurer-10': 'custom:adventurer/melee-04',
  'base:adventurer/adventurer-11': 'custom:adventurer/mage-01',
  'base:adventurer/adventurer-12': 'custom:adventurer/tank-03',
  'base:adventurer/adventurer-13': 'custom:adventurer/support-01',
  'base:adventurer/adventurer-14': 'custom:adventurer/melee-05',
  'base:adventurer/adventurer-15': 'custom:adventurer/ranged-01',
  'base:adventurer/adventurer-16': 'custom:adventurer/tank-04',
  'base:adventurer/adventurer-17': 'custom:adventurer/support-03',
  'base:adventurer/adventurer-18': 'custom:adventurer/melee-06',
  'base:adventurer/adventurer-19': 'custom:adventurer/mage-03',
  'base:adventurer/adventurer-20': 'custom:adventurer/mage-04',
  'base:adventurer/adventurer-21': 'custom:adventurer/melee-08',
  'base:adventurer/adventurer-22': 'custom:adventurer/tank-05',
  'base:adventurer/adventurer-23': 'custom:adventurer/mage-05',
  'base:adventurer/adventurer-24': 'custom:adventurer/melee-09',
  'base:adventurer/adventurer-25': 'custom:adventurer/tank-08',
  'base:adventurer/adventurer-26': 'custom:adventurer/ranged-04',
  'base:adventurer/adventurer-27': 'custom:adventurer/support-04',
  'base:adventurer/adventurer-28': 'custom:adventurer/support-07',
  'base:adventurer/adventurer-29': 'custom:adventurer/mage-08',
  'base:adventurer/adventurer-30': 'custom:adventurer/support-08',
  'base:adventurer/adventurer-01': 'custom:adventurer/support-05',
  'base:adventurer/adventurer-02': 'custom:adventurer/melee-02',
  'base:adventurer/adventurer-03': 'custom:adventurer/mage-02',
  'base:adventurer/adventurer-04': 'custom:adventurer/tank-01',
  'base:adventurer/adventurer-05': 'custom:adventurer/support-02',
  'base:adventurer/adventurer-06': 'custom:adventurer/melee-01',
  'base:adventurer/adventurer-07': 'custom:adventurer/ranged-02',
  'base:adventurer/adventurer-08': 'custom:adventurer/melee-03',
  'base:adventurer/adventurer-09': 'custom:adventurer/tank-02'
};

export const customAdventurerReplacementDeclarations: readonly ReplacementDeclaration[] = [
  { replacesDefinitionId: 'base:starter/adventurer-01', replacementDefinitionId: 'custom:starter/support', priority: 100 },
  { replacesDefinitionId: 'base:starter/adventurer-02', replacementDefinitionId: 'custom:starter/melee', priority: 100 },
  { replacesDefinitionId: 'base:starter/adventurer-03', replacementDefinitionId: 'custom:starter/mage', priority: 100 },
  { replacesDefinitionId: 'base:starter/adventurer-04', replacementDefinitionId: 'custom:starter/tank', priority: 100 },
  { replacesDefinitionId: 'base:starter/adventurer-05', replacementDefinitionId: 'custom:starter/ranged', priority: 100 },
  { replacesDefinitionId: 'base:adventurer/adventurer-10', replacementDefinitionId: 'custom:adventurer/melee-04', priority: 100 },
  { replacesDefinitionId: 'base:adventurer/adventurer-11', replacementDefinitionId: 'custom:adventurer/mage-01', priority: 100 },
  { replacesDefinitionId: 'base:adventurer/adventurer-12', replacementDefinitionId: 'custom:adventurer/tank-03', priority: 100 },
  { replacesDefinitionId: 'base:adventurer/adventurer-13', replacementDefinitionId: 'custom:adventurer/support-01', priority: 100 },
  { replacesDefinitionId: 'base:adventurer/adventurer-14', replacementDefinitionId: 'custom:adventurer/melee-05', priority: 100 },
  { replacesDefinitionId: 'base:adventurer/adventurer-15', replacementDefinitionId: 'custom:adventurer/ranged-01', priority: 100 },
  { replacesDefinitionId: 'base:adventurer/adventurer-16', replacementDefinitionId: 'custom:adventurer/tank-04', priority: 100 },
  { replacesDefinitionId: 'base:adventurer/adventurer-17', replacementDefinitionId: 'custom:adventurer/support-03', priority: 100 },
  { replacesDefinitionId: 'base:adventurer/adventurer-18', replacementDefinitionId: 'custom:adventurer/melee-06', priority: 100 },
  { replacesDefinitionId: 'base:adventurer/adventurer-19', replacementDefinitionId: 'custom:adventurer/mage-03', priority: 100 },
  { replacesDefinitionId: 'base:adventurer/adventurer-20', replacementDefinitionId: 'custom:adventurer/mage-04', priority: 100 },
  { replacesDefinitionId: 'base:adventurer/adventurer-21', replacementDefinitionId: 'custom:adventurer/melee-08', priority: 100 },
  { replacesDefinitionId: 'base:adventurer/adventurer-22', replacementDefinitionId: 'custom:adventurer/tank-05', priority: 100 },
  { replacesDefinitionId: 'base:adventurer/adventurer-23', replacementDefinitionId: 'custom:adventurer/mage-05', priority: 100 },
  { replacesDefinitionId: 'base:adventurer/adventurer-24', replacementDefinitionId: 'custom:adventurer/melee-09', priority: 100 },
  { replacesDefinitionId: 'base:adventurer/adventurer-25', replacementDefinitionId: 'custom:adventurer/tank-08', priority: 100 },
  { replacesDefinitionId: 'base:adventurer/adventurer-26', replacementDefinitionId: 'custom:adventurer/ranged-04', priority: 100 },
  { replacesDefinitionId: 'base:adventurer/adventurer-27', replacementDefinitionId: 'custom:adventurer/support-04', priority: 100 },
  { replacesDefinitionId: 'base:adventurer/adventurer-28', replacementDefinitionId: 'custom:adventurer/support-07', priority: 100 },
  { replacesDefinitionId: 'base:adventurer/adventurer-29', replacementDefinitionId: 'custom:adventurer/mage-08', priority: 100 },
  { replacesDefinitionId: 'base:adventurer/adventurer-30', replacementDefinitionId: 'custom:adventurer/support-08', priority: 100 },
  { replacesDefinitionId: 'base:adventurer/adventurer-01', replacementDefinitionId: 'custom:adventurer/support-05', priority: 100 },
  { replacesDefinitionId: 'base:adventurer/adventurer-02', replacementDefinitionId: 'custom:adventurer/melee-02', priority: 100 },
  { replacesDefinitionId: 'base:adventurer/adventurer-03', replacementDefinitionId: 'custom:adventurer/mage-02', priority: 100 },
  { replacesDefinitionId: 'base:adventurer/adventurer-04', replacementDefinitionId: 'custom:adventurer/tank-01', priority: 100 },
  { replacesDefinitionId: 'base:adventurer/adventurer-05', replacementDefinitionId: 'custom:adventurer/support-02', priority: 100 },
  { replacesDefinitionId: 'base:adventurer/adventurer-06', replacementDefinitionId: 'custom:adventurer/melee-01', priority: 100 },
  { replacesDefinitionId: 'base:adventurer/adventurer-07', replacementDefinitionId: 'custom:adventurer/ranged-02', priority: 100 },
  { replacesDefinitionId: 'base:adventurer/adventurer-08', replacementDefinitionId: 'custom:adventurer/melee-03', priority: 100 },
  { replacesDefinitionId: 'base:adventurer/adventurer-09', replacementDefinitionId: 'custom:adventurer/tank-02', priority: 100 }
];

const customDefinitions: CardDefinition[] = customCardRows.map(([
  id, profession, copies, cost, combat, honor, effectStatus, inheritsMechanicFrom,
]) => ({
  id,
  name: id.startsWith('custom:starter/') ? `自定義起始冒險者 ${profession}` : `自定義冒險者 ${id.split('/').at(-1)}`,
  type: id.startsWith('custom:starter/') ? 'starter' : 'adventurer',
  copies,
  source,
  tags: [
    `profession:${profession}`,
    effectStatus === 'enabled' ? 'playtest:effect-enabled'
      : effectStatus === 'none' ? 'playtest:no-special-effect'
        : 'playtest:effects-disabled',
    effectStatus === 'blocked' ? 'playtest:blocker-unverified-effect-semantics'
      : effectStatus === 'ready' ? 'playtest:ready-for-rule-implementation'
        : 'playtest:effect-audited',
    ...(inheritsMechanicFrom ? [`custom:inherits-mechanic:${inheritsMechanicFrom}`] : []),
    'project-policy:digital-copy-count',
  ],
  ...(cost === undefined ? {} : { cost }),
  combat,
  ...(honor === undefined ? {} : { honor }),
}));

export const customAdventurerContentPack: ContentPack = {
  manifest: {
    id: customAdventurerContentPackId,
    version: '0.8.0',
    hash: 'custom-adventurers-full-v8-four-confirmed-character-effects',
    role: 'expansion',
    contentStatus: 'provisional-playtest',
    dependencies: ['base:provisional-original-full'],
  },
  definitions: customDefinitions,
  replacements: customAdventurerReplacementDeclarations,
  rulesModuleIds: [customAdventurerRulesModuleId],
};

export type CustomAdventurerCapabilityEntry = {
  readonly contentId: string;
  readonly effectStatus: CustomEffectStatus;
  readonly enabled: boolean;
  readonly mechanicFamily: string;
  readonly cpuResolver: 'shared-legal-command-policy' | 'no-decision-required' | 'disabled';
  readonly decisionKinds: readonly string[];
  readonly ruleEvidence: readonly string[];
  readonly testIds: readonly string[];
  readonly inheritsMechanicFrom?: string;
  readonly blocker?: 'unverified-effect-semantics';
};

const additionalMechanics: Readonly<Record<string, { readonly family: string; readonly decisions: readonly string[]; readonly testId: string }>> = {
  'custom:adventurer/mage-06': { family: 'combat/optional-nonparticipant-assist', decisions: [], testId: 'custom-mage-06-halves-combat-and-is-removed' },
  'custom:adventurer/melee-07': { family: 'dice/turn-card-combat-multiplier', decisions: [], testId: 'custom-melee-07-combat-multiplier' },
  'custom:adventurer/support-06': { family: 'party/choose-order', decisions: ['choose-order'], testId: 'custom-support-06-party-order' },
  'custom:adventurer/ranged-03': { family: 'combat/reserve-contribution', decisions: [], testId: 'custom-ranged-03-reserve-combat' },
  'custom:adventurer/ranged-05': { family: 'item/repeat-use-effect', decisions: ['choose-effect-option'], testId: 'custom-ranged-05-repeat-item' },
  'custom:adventurer/mage-07': { family: 'party/profession-threshold-aura', decisions: [], testId: 'custom-profession-threshold-aura' },
  'custom:adventurer/tank-06': { family: 'party/public-enemy-combat-tier', decisions: [], testId: 'custom-tank-06-public-monster-combat-tier' },
  'custom:adventurer/tank-07': { family: 'combat/once-per-turn-departure-replacement', decisions: ['choose-party-member'], testId: 'custom-tank-07-stay-after-combat' },
  'custom:adventurer/support-09': { family: 'helper/optional-rotation-on-entry', decisions: ['choose-effect-option'], testId: 'custom-support-09-rotate-helper' },
  'custom:adventurer/tank-09': { family: 'party/profession-threshold-aura', decisions: [], testId: 'custom-profession-threshold-aura' },
  'custom:adventurer/tank-10': { family: 'no-special-effect', decisions: [], testId: 'custom-no-special-effect' },
  'custom:adventurer/support-10': { family: 'no-special-effect', decisions: [], testId: 'custom-no-special-effect' },
  'custom:adventurer/ranged-06': { family: 'no-special-effect', decisions: [], testId: 'custom-no-special-effect' },
};

const baseCapabilitiesById = new Map(
  baseProvisionalOriginalFullCapabilityMatrix.map((entry) => [entry.contentId, entry]),
);

export const customAdventurerCapabilityMatrix: readonly CustomAdventurerCapabilityEntry[] = customCardRows
  .filter(([id]) => id.startsWith('custom:adventurer/'))
  .map(([contentId, , , , , , effectStatus, inheritsMechanicFrom]) => {
    const additional = additionalMechanics[contentId];
    const inherited = inheritsMechanicFrom ? baseCapabilitiesById.get(inheritsMechanicFrom) : undefined;
    const decisionKinds = inherited?.decisionKinds ?? additional?.decisions ?? [];
    return {
      contentId,
      effectStatus,
      enabled: effectStatus === 'enabled' || effectStatus === 'none',
      mechanicFamily: inheritsMechanicFrom ? `base-mechanic:${inheritsMechanicFrom}` : additional?.family ?? 'blocked/unverified-semantics',
      cpuResolver: effectStatus === 'blocked'
        ? 'disabled' as const
        : effectStatus === 'none' || (!inheritsMechanicFrom && decisionKinds.length === 0)
          ? 'no-decision-required' as const
          : 'shared-legal-command-policy' as const,
      decisionKinds,
      ruleEvidence: [
        'docs/card-data/自定義冒險者格式化資料.md',
        ...(effectStatus === 'blocked' || effectStatus === 'none' ? [] : ['packages/content-custom-adventurers-rules/src/index.ts']),
        ...(inheritsMechanicFrom ? ['packages/content-base-rules/src/index.ts'] : []),
      ],
      testIds: inheritsMechanicFrom
        ? [...(inherited?.testIds ?? []), 'content-custom-adventurers-rules:base-mechanic-bindings']
        : [additional?.testId ?? 'custom-blocked-semantics'],
      ...(inheritsMechanicFrom ? { inheritsMechanicFrom } : {}),
      ...(effectStatus === 'blocked' ? { blocker: 'unverified-effect-semantics' as const } : {}),
    };
  });
