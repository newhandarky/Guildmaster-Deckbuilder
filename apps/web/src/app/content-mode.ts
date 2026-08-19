import { baseProvisionalFoundationContentPack, baseProvisionalOriginalFullContentPack } from '@guildmaster/content-base/runtime';
import { customAdventurerContentPackId } from '@guildmaster/content-custom-adventurers';

export type WebContentMode = 'demo' | 'provisional-playtest' | 'provisional-original-full' | 'custom-adventurers-full';

/** Derives the UI mode from authoritative Content Pack identity, independent of session construction. */
export function webContentModeFromPackIds(packIds: readonly string[]): WebContentMode {
  if (packIds.includes(customAdventurerContentPackId)) return 'custom-adventurers-full';
  if (packIds.includes(baseProvisionalOriginalFullContentPack.manifest.id)) return 'provisional-original-full';
  return packIds.includes(baseProvisionalFoundationContentPack.manifest.id) ? 'provisional-playtest' : 'demo';
}
