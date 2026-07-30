import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const forbiddenEngineImports = [/from ['"]react['"]/, /from ['"]zustand['"]/, /from ['"][^'"]*apps\//, /from ['"]@guildmaster\/content-/];
const forbiddenAuthorityGlobals = /\b(?:window|document|localStorage|sessionStorage|navigator)\b/;

async function filesAt(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => entry.isDirectory() ? filesAt(join(directory, entry.name)) : [join(directory, entry.name)]));
  return nested.flat();
}

const engineFiles = (await filesAt(join(root, 'packages/game-engine/src'))).filter((file) => file.endsWith('.ts'));
const failures = [];
for (const file of engineFiles) {
  const source = await readFile(file, 'utf8');
  const lineCount = source.split('\n').length;
  if (lineCount > 500) failures.push(`${file}: exceeds 500 lines (${lineCount})`);
  if (forbiddenEngineImports.some((pattern) => pattern.test(source))) failures.push(`${file}: game-engine imports a UI/app/content implementation dependency`);
  if (forbiddenAuthorityGlobals.test(source)) failures.push(`${file}: authoritative engine code references a browser-only global`);
}
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Architecture check passed for ${engineFiles.length} engine files.`);
}
