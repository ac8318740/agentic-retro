import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULTS } from '../cli/lib/config.js';
import { buildCommand } from '../cli/lib/runner.js';
import { writeBatchDigests } from '../cli/lib/digest.js';
import { tempDir } from './helpers/cli.js';

// A single session is enough to exercise buildCommand's model flag; the repo
// just needs to exist so workDirs has something to add.
const SESSIONS = [{ harness: 'claude', sessionId: 's1', transcript: '/t/s1.jsonl', cwd: '/work/alpha', repo: '/work/alpha', endedAt: '2026-10-01T10:00:00.000Z' }];

function build(runner) {
  process.env.AGENTIC_RETRO_HOME = tempDir();
  const config = { ...DEFAULTS, runner: { ...DEFAULTS.runner, ...runner } };
  return buildCommand(config, tempDir(), 7, SESSIONS);
}

// opus is a Claude model; codex and pi have their own default models and no --model/-m flag of their own that understands it.
test('codex with runner.model opus: no -m flag at all', () => {
  const cmd = build({ harness: 'codex', model: 'opus' });
  assert.ok(!cmd.args.includes('-m'), `${cmd.args}`);
});

test('pi with runner.model opus: no --model flag at all', () => {
  const cmd = build({ harness: 'pi', model: 'opus' });
  assert.ok(!cmd.args.includes('--model'), `${cmd.args}`);
});

test('claude with runner.model opus: --model opus is present', () => {
  const cmd = build({ harness: 'claude', model: 'opus' });
  const i = cmd.args.indexOf('--model');
  assert.ok(i !== -1, `${cmd.args}`);
  assert.equal(cmd.args[i + 1], 'opus');
});

test('codex with runner.model o3: -m o3 is present', () => {
  const cmd = build({ harness: 'codex', model: 'o3' });
  const i = cmd.args.indexOf('-m');
  assert.ok(i !== -1, `${cmd.args}`);
  assert.equal(cmd.args[i + 1], 'o3');
});

// A synthetic transcript: 2 real user messages plus 1 line where another Claude
// session relayed a message. isMeta is unset on the relayed line, same as a real
// user turn, so only the leading text distinguishes it.
function writeSyntheticTranscript(path) {
  const lines = [
    { type: 'user', sessionId: 'synth', cwd: '/work/demo', timestamp: '2026-10-02T10:00:00.000Z', message: { role: 'user', content: 'Refactor the parser' } },
    { type: 'user', sessionId: 'synth', cwd: '/work/demo', timestamp: '2026-10-02T10:00:01.000Z', message: { role: 'user', content: 'Another Claude session sent a message:\n<agent-message from="x">hello</agent-message>' } },
    { type: 'user', sessionId: 'synth', cwd: '/work/demo', timestamp: '2026-10-02T10:00:02.000Z', message: { role: 'user', content: 'Keep the tests passing' } },
  ];
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

test('claude reader: a relayed "Another Claude session sent a message:" line is not a user turn', async () => {
  const home = tempDir();
  process.env.AGENTIC_RETRO_HOME = home;
  const transcript = join(home, 'synth.jsonl');
  writeSyntheticTranscript(transcript);
  const session = { harness: 'claude', sessionId: 'synth', transcript, cwd: '/work/demo', repo: '/work/demo', endedAt: '2026-10-02T11:00:00.000Z' };
  await writeBatchDigests(1, [session]);
  const metrics = JSON.parse(readFileSync(join(home, 'metrics.jsonl'), 'utf8').trim());
  assert.equal(metrics.userTurns, 2);
});
