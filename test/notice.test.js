// Black-box tests for `agentic-retro notice` (issue #22): the session-start
// one-line notice. Every test runs the real CLI against a temp state folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'agentic-retro.js');

function makeHome() {
  return mkdtempSync(join(tmpdir(), 'agentic-retro-notice-'));
}

function writeState(home, { config = {}, ledger }, raw) {
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'config.json'), JSON.stringify(config));
  writeFileSync(join(home, 'ledger.json'), raw ?? JSON.stringify(ledger));
}

function runNotice(home, args = [], extraEnv = {}) {
  return spawnSync(process.execPath, [CLI, 'notice', ...args], {
    env: { ...process.env, AGENTIC_RETRO_HOME: home, ...extraEnv },
    encoding: 'utf8',
  });
}

function proposal(overrides) {
  return {
    id: 'P1', batch: 1, repo: '/repo', category: 'clarity', risk: null,
    title: 'x', status: 'open', createdAt: '2020-01-01T00:00:00.000Z',
    statusAt: '2020-01-01T00:00:00.000Z', pr: null, commit: null,
    ...overrides,
  };
}

test('prints nothing when the state folder does not exist', () => {
  const home = join(tmpdir(), 'agentic-retro-missing-' + Date.now());
  const result = runNotice(home);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
});

test('prints nothing when AGENTIC_RETRO_RUN=1, even with new proposals', () => {
  const home = makeHome();
  writeState(home, {
    config: { output: 'pr' },
    ledger: { nextId: 3, batchCount: 1, proposals: [
      proposal({ id: 'P1', pr: 'https://github.com/x/y/pull/1' }),
    ] },
  });
  const result = runNotice(home, [], { AGENTIC_RETRO_RUN: '1' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  rmSync(home, { recursive: true, force: true });
});

test('PR mode: one line, deduped links, then silent on a second run', () => {
  const home = makeHome();
  writeState(home, {
    config: { output: 'pr' },
    ledger: { nextId: 4, batchCount: 1, proposals: [
      proposal({ id: 'P1', pr: 'https://github.com/x/y/pull/1' }),
      proposal({ id: 'P2', pr: 'https://github.com/x/y/pull/1' }),
      proposal({ id: 'P3', pr: 'https://github.com/x/y/pull/2' }),
    ] },
  });
  const first = runNotice(home);
  assert.equal(first.status, 0);
  assert.equal(
    first.stdout.trim(),
    'agentic-retro: 3 new proposals: https://github.com/x/y/pull/1, https://github.com/x/y/pull/2',
  );
  const second = runNotice(home);
  assert.equal(second.status, 0);
  assert.equal(second.stdout, '');
  rmSync(home, { recursive: true, force: true });
});

test('report mode: links are deduped report file paths', () => {
  const home = makeHome();
  writeState(home, {
    config: { output: 'report' },
    ledger: { nextId: 3, batchCount: 7, proposals: [
      proposal({ id: 'P1', batch: 7 }),
      proposal({ id: 'P2', batch: 7 }),
    ] },
  });
  const result = runNotice(home);
  assert.equal(result.status, 0);
  assert.equal(
    result.stdout.trim(),
    `agentic-retro: 2 new proposals: ${join(home, 'reports', '7.md')}`,
  );
  rmSync(home, { recursive: true, force: true });
});

test('only open proposals count, and only those created since the last notice', () => {
  const home = makeHome();
  writeState(home, {
    config: { output: 'pr' },
    ledger: { nextId: 10, batchCount: 1, proposals: [
      proposal({ id: 'P1', pr: 'https://github.com/x/y/pull/1', createdAt: '2020-01-01T00:00:00.000Z' }),
      proposal({ id: 'P2', pr: 'https://github.com/x/y/pull/2', createdAt: '2020-01-01T00:00:00.000Z' }),
      proposal({ id: 'P3', pr: 'https://github.com/x/y/pull/3', status: 'accepted', createdAt: '2020-01-01T00:00:00.000Z' }),
    ] },
  });
  const first = runNotice(home);
  assert.equal(
    first.stdout.trim(),
    'agentic-retro: 2 new proposals: https://github.com/x/y/pull/1, https://github.com/x/y/pull/2',
  );

  // A later batch adds two more open proposals, dated well after the first notice.
  writeState(home, {
    config: { output: 'pr' },
    ledger: { nextId: 12, batchCount: 2, proposals: [
      proposal({ id: 'P1', pr: 'https://github.com/x/y/pull/1', createdAt: '2020-01-01T00:00:00.000Z' }),
      proposal({ id: 'P2', pr: 'https://github.com/x/y/pull/2', createdAt: '2020-01-01T00:00:00.000Z' }),
      proposal({ id: 'P4', pr: 'https://github.com/x/y/pull/4', createdAt: '2099-01-01T00:00:00.000Z' }),
      proposal({ id: 'P5', pr: 'https://github.com/x/y/pull/5', createdAt: '2099-01-01T00:00:00.000Z' }),
    ] },
  });
  const third = runNotice(home);
  assert.equal(third.status, 0);
  assert.equal(
    third.stdout.trim(),
    'agentic-retro: 2 new proposals: https://github.com/x/y/pull/4, https://github.com/x/y/pull/5',
  );
  rmSync(home, { recursive: true, force: true });
});

test('--json prints a systemMessage with the same line', () => {
  const home = makeHome();
  writeState(home, {
    config: { output: 'pr' },
    ledger: { nextId: 3, batchCount: 1, proposals: [
      proposal({ id: 'P1', pr: 'https://github.com/x/y/pull/1' }),
      proposal({ id: 'P2', pr: 'https://github.com/x/y/pull/2' }),
    ] },
  });
  const result = runNotice(home, ['--json']);
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(
    parsed.systemMessage,
    'agentic-retro: 2 new proposals: https://github.com/x/y/pull/1, https://github.com/x/y/pull/2',
  );
  rmSync(home, { recursive: true, force: true });
});

test('never exits non-zero, even when ledger.json is corrupt', () => {
  const home = makeHome();
  writeState(home, { config: { output: 'pr' } }, '{ not valid json');
  const result = runNotice(home);
  assert.equal(result.status, 0);
  rmSync(home, { recursive: true, force: true });
});
