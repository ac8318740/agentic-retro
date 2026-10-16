import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir, run, readState } from '../helpers/cli.js';

function checkouts(separateGitDir = false, metadataName = 'metadata') {
  const root = tempDir('retro-checkouts-');
  const main = join(root, 'main');
  const git = (args) => execFileSync('git', args, { stdio: 'pipe' });
  git(['init', '-q', ...(separateGitDir ? ['--separate-git-dir', join(root, metadataName)] : []), main]);
  git(['-C', main, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'initial', '--allow-empty']);
  const worktrees = ['one', 'two'].map((name) => {
    const dir = join(root, name);
    git(['-C', main, 'worktree', 'add', '-q', '-b', name, dir]);
    return dir;
  });
  const other = join(root, 'other');
  git(['init', '-q', other]);
  for (const cwd of [main, other]) git(['-C', cwd, 'config', '--local', 'agentic-retro.enabled', 'true']);
  return { main, worktrees, other };
}

function entry(sessionId, cwd) {
  return { harness: 'claude', sessionId, cwd, repo: cwd,
    transcript: `/transcripts/${sessionId}.jsonl`, endedAt: '2026-10-01T10:00:00.000Z' };
}

function enqueue(home, sessionId, cwd) {
  return run(home, ['enqueue', '--harness', 'claude', '--session', sessionId,
    '--transcript', `/transcripts/${sessionId}.jsonl`, '--cwd', cwd]);
}

function batches(home) {
  try {
    return readdirSync(join(home, 'batches')).sort().map((n) => readState(home, `batches/${n}/batch.json`));
  } catch { return []; }
}

function assertSessions(actual, expected) {
  assert.deepEqual(actual.map((s) => s.sessionId).sort(), expected.map((s) => s.sessionId).sort());
  for (const session of expected) {
    const found = actual.find((s) => s.sessionId === session.sessionId);
    for (const key of ['harness', 'cwd', 'transcript']) assert.equal(found[key], session[key]);
    if (session.endedAt) assert.equal(found.endedAt, session.endedAt);
  }
}

for (const separateGitDir of [false, true]) {
test(`${separateGitDir ? 'separate-git-dir ' : ''}main checkout and linked worktrees reach one threshold while another repository stays queued`, () => {
  const home = tempDir();
  const { main, worktrees: [one, two], other } = checkouts(separateGitDir);
  const sub = join(two, 'src');
  mkdirSync(sub);
  assert.equal(run(home, ['config', 'set', 'batch.size', '3']).code, 0);
  for (const [id, cwd] of [['main', main], ['one', one], ['other', other]]) {
    assert.equal(enqueue(home, id, cwd).code, 0);
  }
  assert.deepEqual(batches(home), []);
  assert.equal(enqueue(home, 'two', sub).code, 0);
  assert.equal(batches(home).length, 1);
  assertSessions(batches(home)[0].sessions,
    [entry('main', main), entry('one', one), entry('two', sub)].map(({ endedAt, ...s }) => s));
  assertSessions(readState(home, 'queue.json'), [entry('other', other)].map(({ endedAt, ...s }) => s));
});
}

test('newline checkout names retain exact repository identities and distinct repositories never collide', () => {
  const home = tempDir();
  const root = tempDir('retro-newline-paths-');
  const main = join(root, 'same-first-line\nmain');
  const other = join(root, 'same-first-line\nother');
  const linked = join(root, 'linked\ncheckout');
  const git = (args) => execFileSync('git', args, { stdio: 'pipe' });
  for (const repo of [main, other]) {
    git(['init', '-q', repo]);
    git(['-C', repo, 'config', '--local', 'agentic-retro.enabled', 'true']);
  }
  git(['-C', main, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'initial', '--allow-empty']);
  git(['-C', main, 'worktree', 'add', '-q', '-b', 'linked', linked]);
  assert.equal(run(home, ['config', 'set', 'batch.size', '2']).code, 0);
  assert.equal(enqueue(home, 'main-newline', main).code, 0);
  assert.equal(readState(home, 'queue.json')[0].repo, main);
  assert.equal(enqueue(home, 'other-newline', other).code, 0);
  assert.deepEqual(batches(home), [], 'distinct repositories sharing a first line stay separate');
  assert.deepEqual(readState(home, 'queue.json').map((s) => s.repo), [main, other]);
  assert.equal(enqueue(home, 'linked-newline', linked).code, 0);
  assert.equal(batches(home).length, 1);
  assertSessions(batches(home)[0].sessions, [entry('main-newline', main), entry('linked-newline', linked)]
    .map(({ endedAt, ...s }) => s));
  assert.deepEqual(batches(home)[0].sessions.map((s) => s.repo), [main, main]);
  assert.equal(readState(home, 'queue.json')[0].repo, other);
});

