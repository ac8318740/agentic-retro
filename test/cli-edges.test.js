import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempDir, run, readState } from './helpers/cli.js';

test('--help and help print usage to stdout and exit 0', () => {
  for (const args of [['--help'], ['help']]) {
    const { code, stdout } = run(tempDir(), args);
    assert.equal(code, 0, args[0]);
    assert.match(stdout, /usage: agentic-retro/, args[0]);
  }
});

test('no command prints usage and exits 1', () => {
  const { code, stdout, stderr } = run(tempDir(), []);
  assert.equal(code, 1);
  assert.match(stdout + stderr, /usage: agentic-retro/);
});

test('enqueue with malformed JSON on stdin exits 0 and queues nothing', () => {
  const home = tempDir();
  const { code, stderr } = run(home, ['enqueue', '--harness', 'claude'], { input: '{"session_id": "s1", "transcript_pa' });
  assert.equal(code, 0, stderr);
  assert.deepEqual(readState(home, 'queue.json') ?? [], []);
});

test('PR mode: a proposal without a PR waits, then the notice after link shows its PR', () => {
  const home = tempDir();
  run(home, ['config', 'set', 'output', 'pr']);
  const id = run(home, ['propose', '--repo', '/work/demo', '--category', 'clarity', '--title', 'Name the loop']).stdout.trim();
  assert.match(id, /^P\d+$/);

  run(home, ['notice']);
  const url = 'https://github.com/example/demo/pull/42';
  assert.equal(run(home, ['link', id, '--pr', url]).code, 0);

  const { code, stdout } = run(home, ['notice']);
  assert.equal(code, 0);
  assert.ok(stdout.includes(url), `notice names the PR: ${JSON.stringify(stdout)}`);
});
