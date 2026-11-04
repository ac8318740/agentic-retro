import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir, run, readState } from './helpers/cli.js';

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function repo(root, name) {
  const path = join(root, name);
  git(root, 'init', '-q', path);
  return path;
}

function enqueue(home, cwd, id) {
  const result = run(home, ['enqueue', '--harness', 'claude', '--session', id, '--cwd', cwd]);
  assert.equal(result.code, 0, result.stderr);
}

test('project opt-in defaults off and is shared by distant worktrees without checkout files', (t) => {
  const root = tempDir();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'state');
  const main = repo(root, 'main');
  const elsewhere = tempDir();
  t.after(() => rmSync(elsewhere, { recursive: true, force: true }));
  const linked = join(elsewhere, 'linked');
  git(main, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'initial', '--allow-empty');
  git(main, 'worktree', 'add', '-qb', 'linked', linked);
  const nested = join(linked, 'src');
  mkdirSync(nested);
  assert.equal(run(home, ['project', 'status', '--cwd', nested]).stdout.trim(), 'disabled');
  enqueue(home, nested, 'off');
  assert.equal(existsSync(home), false, 'disabled hooks do not create state');
  assert.equal(run(home, ['project', 'enable', '--cwd', nested]).code, 0);
  assert.equal(run(home, ['project', 'status', '--cwd', main]).stdout.trim(), 'enabled');
  git(main, 'config', 'extensions.worktreeConfig', 'true');
  git(linked, 'config', '--worktree', 'agentic-retro.enabled', 'false');
  assert.equal(run(home, ['project', 'status', '--cwd', linked]).stdout.trim(), 'enabled');
  enqueue(home, nested, 'on');
  assert.equal(readState(home, 'queue.json')[0].sessionId, 'on');
  assert.equal(run(home, ['project', 'disable', '--cwd', main]).code, 0);
  assert.equal(run(home, ['project', 'status', '--cwd', linked]).stdout.trim(), 'disabled');
  enqueue(home, nested, 'off-again');
  assert.equal(readState(home, 'queue.json').length, 1);
  for (const cwd of [main, linked]) assert.equal(git(cwd, 'status', '--porcelain'), '');
  assert.equal(run(home, ['project', 'enable', '--cwd', elsewhere]).code, 1);
});

test('queued sessions remain eligible after their worktree is removed', (t) => {
  const root = tempDir();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'state');
  const main = repo(root, 'main');
  const linked = join(root, 'linked');
  git(main, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'initial', '--allow-empty');
  git(main, 'worktree', 'add', '-qb', 'linked', linked);
  run(home, ['project', 'enable', '--cwd', main]);
  run(home, ['config', 'set', 'batch.size', '2']);
  enqueue(home, linked, 'linked-session');
  git(main, 'worktree', 'remove', linked);
  enqueue(home, main, 'main-session');
  assert.deepEqual(readState(home, 'batches/1/batch.json')?.sessions.map(s => s.sessionId), ['linked-session', 'main-session']);
  assert.deepEqual(readState(home, 'queue.json'), []);
});

test('global batches exclude but retain queued sessions from disabled projects', (t) => {
  const root = tempDir();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'state');
  const a = repo(root, 'a');
  const b = repo(root, 'b');
  for (const cwd of [a, b]) assert.equal(run(home, ['project', 'enable', '--cwd', cwd]).code, 0);
  run(home, ['config', 'set', 'batch.size', '2']);
  run(home, ['config', 'set', 'batch.group', 'global']);
  enqueue(home, a, 'a-old');
  run(home, ['project', 'disable', '--cwd', a]);
  enqueue(home, b, 'b1');
  assert.equal(existsSync(join(home, 'batches')), false);
  enqueue(home, b, 'b2');
  assert.deepEqual(readState(home, 'batches/1/batch.json').sessions.map(s => s.sessionId), ['b1', 'b2']);
  assert.deepEqual(readState(home, 'queue.json').map(s => s.sessionId), ['a-old']);
});

test('notices use the hook project and leave unrelated or disabled proposals unread', (t) => {
  const root = tempDir();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'state');
  const a = repo(root, 'a');
  const b = repo(root, 'b');
  run(home, ['config', 'set', 'output', 'report']);
  for (const cwd of [a, b]) run(home, ['propose', '--repo', cwd, '--category', 'clarity', '--title', cwd]);
  const notice = cwd => run(home, ['notice', '--json'], { input: JSON.stringify({ cwd }) });
  assert.equal(notice(a).stdout, '');
  assert.equal(readState(home, 'notice.json'), undefined);
  run(home, ['project', 'enable', '--cwd', a]);
  assert.match(JSON.parse(notice(a).stdout).systemMessage, /1 new proposal:/);
  assert.deepEqual(readState(home, 'notice.json').noticed, ['P1']);
  assert.equal(notice(b).stdout, '');
  run(home, ['project', 'enable', '--cwd', b]);
  assert.match(JSON.parse(notice(b).stdout).systemMessage, /1 new proposal:/);
  assert.deepEqual(readState(home, 'notice.json').noticed, ['P1', 'P2']);
  // Agent-setup proposals can target a different repository than their source batch.
  mkdirSync(join(home, 'batches', '3'), { recursive: true });
  writeFileSync(join(home, 'batches', '3', 'batch.json'), JSON.stringify({ sessions: [{ cwd: a, repo: a }] }));
  writeFileSync(join(home, 'ledger.json'), JSON.stringify({ nextId: 4, batchCount: 3, proposals: [{ id: 'P3', batch: 3, repo: b, status: 'open' }] }));
  assert.match(JSON.parse(notice(a).stdout).systemMessage, /1 new proposal:/);
});
