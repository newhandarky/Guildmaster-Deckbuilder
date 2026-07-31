/**
 * Presentation data is intentionally not part of a Content Pack.  The stable
 * definitionId is the only bridge to game content; no presentation field may
 * be read by rules, snapshots, replays, AI, or network authority.
 */
export type PresentationManifest = {
  id: string;
  version: string;
  theme: string;
  locale: string;
  /** Optional content hashes this pack was authored against. Empty means any. */
  compatibleContentHashes?: readonly string[];
};

export type PresentationEntry = {
  definitionId: string;
  displayName: string;
  portraitAssetKey: string;
  portraitAltText: string;
  shortDisplayText: string;
  detailDisplayText: string;
  variant?: string;
  theme?: string;
  locale?: string;
};

export type PresentationPack = {
  manifest: PresentationManifest;
  entries: readonly PresentationEntry[];
};

export type PresentationPreferences = {
  presentationPackId?: string;
  theme?: string;
  locale?: string;
  variant?: string;
};

export type PresentationViewModel = {
  definitionId: string;
  displayName: string;
  portraitAssetKey: string;
  portraitAsset: {
    key: string;
    altText: string;
    src?: string;
    srcSet?: string;
    width?: number;
    height?: number;
    objectPosition?: string;
  };
  shortDisplayText: string;
  detailDisplayText: string;
  source: 'pack' | 'fallback';
  presentationPackId?: string;
  presentationVersion?: string;
};

export type PresentationValidationResult = { valid: boolean; errors: readonly string[] };

const manifestKeys = new Set(['id', 'version', 'theme', 'locale', 'compatibleContentHashes']);
const entryKeys = new Set(['definitionId', 'displayName', 'portraitAssetKey', 'portraitAltText', 'shortDisplayText', 'detailDisplayText', 'variant', 'theme', 'locale']);

function unknownKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): string[] {
  return Object.keys(value).filter((key) => !allowed.has(key));
}
function isPlainObject(value: unknown): value is Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) return false; const prototype = Object.getPrototypeOf(value); return prototype === Object.prototype || prototype === null; }

export function validatePresentationPack(pack: PresentationPack): PresentationValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(pack)) return { valid: false, errors: ['Presentation Pack must be a plain object.'] };
  const manifest = pack.manifest as unknown as Record<string, unknown>;
  if (!manifest || typeof manifest !== 'object') errors.push('manifest is required.');
  else {
    for (const key of unknownKeys(manifest, manifestKeys)) errors.push(`manifest.${key} is not allowed.`);
    for (const key of ['id', 'version', 'theme', 'locale'] as const) if (typeof manifest[key] !== 'string' || manifest[key].trim() === '') errors.push(`manifest.${key} must be a non-empty string.`);
    if (manifest.compatibleContentHashes !== undefined && (!Array.isArray(manifest.compatibleContentHashes) || manifest.compatibleContentHashes.some((hash) => typeof hash !== 'string'))) errors.push('manifest.compatibleContentHashes must be a string array.');
  }
  if (!Array.isArray(pack.entries)) errors.push('entries must be an array.');
  else {
    const definitionIds = new Set<string>();
    for (const [index, entry] of pack.entries.entries()) {
      if (!isPlainObject(entry)) { errors.push(`entries[${index}] must be a plain object.`); continue; }
      const candidate = entry as unknown as Record<string, unknown>;
      for (const key of unknownKeys(candidate, entryKeys)) errors.push(`entries[${index}].${key} is not allowed.`);
      for (const key of ['definitionId', 'displayName', 'portraitAssetKey', 'portraitAltText', 'shortDisplayText', 'detailDisplayText'] as const) if (typeof candidate[key] !== 'string' || candidate[key].trim() === '') errors.push(`entries[${index}].${key} must be a non-empty string.`);
      if (typeof candidate.definitionId === 'string') {
        if (definitionIds.has(candidate.definitionId)) errors.push(`entries[${index}].definitionId duplicates ${candidate.definitionId}.`);
        definitionIds.add(candidate.definitionId);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}
