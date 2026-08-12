import type { CardDefinition, ContentPack, EffectNode, PlayerDecisionKind } from '@guildmaster/game-protocol';
import { baseProvisionalFoundationContentPack } from './provisional-foundation-pack.js';

const source = 'provisional-original-full-playtest';
const pad = (value: number) => String(value).padStart(2, '0');
const disabled = ['playtest:effects-disabled', 'project-policy:digital-copy-count'];
const enabledFoundationIds = new Set(['resource-01', 'resource-04', 'resource-05', 'resource-08', 'resource-10', 'resource-13', 'resource-15', 'resource-17', 'resource-18', 'resource-27']);
const foundationById = new Map(baseProvisionalFoundationContentPack.definitions.map((definition) => [definition.id, definition]));

const starters: CardDefinition[] = [
  ['support', 1], ['melee', 2], ['mage', 1], ['tank', 1], ['ranged', 1],
].map(([profession, combat], index) => ({ id: `base:starter/adventurer-${pad(index + 1)}`, name: `候選起始冒險者 ${pad(index + 1)}`, type: 'starter', copies: 1, source, tags: [`profession:${profession}`], combat: combat as number }));
starters.push(
  { id: 'base:starter/summoning-stone', name: '候選起始資源 A', type: 'starter', copies: 1, source, purchasePower: 1 },
  { id: 'base:starter/spirit-crystal', name: '候選起始資源 B', type: 'starter', copies: 1, source, honor: 1 },
);

const adventurerStats: readonly [number, number, number, string][] = [
  [4,2,2,'support'],[3,3,2,'melee'],[4,3,1,'mage'],[4,2,2,'tank'],[3,1,1,'support'],[4,2,2,'melee'],[3,2,1,'ranged'],[3,2,1,'melee'],[3,1,1,'tank'],[4,2,2,'melee'],
  [4,1,1,'mage'],[3,2,2,'tank'],[4,1,1,'support'],[4,0,1,'melee'],[3,2,1,'ranged'],[4,3,2,'tank'],[3,1,1,'support'],[4,2,2,'melee'],[4,2,2,'mage'],[3,5,1,'mage'],
  [4,3,2,'melee'],[3,1,1,'tank'],[3,1,1,'mage'],[3,1,1,'melee'],[3,1,1,'tank'],[4,3,2,'ranged'],[3,1,1,'support'],[3,1,1,'support'],[4,1,1,'mage'],[5,0,3,'support'],
];
const adventurers: CardDefinition[] = adventurerStats.map(([cost, combat, honor, profession], index) => ({ id: `base:adventurer/adventurer-${pad(index + 1)}`, name: `候選冒險者 ${pad(index + 1)}`, type: 'adventurer', copies: 2, source, tags: [`profession:${profession}`, ...disabled], cost, combat, honor }));

const resourceStats: readonly ['item' | 'equipment', number][] = [
  ['item',3],['equipment',3],['equipment',3],['item',2],['item',3],['item',1],['equipment',3],['item',4],['equipment',5],['item',3],['equipment',6],['equipment',5],['item',3],['equipment',3],
  ['item',4],['equipment',6],['item',4],['equipment',4],['equipment',4],['equipment',5],['equipment',4],['item',3],['item',4],['equipment',4],['equipment',5],['item',4],['item',5],['item',3],
];
const resources: CardDefinition[] = resourceStats.map(([type, cost], index) => {
  const suffix = `resource-${pad(index + 1)}`;
  const audited = foundationById.get(`base:resource/${suffix}`);
  const effectEnabled = enabledFoundationIds.has(suffix) ? audited : undefined;
  return {
    id: `base:resource/${suffix}`, name: `候選物資 ${pad(index + 1)}`, type,
    copies: index < 3 ? 3 : 2, source, cost,
    tags: [...(audited?.tags?.filter((tag) => tag.startsWith('affinity:')) ?? []), effectEnabled ? 'playtest:effect-enabled' : 'playtest:effects-disabled', 'project-policy:digital-copy-count'],
    ...(effectEnabled?.useEffect ? { useEffect: structuredClone(effectEnabled.useEffect) } : {}),
    ...(effectEnabled?.equipmentEventTriggers ? { equipmentEventTriggers: structuredClone(effectEnabled.equipmentEventTriggers) } : {}),
  };
});

