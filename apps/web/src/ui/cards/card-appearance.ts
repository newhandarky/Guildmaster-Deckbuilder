import type { CardIconKey } from './card-icons.js';

export type CardAppearance = 'adventurer' | 'boss' | 'enemy' | 'item' | 'equipment' | 'helper' | 'bond' | 'standard';
export type ProfessionKey = 'melee' | 'tank' | 'ranged' | 'mage' | 'support';

export const professionPresentation: Readonly<Record<ProfessionKey, { label: string; iconKey: CardIconKey }>> = {
  melee: { label: '近戰', iconKey: 'profession-melee' },
  tank: { label: '坦克', iconKey: 'profession-tank' },
  ranged: { label: '遠程', iconKey: 'profession-ranged' },
  mage: { label: '法師', iconKey: 'profession-mage' },
  support: { label: '輔助', iconKey: 'profession-support' },
};

const appearanceByCardType: Readonly<Record<string, CardAppearance>> = {
  adventurer: 'adventurer',
  boss: 'boss',
  monster: 'enemy',
  item: 'item',
  equipment: 'equipment',
  helper: 'helper',
  bond: 'bond',
};

const typeIconByAppearance: Readonly<Record<CardAppearance, CardIconKey>> = {
  adventurer: 'card-type-standard',
  boss: 'card-type-boss',
  enemy: 'card-type-enemy',
  item: 'card-type-item',
  equipment: 'card-type-equipment',
  helper: 'card-type-helper',
  bond: 'card-type-bond',
  standard: 'card-type-standard',
};

export function appearanceForCardType(cardType: string): CardAppearance {
  return Object.hasOwn(appearanceByCardType, cardType)
    ? appearanceByCardType[cardType] ?? 'standard'
    : 'standard';
}

export function professionFromTags(tags: readonly string[]): ProfessionKey | undefined {
  for (const tag of tags) {
    const token = tag.match(/^profession:(.+)$/)?.[1];
    if (token && Object.hasOwn(professionPresentation, token)) return token as ProfessionKey;
  }
  return undefined;
}

export function typeIconFor(cardType: string, appearance: CardAppearance, profession: ProfessionKey | undefined): CardIconKey {
  if (profession) return professionPresentation[profession].iconKey;
  if (cardType === 'starter') return 'card-type-starter';
  return typeIconByAppearance[appearance];
}
