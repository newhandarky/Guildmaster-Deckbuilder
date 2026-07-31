import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeRoot = path.join(repositoryRoot, 'public-assets');

function usage() {
  throw new Error(
    'Usage: pnpm asset:prepare --input /outside/repo/source.png --category adventurer --slug stable-file-slug --asset-key demo:adventurer/key',
  );
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || !value) usage();
    values.set(flag.slice(2), value);
  }
  const input = values.get('input');
  const category = values.get('category');
  const slug = values.get('slug');
  const assetKey = values.get('asset-key');
  if (!input || !category || !slug || !assetKey) usage();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(category) || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error('category and slug must use lowercase letters, digits, and hyphens.');
  }
  if (!/^[a-z0-9][a-z0-9:-]*\/[a-z0-9][a-z0-9/-]*$/.test(assetKey)) {
    throw new Error('asset-key must be a stable namespaced key such as demo:adventurer/example.');
  }
  return { input, category, slug, assetKey };
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function digest(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

const { input, category, slug, assetKey } = parseArguments(process.argv.slice(2));
const inputPath = await realpath(path.resolve(input));
if (isInside(repositoryRoot, inputPath)) {
  throw new Error('Source artwork must live outside the repository.');
}

const metadata = await sharp(inputPath).metadata();
if (metadata.format !== 'png') throw new Error('Source artwork must be PNG.');
if (!metadata.width || !metadata.height || metadata.height * 3 !== metadata.width * 4) {
  throw new Error('Source artwork must have an exact portrait 3:4 aspect ratio.');
}
if (Math.min(metadata.width, metadata.height) < 1024) {
  throw new Error('Source artwork short edge must be at least 1024px.');
}
if (metadata.space !== 'srgb') {
  throw new Error(`Source artwork must be sRGB; received ${metadata.space ?? 'unknown'}.`);
}

const outputDirectory = path.join(runtimeRoot, 'generated', 'cards', category);
await mkdir(outputDirectory, { recursive: true });
const variants = [];
for (const [width, height] of [[384, 512], [768, 1024]]) {
  const outputPath = path.join(outputDirectory, `${slug}-${width}.webp`);
  await sharp(inputPath)
    .resize(width, height, { fit: 'fill' })
    .webp({ quality: 88 })
    .toFile(outputPath);
  variants.push({
    width,
    height,
    format: 'webp',
    path: path.relative(runtimeRoot, outputPath).split(path.sep).join('/'),
    sha256: await digest(outputPath),
  });
}

process.stdout.write(`${JSON.stringify({
  key: assetKey,
  objectPosition: '50% 50%',
  variants,
  provenance: {
    origin: 'REQUIRED',
    createdOn: new Date().toISOString().slice(0, 10),
    tool: 'REQUIRED',
    model: 'REQUIRED',
    briefVersion: 'REQUIRED',
    referenceSources: 'REQUIRED',
    license: 'REQUIRED',
    humanReview: { status: 'REQUIRES_MANUAL_APPROVAL', reviewedBy: 'REQUIRED', reviewedOn: 'REQUIRED' },
  },
}, null, 2)}\n`);
