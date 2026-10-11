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
  return { run, ledger, status, ghCalls };
}

const commits = (...headlines) => headlines.map((messageHeadline) => ({ messageHeadline }));

test('merged PR: proposals whose commit survived are accepted, dropped ones rejected', () => {
  const s = setup({
    proposals: [
      proposal('P1', { pr: 'https://github.com/o/r/pull/7', commit: 'P1: shorten the map skill' }),
      proposal('P2', { pr: 'https://github.com/o/r/pull/7', commit: 'P2: rename helper' }),
    ],
    prs: { 7: { state: 'MERGED', commits: commits('P1: shorten the map skill', 'fixup') } },
  });
  s.run('sync');
  assert.equal(s.status('P1').status, 'accepted');
  assert.equal(s.status('P2').status, 'rejected');
});

test('closed unmerged PR: every proposal in it is rejected', () => {
  const s = setup({
    proposals: [proposal('P1', { pr: '8', commit: 'P1: a' }), proposal('P2', { pr: '8', commit: 'P2: b' })],
    prs: { 8: { state: 'CLOSED', commits: commits('P1: a', 'P2: b') } },
  });
  s.run('sync');
  assert.equal(s.status('P1').status, 'rejected');
  assert.equal(s.status('P2').status, 'rejected');
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

test('a proposal open for expireAfterBatches batches expires, in both PR and report mode', () => {
  // batchCount 3: whether or not sync increments it, batch 0 is >= 3 old and batch 2 is < 3 old.
  const s = setup({
    proposals: [
      proposal('P1', { batch: 0 }),
      proposal('P2', { batch: 2 }),
      proposal('P3', { batch: 0, pr: '13', commit: 'P3: a' }),
      proposal('P4', { batch: 0, status: 'rejected', statusAt: '2026-01-02T00:00:00.000Z' }),
    ],
    prs: { 13: { state: 'OPEN', commits: commits('P3: a') } },
  });
  s.run('sync');
  assert.equal(s.status('P1').status, 'expired');
  assert.ok(s.status('P1').statusAt, 'expiry sets statusAt');
  assert.equal(s.status('P2').status, 'open');
  assert.equal(s.status('P3').status, 'expired');
  assert.equal(s.status('P4').status, 'rejected');
  assert.equal(s.status('P4').statusAt, '2026-01-02T00:00:00.000Z');
});

test('expireAfterBatches comes from config', () => {
  const s = setup({
    proposals: [proposal('P1', { batch: 9 }), proposal('P2', { batch: 0 })],
    batchCount: 10,
    config: { expireAfterBatches: 20 },
  });
  s.run('sync');
  assert.equal(s.status('P1').status, 'open');
  assert.equal(s.status('P2').status, 'open');
});

test('sync results appear in the never-re-propose lists', () => {
  const s = setup({
    proposals: [
      proposal('P1', { pr: '14', commit: 'P1: a', title: 'shorten the map skill' }),
      proposal('P2', { batch: 0, title: 'add a lint for dashes' }),
      proposal('P3', { batch: 3, title: 'still pending' }),
    ],
    prs: { 14: { state: 'CLOSED', commits: [] } },
  });
  s.run('sync');
  const rejected = s.run('ledger', '--status', 'rejected');
  const expired = s.run('ledger', '--status', 'expired');
  assert.match(rejected, /P1/);
  assert.match(rejected, /shorten the map skill/);
  assert.doesNotMatch(rejected, /P2|P3/);
  assert.match(expired, /P2/);
  assert.match(expired, /add a lint for dashes/);
  assert.doesNotMatch(expired, /P1|P3/);
});
