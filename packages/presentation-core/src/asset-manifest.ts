import type { PresentationAssetSource } from './resolver.js';

export type PresentationAssetVariant = {
  width: 384 | 768;
  height: 512 | 1024;
  format: 'webp';
  path: string;
  sha256: string;
};

export type PresentationAssetProvenance = {
  origin: 'original' | 'ai-generated' | 'licensed';
  createdOn: string;
  tool: string;
  model: string;
  briefVersion: string;
  referenceSources: string;
  license: string;
  humanReview: {
    status: 'approved';
    reviewedBy: string;
    reviewedOn: string;
  };
};

export type PresentationAssetRecord = {
  key: string;
  objectPosition?: string;
  variants: readonly PresentationAssetVariant[];
  provenance: PresentationAssetProvenance;
};

export type PresentationAssetManifest = {
  id: string;
  version: string;
  records: readonly PresentationAssetRecord[];
};

export type PresentationAssetValidationResult = {
  valid: boolean;
  errors: readonly string[];
};

export type PresentationAssetRegistry = {
  manifestId: string;
  manifestVersion: string;
  diagnostics: readonly string[];
  resolveAsset(assetKey: string): PresentationAssetSource | undefined;
};

export type PresentationAssetRegistryOptions = {
  publicBasePath?: string;
  expectedAssetKeys?: readonly string[];
};

const manifestKeys = new Set(['id', 'version', 'records']);
const recordKeys = new Set(['key', 'objectPosition', 'variants', 'provenance']);
const variantKeys = new Set(['width', 'height', 'format', 'path', 'sha256']);
const provenanceKeys = new Set([
  'origin',
  'createdOn',
  'tool',
  'model',
  'briefVersion',
  'referenceSources',
  'license',
  'humanReview',
]);
const reviewKeys = new Set(['status', 'reviewedBy', 'reviewedOn']);
const expectedDimensions = new Map([[384, 512], [768, 1024]]);
const sha256Pattern = /^[a-f0-9]{64}$/;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const supportedManifestVersionPattern = /^1\.\d+\.\d+$/;
const objectPositionPattern = /^(?:100|[1-9]?\d)% (?:100|[1-9]?\d)%$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function unknownKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): string[] {
  return Object.keys(value).filter((key) => !allowed.has(key));
}

