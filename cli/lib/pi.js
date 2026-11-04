// Pi has no hook config, so a small extension file stands in for the hooks.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), 'pi-extension.ts');

export function installPi() {
  const dir = join(process.env.PI_HOME || join(homedir(), '.pi'), 'agent', 'extensions');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'agentic-retro.ts');
  const source = readFileSync(TEMPLATE, 'utf8').replace(
    'const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");',
    `const PACKAGE_ROOT = ${JSON.stringify(PACKAGE_ROOT)};`,
  );
  writeFileSync(file, source);
  console.log(`agentic-retro: wrote ${file}`);
}