const monsterStats: readonly [number, number, number][] = [[5,2,1],[5,2,5],[6,2,5],[5,2,4],[4,1,2],[7,2,5],[5,2,4],[6,2,4],[2,1,2],[4,2,5],[4,2,5],[6,2,4],[4,1,2],[5,1,2]];
const monsters: CardDefinition[] = monsterStats.map(([combat, purchasePower, honor], index) => ({
  id: `base:monster/monster-${pad(index + 1)}`, name: `候選魔物 ${pad(index + 1)}`, type: 'monster',
  copies: index < 4 ? 3 : 2, source, combat, purchasePower, honor,
  tags: [...(index === 0 ? ['base:supply-cycle-anchor'] : []), ...disabled],
}));
const bossStats: readonly [number, number, number][] = [[9,3,10],[9,3,10],[10,3,10],[5,3,10],[9,3,10],[8,3,10],[9,3,8],[9,3,8],[8,3,8],[14,3,8],[6,3,8]];
const bosses: CardDefinition[] = bossStats.map(([combat, purchasePower, honor], index) => ({ id: `base:boss/boss-${pad(index + 1)}`, name: `候選魔王 ${pad(index + 1)}`, type: 'boss', copies: 1, source, combat, purchasePower, honor, tags: disabled }));
const bondHonor = [4,4,3,3,3,3,4,4,4,4,5,5,4,6,5,5,7,5,5,5,5,4,6,3,4,4,4,4,4,4];

export const baseProvisionalOriginalFullContentPack: ContentPack = {
  manifest: { id: 'base:provisional-original-full', version: '0.2.0', hash: 'base-provisional-original-full-v2-explicit-decisions-capability-gate', role: 'base', contentStatus: 'provisional-playtest' },
  definitions: [...starters, ...adventurers, ...resources, ...monsters, ...bosses],
  starter: { partyDefinitionIds: starters.slice(0, 5).map(({ id }) => id), summonStoneDefinitionId: 'base:starter/summoning-stone', crystalDefinitionId: 'base:starter/spirit-crystal' },
  bonds: bondHonor.map((honor, index) => ({ id: `base:bond/bond-${pad(index + 1)}`, name: `候選羈絆 ${pad(index + 1)}`, honor, requiredBosses: 99 })),
};

export type FullProvisionalCapabilityEntry = {
  contentId: string; contentKind: 'definition' | 'bond'; evidenceStatus: 'visual-provisional' | 'project-policy'; evidenceReference: string; copyPolicy: string;
  effectStatus: 'enabled' | 'blocked'; requiredCapabilities: readonly string[]; decisionKinds: readonly string[];
  effectPaths: readonly string[]; cpuResolver: string; testIds: readonly string[]; blocker?: 'unverified-effect-semantics' | 'unverified-bond-condition';
};
export const baseProvisionalOriginalFullCapabilityRegistry = {
  engineCapabilities: ['effect-ast', 'snapshot-continuation', 'equipment-event-lifecycle', 'typed-player-view-choice'] as const,
  cpuResolvers: ['base:cpu-balanced/effect-card-choice', 'base:cpu-balanced/legal-command-scoring', 'base:cpu-balanced/keep-bonds', 'none-effect-disabled'] as const,
  testIds: ['content:provisional-foundation-pack', 'content:provisional-original-full-roster', 'engine:card-use-effect', 'engine:post-command-pipeline', 'engine:bond-setup', 'cpu:deterministic-choice', 'cpu:deterministic-legal-scoring', 'cpu:keep-bonds'] as const,
};