test('separate Git metadata directory with trailing spaces preserves shared checkout identity', () => {
  const home = tempDir();
  const { main, worktrees: [one, two], other } = checkouts(true, 'metadata  ');
  assert.equal(run(home, ['config', 'set', 'batch.size', '3']).code, 0);
  assert.equal(enqueue(home, 'main-space', main).code, 0);
  const identity = readState(home, 'queue.json')[0].repo;
  assert.equal(realpathSync(identity), identity, 'the identity preserves an exact existing canonical path');
  if (identity.includes('metadata')) {
    assert.equal(identity, join(main, '..', 'metadata  '), 'metadata identity preserves trailing spaces');
  }
  assert.equal(enqueue(home, 'other-space', other).code, 0);
  assert.equal(enqueue(home, 'linked-space', one).code, 0);
  const queued = readState(home, 'queue.json');
  assert.equal(queued.find((s) => s.sessionId === 'linked-space').repo, identity);
  assert.notEqual(queued.find((s) => s.sessionId === 'other-space').repo, identity);
  assert.deepEqual(batches(home), []);
  assert.equal(enqueue(home, 'second-linked-space', two).code, 0);
  assert.equal(batches(home).length, 1);
  assert.deepEqual(batches(home)[0].sessions.map((s) => s.repo), [identity, identity, identity]);
  assertSessions(batches(home)[0].sessions,
    [entry('main-space', main), entry('linked-space', one), entry('second-linked-space', two)]
      .map(({ endedAt, ...s }) => s));
  assertSessions(readState(home, 'queue.json'), [entry('other-space', other)].map(({ endedAt, ...s }) => s));
});

test('legacy checkout groups count toward the threshold and preserve every session across migration', () => {
  const home = tempDir();
  const { main, worktrees: [one, two], other } = checkouts();
  assert.equal(run(home, ['config', 'set', 'batch.size', '4']).code, 0);
  const old = [entry('old-main', main), entry('old-one', one), entry('old-other', other)];
  writeFileSync(join(home, 'queue.json'), JSON.stringify(old));
  assert.equal(enqueue(home, 'new-two', two).code, 0);
  assert.deepEqual(batches(home), [], 'three related sessions remain below the threshold');
  assertSessions(readState(home, 'queue.json'), [...old, { ...entry('new-two', two), endedAt: undefined }]);
  assert.equal(enqueue(home, 'new-main', main).code, 0);
  assert.equal(batches(home).length, 1);
  assertSessions(batches(home)[0].sessions, [...old.slice(0, 2),
    { ...entry('new-two', two), endedAt: undefined }, { ...entry('new-main', main), endedAt: undefined }]);
  assertSessions(readState(home, 'queue.json'), [old[2]]);
});

test('failed handoff of a migrated worktree batch keeps its sessions for a later successful batch', () => {
  const home = tempDir();
  const { main, worktrees: [one, two], other } = checkouts();
  assert.equal(run(home, ['config', 'set', 'batch.size', '3']).code, 0);
  const old = [entry('old-main', main), entry('old-one', one), entry('old-other', other)];
  writeFileSync(join(home, 'queue.json'), JSON.stringify(old));
  writeFileSync(join(home, 'batches'), 'not a directory');
  assert.notEqual(enqueue(home, 'new-two', two).code, 0, 'the combined group attempts its ready batch');
  const retained = [...old, { ...entry('new-two', two), endedAt: undefined }];
  assertSessions(readState(home, 'queue.json'), retained);
  rmSync(join(home, 'batches'));
  assert.equal(enqueue(home, 'retry', one).code, 0);
  assert.equal(batches(home).length, 1);
  assert.equal(batches(home)[0].sessions.length, 3, 'migration respects the configured batch size');
  assertSessions([...batches(home)[0].sessions, ...readState(home, 'queue.json')],
    [...retained, { ...entry('retry', one), endedAt: undefined }]);
  assertSessions(readState(home, 'queue.json'), [old[2], { ...entry('retry', one), endedAt: undefined }]);
});
