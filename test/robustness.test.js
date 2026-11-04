import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir, run, readState, enabledRepo } from './helpers/cli.js';

const repo = enabledRepo();

function proposal(id, fields = {}) {
  return { id, batch: 1, repo, category: 'clarity', risk: null, title: `title ${id}`, status: 'open',
    createdAt: '2026-01-01T00:00:00.000Z', statusAt: null, pr: null, commit: null, ...fields };
}

function withLedger(proposals, { batchCount = 1, config } = {}) {
  const home = tempDir();
  writeFileSync(join(home, 'ledger.json'), JSON.stringify({ nextId: proposals.length + 1, batchCount, proposals }));
  if (config) writeFileSync(join(home, 'config.json'), JSON.stringify(config));
  return home;
}

const proposalById = (home, id) => readState(home, 'ledger.json').proposals.find((p) => p.id === id);

// notice

test('notice says "1 new proposal" for a single proposal', () => {
  const home = withLedger([proposal('P1', { pr: 'https://github.com/x/y/pull/1' })], { config: { output: 'pr' } });
  const line = run(home, ['notice', '--cwd', repo]).stdout.trim();
  assert.match(line, /\b1 new proposal\b/);
  assert.doesNotMatch(line, /1 new proposals/);
});

test('notice in PR mode with no PR links still counts proposals and has no dangling colon', () => {
  const home = withLedger([proposal('P1'), proposal('P2')], { config: { output: 'pr' } });
  const { code, stdout } = run(home, ['notice', '--cwd', repo]);
  assert.equal(code, 0);
  const line = stdout.trim();
  assert.match(line, /2 new proposals/);
  assert.doesNotMatch(stdout, /:\s*$/);
});

test('notice in PR mode counts proposals without a PR alongside linked ones', () => {
  const home = withLedger([proposal('P1', { pr: 'https://github.com/x/y/pull/1' }), proposal('P2')],
    { config: { output: 'pr' } });
  const line = run(home, ['notice', '--cwd', repo]).stdout.trim();
  assert.match(line, /2 new proposals/);
  assert.match(line, /https:\/\/github\.com\/x\/y\/pull\/1/);
  assert.doesNotMatch(line, /,\s*$|:\s*$/);
});

// config

test('config set on an object-valued key exits non-zero and leaves config unchanged', () => {
  const home = tempDir();
  run(home, ['config', 'set', 'batch.size', '3']);
  const before = readFileSync(join(home, 'config.json'), 'utf8');
  const { code } = run(home, ['config', 'set', 'batch', '7']);
  assert.notEqual(code, 0);
  assert.equal(readFileSync(join(home, 'config.json'), 'utf8'), before);
});

// sync

// Fake gh: fails for PR 1, reports every other PR as closed.
const FAILING_GH = `#!/usr/bin/env node
const pr = String(process.argv[4]).split('/').pop();
if (pr === '1') { process.stderr.write('gh: network error\\n'); process.exit(1); }
process.stdout.write(JSON.stringify({ state: 'CLOSED', commits: [] }));
`;

test('sync keeps going when gh fails for one PR: other PRs update, expiry applies, ledger saved', () => {
  const home = withLedger([
    proposal('P1', { pr: 'https://github.com/x/y/pull/1', commit: 'P1: a' }),
    proposal('P2', { pr: 'https://github.com/x/y/pull/2', commit: 'P2: b' }),
    proposal('P3', { batch: 0 }),
  ], { batchCount: 5 });
  const gh = join(home, 'fake-gh.cjs');
  writeFileSync(gh, FAILING_GH);
  chmodSync(gh, 0o755);
  run(home, ['sync'], { env: { AGENTIC_RETRO_GH: gh } });
  assert.equal(proposalById(home, 'P2').status, 'rejected');
  assert.equal(proposalById(home, 'P3').status, 'expired');
  assert.notEqual(proposalById(home, 'P1').status, 'rejected');
});

// enqueue

test('enqueue keeps the sessions in the queue when the batch hand-off fails', () => {
  const home = tempDir();
  const cwd = enabledRepo();
  run(home, ['config', 'set', 'batch.size', '2']);
  // A file where the batches folder should be makes writing the batch manifest fail.
  writeFileSync(join(home, 'batches'), 'not a folder');
  const env = { AGENTIC_RETRO_LAUNCHER: '/bin/false' };
  for (const id of ['s1', 's2']) {
    run(home, ['enqueue', '--harness', 'claude', '--session', id, '--transcript', `/t/${id}.jsonl`, '--cwd', cwd], { env });
  }
  const queued = (readState(home, 'queue.json') ?? []).map((s) => s.sessionId).sort();
  assert.deepEqual(queued, ['s1', 's2']);
});

test('enqueue with hook JSON missing session_id exits 0 and queues nothing', () => {
  const home = tempDir();
  const cwd = tempDir('agentic-retro-plain-');
  const hook = { transcript_path: '/t/x.jsonl', cwd, hook_event_name: 'SessionEnd' };
  const { code } = run(home, ['enqueue', '--harness', 'claude'], { input: JSON.stringify(hook) });
  assert.equal(code, 0);
  assert.deepEqual(readState(home, 'queue.json') ?? [], []);
});

// ledger

test('ledger --status takes a comma list and shows only those statuses', () => {
  const home = withLedger([
    proposal('P1', { status: 'open' }),
    proposal('P2', { status: 'accepted' }),
    proposal('P3', { status: 'rejected' }),
    proposal('P4', { status: 'expired' }),
  ]);
  const { code, stdout } = run(home, ['ledger', '--status', 'rejected,expired']);
  assert.equal(code, 0);
  assert.match(stdout, /\bP3\b/);
  assert.match(stdout, /\bP4\b/);
  assert.doesNotMatch(stdout, /\bP1\b|\bP2\b/);
});
