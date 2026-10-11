// Where state lives, and how to read and write its JSON files.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

export function stateDir() {
  return process.env.AGENTIC_RETRO_HOME || join(homedir(), '.agentic-retro');
}

export function statePath(...parts) {
  return join(stateDir(), ...parts);
}

export function readJson(name, fallback) {
  const path = statePath(name);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
}

export function writeJson(name, data) {
  const path = statePath(name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}
