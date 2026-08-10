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
  provisionalFoundationPresentationPack,
} from '../src/index.js';

describe('demo presentation package', () => {
  it('provides a valid complete demo Presentation Pack with stable unique asset keys', () => {
    expect(validatePresentationPack(demoPresentationPack)).toEqual({ valid: true, errors: [] });
    expect(demoPresentationPack.entries).toHaveLength(18);
    expect(new Set(demoPresentationAssetKeys)).toHaveLength(18);
    expect(demoPresentationAssetKeys.every((key) => key.startsWith('demo:'))).toBe(true);
  });

  it('provides explicit neutral copy for enabled and disabled provisional resources', () => {
    expect(validatePresentationPack(provisionalFoundationPresentationPack)).toEqual({ valid: true, errors: [] });
    expect(provisionalFoundationPresentationPack.entries).toEqual([
      expect.objectContaining({ definitionId: 'base:resource/resource-02', shortDisplayText: expect.stringContaining('尚未啟用') }),
      expect.objectContaining({ definitionId: 'base:resource/resource-08', shortDisplayText: '使用：抽 2 張牌。' }),
      expect.objectContaining({ definitionId: 'base:resource/resource-10', shortDisplayText: expect.stringContaining('棄 1 張手牌') }),
      expect.objectContaining({ definitionId: 'base:resource/resource-17', shortDisplayText: expect.stringContaining('抽 3 張牌') }),
    ]);
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
