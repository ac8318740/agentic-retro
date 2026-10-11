import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir, run, readState } from './helpers/cli.js';

// Fake gh: logs its arguments and reports every PR as still open.
const FAKE_GH = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
fs.appendFileSync(path.join(__dirname, 'gh-calls.log'), process.argv.slice(2).join(' ') + '\\n');
process.stdout.write(JSON.stringify({ state: 'OPEN', commits: [] }));
`;

function withProposal() {
  const home = tempDir();
  run(home, ['propose', '--repo', '/repos/demo', '--category', 'clarity', '--title', 'Clarify the run skill']);
  return home;
}

const proposal = (home, id = 'P1') => readState(home, 'ledger.json').proposals.find((p) => p.id === id);

test('link sets the PR and commit on an existing proposal', () => {
  const home = withProposal();
  const { code } = run(home, ['link', 'P1', '--pr', 'https://github.com/o/r/pull/7', '--commit', 'abc123']);
  assert.equal(code, 0);
  assert.equal(proposal(home).pr, 'https://github.com/o/r/pull/7');
  assert.equal(proposal(home).commit, 'abc123');
});

test('link with only --pr sets the PR and leaves the commit alone', () => {
  const home = withProposal();
  assert.equal(run(home, ['link', 'P1', '--pr', 'https://github.com/o/r/pull/7']).code, 0);
  assert.equal(proposal(home).pr, 'https://github.com/o/r/pull/7');
  assert.equal(proposal(home).commit, null);
});

test('link with only --commit sets the commit and leaves the PR alone', () => {
  const home = withProposal();
  assert.equal(run(home, ['link', 'P1', '--commit', 'abc123']).code, 0);
  assert.equal(proposal(home).commit, 'abc123');
  assert.equal(proposal(home).pr, null);
});

test('link on an unknown proposal id exits non-zero and leaves the ledger unchanged', () => {
  const home = withProposal();
  const before = readFileSync(join(home, 'ledger.json'), 'utf8');
  const { code } = run(home, ['link', 'P99', '--pr', 'https://github.com/o/r/pull/7']);
  assert.notEqual(code, 0);
  assert.equal(readFileSync(join(home, 'ledger.json'), 'utf8'), before);
});

test('sync checks the PR that link attached', () => {
  const home = withProposal();
  const gh = join(home, 'fake-gh.cjs');
  writeFileSync(gh, FAKE_GH);
  chmodSync(gh, 0o755);
  writeFileSync(join(home, 'gh-calls.log'), '');
  run(home, ['link', 'P1', '--pr', 'https://github.com/o/r/pull/7', '--commit', 'abc123']);
  assert.equal(run(home, ['sync'], { env: { AGENTIC_RETRO_GH: gh } }).code, 0);
  const calls = readFileSync(join(home, 'gh-calls.log'), 'utf8');
  assert.match(calls, /pr view https:\/\/github\.com\/o\/r\/pull\/7/);
});
