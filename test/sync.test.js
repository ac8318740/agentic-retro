import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = new URL('../cli/agentic-retro.js', import.meta.url).pathname;

// Fake gh: answers `pr view <pr> --json state,commits` from prs.json, keyed by PR number.
const FAKE_GH = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const pr = String(process.argv[4]).split('/').pop();
fs.appendFileSync(path.join(__dirname, 'gh-calls.log'), process.argv.slice(2).join(' ') + '\\n');
process.stdout.write(JSON.stringify(JSON.parse(fs.readFileSync(path.join(__dirname, 'prs.json'), 'utf8'))[pr]));
`;

function proposal(id, fields) {
  return { id, batch: 3, repo: '/r', category: 'clarity', risk: null, title: `title ${id}`,
    status: 'open', createdAt: '2026-01-01T00:00:00.000Z', statusAt: null, pr: null, commit: null, ...fields };
}

function setup({ proposals, prs = {}, batchCount = 3, config }) {
  const home = mkdtempSync(join(tmpdir(), 'agentic-retro-sync-'));
  writeFileSync(join(home, 'ledger.json'), JSON.stringify({ nextId: proposals.length + 1, batchCount, proposals }));
  if (config) writeFileSync(join(home, 'config.json'), JSON.stringify(config));
  writeFileSync(join(home, 'prs.json'), JSON.stringify(prs));
  writeFileSync(join(home, 'gh-calls.log'), '');
  const gh = join(home, 'fake-gh.cjs');
  writeFileSync(gh, FAKE_GH);
  chmodSync(gh, 0o755);
  const run = (...args) => execFileSync('node', [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, AGENTIC_RETRO_HOME: home, AGENTIC_RETRO_GH: gh, AGENTIC_RETRO_RUN: '' },
  });
  const ledger = () => JSON.parse(readFileSync(join(home, 'ledger.json'), 'utf8'));
  const status = (id) => ledger().proposals.find((p) => p.id === id);
  const ghCalls = () => readFileSync(join(home, 'gh-calls.log'), 'utf8').trim().split('\n').filter(Boolean);
  const setPrs = (next) => writeFileSync(join(home, 'prs.json'), JSON.stringify(next));
  return { run, ledger, status, ghCalls, setPrs };
}

const commits = (...headlines) => headlines.map((messageHeadline) => ({ messageHeadline }));

test('merged PR: surviving proposal IDs are accepted; missing IDs are neutral', () => {
  const s = setup({
    proposals: [
      proposal('P1', { pr: 'https://github.com/o/r/pull/7', commit: 'P1: shorten the map skill' }),
      proposal('P2', { pr: 'https://github.com/o/r/pull/7', commit: 'P2: rename helper' }),
    ],
    prs: { 7: { state: 'MERGED', commits: commits('P1: shorten the map skill', 'fixup') } },
  });
  s.run('sync');
  assert.equal(s.status('P1').status, 'accepted');
  assert.equal(s.status('P2').status, 'neutral');
});

test('closed unmerged PR: unknown intent is neutral per proposal', () => {
  const s = setup({
    proposals: [proposal('P1', { pr: '8', commit: 'P1: a' }), proposal('P2', { pr: '8', commit: 'P2: b' })],
    prs: { 8: { state: 'CLOSED', commits: commits('P1: a', 'P2: b') } },
  });
  s.run('sync');
  assert.equal(s.status('P1').status, 'neutral');
  assert.equal(s.status('P2').status, 'neutral');
  assert.match(s.status('P1').decision.reason, /intent|infer/i);
});

test('open PR: proposals stay open and statusAt is untouched', () => {
  const s = setup({
    proposals: [proposal('P1', { pr: '9', commit: 'P1: a' })],
    prs: { 9: { state: 'OPEN', commits: commits('P1: a') } },
  });
  s.run('sync');
  assert.equal(s.status('P1').status, 'open');
  assert.equal(s.status('P1').statusAt, null);
});

test('each distinct PR is checked once; settled proposals and report-mode ones are not checked', () => {
  const s = setup({
    proposals: [
      proposal('P1', { pr: '10', commit: 'P1: a' }),
      proposal('P2', { pr: '10', commit: 'P2: b' }),
      proposal('P3', { pr: '11', commit: 'P3: c', status: 'accepted' }),
      proposal('P4'),
    ],
    prs: { 10: { state: 'OPEN', commits: [] } },
  });
  s.run('sync');
  const calls = s.ghCalls();
  assert.equal(calls.length, 1, `expected one gh call, got: ${calls.join(' | ')}`);
  assert.match(calls[0], /^pr view 10 --json state,commits$/);
});

test('every status change sets statusAt to now', () => {
  const before = Date.now();
  const s = setup({
    proposals: [proposal('P1', { pr: '12', commit: 'P1: a' })],
    prs: { 12: { state: 'MERGED', commits: commits('P1: a') } },
  });
  s.run('sync');
  const at = Date.parse(s.status('P1').statusAt);
  assert.ok(at >= before - 1000 && at <= Date.now() + 1000, `statusAt not current: ${s.status('P1').statusAt}`);
});

test('unattended proposals stay open regardless of age or legacy expiry config', () => {
  const s = setup({
    proposals: [
      proposal('P1', { batch: 0 }),
      proposal('P2', { batch: 2 }),
      proposal('P3', { batch: 0, pr: '13', commit: 'P3: a' }),
      proposal('P4', { batch: 0, status: 'rejected', statusAt: '2026-01-02T00:00:00.000Z' }),
    ],
    prs: { 13: { state: 'OPEN', commits: commits('P3: a') } },
    batchCount: 100,
    config: { expireAfterBatches: 1 },
  });
  s.run('sync');
  assert.equal(s.status('P1').status, 'open');
  assert.equal(s.status('P1').statusAt, null);
  assert.equal(s.status('P2').status, 'open');
  assert.equal(s.status('P3').status, 'open');
  assert.equal(s.status('P3').statusAt, null);
  assert.equal(s.status('P4').status, 'rejected');
  assert.equal(s.status('P4').statusAt, '2026-01-02T00:00:00.000Z');
});

test('sync recovers historical expiries and resolves their PRs without overriding explicit decisions', () => {
  const expired = { status: 'expired', statusAt: '2026-01-02T00:00:00.000Z' };
  const s = setup({
    proposals: [
      proposal('P1', { ...expired, pr: '15' }),
      proposal('P2', { ...expired, pr: '16' }),
      proposal('P3', { ...expired, pr: '16' }),
      proposal('P4', { ...expired, pr: '17' }),
      proposal('P5', expired),
      proposal('P6', { status: 'accepted', pr: '18' }),
      proposal('P7', { status: 'rejected', pr: '19' }),
      proposal('P8', { ...expired, pr: '20' }), // lookup fails: still pending, not rejected
    ],
    prs: {
      15: { state: 'OPEN', commits: [] },
      16: { state: 'MERGED', commits: commits('P2: kept') },
      17: { state: 'CLOSED', commits: [] },
    },
  });
  s.run('sync');
  for (const id of ['P1', 'P5', 'P8']) assert.equal(s.status(id).status, 'open');
  assert.equal(s.status('P2').status, 'accepted');
  for (const id of ['P3', 'P4']) assert.equal(s.status(id).status, 'neutral');
  assert.equal(s.status('P6').status, 'accepted');
  assert.equal(s.status('P7').status, 'rejected');
  assert.equal(s.ghCalls().length, 4, 'shared PR checked once; explicit decisions not checked');
  const at = s.status('P1').statusAt;
  s.run('sync');
  assert.equal(s.status('P1').statusAt, at, 'recovery is idempotent');
});

test('sync separates explicit rejection from pending proposals for duplicate filtering', () => {
  const s = setup({
    proposals: [
      proposal('P1', { pr: '14', commit: 'P1: a', title: 'shorten the map skill' }),
      proposal('P2', { batch: 0, title: 'add a lint for dashes' }),
      proposal('P3', { batch: 3, title: 'still pending' }),
    ],
    prs: { 14: { state: 'CLOSED', commits: [] } },
  });
  s.run('sync');
  s.run('mark', 'P1', 'rejected');
  const rejected = s.run('ledger', '--status', 'rejected');
  const open = s.run('ledger', '--status', 'open');
  assert.match(rejected, /P1/);
  assert.match(rejected, /shorten the map skill/);
  assert.doesNotMatch(rejected, /P2|P3/);
  assert.match(open, /P2/);
  assert.match(open, /add a lint for dashes/);
  assert.match(open, /P3/);
  assert.doesNotMatch(open, /P1/);
  assert.doesNotMatch(s.run('ledger', '--status', 'expired'), /P\d/);
});

test('sync preserves inferred mixed outcomes, reopens them, and protects manual decisions', () => {
  const s = setup({
    proposals: [proposal('P1', { pr: '21' }), proposal('P2', { pr: '21' }), proposal('P3', { pr: '21' })],
    prs: { 21: { state: 'CLOSED', commits: [] } },
  });
  s.run('sync');
  const neutral = s.status('P1');
  s.run('sync');
  assert.deepEqual(s.status('P1'), neutral, 'neutral sync must not churn timestamps');
  const evidence = 'https://github.com/example/project/pull/21#issuecomment-1';
  s.run('resolve', 'P1', 'accepted', '--reason', 'Replacement keeps documentation', '--evidence', evidence);
  s.run('resolve', 'P2', 'rejected', '--reason', 'Maintainer rejected automatic installs', '--evidence', evidence);
  s.run('mark', 'P3', 'rejected');
  const settled = s.ledger().proposals;
  s.run('sync');
  assert.deepEqual(s.ledger().proposals, settled);
  const manual = s.status('P3');
  s.setPrs({ 21: { state: 'OPEN', commits: [] } });
  s.run('sync');
  for (const id of ['P1', 'P2']) {
    assert.equal(s.status(id).status, 'open');
    assert.equal(s.status(id).decision, undefined);
  }
  assert.deepEqual(s.status('P3'), manual);
  const reopened = s.ledger().proposals;
  s.run('sync');
  assert.deepEqual(s.ledger().proposals, reopened);
  s.setPrs({ 21: { state: 'MERGED', commits: commits('P1: docs') } });
  s.run('sync');
  assert.equal(s.status('P1').status, 'accepted');
  assert.equal(s.status('P2').status, 'neutral');
  assert.deepEqual(s.status('P3'), manual);
  const merged = s.ledger().proposals;
  s.run('sync');
  assert.deepEqual(s.ledger().proposals, merged, 'merged sync is idempotent too');
});

test('a surviving merged ID does not override stronger proposal-specific inference', () => {
  const s = setup({
    proposals: [proposal('P1', { pr: '23' }), proposal('P2', { pr: '23' }), proposal('P3', { pr: '23' })],
    prs: { 23: { state: 'MERGED', commits: commits('P1: docs', 'P2: installs', 'P3: migration') } },
  });
  for (const [id, status, reason] of [
    ['P1', 'accepted', 'Documentation adopted in a replacement'],
    ['P2', 'rejected', 'Install behavior reverted despite its surviving commit headline'],
    ['P3', 'neutral', 'Source changes conflict with the closure explanation'],
  ]) {
    s.run('resolve', id, status, '--reason', reason, '--evidence', 'https://github.com/example/project/pull/23');
  }
  const inferred = s.ledger().proposals;
  s.run('sync');
  assert.deepEqual(s.ledger().proposals, inferred);
  s.run('sync');
  assert.deepEqual(s.ledger().proposals, inferred, 'repeated sync preserves reasons, evidence, and timestamps');
});

test('failed or malformed PR lookups preserve inferred evidence, not reopen or reject it', () => {
  const s = setup({ proposals: [proposal('P1', { pr: '22' })] });
  s.run('resolve', 'P1', 'neutral', '--reason', 'Conflicting closure comments need source verification',
    '--evidence', 'https://github.com/example/project/pull/22');
  const inferred = s.status('P1');
  s.run('sync');
  assert.deepEqual(s.status('P1'), inferred);
  s.setPrs({ 22: { state: 'unexpected', commits: [] } });
  s.run('sync');
  assert.deepEqual(s.status('P1'), inferred);
  s.setPrs({ 22: { state: 'CLOSED', commits: [] } });
  s.run('sync');
  assert.deepEqual(s.status('P1'), inferred);
  s.setPrs({ 22: { state: 'OPEN', commits: [] } });
  s.run('sync');
  assert.equal(s.status('P1').status, 'open');
});

test('legacy accepted and rejected entries without provenance refuse inference', () => {
  const s = setup({ proposals: [proposal('P1', { status: 'accepted' }), proposal('P2', { status: 'rejected' })] });
  const before = s.ledger().proposals;
  for (const id of ['P1', 'P2']) assert.throws(() => s.run('resolve', id, 'neutral', '--reason', 'Uncertain',
    '--evidence', 'https://github.com/example/project/pull/1'), /manual decision/);
  assert.deepEqual(s.ledger().proposals, before);
});