function effectChoices(node: EffectNode, path = '$'): { path: string; decisionKind?: PlayerDecisionKind }[] {
  if (node.kind === 'choice') return [{ path, ...(node.decisionKind ? { decisionKind: node.decisionKind } : {}) }, ...node.options.flatMap((option, index) => effectChoices(option.effect, `${path}.options[${index}]`))];
  if (node.kind === 'choose-card') return [{ path, ...(node.decisionKind ? { decisionKind: node.decisionKind } : {}) }, ...effectChoices(node.effect, `${path}.effect`)];
  if (node.kind === 'sequence') return node.effects.flatMap((effect, index) => effectChoices(effect, `${path}.effects[${index}]`));
  if (node.kind === 'conditional') return [...effectChoices(node.whenTrue, `${path}.whenTrue`), ...(node.whenFalse ? effectChoices(node.whenFalse, `${path}.whenFalse`) : [])];
  if (node.kind === 'random' || node.kind === 'roll-die') return node.outcomes.flatMap((outcome, index) => effectChoices(outcome.effect, `${path}.outcomes[${index}]`));
  if (node.kind === 'request-counter-consent') return Object.entries(node.outcomes).flatMap(([outcome, effect]) => effectChoices(effect, `${path}.outcomes.${outcome}`));
  return [];
}

const definitionCapabilities = baseProvisionalOriginalFullContentPack.definitions.map((definition): FullProvisionalCapabilityEntry => {
  const enabled = definition.tags?.includes('playtest:effect-enabled') ?? false;
  const roots = [definition.useEffect?.body, ...(definition.equipmentEventTriggers ?? []).map(({ effect }) => effect.body)].filter((node): node is EffectNode => node !== undefined);
  const choices = roots.flatMap((node, index) => effectChoices(node, `$effects[${index}]`));
  const hasChoice = choices.length > 0;
  const requiredCapabilities = enabled
    ? ['effect-ast', 'snapshot-continuation', ...(definition.equipmentEventTriggers ? ['equipment-event-lifecycle'] : []), ...(hasChoice ? ['typed-player-view-choice'] : [])]
    : [];
  return {
    contentId: definition.id,
    contentKind: 'definition',
    evidenceStatus: definition.tags?.includes('project-policy:digital-copy-count') ? 'project-policy' : 'visual-provisional',
    evidenceReference: enabled ? `foundation-audit:${definition.id}` : `visual-roster:${definition.id}`,
    copyPolicy: definition.type === 'adventurer' ? 'project-policy:2-each' : definition.type === 'monster' ? 'project-policy:32-card-distribution' : definition.type === 'item' || definition.type === 'equipment' ? 'project-policy:59-card-distribution' : 'visual-provisional',
    effectStatus: enabled ? 'enabled' : 'blocked',
    requiredCapabilities,
    decisionKinds: choices.flatMap(({ decisionKind }) => decisionKind ? [decisionKind] : []),
    effectPaths: choices.map(({ path }) => path),
    cpuResolver: enabled ? (hasChoice ? 'base:cpu-balanced/effect-card-choice' : 'base:cpu-balanced/legal-command-scoring') : 'none-effect-disabled',
    testIds: enabled ? ['content:provisional-foundation-pack', definition.equipmentEventTriggers ? 'engine:post-command-pipeline' : 'engine:card-use-effect', hasChoice ? 'cpu:deterministic-choice' : 'cpu:deterministic-legal-scoring'] : ['content:provisional-original-full-roster'],
    ...(!enabled ? { blocker: 'unverified-effect-semantics' as const } : {}),
  };
});

const bondCapabilities = (baseProvisionalOriginalFullContentPack.bonds ?? []).map((bond): FullProvisionalCapabilityEntry => ({
  contentId: bond.id,
  contentKind: 'bond',
  evidenceStatus: 'visual-provisional',
  evidenceReference: `visual-roster:${bond.id}`,
  copyPolicy: 'visual-provisional:1-each',
  effectStatus: 'blocked',
  requiredCapabilities: [],
  decisionKinds: ['keep-bonds'],
  effectPaths: [],
  cpuResolver: 'base:cpu-balanced/keep-bonds',
  testIds: ['content:provisional-original-full-roster', 'engine:bond-setup', 'cpu:keep-bonds'],
  blocker: 'unverified-bond-condition',
}));

/** Machine-readable gate: roster completeness is intentionally separate from verified effect completeness. */
export const baseProvisionalOriginalFullCapabilityMatrix: readonly FullProvisionalCapabilityEntry[] = [...definitionCapabilities, ...bondCapabilities];
