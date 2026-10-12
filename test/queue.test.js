import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tempDir, run, readState } from './helpers/cli.js';
import './lib/queue.test.js';

// Batch handoff contract, under AGENTIC_RETRO_DRY_RUN=1 (set by the helper on every run):
// runner.startBatch(batch) writes batches/<n>/batch.json as { sessions: [queue entries] }
// and does nothing else. It launches no agents. Batches are numbered from 1.

function enqueue(home, sessionId, cwd, env) {
  const args = ['enqueue', '--harness', 'claude', '--session', sessionId,
    '--transcript', `/transcripts/${sessionId}.jsonl`, '--cwd', cwd];
  return run(home, args, { env });
}

function gitRepo() {
  const dir = tempDir('agentic-retro-repo-');
  execFileSync('git', ['init', '-q', dir]);
  return dir;
}

function batches(home) {
  const dir = join(home, 'batches');
  let names = [];
  try { names = readdirSync(dir); } catch {}
  return names.sort().map((n) => ({ n, ...readState(home, join('batches', n, 'batch.json')) }));
}

const ids = (sessions) => sessions.map((s) => s.sessionId).sort();

test('enqueue with flags adds a full entry to queue.json', () => {
  const home = tempDir();
  const cwd = tempDir('agentic-retro-plain-');
  assert.equal(enqueue(home, 's1', cwd).code, 0);
  const [entry] = readState(home, 'queue.json');
  assert.equal(entry.harness, 'claude');
  assert.equal(entry.sessionId, 's1');
  assert.equal(entry.transcript, '/transcripts/s1.jsonl');
  assert.equal(entry.cwd, cwd);
  assert.ok(entry.endedAt, 'endedAt is set');
});

test('enqueue sets repo to the git toplevel of cwd', () => {
  const home = tempDir();
  const repo = gitRepo();
  const sub = join(repo, 'src', 'deep');
  mkdirSync(sub, { recursive: true });
  enqueue(home, 's1', sub);
  assert.equal(readState(home, 'queue.json')[0].repo, repo);
});

test('enqueue sets repo to cwd itself outside a git repo', () => {
  const home = tempDir();
  const cwd = tempDir('agentic-retro-plain-');
  enqueue(home, 's1', cwd);
  assert.equal(readState(home, 'queue.json')[0].repo, cwd);
});

test('enqueue reads the harness hook JSON from stdin when flags are missing', () => {
  const home = tempDir();
  const cwd = tempDir('agentic-retro-plain-');
  const hook = { session_id: 'hook-1', transcript_path: '/t/hook-1.jsonl', cwd, hook_event_name: 'SessionEnd' };
  const { code } = run(home, ['enqueue', '--harness', 'claude'], { input: JSON.stringify(hook) });
  assert.equal(code, 0);
  const [entry] = readState(home, 'queue.json');
  assert.equal(entry.sessionId, 'hook-1');
  assert.equal(entry.transcript, '/t/hook-1.jsonl');
  assert.equal(entry.cwd, cwd);
});

test('enqueue is a no-op inside a retro run (AGENTIC_RETRO_RUN=1)', () => {
  const home = tempDir();
  const { code } = enqueue(home, 's1', tempDir(), { AGENTIC_RETRO_RUN: '1' });
  assert.equal(code, 0);
  assert.deepEqual(readState(home, 'queue.json') ?? [], []);
});

test('enqueue ignores a session id already in the queue', () => {
  const home = tempDir();
  const cwd = tempDir();
  enqueue(home, 's1', cwd);
  enqueue(home, 's1', cwd);
  assert.equal(readState(home, 'queue.json').length, 1);
});

test('a repo group reaching batch.size leaves the queue as batch 1', () => {
  const home = tempDir();
  const repo = gitRepo();
  run(home, ['config', 'set', 'batch.size', '2']);
  enqueue(home, 'a1', repo);
  assert.equal(batches(home).length, 0);
  enqueue(home, 'a2', repo);
  assert.deepEqual(readState(home, 'queue.json'), []);
  const [batch] = batches(home);
  assert.equal(batch.n, '1');
  assert.deepEqual(ids(batch.sessions), ['a1', 'a2']);
});

test('with batch.group repo, sessions from different repos do not batch together', () => {
  const home = tempDir();
  run(home, ['config', 'set', 'batch.size', '2']);
  const [repoA, repoB] = [gitRepo(), gitRepo()];
  enqueue(home, 'a1', repoA);
  enqueue(home, 'b1', repoB);
  assert.equal(batches(home).length, 0);
  enqueue(home, 'a2', repoA);
  assert.deepEqual(ids(batches(home)[0].sessions), ['a1', 'a2']);
  assert.deepEqual(ids(readState(home, 'queue.json')), ['b1']);
});

test('with batch.group global, sessions from any repo batch together', () => {
  const home = tempDir();
  run(home, ['config', 'set', 'batch.size', '2']);
  run(home, ['config', 'set', 'batch.group', 'global']);
  enqueue(home, 'a1', gitRepo());
  enqueue(home, 'b1', gitRepo());
  assert.deepEqual(ids(batches(home)[0].sessions), ['a1', 'b1']);
  assert.deepEqual(readState(home, 'queue.json'), []);
});
