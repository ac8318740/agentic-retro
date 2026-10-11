import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { run as cli, tempDir } from './helpers/cli.js';

const run = (args, opts) => cli(tempDir(), args, opts);

test('about prints a short intro and exits 0', () => {
  const r = run(['about']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /agentic-retro/);
  assert.ok(r.stdout.trim().split('\n').length <= 8, 'intro stays very short');
});

test('setup opens with the same intro before the first question', () => {
  const intro = run(['about']).stdout.trim();
  const r = run(['setup'], { input: '' });
  assert.ok(r.stdout.startsWith(intro), 'setup starts with the intro');
});

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

test('shipped CLI and skills never mention spechub', () => {
  for (const file of [...files('cli'), ...files('skills')]) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /spechub/i, file);
  }
});
