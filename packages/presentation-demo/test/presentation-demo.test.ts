import {
  createPresentationAssetRegistry,
  validatePresentationAssetManifest,
  validatePresentationPack,
} from '@guildmaster/presentation-core';
import { describe, expect, it } from 'vitest';
import {
  demoPresentationAssetKeys,
  demoPresentationAssetManifest,
  demoPresentationPack,
} from '../src/index.js';

describe('demo presentation package', () => {
  it('provides a valid complete demo Presentation Pack with stable unique asset keys', () => {
    expect(validatePresentationPack(demoPresentationPack)).toEqual({ valid: true, errors: [] });
    expect(demoPresentationPack.entries).toHaveLength(18);
    expect(new Set(demoPresentationAssetKeys)).toHaveLength(18);
    expect(demoPresentationAssetKeys.every((key) => key.startsWith('demo:'))).toBe(true);
  });

  it('allows an approved asset manifest to cover none or part of the presentation pack', () => {
    expect(validatePresentationAssetManifest(demoPresentationAssetManifest)).toEqual({ valid: true, errors: [] });
    const registry = createPresentationAssetRegistry(demoPresentationAssetManifest, {
      expectedAssetKeys: demoPresentationAssetKeys,
    });
    expect(registry.resolveAsset(demoPresentationAssetKeys[0]!)).toBeUndefined();
    expect(registry.diagnostics).toHaveLength(18);
    expect(registry.diagnostics).toEqual([...registry.diagnostics].sort());
  });

  it('keeps the manifest JSON-only', () => {
    expect(JSON.parse(JSON.stringify(demoPresentationAssetManifest))).toEqual(demoPresentationAssetManifest);
  });
});
