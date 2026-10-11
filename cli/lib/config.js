// Config: defaults merged with config.json, read and written through dotted keys.
import { readJson, writeJson } from './paths.js';

export const DEFAULTS = {
  batch: { size: 5, group: 'repo' },
  runner: { harness: 'claude', model: 'opus', permissions: 'auto' },
  categories: { clarity: true, 'agent-setup': true, 'repo-for-agents': true },
  scope: 'touched',
  output: 'pr',
  autoMergeLowRisk: false,
  expireAfterBatches: 3,
  editable: [],
  targets: { preset: '~/.claude/skills', note: '' },
  notes: '',
};

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

function merge(base, over) {
  const result = { ...base };
  for (const [key, value] of Object.entries(over)) {
    result[key] = isObject(base[key]) && isObject(value) ? merge(base[key], value) : value;
  }
  return result;
}

export function loadConfig() {
  return merge(DEFAULTS, readJson('config.json', {}));
}

export function saveConfig(config) {
  writeJson('config.json', config);
}

export function getKey(config, key) {
  return key.split('.').reduce((node, part) => (isObject(node) ? node[part] : undefined), config);
}

// "5" -> 5, "true" -> true, '["a"]' -> ["a"]; keys whose default is text stay text.
export function parseValue(key, text) {
  if (typeof getKey(DEFAULTS, key) === 'string') return text;
  try { return JSON.parse(text); } catch { return text; }
}

export function setKey(key, text) {
  const current = getKey(DEFAULTS, key);
  if (current === undefined) throw new Error(`unknown config key: ${key}`);
  // Setting a whole section, e.g. "batch", would replace every key inside it.
  if (isObject(current)) throw new Error(`${key} is a section; set one of its keys, e.g. ${key}.<key>`);
  const config = loadConfig();
  const parts = key.split('.');
  const last = parts.pop();
  const parent = parts.reduce((node, part) => node[part], config);
  parent[last] = parseValue(key, text);
  saveConfig(config);
}
