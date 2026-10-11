// Pi has no hook config, so a small extension file stands in for the hooks.
import { mkdirSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), 'pi-extension.ts');

export function installPi() {
  const dir = join(process.env.PI_HOME || join(homedir(), '.pi'), 'agent', 'extensions');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'agentic-retro.ts');
  copyFileSync(TEMPLATE, file);
  console.log(`agentic-retro: wrote ${file}`);
}
