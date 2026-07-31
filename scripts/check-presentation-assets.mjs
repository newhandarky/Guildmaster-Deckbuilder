import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeRoot = path.join(repositoryRoot, 'public-assets');
const manifestPath = path.join(repositoryRoot, 'packages', 'presentation-demo', 'assets', 'manifest.json');
const errors = [];

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const seenPaths = new Set();
for (const record of manifest.records ?? []) {
  for (const variant of record.variants ?? []) {
    const filePath = path.resolve(runtimeRoot, variant.path);
    if (!isInside(runtimeRoot, filePath)) {
      errors.push(`${record.key}: ${variant.path} escapes public-assets.`);
      continue;
    }
    if (seenPaths.has(filePath)) errors.push(`${record.key}: ${variant.path} is registered more than once.`);
    seenPaths.add(filePath);
    try {
      const metadata = await sharp(filePath).metadata();
      if (
        metadata.format !== 'webp'
        || metadata.width !== variant.width
        || metadata.height !== variant.height
        || metadata.height * 3 !== metadata.width * 4
      ) {
        errors.push(`${record.key}: ${variant.path} does not match its approved WebP dimensions.`);
      }
      const digest = createHash('sha256').update(await readFile(filePath)).digest('hex');
      if (digest !== variant.sha256) errors.push(`${record.key}: ${variant.path} SHA-256 does not match.`);
    } catch (error) {
      errors.push(`${record.key}: ${variant.path} is missing or unreadable (${String(error)}).`);
    }
  }
}

const runtimeFiles = await readdir(runtimeRoot, { recursive: true });
for (const relativePath of runtimeFiles) {
  if (/\.(?:png|psd|psb|tiff?|jpe?g)$/i.test(relativePath)) {
    errors.push(`Unapproved source/raster format is not allowed in public-assets: ${relativePath}`);
  }
  if (/\.webp$/i.test(relativePath) && !seenPaths.has(path.join(runtimeRoot, relativePath))) {
    errors.push(`Runtime WebP is not registered in the approved manifest: ${relativePath}`);
  }
}

if (errors.length > 0) {
  process.stderr.write(`${errors.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Presentation assets valid: ${seenPaths.size} approved runtime files.\n`);
}