function requireString(value: unknown, path: string, errors: string[]): value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${path} must be a non-empty string.`);
    return false;
  }
  return true;
}

function validatePath(path: string, label: string, errors: string[]): void {
  const segments = path.split('/');
  if (
    path.startsWith('/')
    || path.includes('\\')
    || segments.some((segment) => segment === '' || segment === '.' || segment === '..')
    || /^[a-z][a-z0-9+.-]*:/i.test(path)
  ) {
    errors.push(`${label} must be a repository-relative path without traversal, URL, or data URI.`);
  }
  if (!/^generated\/cards\/[a-z0-9][a-z0-9/_-]*\.webp$/.test(path)) {
    errors.push(`${label} must be a lowercase WebP path under generated/cards/.`);
  }
}

function isValidIsoDate(value: string): boolean {
  if (!isoDatePattern.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function validateProvenance(value: unknown, label: string, errors: string[]): void {
  if (!isPlainObject(value)) {
    errors.push(`${label} must be a plain object.`);
    return;
  }
  for (const key of unknownKeys(value, provenanceKeys)) errors.push(`${label}.${key} is not allowed.`);
  if (!['original', 'ai-generated', 'licensed'].includes(String(value.origin))) {
    errors.push(`${label}.origin is invalid.`);
  }
  for (const key of ['createdOn', 'tool', 'model', 'briefVersion', 'referenceSources', 'license'] as const) {
    requireString(value[key], `${label}.${key}`, errors);
  }
  if (typeof value.createdOn === 'string' && !isValidIsoDate(value.createdOn)) {
    errors.push(`${label}.createdOn must be a real date using YYYY-MM-DD.`);
  }
  if (!isPlainObject(value.humanReview)) {
    errors.push(`${label}.humanReview must be a plain object.`);
    return;
  }
  for (const key of unknownKeys(value.humanReview, reviewKeys)) errors.push(`${label}.humanReview.${key} is not allowed.`);
  if (value.humanReview.status !== 'approved') errors.push(`${label}.humanReview.status must be approved.`);
  requireString(value.humanReview.reviewedBy, `${label}.humanReview.reviewedBy`, errors);
  if (
    requireString(value.humanReview.reviewedOn, `${label}.humanReview.reviewedOn`, errors)
    && !isValidIsoDate(value.humanReview.reviewedOn)
  ) {
    errors.push(`${label}.humanReview.reviewedOn must be a real date using YYYY-MM-DD.`);
  }
}

export function validatePresentationAssetManifest(manifest: PresentationAssetManifest): PresentationAssetValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(manifest)) {
    return { valid: false, errors: ['Presentation asset manifest must be a plain object.'] };
  }
  for (const key of unknownKeys(manifest, manifestKeys)) errors.push(`manifest.${key} is not allowed.`);
  requireString(manifest.id, 'manifest.id', errors);
  if (
    requireString(manifest.version, 'manifest.version', errors)
    && !supportedManifestVersionPattern.test(manifest.version)
  ) {
    errors.push('manifest.version must be a supported 1.x semantic version.');
  }
  if (!Array.isArray(manifest.records)) {
    errors.push('manifest.records must be an array.');
    return { valid: false, errors };
  }

  const keys = new Set<string>();
  const paths = new Set<string>();
  for (const [recordIndex, rawRecord] of manifest.records.entries()) {
    const label = `manifest.records[${recordIndex}]`;
    if (!isPlainObject(rawRecord)) {
      errors.push(`${label} must be a plain object.`);
      continue;
    }
    for (const key of unknownKeys(rawRecord, recordKeys)) errors.push(`${label}.${key} is not allowed.`);
    if (requireString(rawRecord.key, `${label}.key`, errors)) {
      if (keys.has(rawRecord.key)) errors.push(`${label}.key duplicates ${rawRecord.key}.`);
      keys.add(rawRecord.key);
    }
    if (
      rawRecord.objectPosition !== undefined
      && (typeof rawRecord.objectPosition !== 'string' || !objectPositionPattern.test(rawRecord.objectPosition))
    ) {
      errors.push(`${label}.objectPosition must contain two percentages from 0% to 100%.`);
    }
    validateProvenance(rawRecord.provenance, `${label}.provenance`, errors);
    if (!Array.isArray(rawRecord.variants)) {
      errors.push(`${label}.variants must be an array.`);
      continue;
    }
    if (rawRecord.variants.length !== 2) errors.push(`${label}.variants must contain exactly the 384px and 768px WebP variants.`);
    const widths = new Set<number>();
    for (const [variantIndex, rawVariant] of rawRecord.variants.entries()) {
      const variantLabel = `${label}.variants[${variantIndex}]`;
      if (!isPlainObject(rawVariant)) {
        errors.push(`${variantLabel} must be a plain object.`);
        continue;
      }
      for (const key of unknownKeys(rawVariant, variantKeys)) errors.push(`${variantLabel}.${key} is not allowed.`);
      const expectedHeight = expectedDimensions.get(Number(rawVariant.width));
      if (!expectedHeight || rawVariant.height !== expectedHeight) {
        errors.push(`${variantLabel} must be either 384x512 or 768x1024.`);
      }
      if (typeof rawVariant.width === 'number') {
        if (widths.has(rawVariant.width)) errors.push(`${variantLabel}.width duplicates ${rawVariant.width}.`);
        widths.add(rawVariant.width);
      }
      if (rawVariant.format !== 'webp') errors.push(`${variantLabel}.format must be webp.`);
      if (requireString(rawVariant.path, `${variantLabel}.path`, errors)) {
        validatePath(rawVariant.path, `${variantLabel}.path`, errors);
        if (paths.has(rawVariant.path)) errors.push(`${variantLabel}.path duplicates ${rawVariant.path}.`);
        paths.add(rawVariant.path);
      }
      if (typeof rawVariant.sha256 !== 'string' || !sha256Pattern.test(rawVariant.sha256)) {
        errors.push(`${variantLabel}.sha256 must be a lowercase SHA-256 digest.`);
      }
    }
    if (!widths.has(384) || !widths.has(768)) {
      errors.push(`${label}.variants must include widths 384 and 768.`);
    }
  }
  return { valid: errors.length === 0, errors };
}

function publicPath(base: string, path: string): string {
  const normalizedBase = base === '' ? '' : `/${base.replace(/^\/+|\/+$/g, '')}`;
  return `${normalizedBase}/${path}`;
}

export function createPresentationAssetRegistry(
  manifest: PresentationAssetManifest,
  options: PresentationAssetRegistryOptions = {},
): PresentationAssetRegistry {
  const validation = validatePresentationAssetManifest(manifest);
  if (!validation.valid) {
    throw new Error(`Invalid Presentation asset manifest:\n${validation.errors.join('\n')}`);
  }
  const records = new Map(manifest.records.map((record) => [record.key, record]));
  const expected = [...new Set(options.expectedAssetKeys ?? [])].sort();
  const diagnostics = expected
    .filter((key) => !records.has(key))
    .map((key) => `Missing approved presentation asset: ${key}`);
  return {
    manifestId: manifest.id,
    manifestVersion: manifest.version,
    diagnostics,
    resolveAsset(assetKey) {
      const record = records.get(assetKey);
      if (!record) return undefined;
      const variants = [...record.variants].sort((left, right) => left.width - right.width);
      const largest = variants.at(-1);
      if (!largest) return undefined;
      const base = options.publicBasePath ?? '';
      return {
        src: publicPath(base, largest.path),
        srcSet: variants.map((variant) => `${publicPath(base, variant.path)} ${variant.width}w`).join(', '),
        width: largest.width,
        height: largest.height,
        objectPosition: record.objectPosition ?? '50% 50%',
      };
    },
  };
}
