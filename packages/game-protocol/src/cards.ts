export type CardType = string;
export type CardDefinition = { id: string; name: string; type: CardType; copies: number; cost?: number; combat?: number; purchasePower?: number; honor?: number; itemEffect?: 'purchase+2' | 'combat+2'; source: string; tags?: string[] };
export type CardInstance = { id: string; definitionId: string; ownerId?: string; state?: Record<string, unknown> };
export type PackManifest = { id: string; version: string; hash: string; role?: 'base' | 'expansion'; contentStatus?: 'demo' | 'provisional-playtest' | 'official-audited'; dependencies?: readonly string[]; conflicts?: readonly string[]; compatibleRuleset?: { min: string; max?: string } };
export type ReplacementDeclaration = { replacementDefinitionId: string; replacesDefinitionId: string; priority?: number };
/** Legacy starter setup repeats one adventurer definition five times. */
export type RepeatedStarterSetup = { adventurerDefinitionId: string; summonStoneDefinitionId: string; crystalDefinitionId: string };
/** A rules-defined setup may put distinct card definitions directly into the starting party. */
export type ExplicitStarterSetup = { partyDefinitionIds: readonly string[]; summonStoneDefinitionId: string; crystalDefinitionId: string };
export type StarterSetup = RepeatedStarterSetup | ExplicitStarterSetup;
export type ContentPack = { manifest: PackManifest; definitions: readonly CardDefinition[]; replacements?: readonly ReplacementDeclaration[]; starter?: StarterSetup; bonds?: readonly { id: string; name: string; honor: number; requiredBosses: number }[]; rulesModuleIds?: readonly string[] };
export type ContentRegistry = { packs: readonly PackManifest[]; definitions: Readonly<Record<string, CardDefinition>>; starter: NonNullable<ContentPack['starter']>; bonds: NonNullable<ContentPack['bonds']>; replacementMap: Readonly<Record<string, string>> };
