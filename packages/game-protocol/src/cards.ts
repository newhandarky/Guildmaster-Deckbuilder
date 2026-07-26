export type CardType = 'adventurer' | 'equipment' | 'item' | 'monster' | 'boss' | 'starter' | 'bond';

export type CardDefinition = {
  id: string;
  name: string;
  type: CardType;
  copies: number;
  cost?: number;
  combat?: number;
  purchasePower?: number;
  honor?: number;
  itemEffect?: 'purchase+2' | 'combat+2';
  source: 'mvp-demo';
};

export type CardInstance = { id: string; definitionId: string; ownerId?: string };

export type ContentPack = {
  manifest: { id: string; version: string; hash: string };
  definitions: readonly CardDefinition[];
  starter: { adventurerDefinitionId: string; summonStoneDefinitionId: string; crystalDefinitionId: string };
  bonds: readonly { id: string; name: string; honor: number; requiredBosses: number }[];
};

export type ContentRegistry = {
  packs: readonly ContentPack['manifest'][];
  definitions: Readonly<Record<string, CardDefinition>>;
  starter: ContentPack['starter'];
  bonds: ContentPack['bonds'];
};
