import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir, run, readState } from './helpers/cli.js';

const DEFAULTS = {
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

test('config list prints the defaults as JSON when no config file exists', () => {
  const home = tempDir();
  const { code, stdout } = run(home, ['config', 'list']);
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(stdout), DEFAULTS);
});

test('config get reads a default through a dotted key', () => {
  const home = tempDir();
  const { code, stdout } = run(home, ['config', 'get', 'batch.size']);
  assert.equal(code, 0);
  assert.equal(stdout.trim(), '5');
});

test('config get on an unknown key exits non-zero', () => {
  const home = tempDir();
  assert.equal(run(home, ['config', 'get', 'batch.size']).code, 0);
  assert.notEqual(run(home, ['config', 'get', 'no.such.key']).code, 0);
});

test('config set writes a number to config.json and get reads it back', () => {
  const home = tempDir();
  assert.equal(run(home, ['config', 'set', 'batch.size', '3']).code, 0);
  assert.equal(readState(home, 'config.json').batch.size, 3);
  assert.equal(run(home, ['config', 'get', 'batch.size']).stdout.trim(), '3');
});

test('config set keeps sibling defaults under the same parent key', () => {
  const home = tempDir();
  run(home, ['config', 'set', 'batch.size', '3']);
  assert.equal(run(home, ['config', 'get', 'batch.group']).stdout.trim(), 'repo');
});

test('config set stores strings and booleans with their natural types', () => {
  const home = tempDir();
  run(home, ['config', 'set', 'runner.harness', 'codex']);
  run(home, ['config', 'set', 'autoMergeLowRisk', 'true']);
  const config = readState(home, 'config.json');
  assert.equal(config.runner.harness, 'codex');
  assert.equal(config.autoMergeLowRisk, true);
});

test('config list merges a partial config file over the defaults', () => {
  const home = tempDir();
  writeFileSync(join(home, 'config.json'), JSON.stringify({ batch: { size: 2 } }));
  const listed = JSON.parse(run(home, ['config', 'list']).stdout);
  assert.deepEqual(listed, { ...DEFAULTS, batch: { size: 2, group: 'repo' } });
});

test('state folder lives at AGENTIC_RETRO_HOME and is created on first write', () => {
  const home = join(tempDir(), 'nested', 'state');
  assert.equal(run(home, ['config', 'set', 'scope', 'neighbours']).code, 0);
  assert.equal(readState(home, 'config.json').scope, 'neighbours');
});

test('setup writes config.json from answers fed on stdin', () => {
  // Kept light: pressing enter on every question accepts the defaults.
  const home = tempDir();
  mkdirSync(home, { recursive: true });
  const { code } = run(home, ['setup'], { input: '\n'.repeat(50) });
  assert.equal(code, 0);
  assert.ok(existsSync(join(home, 'config.json')));
  assert.equal(readState(home, 'config.json').batch.size, 5);
});
