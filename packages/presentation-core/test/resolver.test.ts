import { describe, expect, it } from 'vitest';
import { createPresentationResolver, neutralPlaceholderPresentationPack, validatePresentationPack, type PresentationPack } from '../src/index.js';

const alternatePack: PresentationPack = { manifest: { id: 'presentation:alternate', version: '1.0.0', theme: 'alternate', locale: 'en' }, entries: [{ definitionId: 'base:starter/newcomer', displayName: 'Alternate starter', portraitAssetKey: 'placeholder:alternate-01', shortDisplayText: 'Alternative client-only text.' }] };

describe('Presentation Pack resolver', () => {
  it('resolves a stable definition ID without accessing game state', () => {
    const resolver = createPresentationResolver([neutralPlaceholderPresentationPack]);
    expect(resolver.resolve('base:starter/newcomer')).toMatchObject({ definitionId: 'base:starter/newcomer', displayName: '起始牌 A', source: 'pack' });
  });

  it('uses a neutral fallback for absent or incompatible packs', () => {
    const incompatible: PresentationPack = { ...alternatePack, manifest: { ...alternatePack.manifest, compatibleContentHashes: ['other-content'] } };
    const resolver = createPresentationResolver([incompatible], { contentHash: 'current-content' });
    expect(resolver.resolve('base:starter/newcomer')).toMatchObject({ source: 'fallback', portraitAssetKey: 'placeholder:neutral-card' });
    expect(resolver.diagnostics).toContain('presentation:alternate: incompatible with active content hash.');
  });

  it('rejects rule-shaped fields and duplicate definition mappings', () => {
    const invalid = { ...alternatePack, entries: [...alternatePack.entries, { ...alternatePack.entries[0], combat: 999 }] } as unknown as PresentationPack;
    const resolver = createPresentationResolver([invalid]);
    expect(resolver.resolve('base:starter/newcomer').source).toBe('fallback');
    expect(resolver.diagnostics.join('\n')).toContain('combat is not allowed');
  });

  it('changing client packs cannot change authoritative state, commands, score, snapshot, or replay', () => {
    const authoritative = Object.freeze({ revision: 7, zones: { hand: ['card-1'] }, legalCommands: [{ type: 'END_PHASE' }], score: [{ playerId: 'p1', honor: 4 }], snapshot: { version: 2 }, replay: [{ command: 'END_PHASE' }] });
    const before = JSON.stringify(authoritative);
    expect(createPresentationResolver([neutralPlaceholderPresentationPack]).resolve('base:starter/newcomer').displayName).not.toBe(createPresentationResolver([alternatePack]).resolve('base:starter/newcomer').displayName);
    expect(JSON.stringify(authoritative)).toBe(before);
  });

  it('allows different clients to choose different presentations for the same authority', () => {
    const clientA = createPresentationResolver([neutralPlaceholderPresentationPack]);
    const clientB = createPresentationResolver([alternatePack]);
    expect(clientA.resolve('base:starter/newcomer').definitionId).toBe(clientB.resolve('base:starter/newcomer').definitionId);
    expect(clientA.resolve('base:starter/newcomer').displayName).not.toBe(clientB.resolve('base:starter/newcomer').displayName);
  });

  it('returns diagnostics instead of throwing for null or primitive entries', () => {
    const invalid = { ...alternatePack, entries: [null, 1] } as unknown as PresentationPack;
    expect(() => validatePresentationPack(invalid)).not.toThrow();
    expect(validatePresentationPack(invalid).valid).toBe(false);
  });

  it('rejects a non-plain pack before inspecting its fields', () => {
    const invalid = new Date() as unknown as PresentationPack;
    expect(validatePresentationPack(invalid)).toEqual({ valid: false, errors: ['Presentation Pack must be a plain object.'] });
  });
});
