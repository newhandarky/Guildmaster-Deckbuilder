import { validatePresentationPack, type PresentationPack, type PresentationPreferences, type PresentationViewModel } from './schema.js';

export type PresentationAssetSource = { src: string; width?: number; height?: number };
export type PresentationResolverOptions = {
  contentHash?: string;
  /** Client-only mapping from a stable pack asset key to a deployable asset. */
  resolveAsset?: (assetKey: string) => PresentationAssetSource | undefined;
};

export type PresentationResolver = {
  resolve(definitionId: string, preferences?: PresentationPreferences): PresentationViewModel;
  diagnostics: readonly string[];
};

function fallback(definitionId: string): PresentationViewModel {
  return {
    definitionId,
    displayName: `中性卡牌 ${definitionId.split('/').at(-1) ?? definitionId}`,
    portraitAssetKey: 'placeholder:neutral-card',
    portraitAsset: { key: 'placeholder:neutral-card', altText: '中性卡牌圖像 placeholder' },
    shortDisplayText: '原創文字 placeholder；不影響遊戲規則。',
    detailDisplayText: '尚未提供此卡牌的詳細視覺說明。',
    source: 'fallback',
  };
}

function isCompatible(pack: PresentationPack, contentHash: string | undefined): boolean {
  const hashes = pack.manifest.compatibleContentHashes;
  return !hashes || hashes.length === 0 || (contentHash !== undefined && hashes.includes(contentHash));
}

function score(pack: PresentationPack, entry: PresentationPack['entries'][number], preferences: PresentationPreferences): number {
  let value = 0;
  if (preferences.presentationPackId === pack.manifest.id) value += 32;
  if (preferences.theme && (entry.theme ?? pack.manifest.theme) === preferences.theme) value += 8;
  if (preferences.locale && (entry.locale ?? pack.manifest.locale) === preferences.locale) value += 4;
  if (preferences.variant && entry.variant === preferences.variant) value += 2;
  return value;
}

/** A client-only resolver. It does not retain or mutate authoritative game state. */
export function createPresentationResolver(packs: readonly PresentationPack[], options: PresentationResolverOptions = {}): PresentationResolver {
  const diagnostics: string[] = [];
  const usable = packs.filter((pack) => {
    const validation = validatePresentationPack(pack);
    if (!validation.valid) {
      diagnostics.push(...validation.errors.map((error) => `${pack?.manifest?.id ?? 'unknown'}: ${error}`));
      return false;
    }
    if (!isCompatible(pack, options.contentHash)) {
      diagnostics.push(`${pack.manifest.id}: incompatible with active content hash.`);
      return false;
    }
    return true;
  });
  return {
    diagnostics,
    resolve(definitionId, preferences = {}) {
      const matches = usable.flatMap((pack) => pack.entries.filter((entry) => entry.definitionId === definitionId).map((entry) => ({ pack, entry })));
      if (matches.length === 0) return fallback(definitionId);
      matches.sort((left, right) => score(right.pack, right.entry, preferences) - score(left.pack, left.entry, preferences));
      const chosen = matches[0];
      if (!chosen) return fallback(definitionId);
      const { pack, entry } = chosen;
      const asset = options.resolveAsset?.(entry.portraitAssetKey);
      return {
        definitionId,
        displayName: entry.displayName,
        portraitAssetKey: entry.portraitAssetKey,
        portraitAsset: { key: entry.portraitAssetKey, altText: entry.portraitAltText, ...(asset ?? {}) },
        shortDisplayText: entry.shortDisplayText,
        detailDisplayText: entry.detailDisplayText,
        source: 'pack',
        presentationPackId: pack.manifest.id,
        presentationVersion: pack.manifest.version
      };
    },
  };
}
