import { describe, expect, it } from 'vitest';
import {
  createPresentationAssetRegistry,
  validatePresentationAssetManifest,
  type PresentationAssetManifest,
} from '../src/index.js';

const digest = 'a'.repeat(64);
type MutableFixture = {
  version: string;
  extra?: boolean;
  records: Array<{
    key: string;
    objectPosition?: string;
    variants: Array<{ width: number; height: number; format: string; path: string; sha256: string }>;
    provenance: {
      createdOn: string;
      license: string;
      humanReview: { status: string };
    };
  }>;
};
const validManifest = (): PresentationAssetManifest => ({
  id: 'presentation-assets:test',
  version: '1.0.0',
  records: [{
    key: 'demo:adventurer/test',
    objectPosition: '45% 30%',
    variants: [
      { width: 768, height: 1024, format: 'webp', path: 'generated/cards/adventurer/test-768.webp', sha256: digest },
      { width: 384, height: 512, format: 'webp', path: 'generated/cards/adventurer/test-384.webp', sha256: digest },
    ],
    provenance: {
      origin: 'ai-generated',
      createdOn: '2026-07-31',
      tool: 'OpenAI',
      model: 'test-model',
      briefVersion: 'brief-v1',
      referenceSources: 'No external image references.',
      license: 'Project-owned original output.',
      humanReview: { status: 'approved', reviewedBy: 'reviewer', reviewedOn: '2026-07-31' },
    },
  }],
});

describe('Presentation asset manifest', () => {
  it('round-trips as JSON and creates a stable responsive source without mutating input', () => {
    const manifest = validManifest();
    const before = JSON.stringify(manifest);
    expect(validatePresentationAssetManifest(JSON.parse(before))).toEqual({ valid: true, errors: [] });
    const registry = createPresentationAssetRegistry(manifest, {
      publicBasePath: '/assets/',
      expectedAssetKeys: ['demo:adventurer/test', 'demo:missing'],
    });
    expect(registry.resolveAsset('demo:adventurer/test')).toEqual({
      src: '/assets/generated/cards/adventurer/test-768.webp',
      srcSet: '/assets/generated/cards/adventurer/test-384.webp 384w, /assets/generated/cards/adventurer/test-768.webp 768w',
      width: 768,
      height: 1024,
      objectPosition: '45% 30%',
    });
    expect(registry.diagnostics).toEqual(['Missing approved presentation asset: demo:missing']);
    expect(JSON.stringify(manifest)).toBe(before);
  });

  it('uses a centered crop by default and permits partial coverage', () => {
    const manifest = validManifest();
    delete manifest.records[0]!.objectPosition;
    const registry = createPresentationAssetRegistry(manifest);
    expect(registry.resolveAsset('demo:adventurer/test')?.objectPosition).toBe('50% 50%');
    expect(registry.resolveAsset('demo:missing')).toBeUndefined();
  });

  it.each([
    ['unknown field', (manifest: MutableFixture) => { manifest.extra = true; }, 'manifest.extra is not allowed'],
    ['unsupported version', (manifest: MutableFixture) => { manifest.version = '2.0.0'; }, 'supported 1.x semantic version'],
    ['duplicate key', (manifest: MutableFixture) => { manifest.records.push(structuredClone(manifest.records[0]!)); }, 'key duplicates'],
    ['duplicate path', (manifest: MutableFixture) => {
      const duplicate = structuredClone(manifest.records[0]!);
      duplicate.key = 'demo:adventurer/other';
      manifest.records.push(duplicate);
    }, 'path duplicates'],
    ['path traversal', (manifest: MutableFixture) => { manifest.records[0]!.variants[0]!.path = '../escape.webp'; }, 'without traversal'],
    ['empty path segment', (manifest: MutableFixture) => { manifest.records[0]!.variants[0]!.path = 'generated/cards//escape.webp'; }, 'without traversal'],
    ['external URL', (manifest: MutableFixture) => { manifest.records[0]!.variants[0]!.path = 'https://example.com/a.webp'; }, 'without traversal'],
    ['data URI', (manifest: MutableFixture) => { manifest.records[0]!.variants[0]!.path = 'data:image/webp;base64,abc'; }, 'without traversal'],
    ['wrong dimensions', (manifest: MutableFixture) => { manifest.records[0]!.variants[0]!.height = 512; }, '384x512 or 768x1024'],
    ['missing variant', (manifest: MutableFixture) => { manifest.records[0]!.variants.pop(); }, 'exactly the 384px and 768px'],
    ['invalid crop', (manifest: MutableFixture) => { manifest.records[0]!.objectPosition = 'center'; }, 'two percentages'],
    ['unapproved review', (manifest: MutableFixture) => { manifest.records[0]!.provenance.humanReview.status = 'draft'; }, 'must be approved'],
    ['missing rights record', (manifest: MutableFixture) => { manifest.records[0]!.provenance.license = ''; }, 'license must be a non-empty string'],
    ['impossible date', (manifest: MutableFixture) => { manifest.records[0]!.provenance.createdOn = '2026-02-31'; }, 'real date'],
  ])('rejects %s', (_label, mutate, expected) => {
    const manifest = structuredClone(validManifest()) as unknown as MutableFixture;
    mutate(manifest);
    expect(validatePresentationAssetManifest(manifest as unknown as PresentationAssetManifest).errors.join('\n')).toContain(expected);
    expect(() => createPresentationAssetRegistry(manifest as unknown as PresentationAssetManifest)).toThrow('Invalid Presentation asset manifest');
  });

  it('rejects non-plain manifests without throwing during validation', () => {
    expect(validatePresentationAssetManifest(new Date() as unknown as PresentationAssetManifest)).toEqual({
      valid: false,
      errors: ['Presentation asset manifest must be a plain object.'],
    });
  });
});
