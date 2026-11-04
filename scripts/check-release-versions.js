#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

const surfaces = [
  { label: 'package.json version', path: 'package.json', get: (json) => json.version },
  { label: 'package-lock root version', path: 'package-lock.json', get: (json) => json.version },
  { label: 'package-lock package version', path: 'package-lock.json', get: (json) => json.packages?.['']?.version },
  { label: 'Claude plugin version', path: '.claude-plugin/plugin.json', get: (json) => json.version },
  { label: 'Codex plugin version', path: '.codex-plugin/plugin.json', get: (json) => json.version },
];

function args(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key?.startsWith('--')) throw new Error(`unknown argument: ${key ?? ''}`);
    values[key.slice(2)] = argv[i + 1];
  }
  return values;
}

function fileAt(ref, path) {
  return execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function refExists(ref) {
  try {
    execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { encoding: 'utf8', stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function jsonAt(ref, path) {
  try {
    return { exists: true, json: JSON.parse(fileAt(ref, path)) };
  } catch (error) {
    if (error.status !== undefined) return { exists: false, json: undefined };
    throw new Error(`could not read ${path} at ${ref}: ${error.message}`);
  }
}

function changed(base, head, surface) {
  try {
    const baseFile = jsonAt(base, surface.path);
    const headFile = jsonAt(head, surface.path);
    if (!headFile.exists) return false;

    const headValue = surface.get(headFile.json);
    if (!headValue) return false;
    if (!baseFile.exists) return true;

    const baseValue = surface.get(baseFile.json);
    return Boolean(baseValue && baseValue !== headValue);
  } catch (error) {
    throw new Error(`${surface.label}: ${error.message}`);
  }
}

function main() {
  const options = args(process.argv.slice(2));
  if (!options.base || !options.head || !options.target) {
    console.error('usage: check-release-versions --base <ref> --head <ref> --target <branch>');
    return 2;
  }
  if (options.target !== 'main') return 0;
  if (!refExists(options.base)) throw new Error(`unknown base ref: ${options.base}`);
  if (!refExists(options.head)) throw new Error(`unknown head ref: ${options.head}`);

  const missing = surfaces.filter((surface) => !changed(options.base, options.head, surface));
  if (!missing.length) return 0;

  console.error('main-targeted pull requests must bump every release version:');
  for (const surface of missing) console.error(`- ${surface.label} (${surface.path})`);
  return 1;
}

process.exitCode = main();
